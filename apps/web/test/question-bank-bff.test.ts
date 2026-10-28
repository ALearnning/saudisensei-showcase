import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchBffRoute, sanitizeQuery, genericError, isSameOrigin, isAllowedFetchSite, readBoundedBody } from "../src/lib/bff-policy";

const questions = ["admin", "question-bank", "questions"];
const skills = ["admin", "skills"];
const question = [...questions, "11111111-1111-4111-8111-111111111111"];
const id = "22222222-2222-4222-8222-222222222222";
const query = (search: string, path = questions, method = "GET") =>
  new URLSearchParams(sanitizeQuery(new URLSearchParams(search), { method, path }).slice(1));

test("Q3 BFF prepares only exact Admin Question Bank and Skill method/routes", () => {
  for (const [method, path] of [
    ["GET", questions], ["POST", questions], ["GET", question], ["PATCH", question],
    ["GET", [...question, "revisions"]], ["POST", [...question, "revisions"]],
    ["GET", [...question, "revisions", id]], ["POST", [...question, "archive"]],
    ["GET", skills], ["POST", skills], ["GET", [...skills, id]], ["PATCH", [...skills, id]],
    ["POST", [...skills, id, "move"]], ["POST", [...skills, id, "archive"]],
  ] as const) assert.equal(matchBffRoute(method, path), true, `${method} ${path.join("/")}`);
  for (const [method, path] of [
    ["DELETE", question], ["PUT", question], ["PATCH", questions],
    ["POST", [...question, "restore"]], ["POST", [...question, "validate"]],
    ["PATCH", [...question, "revisions", id]], ["POST", [...question, "revisions", id]],
    ["POST", [...skills, id, "restore"]], ["GET", [...skills, id, "move"]],
    ["GET", ["question-bank", "questions"]], ["GET", ["skills"]],
    ["GET", ["me", "question-bank", "questions"]], ["GET", ["admin", "anything"]],
    ["POST", ["admin", "quizzes"]], ["GET", [...question, "revisions", id, "private"]],
    ["GET", [...questions, ".."]], ["GET", [...questions, "%2f"]],
  ] as const) assert.equal(matchBffRoute(method, path), false, `${method} ${path.join("/")}`);
});

test("Question Bank filters are bounded and forwarded only on its exact GET list", () => {
  const params = query(`page=100000&pageSize=50&search=${"س".repeat(200)}&status=active&type=short_text&primarySkillId=${id}&cognitiveTag=code_tracing&difficulty=hard&locale=ar&token=private&parentId=root&courseId=wrong`);
  assert.equal(params.get("page"), "100000");
  assert.equal(params.get("search")?.length, 200);
  for (const [key, value] of Object.entries({
    pageSize: "50", status: "active", type: "short_text", primarySkillId: id,
    cognitiveTag: "code_tracing", difficulty: "hard", locale: "ar",
  })) assert.equal(params.get(key), value);
  for (const key of ["token", "parentId", "courseId"]) assert.equal(params.has(key), false);
  assert.equal(query(`page=100001&pageSize=51&search=${"s".repeat(201)}&status=published&type=code&primarySkillId=bad&cognitiveTag=ai&difficulty=extreme&locale=fr`).size, 0);
  assert.equal(query("page=0&pageSize=0").size, 0);
  const additional = `type=ordering&primarySkillId=${id}&cognitiveTag=concept&difficulty=easy&locale=en&parentId=root`;
  for (const [path, method] of [[questions, "POST"], [question, "GET"], [skills, "GET"], [["admin", "courses"], "GET"]] as const) {
    const sanitized = new URLSearchParams(sanitizeQuery(new URLSearchParams(additional), { method, path }).slice(1));
    for (const key of ["type", "primarySkillId", "cognitiveTag", "difficulty", "locale"]) assert.equal(sanitized.has(key), false);
  }
  assert.equal(sanitizeQuery(new URLSearchParams(additional)), "");
});

test("Skill and revision pagination/filter contexts do not expand existing LMS query policy", () => {
  assert.equal(query("parentId=root&status=archived&pageSize=50", skills).get("parentId"), "root");
  assert.equal(query(`parentId=${id}`, skills).get("parentId"), id);
  assert.equal(query("parentId=../admin", skills).size, 0);
  assert.equal(query(`search=${"s".repeat(121)}`, skills).size, 0);
  const revisions = query("page=2&pageSize=10&search=no&status=active&type=ordering", [...question, "revisions"]);
  assert.deepEqual([...revisions], [["page", "2"], ["pageSize", "10"]]);
  assert.equal(sanitizeQuery(new URLSearchParams("page=2&pageSize=20&status=draft&evil=1")), "?page=2&pageSize=20&status=draft");
  assert.equal(sanitizeQuery(new URLSearchParams(`search=${"s".repeat(101)}`)), "");
});

test("Q3 reuses session-token isolation, Origin, no-store, bounded body and generic-error BFF protections", async () => {
  const route = await readFile(new URL("../src/app/lms-api/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(route, /sanitizeQuery\(req\.nextUrl\.searchParams, \{ method, path \}\)/);
  for (const required of ["getSession()", "getAccessToken()", 'cache: "no-store"', 'redirect: "manual"', "readBoundedBody(req.body, MAX_BODY)", "isSameOrigin(", "isAllowedFetchSite(", "genericError("]) {
    assert.ok(route.includes(required), required);
  }
  assert.equal(isSameOrigin("https://other.invalid", "https://app.invalid"), false);
  assert.equal(isSameOrigin("https://app.invalid", "https://app.invalid"), true);
  assert.equal(isAllowedFetchSite("cross-site"), false);
  assert.deepEqual(genericError({ code: "QUESTION_CHANGED", gradingDefinition: { correctValue: true }, token: "secret" }, "REQUEST_FAILED"), { code: "QUESTION_CHANGED" });
  const oversized = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(200001)); controller.close();
  } });
  assert.deepEqual(await readBoundedBody(oversized, 200000), { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" });
});

test("both emitted SDKs preserve exactly named Q3 operations, without public grading operations", async () => {
  const react = await readFile(new URL("../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");
  const zod = await readFile(new URL("../../../lib/api-zod/src/generated/api.ts", import.meta.url), "utf8");
  for (const operation of [
    "adminQuestionBankList", "adminQuestionBankCreate", "adminQuestionBankGet", "adminQuestionBankEdit",
    "adminQuestionBankRevisionList", "adminQuestionBankSeal", "adminQuestionBankRevisionGet", "adminQuestionBankArchive",
    "adminSkillList", "adminSkillCreate", "adminSkillGet", "adminSkillEdit", "adminSkillMove", "adminSkillArchive",
  ]) {
    assert.match(react, new RegExp(`export const ${operation} = async \\(`));
    const name = operation[0].toUpperCase() + operation.slice(1);
    assert.match(zod, new RegExp(`export const ${name}(Body|Response|Params|Query|Path)`));
  }
  assert.doesNotMatch(react, /\/assessment-attempts\/[^`]*\/(?:results|grade)|\/student\/question-bank|adminQuestionBankValidate/);
});
