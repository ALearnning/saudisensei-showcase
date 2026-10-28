import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateScore, gradeItem, GRADER_VERSION, correctAnswerPresentation } from "../src/modules/assessments/grading/deterministic-grader.js";
import type { GradingDefinition, StudentQuestion } from "../src/modules/assessments/contracts/questions.js";
import { visibilityPermits } from "../src/modules/assessments/grading/results.service.js";

const labels = ["a", "b", "c"].map(id => ({ id, label: id }));
const normalizer = { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false } as const;
const fixtures: [GradingDefinition, unknown, unknown][] = [
  [{ type: "single_choice", correctOptionId: "b" }, { type: "single_choice", optionId: "b" }, { type: "single_choice", optionId: "a" }],
  [{ type: "true_false", correctValue: false }, { type: "true_false", value: false }, { type: "true_false", value: true }],
  [{ type: "multiple_choice", correctOptionIds: ["a", "c"] }, { type: "multiple_choice", optionIds: ["c", "a"] }, { type: "multiple_choice", optionIds: ["a"] }],
  [{ type: "ordering", correctOrderedItemIds: ["c", "b", "a"] }, { type: "ordering", orderedItemIds: ["c", "b", "a"] }, { type: "ordering", orderedItemIds: ["a", "b", "c"] }],
  [{ type: "short_text", normalizer, acceptedByLocale: { en: ["é\nYes"], ar: ["نعم"] } }, { type: "short_text", text: "e\u0301\r\nYes" }, { type: "short_text", text: "é\nyes" }],
];
function input(definition: GradingDefinition, answer: unknown) {
  const question: StudentQuestion = { attemptQuestionId: "item", position: 0, points: 3, locale: "en", prompt: "Question", type: definition.type,
    ...(definition.type.endsWith("choice") ? { options: labels } : {}), ...(definition.type === "ordering" ? { items: labels } : {}) };
  return { schemaVersion: 1, graderVersion: GRADER_VERSION, question, definition, answer, hadRecordedView: false, coverage: "unknown" };
}
for (const [definition, correct, incorrect] of fixtures) {
  test(`${definition.type}: exact correct/incorrect/unanswered and all-or-nothing`, () => {
    const yes = gradeItem(input(definition, correct)), no = gradeItem(input(definition, incorrect)), blank = gradeItem(input(definition, null));
    assert.equal(yes.correct, true); assert.equal(yes.earnedPoints, 3); assert.equal(yes.responseState, "correct_answered");
    assert.equal(no.correct, false); assert.equal(no.earnedPoints, 0); assert.equal(no.responseState, "incorrect_answered");
    assert.equal(blank.earnedPoints, 0); assert.equal(blank.hadAcceptedAnswer, false); assert.equal(blank.responseState, "unanswered_unviewed");
    const viewed = gradeItem({ ...input(definition, null), hadRecordedView: true, coverage: "partial" });
    assert.equal(viewed.responseState, "unanswered_viewed"); assert.equal(viewed.coverage, "partial");
    assert.equal(gradeItem(input(definition, correctAnswerPresentation(definition, "en"))).correct, true);
  });
}
test("sets reject duplicate/unknown IDs and extra/missing choices earn zero; sequences cannot be subsets", () => {
  const d = fixtures[2]![0];
  for (const ids of [["a"], ["a", "b", "c"], ["b", "c"]]) assert.equal(gradeItem(input(d, { type: "multiple_choice", optionIds: ids })).earnedPoints, 0);
  for (const ids of [["a", "a"], ["foreign"]]) assert.throws(() => gradeItem(input(d, { type: "multiple_choice", optionIds: ids })));
  assert.throws(() => gradeItem(input(fixtures[3]![0], { type: "ordering", orderedItemIds: ["c", "b"] })));
});
test("short text uses only immutable authored normalization and selected locale; empty text is answered", () => {
  const definition: GradingDefinition = { type: "short_text", normalizer, acceptedByLocale: { en: ["A B", "Other"], ar: ["نَعَم"] } };
  const grade = (text: string, overrides = {}) => gradeItem(input({ ...definition, normalizer: { ...normalizer, ...overrides } }, { type: "short_text", text }));
  assert.equal(grade(" A B ").correct, false); assert.equal(grade(" A B ", { trim: true }).correct, true);
  assert.equal(grade("A\t B").correct, false); assert.equal(grade("A\t B", { collapseWhitespace: true }).correct, true);
  assert.equal(grade("a b").correct, false); assert.equal(grade("a b", { caseFold: true }).correct, true);
  assert.equal(grade("other").correct, false); assert.equal(grade("Other").correct, true);
  assert.equal(grade("نَعَم").correct, false);
  const ar = input(definition, { type: "short_text", text: "نَعَم" }); ar.question.locale = "ar";
  assert.equal(gradeItem(ar).correct, true); ar.answer = { type: "short_text", text: "نعم" }; assert.equal(gradeItem(ar).correct, false);
  assert.equal(grade("").responseState, "incorrect_answered");
  assert.equal(grade("A B.").correct, false);
});
test("checked integer aggregation uses exact basis-point boundary without display rounding", () => {
  const items = [{ earnedPoints: 2, possiblePoints: 2 }, { earnedPoints: 0, possiblePoints: 1 }];
  assert.deepEqual(aggregateScore(items, 6667), { earnedPoints: 2, possiblePoints: 3, passed: false });
  assert.equal(aggregateScore(items, 6666).passed, true);
  assert.equal(aggregateScore(items, 0).passed, true); assert.equal(aggregateScore(items, 10000).passed, false);
  assert.equal(aggregateScore([{ earnedPoints: 1, possiblePoints: 1 }], 10000).passed, true);
  assert.equal(aggregateScore(Array.from({ length: 100 }, () => ({ earnedPoints: 1000, possiblePoints: 1000 })), 10000).earnedPoints, 100000);
  for (const value of [NaN, Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER]) assert.throws(() => aggregateScore([{ earnedPoints: value, possiblePoints: 1 }], 7000));
  assert.throws(() => aggregateScore([], 7000)); assert.throws(() => aggregateScore(items, 10001));
});
test("incompatible versions and tampered frozen answer types fail closed", () => {
  const base = input(fixtures[1]![0], fixtures[1]![1]);
  assert.throws(() => gradeItem({ ...base, graderVersion: "future" }));
  assert.throws(() => gradeItem({ ...base, schemaVersion: 2 }));
  assert.throws(() => gradeItem({ ...base, answer: { type: "short_text", text: "false" } }));
});
test("visibility conditions are independent events and unlimited allowance is never exhausted", () => {
  assert.equal(visibilityPermits("never", 1, 3, true, false), false);
  assert.equal(visibilityPermits("after_grading", null, 0, false, true), true);
  assert.equal(visibilityPermits("manual_release", 1, 3, false, false), false);
  assert.equal(visibilityPermits("manual_release", null, 0, true, true), true);
  assert.equal(visibilityPermits("after_attempt_limit", 2, 1, true, false), false);
  assert.equal(visibilityPermits("after_attempt_limit", 2, 2, false, false), true);
  assert.equal(visibilityPermits("after_attempt_limit", 2, 2, true, true), false);
  assert.equal(visibilityPermits("after_attempt_limit", null, 100, true, false), false);
});
