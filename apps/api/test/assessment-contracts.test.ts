import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  quizPolicySchema, calculateDeadline, answerSchema, gradingDefinitionSchema,
  studentQuestionSchema, projectStudentQuestion, validateAnswerForQuestion, validateGradingDefinitionForQuestion,
  reviewFlagSchema, savedAnswerSchema, evidenceContextSchema,
  type QuizPolicy, type StudentQuestion,
} from "../src/modules/assessments/contracts/index.js";

const policy: QuizPolicy = {
  version: 1, mode: "graded", required: false, passBasisPoints: 7000,
  maxAttempts: 2, timeLimitSeconds: 1800, shuffleQuestions: false, shuffleOptions: false,
  scoreVisibility: "after_grading", reviewVisibility: "after_attempt_limit",
  explanationVisibility: "after_attempt_limit", aiAnalysisEnabled: false,
};
const question: StudentQuestion = {
  attemptQuestionId: "aq", type: "single_choice", locale: "en", prompt: "Select",
  options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], position: 0, points: 1,
};

test("policy validates optional UTC windows, safe integer bounds and independent visibility conditions", () => {
  assert.equal(quizPolicySchema.safeParse(policy).success, true);
  assert.equal(quizPolicySchema.safeParse({ ...policy, opensAt: null }).success, true);
  for (const patch of [
    { opensAt: "2026-01-01T10:00:00Z", closesAt: "2026-01-01T10:00:00Z" },
    { opensAt: "2026-01-01T10:00:00+03:00" }, { maxAttempts: null },
    { maxAttempts: 0 }, { timeLimitSeconds: -1 }, { timeLimitSeconds: 1.5 },
    { passBasisPoints: 10001 }, { reviewVisibility: "never", explanationVisibility: "after_grading" },
    { reviewVisibility: "manual_release", explanationVisibility: "after_attempt_limit" },
    { reviewVisibility: "after_attempt_limit", explanationVisibility: "manual_release" },
  ]) assert.equal(quizPolicySchema.safeParse({ ...policy, ...patch }).success, false);
  assert.equal(quizPolicySchema.safeParse({ ...policy, reviewVisibility: "after_grading", explanationVisibility: "manual_release" }).success, true);
  for (const timeLimitSeconds of [60, 10800, null]) {
    assert.equal(quizPolicySchema.safeParse({ ...policy, timeLimitSeconds }).success, true);
  }
  for (const timeLimitSeconds of [59, 10801]) {
    assert.equal(quizPolicySchema.safeParse({ ...policy, timeLimitSeconds }).success, false);
  }
  for (const points of [1, 1000]) assert.equal(studentQuestionSchema.safeParse({ ...question, points }).success, true);
  for (const points of [0, 1001]) assert.equal(studentQuestionSchema.safeParse({ ...question, points }).success, false);
});

test("pure deadline snapshot clips near closure and preserves exact-open/exclusive-close/tie/null boundaries", () => {
  const windowed = { ...policy, opensAt: "2026-01-01T20:00:00Z", closesAt: "2026-01-01T22:00:00Z" };
  assert.equal(calculateDeadline(windowed, "2026-01-01T21:50:00Z").deadlineAt, "2026-01-01T22:00:00.000Z");
  assert.equal(calculateDeadline(windowed, "2026-01-01T21:50:00Z").deadlineReason, "availability_close");
  assert.equal(calculateDeadline(windowed, "2026-01-01T21:30:00Z").deadlineReason, "both");
  assert.equal(calculateDeadline(windowed, "2026-01-01T20:00:00Z").deadlineReason, "time_limit");
  assert.throws(() => calculateDeadline(windowed, "2026-01-01T19:59:59Z"), /QUIZ_NOT_OPEN/);
  assert.throws(() => calculateDeadline(windowed, "2026-01-01T22:00:00Z"), /QUIZ_CLOSED/);
  assert.equal(calculateDeadline({ ...policy, timeLimitSeconds: null }, "2026-01-01T21:50:00Z").deadlineAt, null);
  assert.equal(calculateDeadline({ ...windowed, timeLimitSeconds: null }, "2026-01-01T21:50:00Z").deadlineReason, "availability_close");
  const snapshot = calculateDeadline(windowed, "2026-01-01T21:50:00Z");
  windowed.closesAt = "2026-01-02T22:00:00Z";
  assert.equal(snapshot.closesAt, "2026-01-01T22:00:00Z");
  assert.equal(Object.isFrozen(snapshot), true);
  const clipped = calculateDeadline({ ...policy, timeLimitSeconds: 60, closesAt: "2026-01-01T22:00:00Z" }, "2026-01-01T21:59:45Z");
  assert.equal(clipped.timeLimitSeconds, 60);
  assert.equal(clipped.deadlineAt, "2026-01-01T22:00:00.000Z");
  assert.equal(clipped.deadlineReason, "availability_close");
});

