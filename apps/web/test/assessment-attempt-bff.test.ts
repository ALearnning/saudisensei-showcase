import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchBffRoute, sanitizeQuery, genericError, readBoundedBody } from "../src/lib/bff-policy";

const id = "11111111-1111-4111-8111-111111111111";
const attempt = ["me", "assessment-attempts", id];
const query = (path: readonly string[], method = "GET", search = `locale=en&pageSize=50&cursor=${id}&page=2&status=published&userId=secret&courseId=${id}&search=hidden`) =>
  new URLSearchParams(sanitizeQuery(new URLSearchParams(search), { method, path }).slice(1));

test("Q5 BFF permits only exact Student methods and assessment paths", () => {
  const allowed: [string, string[]][] = [
    ["GET", ["me", "assessment-attempts"]], ["GET", attempt],
    ["PUT", [...attempt, "answers"]], ["PUT", [...attempt, "questions", id, "flag"]],
    ["POST", [...attempt, "submit"]],
  ];
  for (const scope of ["courses", "chapters", "lessons"]) {
    allowed.push(["GET", [scope, id, "quizzes"]], ["GET", [scope, id, "quizzes", id]],
      ["POST", [scope, id, "quizzes", id, "attempts"]]);
  }
  for (const [method, path] of allowed) {
    assert.equal(matchBffRoute(method, path), true, `${method} ${path.join("/")}`);
    for (const other of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      if (!allowed.some(([m, p]) => m === other && p.join("/") === path.join("/"))) {
        assert.equal(matchBffRoute(other, path), false, `${other} ${path.join("/")}`);
      }
    }
  }
  for (const path of [
    [...attempt, "results"], [...attempt, "grade"],
    [...attempt, "questions", id, "answers"], [...attempt, "deadline"],
    ["me", "assessment-attempts", id, "reset"], ["students", id, "quizzes"],
    ["courses", id, "quizzes", id, "revisions"], ["courses", id, "quizzes", id, "preview"],
    ["me", "assessment-attempts", ".."], ["me", "assessment-attempts", "%2f"],
    ["me", "assessment-attempts", id, "submit", "anything"],
  ]) for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) assert.equal(matchBffRoute(method, path), false);
});

test("Q5 queries are context-specific, bounded and never forwarded to mutations or resume", () => {
  for (const path of [["courses", id, "quizzes"], ["chapters", id, "quizzes"], ["lessons", id, "quizzes"], ["me", "assessment-attempts"]]) {
    assert.deepEqual(Object.fromEntries(query(path)), { locale: "en", pageSize: "50", cursor: id });
    assert.equal(query(path, "GET", "locale=fr&pageSize=51&cursor=not-a-uuid").size, 0);
    assert.equal(query(path, "GET", "pageSize=0").size, 0);
    assert.equal(query(path, "POST").size, 0);
  }
  assert.deepEqual(Object.fromEntries(query(["courses", id, "quizzes", id])), { locale: "en" });
  for (const [path, method] of [
    [attempt, "GET"], [[...attempt, "answers"], "PUT"],
    [[...attempt, "questions", id, "flag"], "PUT"], [[...attempt, "submit"], "POST"],
    [["courses", id, "quizzes", id, "attempts"], "POST"],
  ] as const) assert.equal(query(path, method).size, 0);
});

test("Q5 preserves bounded bodies, generic errors and server-side same-origin BFF protections", async () => {
  const source = await readFile(new URL("../src/app/lms-api/[...path]/route.ts", import.meta.url), "utf8");
  for (const text of ["getSession()", "getAccessToken()", 'cache: "no-store"', 'redirect: "manual"',
    "readBoundedBody(req.body, MAX_BODY)", "isSameOrigin(", "isAllowedFetchSite(", "genericError("]) assert.ok(source.includes(text), text);
  assert.deepEqual(genericError({ code: "ANSWER_CHANGED", correctValue: true, answer: "secret", score: 99 }, "REQUEST_FAILED"), { code: "ANSWER_CHANGED" });
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(200001)); controller.close(); } });
  assert.deepEqual(await readBoundedBody(stream, 200000), { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" });
});
