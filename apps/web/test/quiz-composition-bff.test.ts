import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchBffRoute, sanitizeQuery, genericError, isSameOrigin, isAllowedFetchSite, readBoundedBody } from "../src/lib/bff-policy";

const id = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const list = (scope = "courses") => ["admin", scope, id, "quizzes"];
const quiz = (scope = "courses") => [...list(scope), id];
const query = (search: string, path = list(), method = "GET") =>
  new URLSearchParams(sanitizeQuery(new URLSearchParams(search), { method, path }).slice(1));

test("Q4 BFF permits only explicit Admin quiz composition methods and closed parent scopes", () => {
  for (const scope of ["courses", "chapters", "lessons"]) {
    const collection = list(scope);
    const detail = quiz(scope);
    for (const [method, path] of [
      ["GET", collection], ["POST", collection], ["GET", detail], ["PATCH", detail],
      ["PUT", [...detail, "items"]], ["POST", [...detail, "preview"]],
      ["POST", [...detail, "answer-preview"]],
      ["POST", [...detail, "publish"]], ["POST", [...detail, "unpublish"]],
      ["POST", [...detail, "archive"]], ["GET", [...detail, "revisions"]],
      ["GET", [...detail, "revisions", revisionId]],
      ["POST", [...detail, "revisions", revisionId, "review-release"]],
    ] as const) assert.equal(matchBffRoute(method, path), true, `${method} ${path.join("/")}`);
  }
  for (const [method, path] of [
    ["GET", list("anything")], ["POST", list("students")], ["GET", ["admin", "quizzes"]],
    ["GET", ["courses", id, "quizzes", id, "results"]], ["POST", ["me", "quizzes", id, "attempts"]],
    ["POST", [...quiz(), "attempts"]], ["GET", [...quiz(), "attempts"]],
    ["DELETE", quiz()], ["PUT", quiz()], ["PATCH", list()],
    ["GET", [...quiz(), "preview"]], ["PATCH", [...quiz(), "items"]],
    ["GET", [...quiz(), "answer-preview"]], ["POST", [...quiz(), "preview", "answers"]],
    ["POST", [...quiz(), "restore"]], ["POST", [...quiz(), "anything"]],
    ["PATCH", [...quiz(), "revisions", revisionId]], ["POST", [...quiz(), "revisions"]],
    ["GET", [...quiz(), "revisions", revisionId, "review-release"]],
    ["POST", [...quiz(), "review-release"]], ["GET", ["admin", "courses", "..", "quizzes"]],
    ["GET", ["admin", "courses", "%2f", "quizzes"]],
  ] as const) assert.equal(matchBffRoute(method, path), false, `${method} ${path.join("/")}`);
});

test("Q4 quiz filters and revision pagination are bounded to exact list contexts", () => {
  const filtered = query("page=100000&pageSize=50&status=published&mode=graded&required=false&locale=ar&token=secret&courseId=wrong&search=hidden");
  assert.deepEqual(Object.fromEntries(filtered), {
    page: "100000", pageSize: "50", status: "published", mode: "graded", required: "false", locale: "ar",
  });
  assert.equal(query("page=0&pageSize=0&status=active&mode=exam&required=1&locale=fr").size, 0);
  assert.equal(query("page=100001&pageSize=51").size, 0);
  assert.equal(query("status=unpublished").has("status"), false);
  assert.deepEqual(Object.fromEntries(query("page=2&pageSize=10&status=archived&mode=practice&required=true&locale=en", [...quiz(), "revisions"])), {
    page: "2", pageSize: "10",
  });
  for (const [path, method] of [
    [list(), "POST"], [quiz(), "GET"], [quiz(), "PATCH"],
    [[...quiz(), "preview"], "POST"], [[...quiz(), "revisions", revisionId], "GET"],
  ] as const) assert.equal(query("page=2&status=published&mode=graded&required=true&locale=en&search=hidden", [...path], method).size, 0);
  for (const scope of ["chapters", "lessons"]) {
    assert.equal(query("mode=practice&required=true&locale=en", list(scope)).get("required"), "true");
  }
  // Approved LMS and Q3 query policies remain separate.
  assert.equal(sanitizeQuery(new URLSearchParams("page=2&pageSize=20&status=draft&mode=graded&required=true&locale=ar")), "?page=2&pageSize=20&status=draft");
});

test("Q4 keeps same-origin session BFF token isolation, no-store, generic errors and bounded bodies", async () => {
  const route = await readFile(new URL("../src/app/lms-api/[...path]/route.ts", import.meta.url), "utf8");
  for (const required of [
    "getSession()", "getAccessToken()", 'cache: "no-store"', 'redirect: "manual"',
    "readBoundedBody(req.body, MAX_BODY)", "isSameOrigin(", "isAllowedFetchSite(", "genericError(",
    "sanitizeQuery(req.nextUrl.searchParams, { method, path })",
  ]) assert.ok(route.includes(required), required);
  assert.equal(isSameOrigin("https://other.invalid", "https://app.invalid"), false);
  assert.equal(isSameOrigin(null, "https://app.invalid"), false);
  assert.equal(isSameOrigin("https://app.invalid", "https://app.invalid"), true);
  assert.equal(isAllowedFetchSite("cross-site"), false);
  assert.deepEqual(genericError({ code: "QUIZ_CHANGED", gradingDefinition: { correctValue: true }, token: "secret" }, "REQUEST_FAILED"), { code: "QUIZ_CHANGED" });
  const oversized = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(200001)); controller.close();
  } });
  assert.deepEqual(await readBoundedBody(oversized, 200000), { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" });
});

test("Q4 emitted operations preserve separate preview concepts and exclude public grading routes", async () => {
  const react = await readFile(new URL("../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");
  const zod = await readFile(new URL("../../../lib/api-zod/src/generated/api.ts", import.meta.url), "utf8");
  for (const operation of [
    "adminQuizList", "adminQuizCreate", "adminQuizGet", "adminQuizEdit", "adminQuizReplaceItems",
    "adminQuizPreview", "adminQuizAnswerPreview", "adminQuizPublish", "adminQuizUnpublish",
    "adminQuizArchive", "adminQuizRevisionList", "adminQuizRevisionGet", "adminQuizReviewRelease",
  ]) {
    assert.match(react, new RegExp(`export const ${operation} = async \\(`));
    const name = operation[0].toUpperCase() + operation.slice(1);
    assert.match(zod, new RegExp(`export const ${name}Response =`));
  }
  assert.ok(react.includes("/quizzes/${quizId}/preview"));
  assert.ok(react.includes("/quizzes/${quizId}/answer-preview"));
  assert.doesNotMatch(react, /\/me\/assessment-attempts\/[^`]*\/(?:results|grade)|\/student\/quizzes/);
});
