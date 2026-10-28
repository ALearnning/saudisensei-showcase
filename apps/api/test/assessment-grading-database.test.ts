import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { PrismaClient } from "@workspace/saudisensei-database";
import { AssessmentDatabaseFixture } from "./assessment-database.fixture.js";
import { LmsStore } from "../src/modules/courses/lms.store.js";
import { EnrollmentsService } from "../src/modules/enrollments/enrollments.service.js";
import { AssessmentAccessService } from "../src/modules/assessments/assessment-access.service.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";
import { QuestionBankService } from "../src/modules/assessments/question-bank/question-bank.service.js";
import type { QuestionDraftInput } from "../src/modules/assessments/question-bank/question-bank.schemas.js";
import { QuizzesService } from "../src/modules/assessments/quizzes/quizzes.service.js";
import { AttemptsService } from "../src/modules/assessments/attempts/attempts.service.js";
import { AssessmentDeadlineService } from "../src/modules/assessments/attempts/assessment-deadline.service.js";
import { AssessmentGradingService } from "../src/modules/assessments/grading/assessment-grading.service.js";
import { AssessmentResultsService } from "../src/modules/assessments/grading/results.service.js";
import { gradingDefinitionSchema, type StudentQuestion } from "../src/modules/assessments/contracts/questions.js";

const reject = (fn: () => Promise<unknown>, code: string) =>
  assert.rejects(fn, (e: unknown) => e instanceof HttpException && e.message === code);
const mutation = () => ({ clientMutationId: randomUUID() });

