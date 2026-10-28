import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../../courses/lms.store.js";
import { parse, uuid } from "../../courses/lms.schemas.js";
import { AssessmentAccessService, type AssessmentParent } from "../assessment-access.service.js";
import { quizPolicySchema } from "../contracts/policy.js";
import { questionDraftSchema } from "../question-bank/question-bank.schemas.js";
import * as s from "./quizzes.schemas.js";

const include = { draft: { include: { items: { orderBy: { position: "asc" as const } } } } } as const;
type Aggregate = Prisma.QuizGetPayload<{ include: typeof include }>;
const revisionInclude = { items: { orderBy: { position: "asc" as const } }, reviewRelease: true } as const;
type Revision = Prisma.QuizRevisionGetPayload<{ include: typeof revisionInclude }>;
type QuestionRevision = Prisma.QuestionRevisionGetPayload<Record<string, never>>;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const parentType = { courses: "course", chapters: "chapter", lessons: "lesson" } as const;
const skillsSchema = z.array(z.object({
  skillId: uuid, role: z.enum(["primary", "secondary"]),
  path: z.array(z.object({ skillId: uuid }).passthrough()).min(1).max(8),
}).passthrough()).min(1).max(21);

function draftDto(q: Aggregate) {
  if (!q.draft) throw new ConflictException("QUIZ_DRAFT_MISSING");
  return { defaultContentLocale: q.draft.defaultContentLocale, content: q.draft.content, policy: q.draft.policy };
}
function itemDto(i: { id: string; questionId: string; questionRevisionId: string; position: number; points: number }) {
  return { id: i.id, questionId: i.questionId, questionRevisionId: i.questionRevisionId, position: i.position, points: i.points };
}
function detail(q: Aggregate) {
  return { id: q.id, courseId: q.courseId, parentType: q.parentType, parentId: q.parentId,
    chapterId: q.chapterId, lessonId: q.lessonId, status: q.status, editRevision: q.editRevision,
    currentRevisionId: q.currentRevisionId, createdAt: q.createdAt.toISOString(),
    draft: draftDto(q), items: q.draft!.items.map(itemDto) };
}
function policyDto(r: Revision) {
  return parse(quizPolicySchema, {
    version: 1, mode: r.mode, required: r.required, passBasisPoints: r.passBasisPoints,
    maxAttempts: r.maxAttempts, timeLimitSeconds: r.timeLimitSeconds, opensAt: r.opensAt?.toISOString() ?? null,
    closesAt: r.closesAt?.toISOString() ?? null, shuffleQuestions: r.shuffleQuestions, shuffleOptions: r.shuffleOptions,
    scoreVisibility: r.scoreVisibility, reviewVisibility: r.reviewVisibility,
    explanationVisibility: r.explanationVisibility, aiAnalysisEnabled: r.aiAnalysisEnabled,
  });
}
function releaseDto(r: { quizRevisionId: string; releasedAt: Date }) {
  return { quizRevisionId: r.quizRevisionId, releasedAt: r.releasedAt.toISOString() };
}
function revisionDto(r: Revision) {
  // No assemblyTransaction bigint, private keys, or implicit ORM serialization.
  return { id: r.id, quizId: r.quizId, courseId: r.courseId, number: r.number,
    defaultContentLocale: r.defaultContentLocale, content: r.content, policy: policyDto(r),
    totalPoints: r.totalPoints, schemaVersion: r.schemaVersion, graderVersion: r.graderVersion,
    createdAt: r.createdAt.toISOString(), items: r.items.map(itemDto),
    reviewRelease: r.reviewRelease ? releaseDto(r.reviewRelease) : null };
}

@Injectable()
export class QuizzesService {
  constructor(
    @Inject(LmsStore) private readonly store: LmsStore,
    @Inject(AssessmentAccessService) private readonly access: AssessmentAccessService,
  ) {}

