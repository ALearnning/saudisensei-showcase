import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { HttpException } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@workspace/saudisensei-database";
import { AssessmentDatabaseFixture } from "./assessment-database.fixture.js";
import { LmsStore, type Actor, type Tx } from "../src/modules/courses/lms.store.js";
import { EnrollmentsService } from "../src/modules/enrollments/enrollments.service.js";
import { AssessmentAccessService } from "../src/modules/assessments/assessment-access.service.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";
import { QuestionBankService } from "../src/modules/assessments/question-bank/question-bank.service.js";
import { QuizzesService } from "../src/modules/assessments/quizzes/quizzes.service.js";
import { quizPolicyInputSchema } from "../src/modules/assessments/quizzes/quizzes.schemas.js";
import { AttemptsService } from "../src/modules/assessments/attempts/attempts.service.js";
import { AssessmentGradingService } from "../src/modules/assessments/grading/assessment-grading.service.js";
import { AssessmentResultsService, visibilityPermits } from "../src/modules/assessments/grading/results.service.js";

const mutation = () => ({ clientMutationId: randomUUID() });
const reject = (work: () => Promise<unknown>, code: string) =>
  assert.rejects(work, (e: unknown) => e instanceof HttpException && e.message === code);
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Test barriers surround real transactions; they do not replace locks or business logic.
class GatedStore extends LmsStore {
  afterAudit?: (action: string) => Promise<void>;
  override async audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject = {}) {
    await super.audit(tx, actor, action, entityType, entityId, metadata);
    await this.afterAudit?.(action);
  }
}
class SnapshotAttempts extends AttemptsService {
  constructor(store: LmsStore, access: AssessmentAccessService, private readonly enrollmentId: string,
    private readonly snapshot: () => void) { super(store, access); }
  override transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return super.transaction(async tx => {
      // Establish a real SERIALIZABLE snapshot before the competing start commits.
      await tx.enrollment.findUniqueOrThrow({ where: { id: this.enrollmentId } });
      this.snapshot();
      return work(tx);
    });
  }
}

