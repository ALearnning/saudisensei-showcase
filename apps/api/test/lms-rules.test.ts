import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateProgress } from "../src/modules/progress/progress.service.js";
import * as input from "../src/modules/courses/lms.schemas.js";

test("zero required lessons is 0% and not complete", () => {
  const empty = calculateProgress([], new Set());
  assert.equal(empty.percentage, 0); assert.equal(empty.isCompleted, false);
  const optional = calculateProgress([{ id: "a", isRequired: false }], new Set(["a"]));
  assert.equal(optional.percentage, 0); assert.equal(optional.continueLessonId, "a");
});
test("only current eligible required completions affect progress", () => {
  const result = calculateProgress([{ id: "a", isRequired: true }, { id: "b", isRequired: true }, { id: "c", isRequired: false }], new Set(["a", "c", "removed"]));
  assert.equal(result.percentage, 50); assert.equal(result.remainingRequired, 1); assert.equal(result.continueLessonId, "b");
});
test("new required content reduces completed progress", () => {
  const first = [{ id: "a", isRequired: true }];
  assert.equal(calculateProgress(first, new Set(["a"])).isCompleted, true);
  assert.equal(calculateProgress([...first, { id: "b", isRequired: true }], new Set(["a"])).percentage, 50);
});
test("removing eligibility excludes completions without resetting history", () => {
  const history = new Set(["a", "b"]);
  assert.equal(calculateProgress([{ id: "a", isRequired: true }], history).percentage, 100);
  assert.equal(history.size, 2);
});
test("rounding does not report incomplete courses as 100%", () => {
  const lessons = Array.from({ length: 20000 }, (_, i) => ({ id: `${i}`, isRequired: true }));
  const progress = calculateProgress(lessons, new Set(lessons.slice(0, -1).map((l) => l.id)));
  assert.ok(progress.percentage < 100); assert.equal(progress.isCompleted, false);
});
test("restricted Markdown accepts headings lists inline and fenced code", () => {
  assert.equal(input.markdownIsRestricted("# عنوان\n- item\n`<span>`\n```html\n<div>example</div>\n```"), true);
});
test("raw HTML, images and executable link protocols are rejected", () => {
  for (const body of ["<script>alert(1)</script>", "<iframe src='external'></iframe>", "![asset](url)", "[run](javascript:alert(1))", "<!-- hidden -->"])
    assert.equal(input.markdownIsRestricted(body), false);
});
test("strict mutation schemas reject actor role progress and invalid state fields", () => {
  assert.equal(input.courseCreate.safeParse({ title: "Course", createdBy: "client" }).success, false);
  assert.equal(input.lessonEdit.safeParse({ expectedRevision: 0, isRequired: true, roles: ["admin"] }).success, false);
  assert.equal(input.enrollmentEdit.safeParse({ status: "active", percentage: 100 }).success, false);
  assert.equal(input.revisionInput.safeParse({ expectedRevision: -1 }).success, false);
  assert.equal(input.chapterEdit.safeParse({ expectedRevision: 0 }).success, false);
});
test("paging is bounded and unsupported query fields are rejected", () => {
  assert.equal(input.listInput.safeParse({ pageSize: 51 }).success, false);
  assert.equal(input.listInput.safeParse({ sort: "arbitrary SQL" }).success, false);
  assert.equal(input.listInput.parse({}).pageSize, 20);
});