test("all five answer types preserve false and empty text; reject duplicate/unknown/partial data", () => {
  for (const answer of [
    { type: "single_choice", optionId: "a" }, { type: "multiple_choice", optionIds: ["a", "b"] },
    { type: "true_false", value: false }, { type: "short_text", text: "" },
    { type: "ordering", orderedItemIds: ["a", "b"] },
  ]) assert.equal(answerSchema.safeParse(answer).success, true);
  for (const answer of [
    { type: "multiple_choice", optionIds: ["a", "a"] }, { type: "multiple_choice", optionIds: [] },
    { type: "ordering", orderedItemIds: ["a", "a"] }, { type: "short_text", text: "a".repeat(2001) },
    { type: "true_false", value: false, correctValue: false },
  ]) assert.equal(answerSchema.safeParse(answer).success, false);
  assert.equal(validateAnswerForQuestion(question, null), null);
  assert.throws(() => validateAnswerForQuestion(question, { type: "single_choice", optionId: "unknown" }), /UNKNOWN_OPTION/);
  assert.throws(() => validateAnswerForQuestion(question, { type: "true_false", value: false }), /ANSWER_TYPE/);
  const ordering = { ...question, type: "ordering" as const, options: undefined, items: [...question.options!, { id: "c", label: "C" }] };
  assert.throws(() => validateAnswerForQuestion(ordering, { type: "ordering", orderedItemIds: ["a", "b"] }), /FULL_PERMUTATION/);
});

test("student projection recursively whitelists fields, never exposing private definitions", () => {
  const privateSource = {
    ...question, gradingDefinition: { type: "single_choice", correctOptionId: "a" },
    explanation: "Private", gradingHash: "private", taxonomyDraft: { private: true },
    options: question.options!.map((option) => ({ ...option, isCorrect: true, explanation: "Private" })),
    code: { language: "java" as const, source: "int n = 1;", secret: "private" },
  };
  assert.equal(studentQuestionSchema.safeParse(privateSource).success, false);
  const dto = projectStudentQuestion(privateSource);
  const serialized = JSON.stringify(dto);
  for (const field of ["correctOptionId", "gradingDefinition", "explanation", "gradingHash", "taxonomyDraft", "isCorrect", "secret"]) {
    assert.equal(serialized.includes(field), false, field);
  }
  privateSource.options[0].label = "Changed";
  assert.equal(dto.options![0].label, "A");
  assert.equal(gradingDefinitionSchema.safeParse(privateSource.gradingDefinition).success, true);
  assert.equal(studentQuestionSchema.safeParse({ ...question, type: "short_text" }).success, false);
});

test("server-private definitions validate exact presentation membership and explicit locale normalization", () => {
  assert.throws(() => validateGradingDefinitionForQuestion(question, { type: "single_choice", correctOptionId: "missing" }), /UNKNOWN_OPTION/);
  assert.throws(() => validateGradingDefinitionForQuestion(question, { type: "true_false", correctValue: true }), /GRADING_TYPE/);
  const definition = {
    type: "short_text",
    normalizer: { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false },
    acceptedByLocale: { ar: ["نعم"] },
  };
  const textQuestion = { ...question, type: "short_text" as const, options: undefined };
  assert.throws(() => validateGradingDefinitionForQuestion(textQuestion, definition), /MISSING_ACCEPTED_LOCALE/);
  assert.equal(validateGradingDefinitionForQuestion({ ...textQuestion, locale: "ar" }, definition).type, "short_text");
  assert.equal(gradingDefinitionSchema.safeParse({ ...definition, normalizer: { ...definition.normalizer, regex: ".*" } }).success, false);
});

test("review flags and answers have independent revisions and four evidence states retain missing-view context", () => {
  const flag = { attemptQuestionId: "aq", isFlagged: true, flagRevision: 2 };
  const answer = { attemptQuestionId: "aq", answer: null, answerRevision: 7 };
  assert.equal(reviewFlagSchema.safeParse(flag).success, true);
  assert.equal(savedAnswerSchema.safeParse(answer).success, true);
  assert.equal(reviewFlagSchema.safeParse({ ...flag, answerRevision: 7 }).success, false);
  assert.equal(savedAnswerSchema.safeParse({ ...answer, isFlagged: true }).success, false);
  for (const responseState of ["correct_answered", "incorrect_answered", "unanswered_viewed", "unanswered_unviewed"]) {
    assert.equal(evidenceContextSchema.safeParse({
      responseState, hasRecordedView: responseState === "unanswered_viewed",
      observationQuality: "unknown", finalizationReason: "availability_close",
    }).success, true);
  }
  assert.equal(evidenceContextSchema.safeParse({
    responseState: "unanswered_unviewed", hasRecordedView: true,
    observationQuality: "partial", finalizationReason: "time_limit",
  }).success, false);
});

