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
import type { QuizItemInput } from "../src/modules/assessments/quizzes/quizzes.schemas.js";

const rejected = (fn: () => Promise<unknown>, code: string) =>
  assert.rejects(fn, (e: unknown) => e instanceof HttpException && e.message === code);
const draft = { defaultContentLocale: "ar", content: { ar: { title: "اختبار", instructions: "تعليمات" },
  en: { title: "Quiz", instructions: "Instructions" } }, policy: { mode: "graded" } };

test("Q4 quiz composition real services on disposable PostgreSQL", { timeout: 180000 }, async t => {
  const f = new AssessmentDatabaseFixture();
  let db: PrismaClient | undefined;
  try {
    await f.setup(); await f.migrate();
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", f.schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const database = db, store = new LmsStore(db), access = new AssessmentAccessService(store, new EnrollmentsService(store));
    const service = new QuizzesService(store, access), bank = new QuestionBankService(store);
    const adminRole = await db.role.upsert({ where: { name: "admin" }, create: { name: "admin" }, update: {} });
    await db.userRole.create({ data: { userId: f.ids.user!, roleId: adminRole.id } });
    const req = { user: { id: f.ids.user }, requestId: randomUUID(), mfaVerified: true } as AuthenticatedRequest;
    const baseline = await f.baseline();
    const skill = await db.skill.create({ data: { slug: "quiz-primary", translations: { create: { locale: "en", label: "Primary" } } } });
    const qdraft: QuestionDraftInput = {
      type: "true_false", defaultContentLocale: "ar",
      content: { ar: { prompt: "سؤال خاص", code: { language: "java", source: "int n = 7;" } }, en: { prompt: "Private prompt" } },
      gradingDefinition: { type: "true_false", correctValue: false }, explanation: { ar: "تفسير سري", en: "Private explanation" },
      defaultPoints: 7, difficulty: "medium", primarySkillId: skill.id, secondarySkillIds: [], cognitiveTags: ["concept"],
    };
    const makeQuestion = async (d: QuestionDraftInput = qdraft) => {
      const question = await bank.create(req, { draft: d });
      const { revision } = await bank.seal(req, question.id, { expectedRevision: 0 });
      return { question, revision };
    };
    const first = await makeQuestion(), second = await makeQuestion();
    const item = (position = 0, q = first) => ({ questionId: q.question.id, questionRevisionId: q.revision.id, position });
    const create = (d: unknown = draft) => service.create(req, "courses", f.ids.course!, { draft: d });
    const get = (id: string) => service.get(req, "courses", f.ids.course!, id);
    const replace = (id: string, expectedRevision: number, items: QuizItemInput[] = [item()]) =>
      service.replaceItems(req, "courses", f.ids.course!, id, { expectedRevision, items });
    const publish = (id: string, expectedRevision: number) => service.publish(req, "courses", f.ids.course!, id, { expectedRevision });
    const revision = (id: string, rid: string) => service.revision(req, "courses", f.ids.course!, id, rid);

    await t.test("course/chapter/lesson attachments, exact parent routing and parent immutability", async () => {
      for (const [scope, parentId, type] of [
        ["courses", f.ids.course!, "course"], ["chapters", f.ids.chapter!, "chapter"], ["lessons", f.ids.lesson!, "lesson"],
      ] as const) {
        const q = await service.create(req, scope, parentId, { draft });
        assert.equal(q.parentType, type); assert.equal(q.parentId, parentId); assert.equal(q.courseId, f.ids.course);
        assert.equal(q.chapterId, scope === "courses" ? null : f.ids.chapter);
        assert.equal(q.lessonId, scope === "lessons" ? f.ids.lesson : null);
        assert.equal((await service.get(req, scope, parentId, q.id)).id, q.id);
        await rejected(() => service.get(req, "courses", f.ids.otherCourse!, q.id), "QUIZ_UNAVAILABLE");
        await rejected(() => service.edit(req, scope, parentId, q.id, { expectedRevision: 0, draft, parentId: f.ids.otherCourse }), "INVALID_INPUT");
      }
      await rejected(() => service.create(req, "arbitrary", f.ids.course!, { draft }), "INVALID_INPUT");
      await rejected(() => service.create(req, "chapters", f.ids.course!, { draft }), "QUIZ_UNAVAILABLE");
      const q = await create(); await replace(q.id, 0); await publish(q.id, 1);
      await assert.rejects(() => database.quiz.update({ where: { id: q.id },
        data: { courseId: f.ids.otherCourse!, parentId: f.ids.otherCourse! } }));
    });
    await t.test("service rechecks Admin/MFA; cross-parent tampering and archived ancestors fail closed", async () => {
      const q = await create();
      for (const call of [
        () => service.get({ ...req, mfaVerified: false } as AuthenticatedRequest, "courses", f.ids.course!, q.id),
        () => service.preview({ ...req, mfaVerified: false } as AuthenticatedRequest, "courses", f.ids.course!, q.id, { expectedRevision: 0, locale: "ar" }),
        () => service.answerPreview({ ...req, mfaVerified: false } as AuthenticatedRequest, "courses", f.ids.course!, q.id, { expectedRevision: 0, locale: "ar" }),
      ]) await rejected(call, "ADMIN_MFA_REQUIRED");
      await rejected(() => service.get({ ...req, user: { id: f.ids.otherUser } } as AuthenticatedRequest,
        "courses", f.ids.course!, q.id), "ROLE_REQUIRED");
      await rejected(() => service.get(req, "chapters", f.ids.chapter!, q.id), "QUIZ_UNAVAILABLE");
      // Separate archived tree: never alter/restore the approved baseline tree.
      const archivedCourse = await database.course.create({ data: { slug: "archived-quiz-parent", title: "Archived", createdBy: req.user.id } });
      const chapter = await database.chapter.create({ data: { courseId: archivedCourse.id, title: "Archived", position: 0 } });
      const lesson = await database.lesson.create({ data: { courseId: archivedCourse.id, chapterId: chapter.id, title: "Archived", position: 0 } });
      const lessonQuiz = await service.create(req, "lessons", lesson.id, { draft });
      await database.chapter.update({ where: { id: chapter.id }, data: { status: "archived", archivedAt: new Date() } });
      assert.equal((await service.get(req, "lessons", lesson.id, lessonQuiz.id)).id, lessonQuiz.id);
      await rejected(() => service.edit(req, "lessons", lesson.id, lessonQuiz.id, { expectedRevision: 0, draft }), "ARCHIVED_READ_ONLY");
      await rejected(() => service.create(req, "chapters", chapter.id, { draft }), "ARCHIVED_READ_ONLY");
      await database.course.update({ where: { id: archivedCourse.id }, data: { status: "archived", archivedAt: new Date() } });
      await rejected(() => service.create(req, "courses", archivedCourse.id, { draft }), "ARCHIVED_READ_ONLY");
      await rejected(() => service.create(req, "lessons", lesson.id, { draft }), "ARCHIVED_READ_ONLY");
    });
    await t.test("exact pinned revision/default points survive newer bank versions; overrides and reorder are atomic", async () => {
      const q = await create();
      let selected = await replace(q.id, 0, [item(1, first), { ...item(0, second), points: 11 }]);
      assert.deepEqual(selected.items.map(i => [i.questionId, i.position, i.points]), [[second.question.id, 0, 11], [first.question.id, 1, 7]]);
      await bank.edit(req, first.question.id, { expectedRevision: 1, draft: { ...qdraft, defaultPoints: 99 } });
      const next = await bank.seal(req, first.question.id, { expectedRevision: 2 });
      assert.notEqual(next.revision.id, first.revision.id);
      selected = await get(q.id);
      assert.equal(selected.items[1]!.questionRevisionId, first.revision.id); assert.equal(selected.items[1]!.points, 7);
      const old = await publish(q.id, 1);
      assert.equal(old.revision.totalPoints, 18);
      assert.equal(old.revision.items[1]!.questionRevisionId, first.revision.id);
      selected = await replace(q.id, 2, [{ ...item(), questionRevisionId: next.revision.id }, item(1, second)]);
      assert.deepEqual(selected.items.map(i => i.points), [99, 7]);
      const nextPublication = await publish(q.id, 3);
      assert.equal(nextPublication.revision.number, 2); assert.equal(nextPublication.revision.totalPoints, 106);
      assert.deepEqual(await revision(q.id, old.revision.id), old.revision);
      await assert.rejects(() => database.quizRevision.update({ where: { id: old.revision.id }, data: { totalPoints: 88 } }));
      await assert.rejects(() => database.quizRevisionItem.update({ where: { id: old.revision.items[0]!.id }, data: { points: 88 } }));
      await assert.rejects(() => database.quizRevisionItem.create({ data: {
        quizRevisionId: old.revision.id, questionId: randomUUID(), questionRevisionId: first.revision.id,
        position: 2, points: 1, evidenceSnapshot: {},
      } }));
    });
    await t.test("invalid selection/duplicate lineage/gaps/points/maximum do not replace prior items or revision", async () => {
      const q = await create(); const before = await replace(q.id, 0);
      for (const items of [
        [{ ...item(), questionRevisionId: randomUUID() }],
        [{ ...item(), questionRevisionId: second.revision.id }],
        [item(), { ...item(1), questionRevisionId: second.revision.id }],
        [{ ...item(), points: 0 }], [{ ...item(), points: 1001 }], [{ ...item(), position: 1 }],
        Array.from({ length: 101 }, (_, position) => ({ ...item(), position })),
      ]) {
        await assert.rejects(() => replace(q.id, 1, items));
        assert.deepEqual(await get(q.id), before);
      }
      const empty = await create();
      await rejected(() => publish(empty.id, 0), "QUIZ_QUESTIONS_REQUIRED");
      assert.equal((await service.revisions(req, "courses", f.ids.course!, empty.id, {})).total, 0);
    });
    await t.test("100 distinct exact revisions publish at the approved 100000-point ceiling", async () => {
      const items: QuizItemInput[] = [];
      for (let position = 0; position < 100; position++) {
        const question = await makeQuestion();
        items.push({ ...item(position, question), points: 1000 });
      }
      const q = await create(); const selected = await replace(q.id, 0, items.slice().reverse());
      assert.equal(selected.items.length, 100);
      assert.deepEqual(selected.items.map(i => i.position), items.map(i => i.position));
      const result = await publish(q.id, 1);
      assert.equal(result.revision.items.length, 100); assert.equal(result.revision.totalPoints, 100000);
      assert.deepEqual(result.revision.items.map(i => i.questionRevisionId), items.map(i => i.questionRevisionId));
    });
    await t.test("safe/private previews are disjoint explicit projections with per-item locale fallback and no side effects", async () => {
      const english = await makeQuestion({ ...qdraft, defaultContentLocale: "en",
        content: { en: qdraft.content.en! }, explanation: { en: "English private explanation" } });
      const q = await create({ defaultContentLocale: "ar", content: { ar: draft.content.ar }, policy: { mode: "practice", shuffleQuestions: true, shuffleOptions: true } });
      await replace(q.id, 0, [item(0, english), item(1, second)]);
      const before = await get(q.id), auditCount = await database.auditLog.count();
      const preview = await service.preview(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, locale: "en" });
      assert.equal(preview.requestedLocale, "en"); assert.equal(preview.locale, "ar");
      assert.equal(preview.questions[0]!.locale, "en"); assert.equal(preview.questions[1]!.locale, "en");
      const arabic = await service.preview(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, locale: "ar" });
      assert.equal(arabic.questions[0]!.locale, "en"); assert.equal(arabic.questions[1]!.locale, "ar");
      assert.deepEqual(arabic.questions[1]!.code, { language: "java", source: "int n = 7;" });
      assert.doesNotMatch(JSON.stringify(preview), /gradingDefinition|correctValue|Private explanation|"explanation":|skillSnapshot|checksum|assemblyTransaction/);
      const answers = await service.answerPreview(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, locale: "ar" });
      assert.deepEqual(answers.questions[0]!.gradingDefinition, qdraft.gradingDefinition);
      assert.equal(answers.questions[0]!.explanation, "English private explanation");
      assert.equal(answers.questions[1]!.explanation, "تفسير سري");
      assert.equal("prompt" in answers.questions[0]!, false);
      assert.deepEqual(await get(q.id), before); assert.equal(await database.auditLog.count(), auditCount);
      await rejected(() => service.preview(req, "courses", f.ids.course!, q.id, { expectedRevision: 0, locale: "ar" }), "QUIZ_CHANGED");
    });
    await t.test("all five sealed types retain safe option/item/code presentation and private answer definitions separately", async () => {
      const options = [randomUUID(), randomUUID()].map((id, index) => ({ id, label: `Option ${index}` }));
      for (const type of ["single_choice", "multiple_choice", "true_false", "short_text", "ordering"] as const) {
        const gradingDefinition: QuestionDraftInput["gradingDefinition"] = type === "single_choice" ? { type, correctOptionId: options[1]!.id }
          : type === "multiple_choice" ? { type, correctOptionIds: options.map(o => o.id) }
            : type === "ordering" ? { type, correctOrderedItemIds: options.map(o => o.id).reverse() }
              : type === "true_false" ? { type, correctValue: false }
                : { type, acceptedByLocale: { en: ["answer"] }, normalizer: {
                  version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false } };
        const question = await makeQuestion({ ...qdraft, type, defaultContentLocale: "en", explanation: { en: "Private" },
          content: { en: { prompt: "Prompt", ...(type.includes("choice") ? { options } : {}), ...(type === "ordering" ? { items: options } : {}) } },
          gradingDefinition });
        const q = await create(); await replace(q.id, 0, [item(0, question)]);
        const safe = await service.preview(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, locale: "en" });
        assert.equal(safe.questions[0]!.type, type);
        if (type.includes("choice")) assert.deepEqual(safe.questions[0]!.options, options);
        if (type === "ordering") assert.deepEqual(safe.questions[0]!.items, options);
        assert.doesNotMatch(JSON.stringify(safe), /correctOption|correctOrdered|acceptedByLocale|normalizer|gradingDefinition/);
        assert.deepEqual((await service.answerPreview(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, locale: "en" })).questions[0]!.gradingDefinition, gradingDefinition);
        await publish(q.id, 1);
      }
    });
    await t.test("publication freezes full policy/availability/AI flag and evidence references, not mutable bank values", async () => {
      const policy = { mode: "practice", required: true, maxAttempts: 3, timeLimitSeconds: 60,
        opensAt: "2026-01-01T00:00:00Z", closesAt: "2026-01-02T00:00:00Z",
        passBasisPoints: 6667, shuffleQuestions: true, shuffleOptions: true, aiAnalysisEnabled: true,
        scoreVisibility: "after_attempt_limit", reviewVisibility: "after_attempt_limit", explanationVisibility: "never" };
      const q = await create({ ...draft, policy }); await replace(q.id, 0);
      const old = await publish(q.id, 1);
      assert.equal(old.revision.totalPoints, 7); assert.equal(old.revision.policy.passBasisPoints, 6667);
      assert.equal(old.revision.policy.opensAt, "2026-01-01T00:00:00.000Z");
      assert.equal(old.revision.policy.closesAt, "2026-01-02T00:00:00.000Z");
      assert.equal(old.revision.policy.aiAnalysisEnabled, true); assert.equal(old.revision.policy.required, true);
      assert.equal(old.revision.policy.maxAttempts, 3); assert.equal(old.revision.policy.shuffleOptions, true);
      const persisted = await database.quizRevisionItem.findUniqueOrThrow({ where: { id: old.revision.items[0]!.id } });
      assert.deepEqual((persisted.evidenceSnapshot as Record<string, unknown>).skillSnapshot, first.revision.skillSnapshot);
      await service.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft });
      assert.equal((await get(q.id)).currentRevisionId, old.revision.id);
      assert.deepEqual(await revision(q.id, old.revision.id), old.revision);
      await rejected(() => service.release(req, "courses", f.ids.course!, q.id, old.revision.id, { clientMutationId: randomUUID() }), "MANUAL_RELEASE_NOT_CONFIGURED");
    });
    await t.test("publish revalidates persisted localization, policy, ordering and grader compatibility, preserving previous publication", async () => {
      const q = await create(); await replace(q.id, 0); const old = await publish(q.id, 1);
      const stored = await database.quizDraft.findUniqueOrThrow({ where: { quizId: q.id } });
      for (const data of [
        { content: {} }, { policy: { mode: "practice", maxAttempts: null, reviewVisibility: "after_attempt_limit" } },
        { defaultContentLocale: "en", content: { ar: draft.content.ar } }, { schemaVersion: 2 },
      ]) {
        await database.quizDraft.update({ where: { quizId: q.id }, data });
        await assert.rejects(() => publish(q.id, 2));
        assert.equal((await get(q.id)).currentRevisionId, old.revision.id);
        assert.equal(await database.quizRevision.count({ where: { quizId: q.id } }), 1);
        await database.quizDraft.update({ where: { quizId: q.id }, data: {
          content: stored.content!, policy: stored.policy!, defaultContentLocale: stored.defaultContentLocale, schemaVersion: 1,
        } });
      }
      await database.quizDraftItem.update({ where: { id: (await get(q.id)).items[0]!.id }, data: { position: 5 } });
      await rejected(() => publish(q.id, 2), "INVALID_INPUT");
      assert.equal((await get(q.id)).currentRevisionId, old.revision.id);
      const source = await database.questionRevision.findUniqueOrThrow({ where: { id: second.revision.id } });
      for (const [number, invalid] of [
        [2, { graderVersion: "unsupported-v2" }],
        [3, { gradingDefinition: { type: "true_false", correctValue: "not-boolean" } }],
        [4, { content: { ar: { prompt: "Incomplete default points" } } }],
      ] as const) {
        const invalidRevision = await database.questionRevision.create({ data: {
          ...source, content: source.content!, gradingDefinition: source.gradingDefinition!, explanation: source.explanation!,
          skillSnapshot: source.skillSnapshot!, cognitiveTags: source.cognitiveTags!, id: randomUUID(), number, ...invalid,
        } });
        const before = await get(q.id);
        await assert.rejects(() => replace(q.id, 2, [{ ...item(0, second), questionRevisionId: invalidRevision.id }]));
        assert.deepEqual(await get(q.id), before);
      }
    });
    await t.test("archived question/skills cannot enter new publication; immutable historical use remains readable and previewable", async () => {
      const archived = await makeQuestion();
      const q = await create(); await replace(q.id, 0, [item(0, archived)]); const old = await publish(q.id, 1);
      await bank.archive(req, archived.question.id, { expectedRevision: 1 });
      await rejected(() => publish(q.id, 2), "QUESTION_NOT_ACTIVE");
      await rejected(() => replace(q.id, 2, [item(0, archived)]), "QUESTION_NOT_ACTIVE");
      assert.deepEqual(await revision(q.id, old.revision.id), old.revision);
      assert.equal((await service.preview(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, locale: "ar" })).questions[0]!.questionRevisionId, archived.revision.id);
      const otherSkill = await database.skill.create({ data: { slug: "to-archive", translations: { create: { locale: "ar", label: "مهارة" } } } });
      const skillQuestion = await makeQuestion({ ...qdraft, primarySkillId: otherSkill.id });
      const s = await create(); await replace(s.id, 0, [item(0, skillQuestion)]);
      await database.skill.update({ where: { id: otherSkill.id }, data: { status: "archived" } });
      await rejected(() => publish(s.id, 1), "SKILL_NOT_ACTIVE");
      assert.equal(await database.quizRevision.count({ where: { quizId: s.id } }), 0);
    });
    await t.test("independent editRevision rejects stale metadata/policy/item/lifecycle changes and concurrent publish/edit", async () => {
      const q = await create(); await replace(q.id, 0);
      const outcomes = await Promise.allSettled([
        publish(q.id, 1),
        service.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, draft: { ...draft, policy: { mode: "practice" } } }),
      ]);
      assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
      const loser = outcomes.find(o => o.status === "rejected") as PromiseRejectedResult;
      assert.ok(loser.reason instanceof HttpException); assert.equal(loser.reason.getStatus(), 409);
      assert.equal((await get(q.id)).editRevision, 2);
      for (const mutation of [
        () => replace(q.id, 1), () => publish(q.id, 1),
        () => service.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 1, draft }),
        () => service.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 1 }),
        () => service.archive(req, "courses", f.ids.course!, q.id, { expectedRevision: 1 }),
      ]) await rejected(mutation, "QUIZ_CHANGED");
      const p = await create(); await replace(p.id, 0);
      const publishes = await Promise.allSettled([publish(p.id, 1), publish(p.id, 1)]);
      assert.equal(publishes.filter(o => o.status === "fulfilled").length, 1);
      assert.equal(await database.quizRevision.count({ where: { quizId: p.id } }), 1);
    });
    await t.test("unpublish and archive preserve history/draft, deny future writes and do not reuse revision numbers", async () => {
      const q = await create(); await replace(q.id, 0); const old = await publish(q.id, 1);
      const unpublished = await service.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 });
      assert.equal(unpublished.status, "draft"); assert.equal(unpublished.currentRevisionId, null);
      assert.equal(unpublished.items.length, 1); assert.deepEqual(unpublished.draft, q.draft);
      assert.deepEqual(await revision(q.id, old.revision.id), old.revision);
      await rejected(() => service.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 3 }), "QUIZ_NOT_PUBLISHED");
      const next = await publish(q.id, 3); assert.equal(next.revision.number, 2);
      const archived = await service.archive(req, "courses", f.ids.course!, q.id, { expectedRevision: 4 });
      assert.equal(archived.status, "archived"); assert.equal(archived.editRevision, 5);
      await rejected(() => publish(q.id, 5), "ARCHIVED_READ_ONLY");
      await rejected(() => replace(q.id, 5), "ARCHIVED_READ_ONLY");
      await rejected(() => service.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 5, draft }), "ARCHIVED_READ_ONLY");
      await rejected(() => service.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 5 }), "ARCHIVED_READ_ONLY");
      assert.equal((await service.revisions(req, "courses", f.ids.course!, q.id, { pageSize: 1 })).total, 2);
      assert.deepEqual(await revision(q.id, old.revision.id), old.revision);
      await rejected(() => revision(q.id, randomUUID()), "QUIZ_REVISION_NOT_FOUND");
      const other = await create();
      await rejected(() => revision(other.id, old.revision.id), "QUIZ_REVISION_NOT_FOUND");
    });
    await t.test("manual release is exact-revision, irreversible, audited once and concurrently idempotent", async () => {
      const q = await create(); await replace(q.id, 0); const old = await publish(q.id, 1);
      const next = await publish(q.id, 2);
      const releases = await Promise.all([randomUUID(), randomUUID()].map(clientMutationId =>
        service.release(req, "courses", f.ids.course!, q.id, old.revision.id, { clientMutationId })));
      assert.deepEqual(releases[0], releases[1]);
      assert.equal(releases[0]!.quizRevisionId, old.revision.id);
      assert.equal((await revision(q.id, next.revision.id)).reviewRelease, null);
      assert.deepEqual((await revision(q.id, old.revision.id)).reviewRelease, releases[0]);
      assert.equal(await database.auditLog.count({ where: { entityId: q.id, action: "assessment.quiz.review_released" } }), 1);
      assert.equal((await get(q.id)).editRevision, 3);
      await rejected(() => service.release(req, "courses", f.ids.course!, q.id, randomUUID(), { clientMutationId: randomUUID() }), "QUIZ_REVISION_NOT_FOUND");
      const other = await create();
      await rejected(() => service.release(req, "courses", f.ids.course!, other.id, old.revision.id, { clientMutationId: randomUUID() }), "QUIZ_REVISION_NOT_FOUND");
      await assert.rejects(() => database.quizReviewRelease.delete({ where: { quizRevisionId: old.revision.id } }));
    });
    await t.test("every meaningful mutation and republish rolls back atomically when required audit fails", async () => {
      const q = await create(); await replace(q.id, 0); const old = await publish(q.id, 1);
      const unpublished = await create(); await replace(unpublished.id, 0);
      const before = await get(q.id), count = await database.quiz.count(), auditCount = await database.auditLog.count();
      const original = store.audit;
      store.audit = async () => { throw new Error("TEST_QUIZ_AUDIT_FAILURE"); };
      try {
        for (const call of [
          () => create(),
          () => service.edit(req, "courses", f.ids.course!, q.id, { expectedRevision: 2, draft: { ...draft, policy: { mode: "practice" } } }),
          () => replace(q.id, 2, [item(0, second)]), () => publish(q.id, 2), () => publish(unpublished.id, 1),
          () => service.unpublish(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 }),
          () => service.archive(req, "courses", f.ids.course!, q.id, { expectedRevision: 2 }),
          () => service.release(req, "courses", f.ids.course!, q.id, old.revision.id, { clientMutationId: randomUUID() }),
        ]) {
          await assert.rejects(call, /TEST_QUIZ_AUDIT_FAILURE/);
          assert.deepEqual(await get(q.id), before);
          assert.equal(await database.quiz.count(), count);
          assert.equal(await database.quizRevision.count({ where: { quizId: q.id } }), 1);
          assert.equal(await database.quizRevisionItem.count({ where: { revision: { quizId: q.id } } }), 1);
          assert.equal(await database.quizReviewRelease.count({ where: { quizRevisionId: old.revision.id } }), 0);
          assert.equal(await database.auditLog.count(), auditCount);
          assert.equal(await database.quizRevision.count({ where: { quizId: unpublished.id } }), 0);
          assert.equal((await get(unpublished.id)).currentRevisionId, null);
        }
      } finally { store.audit = original; }
      assert.deepEqual(await revision(q.id, old.revision.id), old.revision);
      const audit = await database.auditLog.findMany({ where: { entityType: "quiz" } });
      const allowed = new Set(["editRevision", "parentType", "parentId", "itemCount", "revisionId", "number", "totalPoints", "priorStatus"]);
      for (const row of audit) {
        for (const key of Object.keys(row.metadata as object)) assert.ok(allowed.has(key), key);
        assert.doesNotMatch(JSON.stringify(row.metadata), /correctValue|gradingDefinition|prompt|instructions|تفسير|Private|token/i);
      }
    });
    await t.test("bounded database-side filters/list/history and summaries remain isolated from grading definitions", async () => {
      const q = await create({ defaultContentLocale: "en", content: { en: { title: "Filter target", instructions: "" } },
        policy: { mode: "practice", required: true } });
      const result = await service.list(req, "courses", f.ids.course!, { mode: "practice", required: "true", locale: "en", status: "draft", pageSize: 1 });
      assert.ok(result.total >= 1); assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.id, q.id);
      assert.doesNotMatch(JSON.stringify(result), /gradingDefinition|correctValue|evidenceSnapshot/);
      const arabic = await service.list(req, "courses", f.ids.course!, { required: "true", locale: "ar", status: "draft" });
      assert.equal(arabic.items.some(i => i.id === q.id), false);
      await rejected(() => service.list(req, "courses", f.ids.course!, { pageSize: 51 }), "INVALID_INPUT");
    });
    await t.test("publication waiting behind parent archive retries and cannot publish stale ancestry", async () => {
      const course = await database.course.create({ data: { slug: "quiz-parent-race", title: "Race", createdBy: req.user.id } });
      const chapter = await database.chapter.create({ data: { courseId: course.id, title: "Race", position: 0 } });
      const q = await service.create(req, "chapters", chapter.id, { draft });
      await service.replaceItems(req, "chapters", chapter.id, q.id, { expectedRevision: 0, items: [item()] });
      let ready!: () => void, release!: () => void;
      const acquired = new Promise<void>(resolve => { ready = resolve; });
      const proceed = new Promise<void>(resolve => { release = resolve; });
      const writer = store.transaction(async tx => {
        await store.courseLock(tx, course.id);
        await tx.chapter.update({ where: { id: chapter.id }, data: { status: "archived", archivedAt: new Date() } });
        ready(); await proceed;
      });
      await acquired;
      const publishing = service.publish(req, "chapters", chapter.id, q.id, { expectedRevision: 1 });
      // The writer holds the real course lock while publication establishes its
      // snapshot, reproducing the stale Serializable advisory/row-lock pitfall.
      await new Promise(resolve => setTimeout(resolve, 75));
      release(); await writer;
      await rejected(() => publishing, "ARCHIVED_READ_ONLY");
      assert.equal(await database.quizRevision.count({ where: { quizId: q.id } }), 0);
    });
    await t.test("publication waiting behind taxonomy archive retries and cannot publish stale active skills", async () => {
      const skill = await database.skill.create({ data: { slug: "quiz-skill-race", translations: { create: { locale: "en", label: "Race" } } } });
      const question = await makeQuestion({ ...qdraft, primarySkillId: skill.id });
      const q = await create(); await replace(q.id, 0, [item(0, question)]);
      let ready!: () => void, release!: () => void;
      const acquired = new Promise<void>(resolve => { ready = resolve; });
      const proceed = new Promise<void>(resolve => { release = resolve; });
      const writer = store.transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209,1)`;
        await tx.skill.update({ where: { id: skill.id }, data: { status: "archived" } });
        ready(); await proceed;
      });
      await acquired; const publishing = publish(q.id, 1);
      await new Promise(resolve => setTimeout(resolve, 75));
      release(); await writer;
      await rejected(() => publishing, "SKILL_NOT_ACTIVE");
      assert.equal(await database.quizRevision.count({ where: { quizId: q.id } }), 0);
    });
    await t.test("publication waiting behind question archive retries and cannot publish a stale active identity", async () => {
      const question = await makeQuestion();
      const q = await create(); await replace(q.id, 0, [item(0, question)]);
      let ready!: () => void, release!: () => void;
      const acquired = new Promise<void>(resolve => { ready = resolve; });
      const proceed = new Promise<void>(resolve => { release = resolve; });
      const writer = store.transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM assessment_questions WHERE id=${question.question.id}::uuid FOR UPDATE`;
        await tx.question.update({ where: { id: question.question.id }, data: { status: "archived" } });
        ready(); await proceed;
      });
      await acquired; const publishing = publish(q.id, 1);
      await new Promise(resolve => setTimeout(resolve, 75));
      release(); await writer;
      await rejected(() => publishing, "QUESTION_NOT_ACTIVE");
      assert.equal(await database.quizRevision.count({ where: { quizId: q.id } }), 0);
    });
    await t.test("Q4 never creates attempts, grades, evidence, telemetry, jobs or changes original LMS progress", async () => {
      assert.equal(await database.assessmentAttempt.count(), 0);
      assert.equal(await database.attemptGrade.count(), 0);
      assert.equal(await database.skillEvidence.count(), 0);
      assert.equal(await database.assessmentJob.count(), 0);
      assert.equal(await database.attemptQuestionTelemetry.count(), 0);
      // Extra archived/race trees are intentional fixtures, not LMS mutations by
      // authoring. Remove them from the baseline projection by checking each
      // original application's rows, including stable edit/progress versions.
      const original = JSON.parse(baseline);
      assert.deepEqual(await database.course.findMany({ where: { id: { in: [f.ids.course!, f.ids.otherCourse!] } }, orderBy: { id: "asc" } })
        .then(rows => rows.map(r => ({ id: r.id, editRevision: r.editRevision, status: r.status }))),
      original.courses.map((r: { id: string; edit_revision: number; status: string }) => ({ id: r.id, editRevision: r.edit_revision, status: r.status })));
      const after = JSON.parse(await f.baseline());
      for (const key of ["users", "enrollments", "completion", "mediaState", "required", "completed"]) {
        assert.deepEqual(after[key], original[key], key);
      }
      assert.deepEqual(after.chapters.filter((r: { id: string }) => r.id === f.ids.chapter), original.chapters);
      assert.deepEqual(after.lessons.filter((r: { id: string }) => r.id === f.ids.lesson), original.lessons);
    });
  } finally {
    await db?.$disconnect();
    await f.cleanup();
  }
});
