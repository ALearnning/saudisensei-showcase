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
import type { StudentQuestion } from "../src/modules/assessments/contracts/questions.js";

const reject = (fn: () => Promise<unknown>, code: string) =>
  assert.rejects(fn, (e: unknown) => e instanceof HttpException && e.message === code);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const mutation = () => ({ clientMutationId: randomUUID() });

test("Q5 real attempt services and separate durable jobs on disposable PostgreSQL", { timeout: 180000 }, async t => {
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
    const makeQuiz = async (policy: Record<string, unknown> = {}, parent = ["courses", f.ids.course!] as const) => {
      const draft = { defaultContentLocale: "ar", content: { ar: { title: "اختبار", instructions: "ابدأ" }, en: { title: "Quiz", instructions: "Begin" } },
        policy: { mode: "practice", ...policy } };
      const q = await quizzes.create(req, parent[0], parent[1], { draft });
      await quizzes.replaceItems(req, parent[0], parent[1], q.id, { expectedRevision: 0, items: questionItems });
      const published = await quizzes.publish(req, parent[0], parent[1], q.id, { expectedRevision: 1 });
      return { q, draft, published, parent };
    };
    const start = async (id: string, body = { ...mutation(), requestedContentLocale: "en" }) => {
      const receipt = await service.start(req, "courses", f.ids.course!, id, body);
      assert.deepEqual(Object.keys(receipt), ["attemptId"]);
      const view = await service.resume(req, receipt.attemptId);
      assert.ok("questions" in view); return view;
    };
    const resume = async (id: string) => {
      const view = await service.resume(req, id);
      assert.ok("questions" in view); return view;
    };
    const answer = (q: StudentQuestion) => q.type === "single_choice" ? { type: q.type, optionId: A }
      : q.type === "multiple_choice" ? { type: q.type, optionIds: [C, A] }
      : q.type === "true_false" ? { type: q.type, value: true }
      : q.type === "short_text" ? { type: q.type, text: "Student answer" }
      : { type: q.type, orderedItemIds: [B, C, A] };
    const change = (q: StudentQuestion, revision = 0, value: unknown = answer(q)) =>
      ({ attemptQuestionId: q.attemptQuestionId, expectedAnswerRevision: revision, answer: value });

    await t.test("discovery is safe; start/resume and concurrent tabs converge without quota consumption", async () => {
      const { q } = await makeQuiz({ shuffleQuestions: true, shuffleOptions: true });
      const metadata = await service.quiz(req, "courses", f.ids.course!, q.id, { locale: "en" });
      assert.equal(metadata.canStart, true); assert.equal(metadata.attemptsUsed, 0);
      assert.ok(!("questions" in metadata));
      const body = { ...mutation(), requestedContentLocale: "en" };
      const views = await Promise.all([start(q.id, body), start(q.id, body), start(q.id)]);
      assert.equal(new Set(views.map(v => v.attemptId)).size, 1);
      assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 1);
      const view = views[0]!;
      assert.equal(view.selectedContentLocale, "en"); assert.equal(view.deadlineAt, null);
      assert.equal(view.questions.find(q => q.type === "true_false")!.locale, "ar");
      assert.ok(view.questions.filter(q => q.type !== "true_false").every(q => q.locale === "en"));
      assert.deepEqual((await resume(view.attemptId)).questions, view.questions);
      assert.equal((await start(q.id, { ...mutation(), requestedContentLocale: "ar" })).selectedContentLocale, "en");
      await reject(() => start(q.id, { ...body, requestedContentLocale: "ar" }), "IDEMPOTENCY_CONFLICT");
      const text = JSON.stringify(view);
      assert.doesNotMatch(text, /gradingDefinition|correctOption|correctValue|private-key|PRIVATE EXPLANATION|checksum/);
      const rows = await database.attemptQuestion.findMany({ where: { attemptId: view.attemptId } });
      assert.doesNotMatch(JSON.stringify(rows.map(q => q.presentation)), /correctOption|private-key|PRIVATE EXPLANATION/);
      const list = await service.listQuizzes(req, "courses", f.ids.course!, { pageSize: 1 });
      assert.equal(list.items.length, 1);
      assert.equal((await service.quiz(req, "courses", f.ids.course!, q.id)).resumableAttemptId, view.attemptId);
    });
    await t.test("all five answer types durable, clear, no-op, canonical set order, replay and independent flags", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      const body = { ...mutation(), changes: view.questions.map(q => change(q)) };
      const saved = await service.save(req, view.attemptId, body);
      assert.deepEqual(await service.save(req, view.attemptId, body), saved);
      await reject(() => service.save(req, view.attemptId, { ...body, changes: [change(view.questions[0]!, 1)] }), "IDEMPOTENCY_CONFLICT");
      const restored = await resume(view.attemptId);
      assert.deepEqual(restored.answers.map(a => a.answerRevision), [1, 1, 1, 1, 1]);
      const flagBody = { ...mutation(), expectedFlagRevision: 0, isFlagged: true }, first = view.questions[0]!;
      const flagged = await service.flag(req, view.attemptId, first.attemptQuestionId, flagBody);
      assert.deepEqual(await service.flag(req, view.attemptId, first.attemptQuestionId, flagBody), flagged);
      await reject(() => service.flag(req, view.attemptId, first.attemptQuestionId, { ...mutation(), expectedFlagRevision: 0, isFlagged: false }), "FLAG_CHANGED");
      await service.save(req, view.attemptId, { ...mutation(), changes: view.questions.map(q => change(q, 1)) });
      let answers = await database.attemptAnswer.findMany({ where: { question: { attemptId: view.attemptId } } });
      assert.ok(answers.every(a => a.answerRevision === 1 && a.changeCount === 1 && a.firstAnsweredAt && a.finalAnsweredAt));
      await service.save(req, view.attemptId, { ...mutation(), changes: [change(first, 1, null)] });
      const cleared = (await resume(view.attemptId)).answers.find(a => a.attemptQuestionId === first.attemptQuestionId)!;
      assert.equal(cleared.answer, null); assert.equal(cleared.answerRevision, 2);
      assert.equal((await resume(view.attemptId)).flags[0]!.isFlagged, true);
      await service.flag(req, view.attemptId, first.attemptQuestionId, { ...mutation(), expectedFlagRevision: 1, isFlagged: false });
      const clearRow = await database.attemptAnswer.findUniqueOrThrow({ where: { attemptQuestionId: first.attemptQuestionId } });
      assert.equal(clearRow.changeCount, 2); assert.ok(clearRow.firstAnsweredAt);
      assert.equal(await database.auditLog.count({ where: { entityId: view.attemptId } }), 1);
    });
    await t.test("start replay returns the exact bounded original receipt after saves, flags and finalization", async () => {
      const { q } = await makeQuiz(), body = { ...mutation(), requestedContentLocale: "en" };
      const receipt = await service.start(req, "courses", f.ids.course!, q.id, body);
      assert.deepEqual(receipt, { attemptId: receipt.attemptId });
      const view = await resume(receipt.attemptId), first = view.questions[0]!;
      await service.save(req, receipt.attemptId, { ...mutation(), changes: [change(first)] });
      await service.flag(req, receipt.attemptId, first.attemptQuestionId, { ...mutation(), expectedFlagRevision: 0, isFlagged: true });
      assert.deepEqual(await service.start(req, "courses", f.ids.course!, q.id, body), receipt);
      await service.submit(req, receipt.attemptId, mutation());
      assert.deepEqual(await service.start(req, "courses", f.ids.course!, q.id, body), receipt);
      assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 1);
      const saved = await database.assessmentMutation.findUniqueOrThrow({ where: { actorId_operationScope_clientMutationId: {
        actorId: req.user.id, operationScope: `start:${q.id}`, clientMutationId: body.clientMutationId,
      } } });
      assert.deepEqual(saved.receipt, receipt);
      assert.ok(!("questions" in await service.resume(req, receipt.attemptId)));
      await reject(() => service.start(req, "courses", f.ids.course!, q.id, { ...body, requestedContentLocale: "ar" }), "IDEMPOTENCY_CONFLICT");
      await enrollment.change(req, f.ids.enrollment!, "revoked");
      try { await reject(() => service.start(req, "courses", f.ids.course!, q.id, body), "RESOURCE_NOT_FOUND"); }
      finally { await enrollment.grant(req, f.ids.course!, f.ids.user!); }
    });
    await t.test("batch atomicity, typed membership, stale revisions and concurrent save conflicts", async () => {
      const { q } = await makeQuiz(), view = await start(q.id), [first, second] = view.questions;
      await reject(() => service.save(req, view.attemptId, { ...mutation(), changes: [change(first!), change(second!, 9)] }), "ANSWER_CHANGED");
      assert.ok((await resume(view.attemptId)).answers.every(a => a.answerRevision === 0));
      await reject(() => service.save(req, view.attemptId, { ...mutation(), changes: [change(first!, 0, { type: "single_choice", optionId: "foreign" })] }), "INVALID_INPUT");
      await reject(() => service.save(req, view.attemptId, { ...mutation(), changes: [{ ...change(first!), attemptQuestionId: randomUUID() }] }), "INVALID_INPUT");
      const race = await Promise.allSettled([service.save(req, view.attemptId, { ...mutation(), changes: [change(first!)] }),
        service.save(req, view.attemptId, { ...mutation(), changes: [change(first!, 0, { type: "single_choice", optionId: B })] })]);
      assert.equal(race.filter(r => r.status === "rejected").length, 1);
      assert.ok((race.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message === "ANSWER_CHANGED");
      const resumed = await resume(view.attemptId);
      assert.equal(resumed.answers[0]!.answerRevision, 1);
    });
    await t.test("submission final batch conflicts roll back; canonical receipt and frozen safe finalized reads", async () => {
      const { q } = await makeQuiz(), view = await start(q.id), first = view.questions[0]!;
      await reject(() => service.submit(req, view.attemptId, { ...mutation(), changes: [change(first, 1)] }), "ANSWER_CHANGED");
      assert.equal((await resume(view.attemptId)).state, "IN_PROGRESS");
      const body = { ...mutation(), changes: [change(first)] };
      const receipt = await service.submit(req, view.attemptId, body);
      assert.deepEqual(await service.submit(req, view.attemptId, body), receipt);
      const duplicates = await Promise.all([service.submit(req, view.attemptId, mutation()), service.submit(req, view.attemptId, mutation())]);
      assert.deepEqual(duplicates, [receipt, receipt]);
      assert.deepEqual(await service.resume(req, view.attemptId), receipt);
      assert.ok(!("questions" in (receipt as object)));
      assert.doesNotMatch(JSON.stringify(receipt), /correct|score|answer|prompt|explanation/);
      await reject(() => service.save(req, view.attemptId, { ...mutation(), changes: [change(first, 1)] }), "ATTEMPT_FINALIZED");
      await reject(() => service.flag(req, view.attemptId, first.attemptQuestionId, { ...mutation(), expectedFlagRevision: 0, isFlagged: true }), "ATTEMPT_FINALIZED");
      assert.equal(await database.assessmentJob.count({ where: { attemptId: view.attemptId, kind: "grade" } }), 1);
      assert.equal(await database.attemptGrade.count(), 0);
      assert.equal(await database.auditLog.count({ where: { entityId: view.attemptId } }), 2);
    });
    await t.test("stable quiz quotas across immutable revisions and enrollment reactivation", async () => {
      const { q, draft } = await makeQuiz({ mode: "graded", maxAttempts: 1 }), view = await start(q.id);
      await service.submit(req, view.attemptId, mutation());
      await reject(() => start(q.id), "ATTEMPT_LIMIT_REACHED");
      await quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft });
      await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 3 });
      await enrollment.change(req, f.ids.enrollment!, "revoked");
      await enrollment.grant(req, f.ids.course!, f.ids.user!);
      await reject(() => start(q.id), "ATTEMPT_LIMIT_REACHED");
      assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 1);
      assert.equal((await service.quiz(req, "courses", f.ids.course!, q.id)).attemptsRemaining, 0);
    });
    await t.test("availability rejects starts without consuming allowance; authored locale fallback and revision pinning", async () => {
      for (const p of [{ opensAt: new Date(Date.now() + 60000).toISOString() }, { closesAt: new Date(Date.now() - 1000).toISOString() }]) {
        const { q } = await makeQuiz(p);
        await reject(() => start(q.id), "opensAt" in p ? "QUIZ_NOT_OPEN" : "QUIZ_CLOSED");
        assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 0);
      }
      const { q, draft } = await makeQuiz({ shuffleQuestions: true, shuffleOptions: true }), view = await start(q.id);
      await quizzes.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2,
        draft: { ...draft, content: { ar: { title: "New", instructions: "New instructions" } } } });
      await quizzes.publish(req, "courses", f.ids.course!, q.id, { expectedRevision: 3 });
      const old = await resume(view.attemptId);
      assert.deepEqual(old.questions, view.questions); assert.equal(old.title, "Quiz");
      await service.submit(req, view.attemptId, mutation());
      const next = await start(q.id);
      assert.equal(next.selectedContentLocale, "ar"); assert.equal(next.attemptNumber, 2);
      assert.notEqual(next.quizRevisionId, view.quizRevisionId);
    });
    await t.test("owner and current authorization precede receipt replay; withdrawal retains history", async () => {
      const { q } = await makeQuiz(), view = await start(q.id), first = view.questions[0]!;
      const body = { ...mutation(), changes: [change(first)] };
      await service.save(req, view.attemptId, body);
      await reject(() => service.save(other, view.attemptId, body), "QUIZ_UNAVAILABLE");
      await reject(() => service.start(req, "courses", f.ids.otherCourse!, q.id, { ...mutation(), requestedContentLocale: "en" }), "RESOURCE_NOT_FOUND");
      await enrollment.change(req, f.ids.enrollment!, "revoked");
      await reject(() => service.save(req, view.attemptId, body), "RESOURCE_NOT_FOUND");
      assert.equal((await database.attemptAnswer.findUniqueOrThrow({ where: { attemptQuestionId: first.attemptQuestionId } })).answerRevision, 1);
      await enrollment.grant(req, f.ids.course!, f.ids.user!);
      await database.enrollment.update({ where: { id: f.ids.enrollment! }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await reject(() => service.resume(req, view.attemptId), "RESOURCE_NOT_FOUND");
      await database.enrollment.update({ where: { id: f.ids.enrollment! }, data: { expiresAt: null } });
      await quizzes.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 });
      await reject(() => service.save(req, view.attemptId, body), "QUIZ_UNAVAILABLE");
      assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 1);
    });
    await t.test("lifecycle audit failures roll back start and explicit final answer submission", async () => {
      const { q } = await makeQuiz(), audit = store.audit.bind(store);
      store.audit = async () => { throw new Error("INJECTED_AUDIT_FAILURE"); };
      await assert.rejects(() => start(q.id), /INJECTED_AUDIT_FAILURE/);
      assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 0);
      store.audit = audit;
      const view = await start(q.id);
      store.audit = async () => { throw new Error("INJECTED_AUDIT_FAILURE"); };
      await assert.rejects(() => service.submit(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!)] }), /INJECTED_AUDIT_FAILURE/);
      store.audit = audit;
      assert.ok((await resume(view.attemptId)).answers.every(a => a.answerRevision === 0));
      assert.equal((await resume(view.attemptId)).attemptNumber, 1);
    });
    await t.test("lazy deadline save commits finalization before error and preserves only acknowledged answers", async () => {
      const { q } = await makeQuiz({ timeLimitSeconds: 60, closesAt: new Date(Date.now() + 1200).toISOString() });
      const view = await start(q.id), first = view.questions[0]!, body = { ...mutation(), changes: [change(first)] };
      assert.equal(view.deadlineReason, "availability_close");
      await service.save(req, view.attemptId, body);
      await wait(Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 20));
      await reject(() => service.save(req, view.attemptId, { ...mutation(), changes: [change(first, 1, null)] }), "ATTEMPT_EXPIRED");
      const a = await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } });
      assert.equal(a.status, "AUTO_SUBMITTED"); assert.equal(a.effectiveSubmittedAt!.toISOString(), view.deadlineAt);
      assert.ok(a.submittedAt! >= a.deadlineAt!);
      assert.equal((await database.attemptAnswer.findUniqueOrThrow({ where: { attemptQuestionId: first.attemptQuestionId } })).answerRevision, 1);
      assert.deepEqual(await service.save(req, view.attemptId, body), { ...(await service.save(req, view.attemptId, body)) });
      assert.ok(!("questions" in await service.resume(req, view.attemptId)));
      const audits = await database.auditLog.findMany({ where: { entityId: view.attemptId } });
      assert.equal(audits.length, 2); assert.doesNotMatch(JSON.stringify(audits.map(a => a.metadata)), /Student answer|Question |correctOption/);
    });
    await t.test("clock_timestamp after lock wait defeats a pre-deadline transaction snapshot", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1100).toISOString() }), view = await start(q.id);
      let locked!: () => void;
      const ready = new Promise<void>(resolve => { locked = resolve; });
      const blocker = database.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id=${view.attemptId}::uuid FOR UPDATE`;
        locked(); await wait(Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 50));
      });
      await ready;
      const save = service.save(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!)] });
      await blocker; await reject(() => save, "ATTEMPT_EXPIRED");
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).status, "AUTO_SUBMITTED");
    });
    await t.test("deadline crossing inside a batch rolls back every new answer before lazy finalization", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1000).toISOString() }), view = await start(q.id);
      const [first, second] = view.questions;
      await f.sql(`CREATE FUNCTION delay_second_answer() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.attempt_question_id='${second!.attemptQuestionId}'::uuid THEN PERFORM pg_sleep(1.1); END IF; RETURN NEW; END $$;
        CREATE TRIGGER a_delay_second_answer BEFORE UPDATE ON assessment_attempt_answers FOR EACH ROW EXECUTE FUNCTION delay_second_answer();`);
      try {
        await reject(() => service.save(req, view.attemptId, { ...mutation(), changes: [change(first!), change(second!)] }), "ATTEMPT_EXPIRED");
      } finally {
        await f.sql(`DROP TRIGGER a_delay_second_answer ON assessment_attempt_answers; DROP FUNCTION delay_second_answer();`);
      }
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).status, "AUTO_SUBMITTED");
      const answers = await database.attemptAnswer.findMany({ where: { question: { attemptId: view.attemptId } } });
      assert.ok(answers.every(a => a.answerRevision === 0 && a.answer === null && a.changeCount === 0));
    });
    await t.test("concurrent flag revisions conflict independently; expired flag, resume and submit use the same freeze", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1000).toISOString() }), view = await start(q.id);
      const first = view.questions[0]!;
      const bodies = [{ ...mutation(), expectedFlagRevision: 0, isFlagged: true }, { ...mutation(), expectedFlagRevision: 0, isFlagged: true }];
      const race = await Promise.allSettled(bodies.map(body => service.flag(req, view.attemptId, first.attemptQuestionId, body)));
      assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
      assert.equal((race.find(r => r.status === "rejected") as PromiseRejectedResult).reason.message, "FLAG_CHANGED");
      await wait(Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 10));
      await reject(() => service.flag(req, view.attemptId, first.attemptQuestionId,
        { ...mutation(), expectedFlagRevision: 1, isFlagged: false }), "ATTEMPT_EXPIRED");
      const receipts = await Promise.all([service.resume(req, view.attemptId), service.submit(req, view.attemptId, mutation()), service.submit(req, view.attemptId, mutation())]);
      assert.deepEqual(receipts[0], receipts[1]); assert.deepEqual(receipts[1], receipts[2]);
      const flag = await database.attemptQuestionState.findUniqueOrThrow({ where: { attemptQuestionId: first.attemptQuestionId } });
      assert.equal(flag.isFlagged, true); assert.equal(flag.flagRevision, 1);
      assert.equal((await database.attemptAnswer.findUniqueOrThrow({ where: { attemptQuestionId: first.attemptQuestionId } })).changeCount, 0);
    });
    await t.test("enrollment expiration during an attempt-lock wait denies interactive writes", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      await database.enrollment.update({ where: { id: f.ids.enrollment! }, data: { expiresAt: new Date(Date.now() + 700) } });
      let locked!: () => void;
      const ready = new Promise<void>(resolve => { locked = resolve; });
      const blocker = database.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id=${view.attemptId}::uuid FOR UPDATE`;
        locked(); await wait(850);
      });
      await ready;
      const saving = service.save(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!)] });
      await blocker;
      try { await reject(() => saving, "RESOURCE_NOT_FOUND"); }
      finally { await database.enrollment.update({ where: { id: f.ids.enrollment! }, data: { expiresAt: null } }); }
      assert.ok((await resume(view.attemptId)).answers.every(a => a.answerRevision === 0));
    });
    await t.test("leased jobs recover from crash, fence stale owners, deduplicate grade work and finalize withdrawn attempts", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1100).toISOString() }), view = await start(q.id);
      await wait(Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 20));
      const deadline = await database.assessmentJob.findUniqueOrThrow({ where: { deduplicationKey: `deadline:${view.attemptId}` } });
      // Isolate this job from earlier lazy-finalized deadlines, which may also be due.
      await database.assessmentJob.updateMany({ where: { kind: "deadline", id: { not: deadline.id }, state: "queued" },
        data: { availableAt: new Date(Date.now() + 60000) } });
      const claimed = await Promise.all([deadlines.claim(), deadlines.claim()]);
      assert.equal(claimed.filter(Boolean).length, 1);
      const lease = claimed.find(Boolean)!; assert.equal(lease.attemptId, view.attemptId);
      await database.assessmentJob.update({ where: { id: lease.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      const restarted = new AssessmentDeadlineService(store, new AttemptsService(store, access));
      const recovered = await restarted.claim(); assert.ok(recovered); assert.ok(recovered.fence > lease.fence);
      assert.equal(await deadlines.execute(lease), false);
      await quizzes.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 });
      await enrollment.change(req, f.ids.enrollment!, "revoked");
      assert.equal(await restarted.execute(recovered), true);
      assert.equal(await restarted.execute(recovered), false);
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).status, "AUTO_SUBMITTED");
      assert.equal(await database.assessmentJob.count({ where: { attemptId: view.attemptId, kind: "grade" } }), 1);
      const audit = await database.auditLog.findFirstOrThrow({ where: { entityId: view.attemptId, action: "assessment.attempt.auto_submitted" } });
      assert.equal(audit.actorUserId, null);
      await enrollment.grant(req, f.ids.course!, f.ids.user!);
      await restarted.onModuleDestroy();
    });
    await t.test("bounded recovery reconstructs missing due deadlines; failures retry boundedly without partial finalization", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1100).toISOString() }), view = await start(q.id);
      await database.assessmentJob.deleteMany({ where: { attemptId: view.attemptId } });
      await wait(Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 20));
      assert.ok(await deadlines.recover(1) <= 1);
      const job = await database.assessmentJob.findUniqueOrThrow({ where: { deduplicationKey: `deadline:${view.attemptId}` } });
      await database.assessmentJob.updateMany({ where: { kind: "deadline", id: { not: job.id }, state: "queued" },
        data: { availableAt: new Date(Date.now() + 60000) } });
      const lease = await deadlines.claim(); assert.ok(lease);
      // Force internal auto-submit audit failure at PostgreSQL, not an in-memory fake finalization.
      await f.sql(`CREATE FUNCTION reject_attempt_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='assessment.attempt.auto_submitted' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_attempt_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_attempt_audit();`);
      await assert.rejects(() => deadlines.execute(lease));
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).status, "IN_PROGRESS");
      await database.assessmentJob.update({ where: { id: lease.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      await deadlines.tick(1);
      const retry = await database.assessmentJob.findUniqueOrThrow({ where: { id: lease.id } });
      assert.equal(retry.state, "queued"); assert.equal(retry.attempts, 2);
      assert.equal(retry.errorCode, "DEADLINE_FINALIZATION_FAILED");
      await f.sql(`DROP TRIGGER reject_attempt_audit ON audit_logs; DROP FUNCTION reject_attempt_audit();`);
      await database.assessmentJob.update({ where: { id: lease.id }, data: { availableAt: new Date(Date.now() - 1000) } });
      assert.equal(await deadlines.tick(1), 1);
      const terminal = await makeQuiz({ closesAt: new Date(Date.now() + 1100).toISOString() }), terminalView = await start(terminal.q.id);
      const terminalJob = await database.assessmentJob.findUniqueOrThrow({ where: { deduplicationKey: `deadline:${terminalView.attemptId}` } });
      await database.assessmentJob.update({ where: { id: terminalJob.id }, data: { state: "running", attempts: 5,
        leaseToken: randomUUID(), leaseUntil: new Date(Date.now() - 1000) } });
      assert.equal(await deadlines.reap(), 1);
      assert.equal((await database.assessmentJob.findUniqueOrThrow({ where: { id: terminalJob.id } })).state, "failed");
      assert.equal(await deadlines.reap(), 0);
    });
    await t.test("save/submit and flag/submit races freeze one convergent snapshot; history paginates safely", async () => {
      const { q } = await makeQuiz(), view = await start(q.id), first = view.questions[0]!;
      const races = await Promise.allSettled([
        service.save(req, view.attemptId, { ...mutation(), changes: [change(first)] }),
        service.flag(req, view.attemptId, first.attemptQuestionId, { ...mutation(), expectedFlagRevision: 0, isFlagged: true }),
        service.submit(req, view.attemptId, mutation()),
      ]);
      assert.ok(races.some(r => r.status === "fulfilled"));
      const a = await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } });
      assert.equal(a.status, "SUBMITTED");
      assert.equal(await database.auditLog.count({ where: { entityId: view.attemptId, action: "assessment.attempt.submitted" } }), 1);
      const history = await service.history(req, { pageSize: 1 });
      assert.equal(history.items.length, 1); assert.ok(history.nextCursor);
      const next = await service.history(req, { pageSize: 1, cursor: history.nextCursor });
      assert.notEqual(next.items[0]?.attemptId, history.items[0]!.attemptId);
    });
    await t.test("first submit races converge across mutation IDs without duplicate audits or grade jobs", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      const receipts = await Promise.all([service.submit(req, view.attemptId, mutation()), service.submit(req, view.attemptId, mutation())]);
      assert.deepEqual(receipts[0], receipts[1]);
      assert.equal(await database.auditLog.count({ where: { entityId: view.attemptId, action: "assessment.attempt.submitted" } }), 1);
      assert.equal(await database.assessmentJob.count({ where: { attemptId: view.attemptId, kind: "grade" } }), 1);
      await database.assessmentJob.deleteMany({ where: { attemptId: view.attemptId, kind: "grade" } });
      await deadlines.recover();
      assert.equal(await database.assessmentJob.count({ where: { attemptId: view.attemptId, kind: "grade" } }), 1);
    });
    await t.test("deadline job vs save/flag/submit converges to one frozen snapshot and one auto-submit audit", async () => {
      const { q } = await makeQuiz({ closesAt: new Date(Date.now() + 1100).toISOString() }), view = await start(q.id);
      await wait(Math.max(0, Date.parse(view.deadlineAt!) - Date.now() + 15));
      const job = await database.assessmentJob.findUniqueOrThrow({ where: { deduplicationKey: `deadline:${view.attemptId}` } });
      await database.assessmentJob.updateMany({ where: { kind: "deadline", id: { not: job.id }, state: "queued" },
        data: { availableAt: new Date(Date.now() + 60000) } });
      const lease = await deadlines.claim(); assert.ok(lease);
      const results = await Promise.allSettled([
        deadlines.execute(lease),
        service.save(req, view.attemptId, { ...mutation(), changes: [change(view.questions[0]!)] }),
        service.flag(req, view.attemptId, view.questions[0]!.attemptQuestionId, { ...mutation(), expectedFlagRevision: 0, isFlagged: true }),
        service.submit(req, view.attemptId, mutation()),
      ]);
      assert.ok(results[0]!.status === "fulfilled", results[0]!.status === "rejected" ? String(results[0]!.reason.message) : "");
      for (const r of results.slice(1, 3)) {
        assert.equal(r.status, "rejected"); assert.equal((r as PromiseRejectedResult).reason.message, "ATTEMPT_EXPIRED");
      }
      assert.equal((await database.assessmentAttempt.findUniqueOrThrow({ where: { id: view.attemptId } })).status, "AUTO_SUBMITTED");
      assert.ok((await database.attemptAnswer.findMany({ where: { question: { attemptId: view.attemptId } } })).every(a => a.answerRevision === 0));
      assert.equal(await database.auditLog.count({ where: { entityId: view.attemptId, action: "assessment.attempt.auto_submitted" } }), 1);
    });
    await t.test("enrollment revocation and quiz withdrawal serialize with Student mutations, never authorize stale replay", async () => {
      const { q } = await makeQuiz(), view = await start(q.id);
      const body = { ...mutation(), changes: [change(view.questions[0]!)] };
      await Promise.allSettled([service.save(req, view.attemptId, body), enrollment.change(req, f.ids.enrollment!, "revoked")]);
      await reject(() => service.save(req, view.attemptId, body), "RESOURCE_NOT_FOUND");
      await enrollment.grant(req, f.ids.course!, f.ids.user!);
      await Promise.allSettled([service.flag(req, view.attemptId, view.questions[0]!.attemptQuestionId,
        { ...mutation(), expectedFlagRevision: 0, isFlagged: true }),
      quizzes.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 })]);
      await reject(() => service.resume(req, view.attemptId), "QUIZ_UNAVAILABLE");
      assert.equal(await database.assessmentAttempt.count({ where: { quizId: q.id } }), 1);
    });
    await deadlines.onModuleDestroy();
    // Enrollment revoke/reactivate legitimately updates enrollment fields; all progress/curriculum state stays byte-identical.
    const current = JSON.parse(await f.baseline()) as Record<string, unknown>, original = JSON.parse(baseline) as Record<string, unknown>;
    delete current.enrollments; delete original.enrollments;
    assert.deepEqual(current, original);
    assert.equal(await database.attemptGrade.count(), 0);
    assert.equal(await database.skillEvidence.count(), 0);
    assert.equal(await database.assessmentTelemetrySession.count(), 0);
  } finally {
    await db?.$disconnect();
    await f.cleanup();
  }
});
