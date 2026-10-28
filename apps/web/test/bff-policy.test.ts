import { test } from "node:test";
import assert from "node:assert/strict";
import { apiBase, buildUpstreamUrl, genericError, isAllowedFetchSite, isSameOrigin, matchBffRoute, sanitizeQuery, safeRetryAfter } from "../src/lib/bff-policy";

test("only bounded numeric Retry-After values can cross the BFF", () => {
  assert.equal(safeRetryAfter("116"), "116");
  assert.equal(safeRetryAfter("0001"), "1");
  for (const value of [null, "0", "3601", "999999", "private-data", "60\r\nX-Other: value"]) {
    assert.equal(safeRetryAfter(value), undefined);
  }
});

const app = "https://application.example.invalid";
test("only exact app origin may mutate", () => {
  assert.equal(isSameOrigin(app, app), true);
  assert.equal(isSameOrigin(app, `${app}/`), true);
  for (const o of [null, "", "https://attacker.example.invalid", `${app}.evil.invalid`, "http://application.example.invalid", "null"]) assert.equal(isSameOrigin(o, app), false);
  assert.equal(isSameOrigin(app, undefined), false);
});
test("cross-site reads are rejected", () => {
  assert.equal(isAllowedFetchSite("same-origin"), true);
  assert.equal(isAllowedFetchSite(null), true);
  assert.equal(isAllowedFetchSite("cross-site"), false);
  assert.equal(isAllowedFetchSite("same-site"), false);
});
test("allowlist matches phase 1B routes and methods only", () => {
  assert.equal(matchBffRoute("GET", ["courses"]), true);
  assert.equal(matchBffRoute("PUT", ["me", "lessons", "abc", "completion"]), true);
  assert.equal(matchBffRoute("POST", ["admin", "courses", "c1", "publish"]), true);
  assert.equal(matchBffRoute("PUT", ["admin", "chapters", "c1", "lesson-order"]), true);
  assert.equal(matchBffRoute("PATCH", ["admin", "enrollments", "e1"]), true);
  assert.equal(matchBffRoute("DELETE", ["admin", "courses", "c1"]), false);
  assert.equal(matchBffRoute("POST", ["courses"]), false);
  assert.equal(matchBffRoute("GET", ["me"]), false);
  assert.equal(matchBffRoute("GET", ["admin", "protected"]), false);
  assert.equal(matchBffRoute("GET", ["admin", "courses", ".."]), false);
  assert.equal(matchBffRoute("GET", ["admin", "courses", "a/b"]), false);
  assert.equal(matchBffRoute("GET", ["courses", "x", "extra"]), false);
});
test("query is reduced to bounded allowlisted parameters", () => {
  assert.equal(sanitizeQuery(new URLSearchParams("page=2&pageSize=20&status=draft&evil=1")), "?page=2&pageSize=20&status=draft");
  assert.equal(sanitizeQuery(new URLSearchParams("page=-1&status=root&courseId=../x")), "");
  assert.equal(sanitizeQuery(new URLSearchParams(`search=${"a".repeat(101)}`)), "");
});
test("upstream origin is fixed and segments are encoded", () => {
  assert.equal(apiBase({ APP_BASE_URL: app }), `${app}/api/v1`);
  assert.equal(apiBase({ API_BASE_URL: "http://localhost:8080/api/v1/" }), "http://localhost:8080/api/v1");
  assert.equal(apiBase({}), null);
  assert.equal(buildUpstreamUrl("http://h/api/v1", ["courses", "a b"], ""), "http://h/api/v1/courses/a%20b");
});
test("errors are reduced to generic code and request id", () => {
  assert.deepEqual(genericError({ code: "COURSE_CHANGED", requestId: "r-1", stack: "x", message: "secret" }, "F"), { code: "COURSE_CHANGED", requestId: "r-1" });
  assert.deepEqual(genericError({ code: "<script>" }, "F"), { code: "F" });
  assert.deepEqual(genericError(null, "F"), { code: "F" });
});