  private async transaction<T>(work: (tx: Tx) => Promise<T>) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.store.transaction(work); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" &&
          ["40001", "40P01"].includes(String(error.meta?.code))) {
          if (attempt < 2) continue;
          throw new ConflictException("QUIZ_CHANGED");
        }
        if (error instanceof ConflictException && error.message === "RESOURCE_CHANGED") {
          throw new ConflictException("QUIZ_CHANGED");
        }
        throw error;
      }
    }
  }
  private parent(scope: string, parentId: string): AssessmentParent {
    return { scope: parse(s.quizScopeSchema, scope), parentId: parse(uuid, parentId) };
  }
  private async context(tx: Tx, req: AuthenticatedRequest, parent: AssessmentParent, mutation: boolean) {
    const ctx = await this.access.admin(tx, req, parent, mutation);
    // Course-before-descendant order matches LMS. Explicit ancestry row locks
    // force SERIALIZABLE retries rather than trusting a snapshot after a wait.
    if (ctx.chapterId) await tx.$queryRaw`SELECT id FROM chapters WHERE id=${ctx.chapterId}::uuid FOR SHARE`;
    if (ctx.lessonId) await tx.$queryRaw`SELECT id FROM lessons WHERE id=${ctx.lessonId}::uuid FOR SHARE`;
    return ctx;
  }
  private async load(tx: Tx, req: AuthenticatedRequest, parent: AssessmentParent, id: string, mutation: boolean, expectedRevision?: number) {
    // Do not lock a foreign quiz before verifying its route parent.
    const ctx = await this.context(tx, req, parent, mutation);
    const where = { id, courseId: ctx.courseId, parentType: parentType[parent.scope], parentId: parent.parentId };
    if (!await tx.quiz.findFirst({ where, select: { id: true } })) throw new NotFoundException("QUIZ_UNAVAILABLE");
    if (mutation) await tx.$queryRaw`SELECT id FROM assessment_quizzes WHERE id=${id}::uuid FOR UPDATE`;
    const q = await tx.quiz.findFirst({ where, include });
    if (!q) throw new NotFoundException("QUIZ_UNAVAILABLE");
    if (mutation && q.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
    if (expectedRevision !== undefined && q.editRevision !== expectedRevision) throw new ConflictException("QUIZ_CHANGED");
    return q;
  }
  private async saveDraft(tx: Tx, id: string, draft: s.QuizDraftInput) {
    const data = { defaultContentLocale: draft.defaultContentLocale, content: json(draft.content), policy: json(draft.policy), schemaVersion: 1 };
    await tx.quizDraft.upsert({ where: { quizId: id }, create: { quizId: id, ...data }, update: data });
  }
  private async changed(tx: Tx, req: AuthenticatedRequest, id: string, expectedRevision: number, action: string,
    metadata: Prisma.InputJsonObject = {}) {
    await tx.quiz.update({ where: { id }, data: { editRevision: { increment: 1 } } });
    await this.store.audit(tx, req, action, "quiz", id, { editRevision: expectedRevision + 1, ...metadata });
    return detail(await tx.quiz.findUniqueOrThrow({ where: { id }, include }));
  }
  async create(req: AuthenticatedRequest, scope: string, parentId: string, input: unknown) {
    const parent = this.parent(scope, parentId), { draft } = parse(s.quizCreateSchema, input);
    return this.transaction(async tx => {
      const ctx = await this.context(tx, req, parent, true);
      const q = await tx.quiz.create({ data: { courseId: ctx.courseId, parentType: parentType[parent.scope],
        parentId: parent.parentId, chapterId: ctx.chapterId, lessonId: ctx.lessonId, createdBy: req.user.id } });
      await this.saveDraft(tx, q.id, draft);
      await this.store.audit(tx, req, "assessment.quiz.created", "quiz", q.id, { editRevision: 0, parentType: q.parentType, parentId: q.parentId });
      return detail(await tx.quiz.findUniqueOrThrow({ where: { id: q.id }, include }));
    });
  }
  async get(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId);
    return this.transaction(async tx => detail(await this.load(tx, req, parent, id, false)));
  }
  async edit(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), { draft, expectedRevision } = parse(s.quizEditSchema, input);
    return this.transaction(async tx => {
      await this.load(tx, req, parent, id, true, expectedRevision);
      await this.saveDraft(tx, id, draft);
      return this.changed(tx, req, id, expectedRevision, "assessment.quiz.edited");
    });
  }
  private validateQuestion(r: QuestionRevision) {
    if (r.schemaVersion !== 1 || r.graderVersion !== "deterministic-v1") throw new BadRequestException("QUESTION_REVISION_INCOMPATIBLE");
    const skills = parse(skillsSchema, r.skillSnapshot);
    if (skills.filter(s => s.role === "primary").length !== 1 ||
      new Set(skills.map(s => s.skillId)).size !== skills.length ||
      skills.some(s => s.path[s.path.length - 1]?.skillId !== s.skillId)) throw new BadRequestException("INVALID_QUESTION_REVISION");
    const content = r.content as Record<string, unknown>;
    const draft = parse(questionDraftSchema, {
      type: r.type, defaultContentLocale: r.defaultContentLocale,
      content: { ...(content.ar !== undefined ? { ar: content.ar } : {}), ...(content.en !== undefined ? { en: content.en } : {}) },
      gradingDefinition: r.gradingDefinition, explanation: r.explanation, defaultPoints: content.defaultPoints,
      difficulty: r.difficulty, primarySkillId: skills.find(s => s.role === "primary")!.skillId,
      secondarySkillIds: skills.filter(s => s.role === "secondary").map(s => s.skillId), cognitiveTags: r.cognitiveTags,
    });
    return { draft, skills };
  }
  private async selected(tx: Tx, items: readonly s.QuizItemInput[], active: boolean) {
    // Exact immutable revisions only: never consult a mutable draft/default or
    // upgrade a selection to Question.currentRevisionId.
    if (active) await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209, 1)`;
    const ids = items.map(i => i.questionId).sort();
    if (active && ids.length) await tx.$queryRaw(Prisma.sql`
      SELECT id FROM assessment_questions
      WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
    const revisions = await tx.questionRevision.findMany({
      where: { id: { in: items.map(i => i.questionRevisionId) } },
    });
    const questions = active ? await tx.question.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) : [];
    const byId = new Map(revisions.map(r => [r.id, r]));
    const result = items.slice().sort((a, b) => a.position - b.position).map(item => {
      const revision = byId.get(item.questionRevisionId);
      if (!revision || revision.questionId !== item.questionId) throw new BadRequestException("INVALID_QUESTION_REVISION");
      if (active && !questions.some(q => q.id === item.questionId && q.status === "active")) throw new BadRequestException("QUESTION_NOT_ACTIVE");
      const validated = this.validateQuestion(revision);
      return { ...item, points: item.points ?? validated.draft.defaultPoints, revision, ...validated };
    });
    if (active) {
      const skillIds = [...new Set(result.flatMap(i => i.skills.flatMap(s => s.path.map(p => p.skillId))))].sort();
      if (skillIds.length) await tx.$queryRaw(Prisma.sql`
        SELECT id FROM assessment_skills
        WHERE id IN (${Prisma.join(skillIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      if (skillIds.length && await tx.skill.count({ where: { id: { in: skillIds }, status: "active" } }) !== skillIds.length) {
        throw new BadRequestException("SKILL_NOT_ACTIVE");
      }
    }
    return result;
  }
  async replaceItems(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), { items, expectedRevision } = parse(s.quizItemsSchema, input);
    return this.transaction(async tx => {
      await this.load(tx, req, parent, id, true, expectedRevision);
      const selected = await this.selected(tx, items, true);
      await tx.quizDraftItem.deleteMany({ where: { quizId: id } });
      if (selected.length) await tx.quizDraftItem.createMany({ data: selected.map(i => ({
        quizId: id, questionId: i.questionId, questionRevisionId: i.questionRevisionId, position: i.position, points: i.points,
      })) });
      return this.changed(tx, req, id, expectedRevision, "assessment.quiz.items_replaced", { itemCount: selected.length });
    });
  }
  private async aggregate(tx: Tx, q: Aggregate, active: boolean) {
    if (q.draft?.schemaVersion !== 1) throw new BadRequestException("QUIZ_SCHEMA_INCOMPATIBLE");
    const draft = parse(s.quizDraftSchema, draftDto(q));
    const { items } = parse(s.quizItemsSchema, { expectedRevision: q.editRevision,
      items: q.draft.items.map(i => ({ questionId: i.questionId, questionRevisionId: i.questionRevisionId, position: i.position, points: i.points })) });
    if (!items.length) throw new BadRequestException("QUIZ_QUESTIONS_REQUIRED");
    const selected = await this.selected(tx, items, active);
    const totalPoints = selected.reduce((sum, i) => sum + i.points, 0);
    if (!Number.isSafeInteger(totalPoints) || totalPoints <= 0 || totalPoints > 100000) throw new BadRequestException("INVALID_TOTAL_POINTS");
    return { draft, selected, totalPoints };
  }
  private async previewData(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), { expectedRevision, locale } = parse(s.quizPreviewSchema, input);
    return this.transaction(async tx => {
      const q = await this.load(tx, req, parent, id, false, expectedRevision);
      return { q, locale, ...await this.aggregate(tx, q, false) };
    });
  }
  async preview(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const { q, locale: requestedLocale, draft, selected, totalPoints } = await this.previewData(req, scope, parentId, quizId, input);
    const locale = draft.content[requestedLocale] ? requestedLocale : draft.defaultContentLocale;
    const content = draft.content[locale]!;
    return { quizId: q.id, editRevision: q.editRevision, requestedLocale, locale,
      title: content.title, instructions: content.instructions, policy: draft.policy, totalPoints,
      questions: selected.map(i => {
        const questionLocale = i.draft.content[requestedLocale] ? requestedLocale : i.draft.defaultContentLocale;
        const c = i.draft.content[questionLocale]!;
        // Explicit nested presentation allowlist. Neither definitions,
        // explanations, skill/evidence snapshots nor checksums enter this DTO.
        return { questionId: i.questionId, questionRevisionId: i.questionRevisionId, position: i.position,
          points: i.points, type: i.draft.type, locale: questionLocale, prompt: c.prompt,
          ...(c.code ? { code: { language: c.code.language, source: c.code.source } } : {}),
          ...(c.options ? { options: c.options.map(o => ({ id: o.id, label: o.label })) } : {}),
          ...(c.items ? { items: c.items.map(o => ({ id: o.id, label: o.label })) } : {}) };
      }) };
  }
  async answerPreview(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const { q, locale: requestedLocale, selected } = await this.previewData(req, scope, parentId, quizId, input);
    return { quizId: q.id, editRevision: q.editRevision,
      questions: selected.map(i => {
        const locale = i.draft.content[requestedLocale] ? requestedLocale : i.draft.defaultContentLocale;
        return { questionId: i.questionId, questionRevisionId: i.questionRevisionId, position: i.position, locale,
          gradingDefinition: i.draft.gradingDefinition, explanation: i.draft.explanation[locale] ?? null };
      }) };
  }
  async publish(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), { expectedRevision } = parse(s.quizMutationSchema, input);
    return this.transaction(async tx => {
      const q = await this.load(tx, req, parent, id, true, expectedRevision);
      const { draft, selected, totalPoints } = await this.aggregate(tx, q, true);
      const latest = await tx.quizRevision.findFirst({ where: { quizId: id }, orderBy: { number: "desc" }, select: { number: true } });
      const { version: _version, opensAt, closesAt, ...policy } = draft.policy;
      const r = await tx.quizRevision.create({ data: {
        quizId: id, courseId: q.courseId, number: (latest?.number ?? 0) + 1,
        defaultContentLocale: draft.defaultContentLocale, content: json(draft.content), ...policy,
        opensAt: opensAt ? new Date(opensAt) : null, closesAt: closesAt ? new Date(closesAt) : null,
        totalPoints, schemaVersion: 1, graderVersion: "deterministic-v1", createdBy: req.user.id,
      } });
      await tx.quizRevisionItem.createMany({ data: selected.map(i => ({
        quizRevisionId: r.id, questionId: i.questionId, questionRevisionId: i.questionRevisionId,
        position: i.position, points: i.points,
        evidenceSnapshot: json({ skillSnapshot: i.revision.skillSnapshot, cognitiveTags: i.revision.cognitiveTags,
          difficulty: i.revision.difficulty, schemaVersion: i.revision.schemaVersion, graderVersion: i.revision.graderVersion }),
      })) });
      await tx.quiz.update({ where: { id }, data: { currentRevisionId: r.id, status: "published", editRevision: { increment: 1 } } });
      await this.store.audit(tx, req, "assessment.quiz.published", "quiz", id,
        { revisionId: r.id, number: r.number, totalPoints, itemCount: selected.length, editRevision: expectedRevision + 1 });
      return { revision: revisionDto(await tx.quizRevision.findUniqueOrThrow({ where: { id: r.id }, include: revisionInclude })),
        editRevision: expectedRevision + 1 };
    });
  }
  async unpublish(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), { expectedRevision } = parse(s.quizMutationSchema, input);
    return this.transaction(async tx => {
      const q = await this.load(tx, req, parent, id, true, expectedRevision);
      if (q.status !== "published") throw new ConflictException("QUIZ_NOT_PUBLISHED");
      // Q2 lifecycle is draft/published/archived; unpublished returns to draft.
      await tx.quiz.update({ where: { id }, data: { status: "draft", currentRevisionId: null } });
      return this.changed(tx, req, id, expectedRevision, "assessment.quiz.unpublished", { revisionId: q.currentRevisionId });
    });
  }
  async archive(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), { expectedRevision } = parse(s.quizMutationSchema, input);
    return this.transaction(async tx => {
      const q = await this.load(tx, req, parent, id, true, expectedRevision);
      await tx.quiz.update({ where: { id }, data: { status: "archived", editRevision: { increment: 1 } } });
      await this.store.audit(tx, req, "assessment.quiz.archived", "quiz", id, { priorStatus: q.status, editRevision: expectedRevision + 1 });
      return detail(await tx.quiz.findUniqueOrThrow({ where: { id }, include }));
    });
  }
  async list(req: AuthenticatedRequest, scope: string, parentId: string, input: unknown) {
    const parent = this.parent(scope, parentId), query = parse(s.quizListSchema, input);
    return this.transaction(async tx => {
      const ctx = await this.context(tx, req, parent, false);
      const filters: Prisma.QuizDraftWhereInput[] = [];
      if (query.mode) filters.push({ policy: { path: ["mode"], equals: query.mode } });
      if (query.required) filters.push({ policy: { path: ["required"], equals: query.required === "true" } });
      if (query.locale) filters.push({ content: { path: [query.locale], not: Prisma.DbNull } });
      const where: Prisma.QuizWhereInput = { courseId: ctx.courseId, parentType: parentType[parent.scope], parentId: parent.parentId,
        ...(query.status ? { status: query.status } : {}), draft: { is: { AND: filters } } };
      const [rows, total] = await Promise.all([
        tx.quiz.findMany({ where, include: { draft: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.quiz.count({ where }),
      ]);
      return { items: rows.map(q => ({ id: q.id, courseId: q.courseId, parentType: q.parentType, parentId: q.parentId,
        status: q.status, editRevision: q.editRevision, currentRevisionId: q.currentRevisionId,
        createdAt: q.createdAt.toISOString(), draft: { defaultContentLocale: q.draft!.defaultContentLocale,
          content: q.draft!.content, policy: q.draft!.policy } })), page: query.page, pageSize: query.pageSize, total };
    });
  }
  async revisions(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), query = parse(s.quizPaginationSchema, input);
    return this.transaction(async tx => {
      await this.load(tx, req, parent, id, false);
      const [rows, total] = await Promise.all([
        tx.quizRevision.findMany({ where: { quizId: id }, orderBy: { number: "desc" },
          skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, quizId: true, number: true, totalPoints: true, createdAt: true } }),
        tx.quizRevision.count({ where: { quizId: id } }),
      ]);
      return { items: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })), page: query.page, pageSize: query.pageSize, total };
    });
  }
  async revision(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, revisionId: string) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), rid = parse(uuid, revisionId);
    return this.transaction(async tx => {
      await this.load(tx, req, parent, id, false);
      const r = await tx.quizRevision.findFirst({ where: { id: rid, quizId: id }, include: revisionInclude });
      if (!r) throw new NotFoundException("QUIZ_REVISION_NOT_FOUND");
      return revisionDto(r);
    });
  }
  async release(req: AuthenticatedRequest, scope: string, parentId: string, quizId: string, revisionId: string, input: unknown) {
    const parent = this.parent(scope, parentId), id = parse(uuid, quizId), rid = parse(uuid, revisionId);
    const { clientMutationId } = parse(s.quizReleaseSchema, input);
    return this.transaction(async tx => {
      const q = await this.load(tx, req, parent, id, true);
      const r = await tx.quizRevision.findFirst({ where: { id: rid, quizId: id }, include: { reviewRelease: true } });
      if (!r) throw new NotFoundException("QUIZ_REVISION_NOT_FOUND");
      if (![r.scoreVisibility, r.reviewVisibility, r.explanationVisibility].includes("manual_release")) {
        throw new ConflictException("MANUAL_RELEASE_NOT_CONFIGURED");
      }
      // Exact revision is inherently a completed publication, including history.
      // Release is irreversible; all replays return the original safe receipt.
      if (r.reviewRelease) return releaseDto(r.reviewRelease);
      // A lock wait alone cannot refresh a Serializable snapshot. Touch the
      // aggregate without advancing its authoring version so simultaneous first
      // releases retry and observe the original receipt instead of a unique-key
      // conflict. This write and the release/audit roll back together.
      await tx.quiz.update({ where: { id }, data: { editRevision: q.editRevision } });
      const released = await tx.quizReviewRelease.create({ data: { quizRevisionId: rid, releasedBy: req.user.id, requestId: clientMutationId } });
      await this.store.audit(tx, req, "assessment.quiz.review_released", "quiz", id, { revisionId: rid });
      return releaseDto(released);
    });
  }
}