test("Q6 deterministic grading, results, review and durable jobs on disposable PostgreSQL", { timeout: 240000 }, async t => {
  const f = new AssessmentDatabaseFixture();
  let db: PrismaClient | undefined;
  try {
    await f.setup(); await f.migrate();
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", f.schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const database = db, store = new LmsStore(db), enrollment = new EnrollmentsService(store);
    const access = new AssessmentAccessService(store, enrollment), bank = new QuestionBankService(store);
    const quizzes = new QuizzesService(store, access), service = new AttemptsService(store, access);
    const deadlines = new AssessmentDeadlineService(store, service);
    const worker = new AssessmentGradingService(store, service), results = new AssessmentResultsService(service);
    const adminRole = await db.role.upsert({ where: { name: "admin" }, create: { name: "admin" }, update: {} });
    const studentRole = await db.role.upsert({ where: { name: "student" }, create: { name: "student" }, update: {} });
    await db.userRole.createMany({ data: [
      { userId: f.ids.user!, roleId: adminRole.id }, { userId: f.ids.user!, roleId: studentRole.id },
      { userId: f.ids.otherUser!, roleId: studentRole.id },
    ] });
    const req = { user: { id: f.ids.user }, requestId: randomUUID(), mfaVerified: true } as AuthenticatedRequest;
    const other = { ...req, user: { id: f.ids.otherUser } } as AuthenticatedRequest;
    const baseline = await f.baseline();
    const skill = await db.skill.create({ data: { slug: "attempt-primary", translations: { create: { locale: "en", label: "Primary" } } } });
    const A = randomUUID(), B = randomUUID(), C = randomUUID();
    const labels = [{ id: A, label: "First" }, { id: B, label: "Second" }, { id: C, label: "Third" }];
    const definitions = [
      { type: "single_choice", correctOptionId: B },
      { type: "multiple_choice", correctOptionIds: [A, C] },
      { type: "true_false", correctValue: false },
      { type: "short_text", normalizer: { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false },
        acceptedByLocale: { ar: ["private-key"], en: ["private-key"] } },
      { type: "ordering", correctOrderedItemIds: [C, B, A] },
    ] as const;
    const questionItems: { questionId: string; questionRevisionId: string; position: number }[] = [];
    for (const definition of definitions) {
      const presentation = { prompt: `Question ${definition.type}`, ...(definition.type.endsWith("choice") ? { options: labels } : {}),
        ...(definition.type === "ordering" ? { items: labels } : {}) };
      const draft = { type: definition.type, defaultContentLocale: "ar",
        content: definition.type === "true_false" ? { ar: presentation } : { ar: presentation, en: presentation },
        gradingDefinition: definition, explanation: { ar: "PRIVATE EXPLANATION" }, defaultPoints: 2, difficulty: "medium",
        primarySkillId: skill.id, secondarySkillIds: [], cognitiveTags: ["concept"] } as unknown as QuestionDraftInput;
      const question = await bank.create(req, { draft });
      const sealed = await bank.seal(req, question.id, { expectedRevision: 0 });
      questionItems.push({ questionId: question.id, questionRevisionId: sealed.revision.id, position: questionItems.length });
    }
    const makeQuiz = async (policy: Record<string, unknown> = {}, parent: readonly [string, string] = ["courses", f.ids.course!], items = questionItems) => {
      const draft = { defaultContentLocale: "ar", content: { ar: { title: "اختبار", instructions: "ابدأ" }, en: { title: "Quiz", instructions: "Begin" } },
        policy: { mode: "practice", ...policy } };
      const q = await quizzes.create(req, parent[0], parent[1], { draft });
      await quizzes.replaceItems(req, parent[0], parent[1], q.id, { expectedRevision: 0, items });
      const published = await quizzes.publish(req, parent[0], parent[1], q.id, { expectedRevision: 1 });
      return { q, draft, published, parent };
    };
    const start = async (id: string, body = { ...mutation(), requestedContentLocale: "en" }) => {
      const receipt = await service.start(req, "courses", f.ids.course!, id, body);
      assert.deepEqual(Object.keys(receipt), ["attemptId"]);
      const view = await service.resume(req, receipt.attemptId);
      assert.ok("questions" in view); return view;
    };
    const answer = (q: StudentQuestion) => q.type === "single_choice" ? { type: q.type, optionId: A }
      : q.type === "multiple_choice" ? { type: q.type, optionIds: [C, A] }
      : q.type === "true_false" ? { type: q.type, value: true }
      : q.type === "short_text" ? { type: q.type, text: "Student answer" }
      : { type: q.type, orderedItemIds: [B, C, A] };
    const change = (q: StudentQuestion, revision = 0, value: unknown = answer(q)) =>
      ({ attemptQuestionId: q.attemptQuestionId, expectedAnswerRevision: revision, answer: value });

    const correct = (q: StudentQuestion) => q.type === "single_choice" ? { type: q.type, optionId: B }
      : q.type === "multiple_choice" ? { type: q.type, optionIds: [C, A] }
      : q.type === "true_false" ? { type: q.type, value: false }
      : q.type === "short_text" ? { type: q.type, text: "private-key" }
      : { type: q.type, orderedItemIds: [C, B, A] };
    const finish = async (id: string) => {
      const lease = await worker.claim(); assert.ok(lease); assert.equal(lease.attemptId, id);
      assert.equal(await worker.execute(lease), true); return lease;
    };
    const assertAtomic = async (id: string, expected: number) => {
      assert.equal(await database.attemptGrade.count({ where: { attemptId: id } }), expected);
      assert.equal(await database.attemptQuestionGrade.count({ where: { attemptId: id } }), expected * 5);
      assert.equal(await database.skillEvidence.count({ where: { attemptId: id } }), expected * 5);
      assert.equal(await database.auditLog.count({ where: { entityId: id, action: "assessment.attempt.graded" } }), expected);
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id } })).status === "GRADED", expected === 1);
    };

    // Start a real 60-second timer while the other independent cases execute.
    const timedQuiz = await makeQuiz({ timeLimitSeconds: 60 });
    const timed = await start(timedQuiz.q.id);
    await service.save(req, timed.attemptId, { ...mutation(), changes: [change(timed.questions[0]!, 0, correct(timed.questions[0]!))] });

    await t.test("processing then deterministic practice score, five correct answers, safe independent result/review DTOs", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      await reject(() => results.result(req, view.attemptId), "ATTEMPT_NOT_SUBMITTED");
      await reject(() => results.review(req, view.attemptId), "REVIEW_UNAVAILABLE");
      await service.submit(req, view.attemptId, { ...mutation(), changes: view.questions.map(q => change(q, 0, correct(q))) });
      assert.deepEqual(await results.result(req, view.attemptId), { attemptId: view.attemptId, state: "SUBMITTED", status: "processing", processingCode: "GRADING_PENDING" });
      await reject(() => results.review(req, view.attemptId), "REVIEW_UNAVAILABLE");
      await finish(view.attemptId); await assertAtomic(view.attemptId, 1);
      const result = await results.result(req, view.attemptId);
      assert.deepEqual(result, { attemptId: view.attemptId, state: "GRADED", status: "available", earnedPoints: 10, possiblePoints: 10, passed: true });
      assert.doesNotMatch(JSON.stringify(result), /answer|correct|explanation|checksum|skill|job|definition/i);
      const review = await results.review(req, view.attemptId);
      assert.ok(review.questions.every(q => q.correct === true && q.earnedPoints === 2 && q.possiblePoints === 2));
      assert.equal(review.questions[2]!.explanation, "PRIVATE EXPLANATION");
      assert.equal("explanation" in review.questions[0]!, false); // Pinned EN has no authored explanation.
      assert.deepEqual(review.questions[3]!.correctAnswer, { type: "short_text", text: "private-key" });
      assert.doesNotMatch(JSON.stringify(review), /gradingDefinition|correctOption|acceptedByLocale|normalizer|checksum|skillSnapshot|evidenceSnapshot|assemblyTransaction/);
      const restored = await service.resume(req, view.attemptId);
      assert.equal("questions" in restored, false); assert.equal("processing" in restored && restored.processing, "ready");
      const audit = await database.auditLog.findFirstOrThrow({ where: { entityId: view.attemptId, action: "assessment.attempt.graded" } });
      assert.equal(audit.actorUserId, null);
      assert.doesNotMatch(JSON.stringify(audit.metadata), /private-key|PRIVATE EXPLANATION|correct|answer|score|points|prompt/i);
    });
    await t.test("every answered-incorrect type earns zero and retains answered evidence", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      await service.submit(req, view.attemptId, { ...mutation(), changes: view.questions.map(q => change(q, 0,
        q.type === "multiple_choice" ? { type: q.type, optionIds: [A] } : answer(q))) });
      await finish(view.attemptId);
      const grade = await database.attemptGrade.findUniqueOrThrow({ where: { attemptId: view.attemptId } });
      assert.equal(grade.earnedPoints, 0); assert.equal(grade.possiblePoints, 10); assert.equal(grade.passed, false);
      const evidence = await database.skillEvidence.findMany({ where: { attemptId: view.attemptId } });
      assert.ok(evidence.every(e => e.responseState === "incorrect_answered" && e.answeredCorrectly === false));
    });
    await t.test("four evidence states use frozen real observations; clearing and flags never fabricate conceptual error/view/time", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      const [first, second, third, fourth, fifth] = view.questions;
      await service.save(req, view.attemptId, { ...mutation(), changes: [change(fifth!, 0, correct(fifth!))] });
      await service.flag(req, view.attemptId, fourth!.attemptQuestionId, { ...mutation(), expectedFlagRevision: 0, isFlagged: true });
      await database.attemptQuestionTelemetry.create({ data: { attemptQuestionId: third!.attemptQuestionId,
        firstViewedAt: new Date(), coverage: "partial", estimatedActiveMs: 300, qualityFlags: ["missing_intervals"], visitCount: 1 } });
      await service.submit(req, view.attemptId, { ...mutation(), changes: [change(first!, 0, correct(first!)),
        change(second!, 0, { type: "multiple_choice", optionIds: [A] }), change(fifth!, 1, null)] });
      await finish(view.attemptId);
      const evidence = await database.skillEvidence.findMany({ where: { attemptId: view.attemptId }, include: { questionGrade: true } });
      const byId = new Map(evidence.map(e => [e.questionGrade.attemptQuestionId, e]));
      assert.deepEqual(view.questions.map(q => byId.get(q.attemptQuestionId)!.responseState),
        ["correct_answered", "incorrect_answered", "unanswered_viewed", "unanswered_unviewed", "unanswered_unviewed"]);
      for (const item of [third!, fourth!, fifth!]) {
        const e = byId.get(item.attemptQuestionId)!;
        assert.equal(e.answeredCorrectly, null); assert.equal(e.earnedPoints, 0); assert.equal(e.hadAcceptedAnswer, false);
        assert.equal(e.finalizationReason, "voluntary");
      }
      const unseen = byId.get(fourth!.attemptQuestionId)!;
      assert.equal(unseen.hadRecordedView, false); assert.equal(unseen.coverage, "unknown");
      assert.equal(unseen.estimatedActiveMs, null); assert.equal(unseen.timeQuality, "unknown");
      assert.equal(byId.get(third!.attemptQuestionId)!.estimatedActiveMs, 300);
      assert.ok((await database.attemptAnswer.findUniqueOrThrow({ where: { attemptQuestionId: fifth!.attemptQuestionId } })).firstAnsweredAt);
      const review = await results.review(req, view.attemptId);
      assert.deepEqual(review.questions.map(q => q.correct), [true, false, null, null, null]);
      await assert.rejects(() => database.attemptQuestionTelemetry.update({ where: { attemptQuestionId: third!.attemptQuestionId }, data: { coverage: "complete" } }));
    });
    await t.test("2/3 fails 66.67 percent in the real grade transaction, required does not gate progress", async () => {
      const { q } = await makeQuiz({ mode: "graded", required: true, passBasisPoints: 6667 }, undefined,
        questionItems.slice(0, 3).map(i => ({ ...i, points: 1 })));
      const view = await start(q.id);
      await service.submit(req, view.attemptId, { ...mutation(), changes: view.questions.slice(0, 2).map(q => change(q, 0, correct(q))) });
      await finish(view.attemptId);
      assert.deepEqual(await results.result(req, view.attemptId), { attemptId: view.attemptId, state: "GRADED", status: "available", earnedPoints: 2, possiblePoints: 3, passed: false });
      assert.equal(await f.baseline(), baseline);
    });
    await t.test("competing workers, duplicate delivery and immutable unique grade/evidence/audit", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      await service.submit(req, view.attemptId, mutation());
      const otherWorker = new AssessmentGradingService(store, new AttemptsService(store, access));
      const claims = await Promise.all([worker.claim(), otherWorker.claim()]);
      assert.equal(claims.filter(Boolean).length, 1); const lease = claims.find(Boolean)!;
      const executed = await Promise.all([worker.execute(lease), otherWorker.execute(lease)]);
      assert.deepEqual(executed.sort(), [false, true]);
      assert.equal(await worker.execute(lease), false); await assertAtomic(view.attemptId, 1);
      await database.assessmentJob.create({ data: { attemptId: view.attemptId, kind: "grade", deduplicationKey: `duplicate:${view.attemptId}` } });
      await finish(view.attemptId); await assertAtomic(view.attemptId, 1);
      const grade = await database.attemptGrade.findUniqueOrThrow({ where: { attemptId: view.attemptId } });
      await assert.rejects(() => database.attemptGrade.update({ where: { id: grade.id }, data: { passed: true } }));
      const qg = await database.attemptQuestionGrade.findFirstOrThrow({ where: { attemptId: view.attemptId } });
      await assert.rejects(() => database.attemptQuestionGrade.update({ where: { id: qg.id }, data: { reasonCode: "OTHER" } }));
      const e = await database.skillEvidence.findFirstOrThrow({ where: { attemptId: view.attemptId } });
      await assert.rejects(() => database.skillEvidence.update({ where: { id: e.id }, data: { timeQuality: "complete" } }));
    });
    for (const table of ["assessment_attempt_grades", "assessment_attempt_question_grades", "assessment_skill_evidence", "assessment_attempts", "assessment_jobs", "audit_logs"]) {
      await t.test(`required ${table} failure rolls back all grade state; durable retry converges`, async () => {
        const { q } = await makeQuiz(), view = await start(q.id);
        await service.submit(req, view.attemptId, mutation());
        const condition = table === "assessment_attempts" ? "NEW.status='GRADED'" : table === "assessment_jobs" ? "NEW.state='succeeded'"
          : table === "audit_logs" ? "NEW.action='assessment.attempt.graded'" : "true";
        await f.sql(`CREATE FUNCTION q6_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'ASSESSMENT_TEST_FAILURE'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER q6_failure BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION q6_fail();`);
        try { assert.equal(await worker.tick(1), 0); await assertAtomic(view.attemptId, 0); }
        finally { await f.sql(`DROP TRIGGER q6_failure ON ${table}; DROP FUNCTION q6_fail();`); }
        const job = await database.assessmentJob.findUniqueOrThrow({ where: { deduplicationKey: `grade:${view.attemptId}` } });
        assert.equal(job.state, "queued"); assert.equal(job.errorCode, "GRADING_FAILED"); assert.equal(job.attempts, 1);
        await database.assessmentJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
        await finish(view.attemptId); await assertAtomic(view.attemptId, 1);
      });
    }
    await t.test("restart reconstructs missing jobs and reclaims leases with fencing; exhausted jobs fail once", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      await service.submit(req, view.attemptId, mutation());
      await database.assessmentJob.delete({ where: { deduplicationKey: `grade:${view.attemptId}` } });
      const restarted = new AssessmentGradingService(store, new AttemptsService(store, access));
      assert.equal(await restarted.recover(), 1); assert.equal(await restarted.recover(), 0);
      const old = await restarted.claim(); assert.ok(old);
      await database.assessmentJob.update({ where: { id: old.id }, data: { leaseUntil: new Date(0) } });
      const current = await worker.claim(); assert.ok(current); assert.equal(current.fence, old.fence + 1);
      assert.equal(await restarted.execute(old), false); assert.equal(await worker.execute(current), true);
      await assertAtomic(view.attemptId, 1);
      const failed = await database.assessmentJob.create({ data: { attemptId: view.attemptId, kind: "grade", deduplicationKey: `exhausted:${view.attemptId}`,
        state: "running", leaseToken: randomUUID(), leaseUntil: new Date(0), attempts: 5, maxAttempts: 5 } });
      assert.equal(await worker.reap(), 1); assert.equal(await worker.reap(), 0); assert.equal(await worker.claim(), null);
      assert.equal((await database.assessmentJob.findUniqueOrThrow({ where: { id: failed.id } })).state, "failed");
      assert.equal(await database.auditLog.count({ where: { entityId: failed.id, action: "assessment.job.failed" } }), 1);
    });
    await t.test("valid never/after_grading score and review policies retain separate explanation gates", async () => {
      for (const [scoreVisibility, reviewVisibility] of [["never", "never"], ["after_grading", "never"], ["after_grading", "after_grading"]]) {
        const { q } = await makeQuiz({ scoreVisibility, reviewVisibility, explanationVisibility: "never" }), view = await start(q.id);
        await service.submit(req, view.attemptId, mutation()); await finish(view.attemptId);
        const result = await results.result(req, view.attemptId);
        if (scoreVisibility === "never") assert.deepEqual(result, { attemptId: view.attemptId, state: "GRADED", status: "withheld" });
        else assert.equal(result.status, "available");
        if (reviewVisibility === "never") await reject(() => results.review(req, view.attemptId), "REVIEW_UNAVAILABLE");
        else assert.ok((await results.review(req, view.attemptId)).questions.every(q => !("explanation" in q)));
      }
    });
    await t.test("after_attempt_limit uses lifetime starts under the frozen policy across reactivation/republication", async () => {
      const { q, draft } = await makeQuiz({ mode: "graded", maxAttempts: 2, scoreVisibility: "after_attempt_limit",
        reviewVisibility: "after_attempt_limit", explanationVisibility: "after_attempt_limit" });
      const first = await start(q.id); await service.submit(req, first.attemptId, mutation()); await finish(first.attemptId);
      assert.equal((await results.result(req, first.attemptId)).status, "withheld");
      await reject(() => results.review(req, first.attemptId), "REVIEW_UNAVAILABLE");
      await enrollment.change(req, f.ids.enrollment!, "revoked"); await enrollment.grant(req, f.ids.course!, f.ids.user!);
      await quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft });
      await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 3 });
      const second = await start(q.id); assert.equal(second.attemptNumber, 2);
      assert.equal((await results.result(req, first.attemptId)).status, "withheld");
      await reject(() => results.review(req, first.attemptId), "REVIEW_UNAVAILABLE");
      await service.submit(req, second.attemptId, mutation()); await finish(second.attemptId);
      assert.equal((await results.result(req, first.attemptId)).status, "available");
      assert.equal((await results.review(req, first.attemptId)).questions[2]!.explanation, "PRIVATE EXPLANATION");
      await reject(() => start(q.id), "ATTEMPT_LIMIT_REACHED");
    });
    await t.test("manual release is exact-revision scoped and explanation cannot precede review", async () => {
      const { q, draft, published } = await makeQuiz({ scoreVisibility: "manual_release", reviewVisibility: "manual_release", explanationVisibility: "manual_release" });
      const first = await start(q.id); await service.submit(req, first.attemptId, mutation()); await finish(first.attemptId);
      await quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft });
      const newRevision = await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 3 });
      const second = await start(q.id); await service.submit(req, second.attemptId, mutation()); await finish(second.attemptId);
      await quizzes.release(req, "courses", f.ids.course!, q.id, published.revision.id, mutation());
      assert.equal((await results.result(req, first.attemptId)).status, "available");
      assert.equal((await results.review(req, first.attemptId)).questions[2]!.explanation, "PRIVATE EXPLANATION");
      assert.equal((await results.result(req, second.attemptId)).status, "withheld");
      await reject(() => results.review(req, second.attemptId), "REVIEW_UNAVAILABLE");
      await quizzes.release(req, "courses", f.ids.course!, q.id, newRevision.revision.id, mutation());
      assert.equal((await results.result(req, second.attemptId)).status, "available");
      assert.equal((await results.review(req, second.attemptId)).questions.length, 5);
      const independent = await makeQuiz({ reviewVisibility: "after_grading", explanationVisibility: "manual_release" });
      const view = await start(independent.q.id); await service.submit(req, view.attemptId, mutation()); await finish(view.attemptId);
      assert.ok((await results.review(req, view.attemptId)).questions.every(q => !("explanation" in q)));
      await quizzes.release(req, "courses", f.ids.course!, independent.q.id, independent.published.revision.id, mutation());
      assert.equal((await results.review(req, view.attemptId)).questions[2]!.explanation, "PRIVATE EXPLANATION");
    });
    await t.test("other Student and current revoked/expired/inactive/role/ancestry/withdrawal reads fail closed; internal grading completes", async () => {
      await database.lesson.update({ where: { id: f.ids.lesson! }, data: { body: "Published content" } });
      const { q } = await makeQuiz({}, ["lessons", f.ids.lesson!]);
      const receipt = await service.start(req, "lessons", f.ids.lesson!, q.id, { ...mutation(), requestedContentLocale: "en" });
      const id = receipt.attemptId; await service.submit(req, id, mutation());
      for (const read of [results.result.bind(results), results.review.bind(results)]) await reject(() => read(other, id), "QUIZ_UNAVAILABLE");
      await enrollment.change(req, f.ids.enrollment!, "revoked");
      await finish(id); // Internal frozen-work authorization does not require an active enrollment.
      const denied = async () => {
        for (const read of [results.result.bind(results), results.review.bind(results)])
          await assert.rejects(() => read(req, id), (e: unknown) => e instanceof HttpException && [403, 404].includes(e.getStatus()));
      };
      await denied(); await enrollment.grant(req, f.ids.course!, f.ids.user!);
      await database.enrollment.update({ where: { id: f.ids.enrollment! }, data: { expiresAt: new Date() } });
      await denied(); await database.enrollment.update({ where: { id: f.ids.enrollment! }, data: { expiresAt: null } });
      await database.user.update({ where: { id: req.user.id }, data: { status: "suspended" } });
      await denied(); await database.user.update({ where: { id: req.user.id }, data: { status: "active" } });
      await database.userRole.delete({ where: { userId_roleId: { userId: req.user.id, roleId: studentRole.id } } });
      await denied(); await database.userRole.create({ data: { userId: req.user.id, roleId: studentRole.id } });
      for (const [table, key] of [["courses", f.ids.course!], ["chapters", f.ids.chapter!], ["lessons", f.ids.lesson!]]) {
        await f.sql(`UPDATE ${table} SET status='draft' WHERE id='${key}'`); await denied();
        await f.sql(`UPDATE ${table} SET status='published' WHERE id='${key}'`);
      }
      await quizzes.unpublish(req, "lessons", f.ids.lesson!, q.id, { expectedRevision: 2 }); await denied();
      await quizzes.publish(req, "lessons", f.ids.lesson!, q.id, { expectedRevision: 3 });
      assert.equal((await results.result(req, id)).status, "available");
      await quizzes.archive(req, "lessons", f.ids.lesson!, q.id, { expectedRevision: 4 }); await denied();
      await assertAtomic(id, 1);
      await database.lesson.update({ where: { id: f.ids.lesson! }, data: { body: "" } });
    });
    await t.test("automatic availability closure freezes answers and grades after withdrawal/restart", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1500).toISOString() });
      const view = await start(q.id);
      await service.save(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!, 0, correct(view.questions[0]!))] });
      await enrollment.change(req, f.ids.enrollment!, "revoked");
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 30)));
      const deadline = await deadlines.claim(); assert.ok(deadline); assert.equal(await deadlines.execute(deadline), true);
      await finish(view.attemptId);
      const a = await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } });
      assert.equal(a.status, "GRADED"); assert.equal(a.finalizationReason, "availability_close");
      assert.equal(a.effectiveSubmittedAt!.getTime(), a.deadlineAt!.getTime());
      assert.ok((await database.skillEvidence.findMany({ where: { attemptId: a.id } })).every(e => e.finalizationReason === "availability_close"));
      await enrollment.grant(req, f.ids.course!, f.ids.user!);
      assert.equal((await results.result(req, a.id)).earnedPoints, 2);
    });
    await t.test("secondary evidence preserves exact taxonomy and role without live skill reinterpretation", async () => {
      const secondary = await database.skill.create({ data: { slug: "secondary-q6", translations: { create: { locale: "en", label: "Original label" } } } });
      const original = await bank.get(questionItems[2]!.questionId);
      const authored = await bank.create(req, { draft: { ...original.draft, secondarySkillIds: [secondary.id] } });
      const sealed = await bank.seal(req, authored.id, { expectedRevision: 0 });
      const { q } = await makeQuiz({}, undefined, [{ questionId: authored.id, questionRevisionId: sealed.revision.id, position: 0 }]);
      const view = await start(q.id);
      await service.submit(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!, 0, correct(view.questions[0]!))] });
      await database.skillTranslation.update({ where: { skillId_locale: { skillId: secondary.id, locale: "en" } }, data: { label: "Later label" } });
      await database.skill.update({ where: { id: secondary.id }, data: { status: "archived" } });
      await finish(view.attemptId);
      const evidence = await database.skillEvidence.findMany({ where: { attemptId: view.attemptId } });
      assert.equal(evidence.length, 2);
      const second = evidence.find(e => e.skillId === secondary.id)!;
      assert.equal(second.role, "secondary"); assert.equal(second.responseState, "correct_answered");
      assert.match(JSON.stringify(second.taxonomySnapshot), /Original label/); assert.doesNotMatch(JSON.stringify(second.taxonomySnapshot), /Later label/);
      assert.equal((await results.result(req, view.attemptId)).possiblePoints, 2);
    });
    await t.test("exact pinned question/quiz revisions survive new keys/policies, draft edits, archive and pointer changes", async () => {
      const { q, draft } = await makeQuiz({ passBasisPoints: 0 });
      const view = await start(q.id);
      await service.submit(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!, 0, correct(view.questions[0]!)),
        change(view.questions[3]!, 0, { type: "short_text", text: " private-key " })] });
      const original = await bank.get(questionItems[0]!.questionId);
      const changed = { ...original.draft, gradingDefinition: { type: "single_choice", correctOptionId: A } };
      await bank.edit(req, original.id, { expectedRevision: original.editRevision, draft: changed });
      const sealed = await bank.seal(req, original.id, { expectedRevision: original.editRevision + 1 });
      const textOriginal = await bank.get(questionItems[3]!.questionId);
      const textDefinition = gradingDefinitionSchema.parse(textOriginal.draft.gradingDefinition);
      assert.ok(textDefinition.type === "short_text");
      await bank.edit(req, textOriginal.id, { expectedRevision: textOriginal.editRevision, draft: { ...textOriginal.draft,
        gradingDefinition: { ...textDefinition, normalizer: { ...textDefinition.normalizer, trim: true } } } });
      const textSealed = await bank.seal(req, textOriginal.id, { expectedRevision: textOriginal.editRevision + 1 });
      await quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft: { ...draft, policy: { ...draft.policy, passBasisPoints: 10000, reviewVisibility: "never", explanationVisibility: "never" } } });
      await quizzes.replaceItems(req, "courses", f.ids.course!, q.id, { expectedRevision: 3,
        items: questionItems.map((i, n) => n === 0 ? { ...i, questionRevisionId: sealed.revision.id, points: 100 }
          : n === 3 ? { ...i, questionRevisionId: textSealed.revision.id } : i) });
      await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 4 });
      await bank.archive(req, original.id, { expectedRevision: original.editRevision + 2 });
      await finish(view.attemptId);
      assert.deepEqual(await results.result(req, view.attemptId), { attemptId: view.attemptId, state: "GRADED", status: "available", earnedPoints: 2, possiblePoints: 10, passed: true });
      const review = await results.review(req, view.attemptId);
      assert.deepEqual(review.questions[0]!.correctAnswer, { type: "single_choice", optionId: B });
      assert.equal(review.questions[3]!.correct, false); // Old normalizer never trims, even after republishing.
      const before = await database.attemptGrade.findUniqueOrThrow({ where: { attemptId: view.attemptId } });
      await quizzes.archive(req, "courses", f.ids.course!, q.id, { expectedRevision: 5 });
      await reject(() => results.result(req, view.attemptId), "QUIZ_UNAVAILABLE");
      assert.deepEqual(await database.attemptGrade.findUniqueOrThrow({ where: { attemptId: view.attemptId } }), before);
    });
    await t.test("real time-limit expiry grades the last saved answer and preserves timer finalization context", async () => {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(timed.deadlineAt!) - Date.now() + 30)));
      await reject(() => results.review(req, timed.attemptId), "REVIEW_UNAVAILABLE");
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: timed.attemptId } })).status, "AUTO_SUBMITTED");
      assert.equal(await database.assessmentJob.count({ where: { attemptId: timed.attemptId, kind: "grade" } }), 1);
      const lease = await deadlines.claim(); assert.ok(lease); assert.equal(lease.attemptId, timed.attemptId);
      assert.equal(await deadlines.execute(lease), true); await finish(timed.attemptId);
      const a = await database.assessmentAttempt.findUniqueOrThrow({ where: { id: timed.attemptId } });
      assert.equal(a.finalizationReason, "time_limit"); assert.equal(a.effectiveSubmittedAt!.getTime(), a.deadlineAt!.getTime());
      assert.equal((await results.result(req, a.id)).earnedPoints, 2);
      assert.ok((await database.skillEvidence.findMany({ where: { attemptId: a.id } })).every(e => e.finalizationReason === "time_limit"));
    });
    assert.equal(await database.lessonCompletion.count(), 1);
    assert.equal(await database.assessmentTelemetrySession.count(), 0);
    assert.equal(await database.skillContentLink.count(), 0);
    assert.equal(await database.assessmentJob.count({ where: { kind: "guidance" } }), 0);
  } finally { await db?.$disconnect(); await f.cleanup(); }
});
