import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import * as s from "../src/modules/assessments/quizzes/quizzes.schemas.js";
import { QuizzesService } from "../src/modules/assessments/quizzes/quizzes.service.js";
import type { AssessmentAccessService } from "../src/modules/assessments/assessment-access.service.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";
import type { LmsStore } from "../src/modules/courses/lms.store.js";

const draft = { defaultContentLocale: "ar", content: { ar: { title: "اختبار", instructions: "تعليمات" } },
  policy: { mode: "practice" } };
test("Q4 policy defaults differ by mode without overriding explicit authored policy", () => {
  const practice = s.quizDraftSchema.parse(draft).policy;
  assert.deepEqual(practice, { version: 1, mode: "practice", required: false, passBasisPoints: 7000,
    maxAttempts: null, timeLimitSeconds: null, opensAt: null, closesAt: null,
    shuffleQuestions: false, shuffleOptions: false, scoreVisibility: "after_grading",
    reviewVisibility: "after_grading", explanationVisibility: "after_grading", aiAnalysisEnabled: false });
  const graded = s.quizPolicyInputSchema.parse({ mode: "graded" });
  assert.equal(graded.maxAttempts, 1);
  assert.equal(graded.reviewVisibility, "manual_release"); assert.equal(graded.explanationVisibility, "manual_release");
  const authored = s.quizPolicyInputSchema.parse({ mode: "graded", required: true, maxAttempts: null,
    timeLimitSeconds: 10800, passBasisPoints: 0, shuffleQuestions: true, shuffleOptions: true,
    aiAnalysisEnabled: true, reviewVisibility: "never", explanationVisibility: "never", scoreVisibility: "manual_release" });
  assert.equal(authored.required, true); assert.equal(authored.maxAttempts, null); assert.equal(authored.passBasisPoints, 0);
  assert.equal(authored.aiAnalysisEnabled, true); assert.equal(authored.scoreVisibility, "manual_release");
});
test("Q6 exhaustive authoring combinations require score then review then explanation, with nonordinal release events", () => {
  const values = ["never", "after_grading", "after_attempt_limit", "manual_release"] as const;
  for (const scoreVisibility of values) for (const reviewVisibility of values) for (const explanationVisibility of values) {
    const expected = (reviewVisibility === "never" || reviewVisibility === scoreVisibility || scoreVisibility === "after_grading") &&
      (explanationVisibility === "never" || explanationVisibility === reviewVisibility || reviewVisibility === "after_grading");
    assert.equal(s.quizPolicyInputSchema.safeParse({ mode: "graded", maxAttempts: 2,
      scoreVisibility, reviewVisibility, explanationVisibility }).success, expected);
  }
  for (const field of ["scoreVisibility", "reviewVisibility", "explanationVisibility"]) {
    assert.equal(s.quizPolicyInputSchema.safeParse({ mode: "practice", [field]: "after_attempt_limit" }).success, false);
  }
});
test("Q4 policy validates bounded thresholds, counts, durations and strict UTC availability windows", () => {
  for (const invalid of [{ passBasisPoints: -1 }, { passBasisPoints: 10001 }, { passBasisPoints: 2.5 },
    { maxAttempts: 0 }, { maxAttempts: 2147483648 }, { maxAttempts: 1.1 },
    { timeLimitSeconds: 59 }, { timeLimitSeconds: 10801 }, { opensAt: "2026-01-01" },
    { opensAt: "2026-01-01T00:00:00Z", closesAt: "2026-01-01T00:00:00Z" },
    { opensAt: "2026-01-02T00:00:00Z", closesAt: "2026-01-01T00:00:00Z" }, { mode: "exam" }, { arbitrary: true }]) {
    assert.equal(s.quizPolicyInputSchema.safeParse({ mode: "graded", ...invalid }).success, false, JSON.stringify(invalid));
  }
  for (const valid of [{ timeLimitSeconds: 60 }, { opensAt: "2026-01-01T00:00:00Z" },
    { closesAt: "2026-01-02T00:00:00Z" },
    { opensAt: "2026-01-01T00:00:00Z", closesAt: "2026-01-02T00:00:00Z", passBasisPoints: 10000 }]) {
    assert.equal(s.quizPolicyInputSchema.safeParse({ mode: "graded", ...valid }).success, true);
  }
});
test("Q4 localized metadata requires only default authored locale and rejects unsafe/oversized content and foreign fields", () => {
  assert.equal(s.quizDraftSchema.safeParse(draft).success, true);
  assert.equal(s.quizDraftSchema.safeParse({ ...draft, defaultContentLocale: "en",
    content: { en: { title: "Quiz", instructions: "" } } }).success, true);
  assert.equal(s.quizDraftSchema.safeParse({ ...draft, content: { ...draft.content, en: { title: "Quiz", instructions: "Instructions" } } }).success, true);
  for (const invalid of [{ ...draft, defaultContentLocale: "en" }, { ...draft, content: {} },
    { ...draft, parentId: randomUUID() }, { ...draft, content: { ar: { title: " ", instructions: "" } } },
    { ...draft, content: { ar: { title: "Quiz", instructions: "<script>alert(1)</script>" } } },
    { ...draft, content: { ar: { title: "Quiz", instructions: "[link](https://example.com)" } } },
    { ...draft, content: { ar: { title: "Quiz", instructions: "a".repeat(20001) } } }]) {
    assert.equal(s.quizDraftSchema.safeParse(invalid).success, false);
  }
  assert.equal(s.quizCreateSchema.safeParse({ draft, courseId: randomUUID() }).success, false);
});
test("Q4 item composition enforces exact IDs, unique lineage, contiguous ordering, points and maximum 100", () => {
  const item = { questionId: randomUUID(), questionRevisionId: randomUUID(), position: 0 };
  assert.equal(s.quizItemsSchema.safeParse({ expectedRevision: 0, items: [] }).success, true);
  assert.equal(s.quizItemsSchema.safeParse({ expectedRevision: 0, items: [item] }).success, true);
  const many = Array.from({ length: 100 }, (_, position) => ({ questionId: randomUUID(), questionRevisionId: randomUUID(), position, points: 1000 }));
  assert.equal(s.quizItemsSchema.safeParse({ expectedRevision: 0, items: many }).success, true);
  for (const items of [[{ ...item, questionRevisionId: "latest" }], [{ ...item, points: 0 }], [{ ...item, points: 1001 }],
    [{ ...item, position: 1 }], [item, { ...item, position: 1, questionRevisionId: randomUUID() }],
    [item, { ...item, questionId: randomUUID() }], [...many, { ...item, position: 100 }]]) {
    assert.equal(s.quizItemsSchema.safeParse({ expectedRevision: 0, items }).success, false);
  }
  assert.equal(s.quizItemsSchema.safeParse({ expectedRevision: 0, items: [item], reorderOnly: true }).success, false);
});
test("Q4 scope, pagination, concurrency and preview DTOs are closed and bounded", () => {
  for (const scope of ["courses", "chapters", "lessons"]) assert.equal(s.quizScopeSchema.safeParse(scope).success, true);
  for (const scope of ["course", "question-bank", "anything"]) assert.equal(s.quizScopeSchema.safeParse(scope).success, false);
  assert.deepEqual(s.quizListSchema.parse({}), { page: 1, pageSize: 20 });
  assert.equal(s.quizListSchema.safeParse({ pageSize: "51" }).success, false);
  assert.equal(s.quizListSchema.safeParse({ required: "false", mode: "practice", locale: "en" }).success, true);
  assert.equal(s.quizListSchema.safeParse({ status: "unpublished" }).success, false);
  assert.equal(s.quizMutationSchema.safeParse({ expectedRevision: -1 }).success, false);
  assert.equal(s.quizMutationSchema.safeParse({ expectedRevision: 0, parentId: randomUUID() }).success, false);
  assert.equal(s.quizPreviewSchema.safeParse({ expectedRevision: 0, locale: "ar" }).success, true);
  assert.equal(s.quizPreviewSchema.safeParse({ expectedRevision: 0, locale: "ar", includeAnswers: true }).success, false);
  assert.equal(s.quizReleaseSchema.safeParse({ clientMutationId: randomUUID() }).success, true);
  assert.equal(s.quizReleaseSchema.safeParse({ clientMutationId: "bad" }).success, false);
});
test("Q4 raw PostgreSQL serialization/deadlock retries are bounded, safe and do not retry arbitrary SQL errors", async () => {
  for (const state of ["40001", "40P01", "23514"]) {
    let calls = 0;
    const error = new Prisma.PrismaClientKnownRequestError("private raw SQL", { code: "P2010",
      clientVersion: "fixture", meta: { code: state } });
    const store = { transaction: async () => { calls++; throw error; } } as unknown as LmsStore;
    const service = new QuizzesService(store, {} as AssessmentAccessService);
    await assert.rejects(() => service.create({} as AuthenticatedRequest, "courses", randomUUID(), { draft }),
      (e: unknown) => state === "23514" ? e === error : e instanceof HttpException && e.message === "QUIZ_CHANGED");
    assert.equal(calls, state === "23514" ? 1 : 3);
  }
});