// Source-level generator checks intentionally inspect emitted artifacts, not
// generator exit status. Run from repository root or apps/api.
const root = resolve(process.cwd(), process.cwd().endsWith("/apps/api") ? "../.." : ".");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
test("Q2 fragment stays schemas-only: registered operations and public schemas are emitted in both clients", () => {
  const fragment = read("lib/api-spec/assessments.yaml");
  assert.match(fragment, /paths: \{\}/);
  assert.doesNotMatch(fragment, /operationId:/);
  const client = read("lib/api-client-react/src/generated/api.ts");
  const zod = read("lib/api-zod/src/generated/api.ts");
  const fragments = readdirSync(resolve(root, "lib/api-spec")).filter((file) => file.endsWith(".yaml"));
  const operationIds = fragments.flatMap((file) => [...read(`lib/api-spec/${file}`).matchAll(/operationId:\s*(\w+)/g)].map((match) => match[1]));
  assert.equal(new Set(operationIds).size, operationIds.length);
  for (const operation of operationIds) {
    assert.match(client, new RegExp(`\\b${operation}\\b`), operation);
    const schemaOperation = operation[0].toUpperCase() + operation.slice(1);
    assert.match(zod, new RegExp(`\\b${schemaOperation}(?:Body|Response|Params|Query|Header|Path)`), operation);
  }
  const emittedOperations = [...client.matchAll(/export const (\w+) = async \(/g)].map((match) => match[1]);
  assert.deepEqual([...emittedOperations].sort(), [...operationIds].sort());
  assert.doesNotMatch(client, /\/assessment-attempts\/[^`]*\/(?:results|grade)|use\w*AssessmentGrade/);
  const types = read("lib/api-client-react/src/generated/api.schemas.ts");
  const runtime = read("lib/api-zod/src/assessment-contracts.ts");
  for (const name of ["AssessmentQuizPolicy", "AssessmentAnswer", "AssessmentStudentQuestion", "AssessmentReviewFlag", "AssessmentEvidenceContext"]) {
    assert.match(types, new RegExp(`\\b${name}\\b`));
    assert.match(runtime, new RegExp(`export const ${name} =`));
  }
  for (const token of ["single_choice", "multiple_choice", "true_false", "short_text", "ordering", "unanswered_unviewed", "opensAt", "closesAt", "flagRevision"]) {
    assert.ok(types.includes(token), token);
    assert.ok(runtime.includes(token), token);
  }
  assert.match(types, /export type AssessmentAnswer = .* \| /);
  assert.match(types, /export type AssessmentStudentQuestion = [\s\S]*?\|/);
  // Q3 adds explicitly Admin-prefixed private contracts to the same SDK file.
  // Keep the original isolation assertion on Q2 public declarations, not the
  // unrelated Admin authoring declarations.
  const publicTypes = [...types.matchAll(/export (?:type|interface|const) Assessment[\s\S]*?(?=\nexport |\s*$)/g)]
    .map(match => match[0]).join("\n");
  for (const output of [fragment, publicTypes, runtime]) assert.doesNotMatch(output, /correctOptionId|correctOptionIds|acceptedByLocale|gradingDefinition|gradingHash/);
});

test("generated reusable Zod schemas execute without fictional operations and retain answer unions", async () => {
  const generated = await import(pathToFileURL(resolve(root, "lib/api-zod/src/assessment-contracts.ts")).href);
  for (const value of [
    { type: "single_choice", optionId: "a" }, { type: "multiple_choice", optionIds: ["a"] },
    { type: "true_false", value: false }, { type: "short_text", text: "" },
    { type: "ordering", orderedItemIds: ["a", "b"] },
  ]) assert.equal(generated.AssessmentAnswer.safeParse(value).success, true);
  assert.equal(generated.AssessmentAnswer.safeParse({ type: "code_execution", source: "no" }).success, false);
  assert.equal(generated.AssessmentQuizPolicy.safeParse(policy).success, true);
  assert.equal(generated.AssessmentQuizPolicy.safeParse({ ...policy, passBasisPoints: -1 }).success, false);
  for (const timeLimitSeconds of [60, 10800, null]) {
    assert.equal(generated.AssessmentQuizPolicy.safeParse({ ...policy, timeLimitSeconds }).success, true);
  }
  for (const timeLimitSeconds of [59, 10801]) {
    assert.equal(generated.AssessmentQuizPolicy.safeParse({ ...policy, timeLimitSeconds }).success, false);
  }
  for (const points of [1, 1000]) assert.equal(generated.AssessmentStudentQuestion.safeParse({ ...question, points }).success, true);
  for (const points of [0, 1001]) assert.equal(generated.AssessmentStudentQuestion.safeParse({ ...question, points }).success, false);
  const projected = generated.AssessmentStudentQuestion.parse({ ...question, gradingDefinition: { correctOptionId: "a" } });
  assert.equal("gradingDefinition" in projected, false);
  assert.equal(generated.AssessmentStudentQuestion.safeParse({ ...question, options: undefined }).success, false);
});