test("Q6 review findings: PostgreSQL visibility, historical policies, races and maximum grading shape", { timeout: 180000 }, async t => {
  const f = new AssessmentDatabaseFixture();
  let db: PrismaClient | undefined;
  try {
    await f.setup(); await f.migrate();
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", f.schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const database = db, store = new GatedStore(db), enrollments = new EnrollmentsService(store);
    const access = new AssessmentAccessService(store, enrollments), bank = new QuestionBankService(store);
    const quizzes = new QuizzesService(store, access), attempts = new AttemptsService(store, access);
    const results = new AssessmentResultsService(attempts), worker = new AssessmentGradingService(store, attempts);
    const req = { user: { id: f.ids.user! }, mfaVerified: true, requestId: randomUUID() } as AuthenticatedRequest;
    for (const name of ["admin", "student"] as const) {
      const role = await db.role.upsert({ where: { name }, create: { name }, update: {} });
      await db.userRole.create({ data: { userId: req.user.id, roleId: role.id } });
    }
    const primary = await db.skill.create({ data: { slug: "visibility-primary", translations: { create: { locale: "en", label: "Primary" } } } });
    const questionDraft = { type: "true_false", defaultContentLocale: "en", content: { en: { prompt: "True?" } },
      gradingDefinition: { type: "true_false", correctValue: true }, explanation: { en: "Authored explanation" },
      defaultPoints: 1, difficulty: "easy", primarySkillId: primary.id, secondarySkillIds: [], cognitiveTags: ["concept"] };
    const makeQuestion = async (secondarySkillIds: string[] = []) => {
      const q = await bank.create(req, { draft: { ...questionDraft, secondarySkillIds } });
      const sealed = await bank.seal(req, q.id, { expectedRevision: 0 });
      return { questionId: q.id, questionRevisionId: sealed.revision.id, position: 0, points: 1 };
    };
    const item = await makeQuestion();
    const makeQuiz = async (policy: Record<string, unknown>, items = [item]) => {
      const draft = { defaultContentLocale: "en", content: { en: { title: "Visibility", instructions: "Begin" } }, policy: { mode: "practice", ...policy } };
      const q = await quizzes.create(req, "courses", f.ids.course!, { draft });
      await quizzes.replaceItems(req, "courses", f.ids.course!, q.id, { expectedRevision: 0, items });
      const published = await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 1 });
      return { id: q.id, draft, revisionId: published.revision.id };
    };
    const start = (quizId: string, engine = attempts) => engine.start(req, "courses", f.ids.course!, quizId,
      { ...mutation(), requestedContentLocale: "en" });
    const finish = async (attemptId: string) => {
      const lease = await worker.claim(); assert.ok(lease); assert.equal(lease.attemptId, attemptId);
      assert.equal(await worker.execute(lease), true);
    };
    const graded = async (quizId: string) => {
      const a = await start(quizId); await attempts.submit(req, a.attemptId, mutation()); await finish(a.attemptId); return a;
    };
    const withheld = async (id: string, reader = results) => {
      assert.deepEqual(await reader.result(req, id), { attemptId: id, state: "GRADED", status: "withheld" });
      await reject(() => reader.review(req, id), "REVIEW_UNAVAILABLE");
    };
    const available = async (id: string) => {
      assert.equal((await results.result(req, id)).status, "available");
      const review = await results.review(req, id);
      assert.deepEqual(review.questions[0]!.correctAnswer, { type: "true_false", value: true });
      assert.equal(review.questions[0]!.explanation, "Authored explanation");
    };
    const exhaustion = { maxAttempts: 2, scoreVisibility: "after_attempt_limit", reviewVisibility: "after_attempt_limit", explanationVisibility: "after_attempt_limit" };

    // Represent combinations legitimately published before B2. Insert a new sealed
    // revision using the unchanged Q2 constraints; never mutate history or disable triggers.
    const historicalQuiz = async (policy: Record<string, string | number>) => {
      const q = await makeQuiz({});
      const revision = await database.quizRevision.findUniqueOrThrow({ where: { id: q.revisionId }, include: { items: true } });
      const { id: _id, assemblyTransaction: _assembly, createdAt: _created, items, ...data } = revision;
      const r = await store.transaction(async tx => {
        const created = await tx.quizRevision.create({ data: { ...data, content: data.content as Prisma.InputJsonValue,
          number: 2, ...policy } });
        await tx.quizRevisionItem.createMany({ data: items.map(({ id: _itemId, quizRevisionId: _revisionId, ...i }) =>
          ({ ...i, quizRevisionId: created.id, evidenceSnapshot: i.evidenceSnapshot as Prisma.InputJsonValue })) });
        await tx.quiz.update({ where: { id: q.id }, data: { currentRevisionId: created.id } });
        return created;
      });
      return { ...q, revisionId: r.id };
    };

    await t.test("B1 final allocated attempt withholds old result/review through resume and save, then releases after submission", async () => {
      const q = await makeQuiz(exhaustion), first = await graded(q.id);
      await withheld(first.attemptId);
      const second = await start(q.id);
      const view = await attempts.resume(req, second.attemptId); assert.ok("questions" in view);
      await attempts.save(req, second.attemptId, { ...mutation(), changes: [{ attemptQuestionId: view.questions[0]!.attemptQuestionId,
        expectedAnswerRevision: 0, answer: { type: "true_false", value: true } }] });
      await withheld(first.attemptId);
      await attempts.submit(req, second.attemptId, mutation());
      // No writable attempt remains; grading the final attempt is not a prerequisite for the old grade.
      await available(first.attemptId);
      await finish(second.attemptId); await available(second.attemptId);
      await reject(() => start(q.id), "ATTEMPT_LIMIT_REACHED");
    });
    await t.test("B1 concurrent result/review snapshots waiting behind the final start retry without disclosing keys", async () => {
      const q = await makeQuiz(exhaustion), first = await graded(q.id);
      const started = signal(), commit = signal(), snapshots = signal(); let seen = 0;
      store.afterAudit = async action => { if (action === "assessment.attempt.started") { started.resolve(); await commit.promise; } };
      const second = start(q.id);
      try {
        await started.promise;
        const reader = new AssessmentResultsService(new SnapshotAttempts(store, access, f.ids.enrollment!, () => {
          if (++seen === 2) snapshots.resolve();
        }));
        const reads = Promise.all([reader.result(req, first.attemptId), reject(() => reader.review(req, first.attemptId), "REVIEW_UNAVAILABLE")]);
        await snapshots.promise; commit.resolve();
        const [result] = await reads;
        assert.equal(result.status, "withheld"); assert.ok(seen > 2, "stale snapshots must retry after the enrollment write fence");
        await withheld(first.attemptId);
      } finally { commit.resolve(); store.afterAudit = undefined; }
      const final = await second;
      await attempts.submit(req, final.attemptId, mutation()); await finish(final.attemptId);
      await available(first.attemptId);
    });
    await t.test("B1 quota and open-attempt checks span revisions and retained re-enrollment; exact old maximum stays authoritative", async () => {
      const q = await makeQuiz(exhaustion), first = await graded(q.id);
      await enrollments.change(req, f.ids.enrollment!, "revoked"); await enrollments.grant(req, f.ids.course!, req.user.id);
      await quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2,
        draft: { ...q.draft, policy: { ...q.draft.policy, maxAttempts: 3 } } });
      await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 3 });
      const second = await start(q.id); await withheld(first.attemptId);
      await attempts.submit(req, second.attemptId, mutation()); await finish(second.attemptId);
      await available(first.attemptId); await withheld(second.attemptId);
      const third = await start(q.id);
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: third.attemptId } })).attemptNumber, 3);
      await withheld(first.attemptId); await withheld(second.attemptId);
      await attempts.submit(req, third.attemptId, mutation()); await finish(third.attemptId);
      await available(first.attemptId); await available(second.attemptId);
    });
    await t.test("unlimited allowance never satisfies exhaustion and cannot publish an attempt-limit visibility", async () => {
      const q = await makeQuiz({ maxAttempts: null, reviewVisibility: "never", explanationVisibility: "never" });
      for (let n = 0; n < 3; n++) await graded(q.id);
      const used = await database.assessmentAttempt.count({ where: { quizId: q.id, studentUserId: req.user.id } });
      assert.equal(visibilityPermits("after_attempt_limit", null, used, true, false), false);
      await reject(() => quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2,
        draft: { ...q.draft, policy: { ...q.draft.policy, scoreVisibility: "after_attempt_limit" } } }), "INVALID_INPUT");
    });
    for (const scoreVisibility of ["never", "manual_release", "after_attempt_limit"]) {
      await t.test(`B2 historical score ${scoreVisibility} gates after_grading review and explanation`, async () => {
        const q = await historicalQuiz({ scoreVisibility, reviewVisibility: "after_grading", explanationVisibility: "after_grading", maxAttempts: 2 });
        const first = await graded(q.id); await withheld(first.attemptId);
        if (scoreVisibility === "manual_release") {
          await quizzes.release(req, "courses", f.ids.course!, q.id, q.revisionId, mutation());
          await available(first.attemptId);
        } else if (scoreVisibility === "after_attempt_limit") {
          const second = await start(q.id); await withheld(first.attemptId);
          await attempts.submit(req, second.attemptId, mutation()); await finish(second.attemptId);
          await available(first.attemptId);
        } else {
          // A later permissive revision must not replace the exact historical score policy.
          await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 });
          await withheld(first.attemptId);
        }
      });
    }
    await t.test("B2 valid score after_grading and manual review/explanation still requires the exact revision release", async () => {
      const q = await makeQuiz({ reviewVisibility: "manual_release", explanationVisibility: "manual_release" });
      const first = await graded(q.id);
      assert.equal((await results.result(req, first.attemptId)).status, "available");
      await reject(() => results.review(req, first.attemptId), "REVIEW_UNAVAILABLE");
      const later = await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 });
      await quizzes.release(req, "courses", f.ids.course!, q.id, later.revision.id, mutation());
      await reject(() => results.review(req, first.attemptId), "REVIEW_UNAVAILABLE");
      await quizzes.release(req, "courses", f.ids.course!, q.id, q.revisionId, mutation());
      await available(first.attemptId);
    });
    await t.test("B2 create/edit and publication revalidation reject unsafe ordering without changing the prior revision", async () => {
      const q = await makeQuiz({});
      const invalid = { ...q.draft, policy: { ...q.draft.policy, scoreVisibility: "never" } };
      await reject(() => quizzes.create(req, "courses", f.ids.course!, { draft: invalid }), "INVALID_INPUT");
      await reject(() => quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft: invalid }), "INVALID_INPUT");
      // A pre-fix saved draft must also be rejected when publication revalidates it.
      const saved = await database.quizDraft.findUniqueOrThrow({ where: { quizId: q.id } });
      await database.quizDraft.update({ where: { quizId: q.id }, data: { policy: {
        ...(saved.policy as Prisma.JsonObject), scoreVisibility: "never" } as Prisma.InputJsonObject } });
      await reject(() => quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 }), "INVALID_INPUT");
      assert.equal((await database.quiz.findUniqueOrThrow({ where: { id: q.id } })).currentRevisionId, q.revisionId);
      assert.equal(await database.quizRevision.count({ where: { quizId: q.id } }), 1);
      assert.equal(await database.auditLog.count({ where: { entityId: q.id, action: "assessment.quiz.published" } }), 1);
      assert.equal(quizPolicyInputSchema.safeParse({ mode: "practice", reviewVisibility: "manual_release", explanationVisibility: "after_grading" }).success, false);
    });
    await t.test("maximum shape: 100 questions and 2100 skill evidence rows grade through the normal 15-second transaction", async () => {
      const baseline = await f.baseline();
      const secondary: string[] = [];
      for (let n = 0; n < 20; n++) secondary.push((await database.skill.create({ data: {
        slug: `maximum-secondary-${n}`, translations: { create: { locale: "en", label: `Secondary ${n}` } } } })).id);
      const items = [];
      for (let position = 0; position < 100; position++) items.push({ ...await makeQuestion(secondary), position, points: 1000 });
      const q = await makeQuiz({}, items), a = await start(q.id);
      const view = await attempts.resume(req, a.attemptId); assert.ok("questions" in view);
      for (let offset = 0; offset < 100; offset += 10) await attempts.save(req, a.attemptId, { ...mutation(),
        changes: view.questions.slice(offset, offset + 10).map(q => ({ attemptQuestionId: q.attemptQuestionId,
          expectedAnswerRevision: 0, answer: { type: "true_false", value: true } })) });
      await attempts.submit(req, a.attemptId, mutation());
      const lease = await worker.claim(); assert.ok(lease); assert.equal(lease.attemptId, a.attemptId);
      const started = performance.now();
      assert.equal(await worker.execute(lease), true);
      const elapsed = performance.now() - started;
      t.diagnostic(`Maximum grading shape: 100 questions, 21 skills each, 2100 evidence rows; execute ${elapsed.toFixed(1)} ms; unchanged timeout 15000 ms.`);
      assert.ok(elapsed < 15000);
      assert.deepEqual(await results.result(req, a.attemptId), { attemptId: a.attemptId, state: "GRADED", status: "available", earnedPoints: 100000, possiblePoints: 100000, passed: true });
      assert.equal(await database.attemptGrade.count({ where: { attemptId: a.attemptId } }), 1);
      assert.equal(await database.attemptQuestionGrade.count({ where: { attemptId: a.attemptId } }), 100);
      assert.equal(await database.skillEvidence.count({ where: { attemptId: a.attemptId } }), 2100);
      assert.equal(await database.auditLog.count({ where: { entityId: a.attemptId, action: "assessment.attempt.graded" } }), 1);
      assert.equal((await database.assessmentJob.findUniqueOrThrow({ where: { id: lease.id } })).state, "succeeded");
      assert.equal(await worker.execute(lease), false);
      assert.equal(await f.baseline(), baseline);
    });
  } finally { await db?.$disconnect(); await f.cleanup(); }
});
