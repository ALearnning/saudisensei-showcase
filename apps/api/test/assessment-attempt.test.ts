import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@workspace/saudisensei-database";
import { calculateDeadline, quizPolicySchema } from "../src/modules/assessments/contracts/policy.js";
import { AttemptsService, canonical, shuffle } from "../src/modules/assessments/attempts/attempts.service.js";
import type { LmsStore } from "../src/modules/courses/lms.store.js";
import type { AssessmentAccessService } from "../src/modules/assessments/assessment-access.service.js";
import { flagSchema, saveSchema, startReceiptSchema, startSchema, submitSchema } from "../src/modules/assessments/attempts/attempts.schemas.js";

const base = quizPolicySchema.parse({ version: 1, mode: "practice", required: false, passBasisPoints: 7000,
  maxAttempts: null, timeLimitSeconds: null, shuffleQuestions: false, shuffleOptions: false,
  scoreVisibility: "after_grading", reviewVisibility: "after_grading", explanationVisibility: "after_grading", aiAnalysisEnabled: false });
test("Q5 deadline boundaries: untimed, duration, window, clipping and equal cutoffs", () => {
  const now = "2026-01-01T00:00:00.000Z", close = "2026-01-01T00:01:00.000Z";
  assert.equal(calculateDeadline(base, now).deadlineAt, null);
  assert.equal(calculateDeadline({ ...base, timeLimitSeconds: 60 }, now).deadlineReason, "time_limit");
  assert.equal(calculateDeadline({ ...base, closesAt: close }, now).deadlineReason, "availability_close");
  assert.equal(calculateDeadline({ ...base, closesAt: close, timeLimitSeconds: 60 }, now).deadlineReason, "both");
  assert.equal(calculateDeadline({ ...base, closesAt: close, timeLimitSeconds: 120 }, now).deadlineAt, close);
  assert.equal(calculateDeadline({ ...base, opensAt: now }, now).startedAt, now);
  assert.throws(() => calculateDeadline({ ...base, opensAt: close }, now), /QUIZ_NOT_OPEN/);
  assert.throws(() => calculateDeadline({ ...base, closesAt: now }, now), /QUIZ_CLOSED/);
});
test("Q5 strict bounded mutation schemas reject impersonation, duplicates and stale field names", () => {
  const id = randomUUID(), clientMutationId = randomUUID();
  const change = { attemptQuestionId: id, expectedAnswerRevision: 0, answer: null };
  assert.equal(saveSchema.safeParse({ clientMutationId, changes: [change] }).success, true);
  for (const changes of [[], [change, change], Array.from({ length: 11 }, () => ({ ...change, attemptQuestionId: randomUUID() }))])
    assert.equal(saveSchema.safeParse({ clientMutationId, changes }).success, false);
  assert.equal(startSchema.safeParse({ clientMutationId, requestedContentLocale: "en", userId: id }).success, false);
  assert.equal(startSchema.safeParse({ clientMutationId, requestedContentLocale: "en", deadline: "tomorrow" }).success, false);
  assert.deepEqual(submitSchema.parse({ clientMutationId }).changes, []);
  assert.equal(flagSchema.safeParse({ clientMutationId, expectedAnswerRevision: 0, isFlagged: true }).success, false);
  assert.deepEqual(startReceiptSchema.parse({ attemptId: id }), { attemptId: id });
  assert.equal(startReceiptSchema.safeParse({ attemptId: id, questions: [] }).success, false);
});
test("Q5 canonical hashes ignore object key order and shuffle retains exact opaque identities", () => {
  assert.equal(canonical({ z: 1, a: { c: false, b: null } }), canonical({ a: { b: null, c: false }, z: 1 }));
  assert.notEqual(canonical(["a", "b"]), canonical(["b", "a"]));
  const source = Array.from({ length: 20 }, () => randomUUID());
  for (let n = 0; n < 20; n++) assert.deepEqual(shuffle(source).sort(), [...source].sort());
  assert.equal(source.length, 20);
});
test("Q5 retries only recognized Prisma PostgreSQL deadlock/serialization wrappers", async () => {
  let calls = 0;
  const deadlock = new Prisma.PrismaClientUnknownRequestError(
    'ConnectorError(PostgresError { code: "40P01", message: "deadlock detected" })',
    { clientVersion: "test" },
  );
  const store = { transaction: async (work: (tx: unknown) => Promise<unknown>) => {
    if (++calls === 1) throw deadlock;
    return work({});
  } } as unknown as LmsStore;
  const service = new AttemptsService(store, {} as AssessmentAccessService);
  assert.equal(await service.transaction(async () => "committed"), "committed");
  assert.equal(calls, 2);
  const unexpected = new Prisma.PrismaClientUnknownRequestError(
    'ConnectorError(PostgresError { code: "23514", message: "constraint violation" })',
    { clientVersion: "test" },
  );
  store.transaction = async () => { calls++; throw unexpected; };
  await assert.rejects(() => service.transaction(async () => "unreachable"), e => e === unexpected);
  assert.equal(calls, 3);
});
