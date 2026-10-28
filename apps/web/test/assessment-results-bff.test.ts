import test from "node:test";
import assert from "node:assert/strict";
import { matchBffRoute, sanitizeQuery, genericError } from "../src/lib/bff-policy";
const id = "11111111-1111-4111-8111-111111111111";
test("Q6 exact GET result/review routes, no write/grade/system/telemetry/analytics wildcard", () => {
  for (const suffix of ["result", "review"]) {
    const path = ["me", "assessment-attempts", id, suffix];
    assert.equal(matchBffRoute("GET", path), true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(matchBffRoute(method, path), false);
    assert.equal(matchBffRoute("GET", [...path, "keys"]), false);
    assert.equal(sanitizeQuery(new URLSearchParams("userId=other&score=100&locale=en&release=true&pageSize=50"), { method: "GET", path }), "");
  }
  for (const suffix of ["results", "grade", "grading", "system", "telemetry", "guidance", "skills"])
    for (const method of ["GET", "POST"]) assert.equal(matchBffRoute(method, ["me", "assessment-attempts", id, suffix]), false);
});
test("Q6 errors cannot carry hidden scores, keys, explanations or job details", () => {
  assert.deepEqual(genericError({ code: "REVIEW_UNAVAILABLE", passed: true, earnedPoints: 3, correctAnswer: "private", explanation: "private", job: "private" }, "REQUEST_FAILED"), { code: "REVIEW_UNAVAILABLE" });
});
