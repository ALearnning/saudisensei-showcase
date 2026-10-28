import { test } from "node:test";
import assert from "node:assert/strict";
import { areaOf, displayPercent, moveId, paths } from "../src/lib/lms-paths";
import { getLms } from "../src/i18n/lms";
import { isSupportedAuthReturnPath } from "../src/lib/auth-navigation";

test("localized LMS paths", () => {
  assert.equal(paths.lesson("ar", "c1", "l1"), "/ar/student/courses/c1/lessons/l1");
  assert.equal(paths.adminLesson("en", "c", "ch", "l"), "/en/admin/courses/c/chapters/ch/lessons/l");
  assert.equal(paths.course("en", "a/b"), "/en/student/courses/a%2Fb");
});
test("nested routes keep the top-level area; login return targets remain top-level only", () => {
  assert.equal(areaOf("/ar/student/courses/x"), "student");
  assert.equal(areaOf("/en/admin/students/y"), "admin");
  assert.equal(areaOf("/ar/login"), null);
  assert.equal(isSupportedAuthReturnPath("/ar/student"), true);
  assert.equal(isSupportedAuthReturnPath("/ar/student/courses/x"), false);
});
test("incomplete progress never displays 100%", () => {
  assert.equal(displayPercent(99.6, false), 99);
  assert.equal(displayPercent(100, true), 100);
  assert.equal(displayPercent(0, false), 0);
  assert.equal(displayPercent(NaN, false), 0);
});
test("reorder moves within complete sibling list", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.equal(moveId(["a", "b"], "a", -1), null);
  assert.equal(moveId(["a"], "z", 1), null);
});
test("LMS catalogs have identical keys in Arabic and English", () => {
  const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]).sort();
  assert.deepEqual(keys(getLms("ar")), keys(getLms("en")));
});
