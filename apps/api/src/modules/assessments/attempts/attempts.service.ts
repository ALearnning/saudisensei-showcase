import { createHash, randomInt, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../../courses/lms.store.js";
import { parse, uuid } from "../../courses/lms.schemas.js";
import { AssessmentAccessService, type AssessmentParent } from "../assessment-access.service.js";
import { calculateDeadline, quizPolicySchema } from "../contracts/policy.js";
import { projectStudentQuestion, validateAnswerForQuestion, type StudentQuestion } from "../contracts/questions.js";
import * as s from "./attempts.schemas.js";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const includes = { revision: true, questions: { orderBy: { position: "asc" as const }, include: { answer: true, state: true } } } as const;
type Attempt = Prisma.AssessmentAttemptGetPayload<{ include: typeof includes }>;
type Revision = Prisma.QuizRevisionGetPayload<Record<string, never>>;
const scope = { course: "courses", chapter: "chapters", lesson: "lessons" } as const;
const parentTypes = { courses: "course", chapters: "chapter", lessons: "lesson" } as const;
const missing = () => new NotFoundException("QUIZ_UNAVAILABLE");

/** Object-key ordering is canonical; answer permutations with set semantics are normalized separately. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function shuffle<T>(input: readonly T[]): T[] {
  const output = [...input];
  for (let i = output.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [output[i], output[j]] = [output[j]!, output[i]!];
  }
  return output;
}
export function policy(r: Revision) {
  return parse(quizPolicySchema, { version: 1, mode: r.mode, required: r.required, passBasisPoints: r.passBasisPoints,
    maxAttempts: r.maxAttempts, timeLimitSeconds: r.timeLimitSeconds,
    opensAt: r.opensAt?.toISOString() ?? null, closesAt: r.closesAt?.toISOString() ?? null,
    shuffleQuestions: r.shuffleQuestions, shuffleOptions: r.shuffleOptions, scoreVisibility: r.scoreVisibility,
    reviewVisibility: r.reviewVisibility, explanationVisibility: r.explanationVisibility, aiAnalysisEnabled: r.aiAnalysisEnabled });
}
function content(r: Revision, requested: string) {
  const map = r.content as Record<string, { title: string; instructions: string }>;
  const locale = map[requested] ? requested : r.defaultContentLocale;
  const c = map[locale];
  if (!c || typeof c.title !== "string" || typeof c.instructions !== "string") throw new ConflictException("QUIZ_REVISION_INCOMPATIBLE");
  return { locale: locale as "ar" | "en", title: c.title, instructions: c.instructions };
}
function timing(a: Attempt, now: Date) {
  return { attemptId: a.id, quizId: a.quizId, quizRevisionId: a.quizRevisionId, state: a.status,
    attemptNumber: a.attemptNumber, selectedContentLocale: a.selectedContentLocale,
    serverNow: now.toISOString(), startedAt: a.startedAt.toISOString(), deadlineAt: a.deadlineAt?.toISOString() ?? null,
    deadlineReason: a.deadlineReason, opensAt: a.opensAt?.toISOString() ?? null, closesAt: a.closesAt?.toISOString() ?? null,
    timeLimitSeconds: a.timeLimitSeconds };
}
export function submissionReceipt(a: Attempt) {
  if (!a.submittedAt || !a.effectiveSubmittedAt) throw new ConflictException("ATTEMPT_NOT_SUBMITTED");
  return { attemptId: a.id, quizId: a.quizId, state: a.status,
    submittedAt: a.submittedAt.toISOString(), effectiveSubmittedAt: a.effectiveSubmittedAt.toISOString(),
    finalizationReason: a.finalizationReason, processing: a.status === "GRADED" ? "ready" as const : "pending" as const };
}
export function attemptView(a: Attempt, now: Date) {
  if (a.status !== "IN_PROGRESS") return submissionReceipt(a);
  return { ...timing(a, now), ...content(a.revision, a.selectedContentLocale), policy: policy(a.revision),
    questions: a.questions.map(q => projectStudentQuestion(q.presentation as StudentQuestion)),
    answers: a.questions.map(q => ({ attemptQuestionId: q.id, answerRevision: q.answer?.answerRevision ?? 0, answer: q.answer?.answer ?? null })),
    flags: a.questions.map(q => ({ attemptQuestionId: q.id, isFlagged: q.state?.isFlagged ?? false, flagRevision: q.state?.flagRevision ?? 0 })) };
}

@Injectable()
export class AttemptsService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(AssessmentAccessService) private readonly access: AssessmentAccessService) {}

  /** Also handles Prisma's raw-SQL serialization/deadlock wrapper. No network in retried work. */
  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let n = 0; ; n++) {
      try { return await this.store.transaction(work); }
      catch (e) {
        const retry = (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2010" &&
          ["40001", "40P01"].includes(String(e.meta?.code))) ||
          // Prisma may also wrap a model-write deadlock as UnknownRequestError.
          (e instanceof Prisma.PrismaClientUnknownRequestError && /PostgresError \{ code: "(?:40001|40P01)"/.test(e.message)) ||
          (e instanceof ConflictException && e.message === "RESOURCE_CHANGED");
        if (retry && n < 5) {
          await new Promise(resolve => setTimeout(resolve, 10 * 2 ** n));
          continue;
        }
        if (retry) throw new ConflictException("ATTEMPT_CHANGED");
        throw e;
      }
    }
  }
  async clock(tx: Tx): Promise<Date> {
    const [row] = await tx.$queryRaw<{ time: Date }[]>`SELECT clock_timestamp() AS time`;
    return row!.time;
  }
  private parent(scopeInput: string, parentId: string): AssessmentParent {
    return { scope: parse(s.scopeSchema, scopeInput), parentId: parse(uuid, parentId) };
  }
  private async context(tx: Tx, req: AuthenticatedRequest, parent: AssessmentParent) {
    const ctx = await this.access.student(tx, req, parent, true);
    // A receipt may be created even for an already-terminal immutable attempt.
    // Fence the existing enrollment row rather than illegally updating that attempt.
    await tx.$executeRaw`UPDATE enrollments SET id=id WHERE id=${ctx.enrollmentId}::uuid`;
    // Access decisions serialize against local account changes and descendant withdrawal.
    await tx.$queryRaw`SELECT id FROM users WHERE id=${req.user.id}::uuid FOR SHARE`;
    const user = await tx.user.findUnique({ where: { id: req.user.id }, include: { roles: { include: { role: true } } } });
    if (!user || user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
    if (!user.roles.some(r => r.role.name === "student")) throw new ForbiddenException("ROLE_REQUIRED");
    if (ctx.chapterId) await tx.$queryRaw`SELECT id FROM chapters WHERE id=${ctx.chapterId}::uuid FOR SHARE`;
    if (ctx.lessonId) await tx.$queryRaw`SELECT id FROM lessons WHERE id=${ctx.lessonId}::uuid FOR SHARE`;
    await this.enrollmentNow(tx, ctx.enrollmentId, await this.clock(tx));
    return ctx;
  }
  private async enrollmentNow(tx: Tx, id: string, now: Date) {
    const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id } });
    if (enrollment.status !== "active" || (enrollment.expiresAt && enrollment.expiresAt <= now)) throw missing();
  }
  private async quizLock(tx: Tx, req: AuthenticatedRequest, parent: AssessmentParent, id: string, start = false) {
    const ctx = await this.context(tx, req, parent);
    const where = { id, courseId: ctx.courseId, parentType: parentTypes[parent.scope], parentId: parent.parentId };
    if (!await tx.quiz.findFirst({ where })) throw missing();
    if (start) {
      // Deliberate write fence makes waiting SERIALIZABLE starts see newly inserted receipts/attempts on retry.
      await tx.$executeRaw`UPDATE assessment_quizzes SET id=id WHERE id=${id}::uuid`;
    } else await tx.$queryRaw`SELECT id FROM assessment_quizzes WHERE id=${id}::uuid FOR SHARE`;
    const quiz = await tx.quiz.findFirst({ where, include: { currentRevision: true } });
    if (!quiz || quiz.status !== "published" || !quiz.currentRevision) throw missing();
    if (quiz.currentRevision.schemaVersion !== 1) throw new ConflictException("QUIZ_REVISION_INCOMPATIBLE");
    return { quiz, ctx, revision: quiz.currentRevision };
  }
  private async load(tx: Tx, id: string) { return tx.assessmentAttempt.findUniqueOrThrow({ where: { id }, include: includes }); }
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id=${id}::uuid FOR UPDATE`;
    const a = await this.load(tx, id);
    // A same-state write fence is permitted only for open attempts by Q2's immutable terminal guard.
    if (a.status === "IN_PROGRESS") await tx.assessmentAttempt.update({ where: { id }, data: { concurrencyVersion: { increment: 1 } } });
    return a;
  }
  private async owned(tx: Tx, req: AuthenticatedRequest, id: string) {
    const initial = await tx.assessmentAttempt.findFirst({ where: { id, studentUserId: req.user.id } });
    if (!initial) throw missing();
    const quiz = await tx.quiz.findUniqueOrThrow({ where: { id: initial.quizId } });
    const type = scope[quiz.parentType as keyof typeof scope];
    if (!type) throw missing();
    const q = await this.quizLock(tx, req, { scope: type, parentId: quiz.parentId, expectedCourseId: initial.courseId }, quiz.id);
    const a = await this.lock(tx, id), now = await this.clock(tx);
    await this.enrollmentNow(tx, q.ctx.enrollmentId, now);
    return { a, now };
  }
  private async replay<T>(tx: Tx, req: AuthenticatedRequest, operationScope: string, body: { clientMutationId: string }): Promise<T | null> {
    const row = await tx.assessmentMutation.findUnique({ where: { actorId_operationScope_clientMutationId:
      { actorId: req.user.id, operationScope, clientMutationId: body.clientMutationId } } });
    if (!row) return null;
    if (row.payloadHash !== createHash("sha256").update(canonical(body)).digest("hex")) throw new ConflictException("IDEMPOTENCY_CONFLICT");
    return row.receipt as T;
  }
  private async receipt<T>(tx: Tx, req: AuthenticatedRequest, operationScope: string, body: { clientMutationId: string }, receipt: T): Promise<T> {
    await tx.assessmentMutation.create({ data: { actorId: req.user.id, operationScope, clientMutationId: body.clientMutationId,
      payloadHash: createHash("sha256").update(canonical(body)).digest("hex"), receipt: json(receipt) } });
    return receipt;
  }
  /** The only finalization path, shared with leased jobs. Caller holds attempt lock. */
  async finalize(tx: Tx, a: Attempt, now: Date, req?: AuthenticatedRequest, voluntary = false): Promise<Attempt> {
    if (a.status !== "IN_PROGRESS") return a;
    const expired = !!a.deadlineAt && now >= a.deadlineAt;
    if (!expired && !voluntary) return a;
    await tx.assessmentAttempt.update({ where: { id: a.id }, data: {
      status: expired ? "AUTO_SUBMITTED" : "SUBMITTED", submittedAt: now,
      effectiveSubmittedAt: expired ? a.deadlineAt : now,
      finalizationReason: expired ? a.deadlineReason : "voluntary",
    } });
    const action = expired ? "assessment.attempt.auto_submitted" : "assessment.attempt.submitted";
    const metadata = { quizId: a.quizId, quizRevisionId: a.quizRevisionId, attemptNumber: a.attemptNumber,
      reason: expired ? a.deadlineReason : "voluntary", initiator: req ? "student" : "deadline_job" };
    if (req) await this.store.audit(tx, req, action, "assessment_attempt", a.id, metadata);
    else await tx.auditLog.create({ data: { actorUserId: null, action, entityType: "assessment_attempt", entityId: a.id, metadata } });
    // Schedule the internal deterministic grader; no grading in the Student request.
    await tx.assessmentJob.upsert({ where: { deduplicationKey: `grade:${a.id}` },
      create: { attemptId: a.id, kind: "grade", deduplicationKey: `grade:${a.id}`, availableAt: now }, update: {} });
    return this.load(tx, a.id);
  }
  private async metadata(tx: Tx, q: Awaited<ReturnType<AttemptsService["quizLock"]>>, locale: string) {
    const now = await this.clock(tx), p = policy(q.revision);
    const used = await tx.assessmentAttempt.count({ where: { studentUserId: q.ctx.userId, quizId: q.quiz.id } });
    const open = await tx.assessmentAttempt.findFirst({ where: { studentUserId: q.ctx.userId, quizId: q.quiz.id, status: "IN_PROGRESS" } });
    const active = open && (!open.deadlineAt || open.deadlineAt > now) ? open.id : null;
    return { quizId: q.quiz.id, courseId: q.quiz.courseId, parentType: q.quiz.parentType, parentId: q.quiz.parentId,
      ...content(q.revision, locale), policy: p, attemptsUsed: used,
      attemptsRemaining: p.maxAttempts === null ? null : Math.max(0, p.maxAttempts - used),
      resumableAttemptId: active, canStart: active !== null || ((p.maxAttempts === null || used < p.maxAttempts) &&
        (!p.opensAt || now.getTime() >= Date.parse(p.opensAt)) && (!p.closesAt || now.getTime() < Date.parse(p.closesAt))),
      serverNow: now.toISOString() };
  }
  async quiz(req: AuthenticatedRequest, scopeInput: string, parentId: string, quizId: string, query: unknown = {}) {
    const parent = this.parent(scopeInput, parentId), id = parse(uuid, quizId), q = parse(s.listSchema, query);
    return this.transaction(async tx => this.metadata(tx, await this.quizLock(tx, req, parent, id), q.locale));
  }
  async listQuizzes(req: AuthenticatedRequest, scopeInput: string, parentId: string, query: unknown) {
    const parent = this.parent(scopeInput, parentId), q = parse(s.listSchema, query);
    return this.transaction(async tx => {
      const ctx = await this.context(tx, req, parent);
      const rows = await tx.quiz.findMany({ where: { courseId: ctx.courseId, parentType: parentTypes[parent.scope],
        parentId, status: "published", currentRevisionId: { not: null }, ...(q.cursor ? { id: { gt: q.cursor } } : {}) },
        orderBy: { id: "asc" }, take: q.pageSize + 1 });
      const items = [];
      for (const row of rows.slice(0, q.pageSize)) items.push(await this.metadata(tx, await this.quizLock(tx, req, parent, row.id), q.locale));
      return { items, nextCursor: rows.length > q.pageSize ? items.at(-1)!.quizId : null };
    });
  }
  async start(req: AuthenticatedRequest, scopeInput: string, parentId: string, quizId: string, input: unknown): Promise<s.StartReceipt> {
    const parent = this.parent(scopeInput, parentId), id = parse(uuid, quizId), body = parse(s.startSchema, input);
    return this.transaction(async tx => {
      const q = await this.quizLock(tx, req, parent, id, true), op = `start:${id}`;
      const replay = await this.replay<s.StartReceipt>(tx, req, op, body);
      if (replay) {
        const a = await this.lock(tx, replay.attemptId), now = await this.clock(tx);
        await this.enrollmentNow(tx, q.ctx.enrollmentId, now);
        await this.finalize(tx, a, now, req);
        return replay;
      }
      const existing = await tx.assessmentAttempt.findFirst({ where: { studentUserId: req.user.id, quizId: id, status: "IN_PROGRESS" } });
      if (existing) {
        const a = await this.lock(tx, existing.id), now = await this.clock(tx);
        await this.enrollmentNow(tx, q.ctx.enrollmentId, now);
        await this.finalize(tx, a, now, req);
        return this.receipt(tx, req, op, body, { attemptId: a.id });
      }
      const p = policy(q.revision), count = await tx.assessmentAttempt.count({ where: { studentUserId: req.user.id, quizId: id } });
      if (p.maxAttempts !== null && count >= p.maxAttempts) throw new ConflictException("ATTEMPT_LIMIT_REACHED");
      const now = await this.clock(tx);
      await this.enrollmentNow(tx, q.ctx.enrollmentId, now);
      let deadline;
      try { deadline = calculateDeadline(p, now.toISOString()); }
      catch (e) { throw new ConflictException(e instanceof Error ? e.message : "QUIZ_UNAVAILABLE"); }
      const selected = content(q.revision, body.requestedContentLocale);
      const a = await tx.assessmentAttempt.create({ data: { quizId: id, quizRevisionId: q.revision.id,
        courseId: q.ctx.courseId, enrollmentId: q.ctx.enrollmentId, studentUserId: req.user.id,
        attemptNumber: count + 1, selectedContentLocale: selected.locale, startedAt: now,
        opensAt: p.opensAt, closesAt: p.closesAt, timeLimitSeconds: p.timeLimitSeconds,
        deadlineAt: deadline.deadlineAt, deadlineReason: deadline.deadlineReason } });
      const items = await tx.quizRevisionItem.findMany({ where: { quizRevisionId: q.revision.id }, orderBy: { position: "asc" }, include: { questionRevision: true } });
      const ordered = p.shuffleQuestions ? shuffle(items) : items;
      for (const [position, item] of ordered.entries()) {
        const r = item.questionRevision, map = r.content as Record<string, Record<string, unknown>>;
        const locale = map[body.requestedContentLocale] ? body.requestedContentLocale : r.defaultContentLocale;
        const c = map[locale];
        if (!c) throw new ConflictException("QUESTION_REVISION_INCOMPATIBLE");
        const questionId = randomUUID();
        const presentation = projectStudentQuestion({ attemptQuestionId: questionId, type: r.type, locale,
          prompt: c.prompt, position, points: item.points, code: c.code,
          options: p.shuffleOptions && Array.isArray(c.options) ? shuffle(c.options) : c.options,
          items: p.shuffleOptions && Array.isArray(c.items) ? shuffle(c.items) : c.items } as StudentQuestion);
        await tx.attemptQuestion.create({ data: { id: questionId, attemptId: a.id, quizRevisionId: q.revision.id,
          itemId: item.id, position, contentLocale: locale, presentation: json(presentation),
          answer: { create: {} }, state: { create: {} } } });
      }
      if (a.deadlineAt) await tx.assessmentJob.create({ data: { attemptId: a.id, kind: "deadline",
        deduplicationKey: `deadline:${a.id}`, availableAt: a.deadlineAt } });
      await this.store.audit(tx, req, "assessment.attempt.started", "assessment_attempt", a.id,
        { quizId: id, quizRevisionId: q.revision.id, attemptNumber: a.attemptNumber });
      return this.receipt(tx, req, op, body, { attemptId: a.id });
    });
  }
  async resume(req: AuthenticatedRequest, attemptId: string) {
    const id = parse(uuid, attemptId);
    return this.transaction(async tx => {
      const { a, now } = await this.owned(tx, req, id);
      return attemptView(await this.finalize(tx, a, now, req), now);
    });
  }
  /** Q6 reads share every Q5 ownership/current-access lock and lazy deadline rule. */
  async readOwned<T>(req: AuthenticatedRequest, attemptId: string, read: (tx: Tx, a: Attempt) => Promise<T>) {
    const id = parse(uuid, attemptId);
    return this.transaction(async tx => {
      const { a, now } = await this.owned(tx, req, id);
      return read(tx, await this.finalize(tx, a, now, req));
    });
  }
  async history(req: AuthenticatedRequest, query: unknown) {
    const q = parse(s.listSchema, query);
    return this.transaction(async tx => {
      // Filter before pagination, so inaccessible history does not leak IDs or counts.
      const now = await this.clock(tx);
      const accessible = { status: "published" as const, archivedAt: null };
      const cursor = q.cursor ? await tx.assessmentAttempt.findFirst({ where: { id: q.cursor, studentUserId: req.user.id } }) : null;
      if (q.cursor && !cursor) throw missing();
      const rows = await tx.assessmentAttempt.findMany({ where: {
        studentUserId: req.user.id,
        ...(cursor ? { OR: [{ startedAt: { lt: cursor.startedAt } }, { startedAt: cursor.startedAt, id: { lt: cursor.id } }] } : {}),
        enrollment: { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        revision: { quiz: { status: "published", currentRevisionId: { not: null },
          course: accessible, OR: [{ chapterId: null }, { chapter: accessible }],
          AND: [{ OR: [{ lessonId: null }, { lesson: { ...accessible, body: { not: "" } } }] }] } },
      }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: q.pageSize + 1 });
      const items = [];
      for (const row of rows.slice(0, q.pageSize)) {
        const { a, now } = await this.owned(tx, req, row.id);
        const result = await this.finalize(tx, a, now, req);
        items.push({ ...timing(result, now), submittedAt: result.submittedAt?.toISOString() ?? null });
      }
      // Account/role must be rechecked even when the accessible page is empty.
      const user = await tx.user.findUnique({ where: { id: req.user.id }, include: { roles: { include: { role: true } } } });
      if (!user || user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
      if (!user.roles.some(r => r.role.name === "student")) throw new ForbiddenException("ROLE_REQUIRED");
      return { items, nextCursor: rows.length > q.pageSize ? items.at(-1)!.attemptId : null };
    });
  }
  private async answers(tx: Tx, a: Attempt, changes: s.Change[], now: Date) {
    const updates = changes.map(change => {
      const q = a.questions.find(q => q.id === change.attemptQuestionId);
      if (!q || !q.answer) throw new BadRequestException("INVALID_INPUT");
      if (q.answer.answerRevision !== change.expectedAnswerRevision) throw new ConflictException("ANSWER_CHANGED");
      let answer;
      try { answer = validateAnswerForQuestion(q.presentation as StudentQuestion, change.answer); }
      catch { throw new BadRequestException("INVALID_INPUT"); }
      if (answer?.type === "multiple_choice") answer = { ...answer, optionIds: [...answer.optionIds].sort() };
      return { q, answer };
    });
    const acknowledgements = [];
    for (const { q, answer } of updates) {
      const previous = q.answer!;
      const changed = canonical(previous.answer) !== canonical(answer);
      const revision = previous.answerRevision + (changed ? 1 : 0);
      if (changed) await tx.attemptAnswer.update({ where: { attemptQuestionId: q.id }, data: {
        answer: answer === null ? Prisma.DbNull : json(answer), answerRevision: revision,
        changeCount: { increment: 1 }, firstAnsweredAt: previous.firstAnsweredAt ?? (answer !== null ? now : null),
        finalAnsweredAt: answer !== null ? now : previous.finalAnsweredAt,
      } });
      acknowledgements.push({ attemptQuestionId: q.id, answerRevision: revision });
    }
    return acknowledgements;
  }
  /** Late trigger/conflict failures roll back the failed batch, then commit lazy expiration separately. */
  private async interactive<T>(req: AuthenticatedRequest, id: string, work: (tx: Tx, a: Attempt, now: Date) => Promise<T>) {
    try {
      return await this.transaction(async tx => {
        const { a, now } = await this.owned(tx, req, id);
        const finalized = await this.finalize(tx, a, now, req);
        return work(tx, finalized, now);
      });
    } catch (error) {
      const expired = await this.transaction(async tx => {
        const { a, now } = await this.owned(tx, req, id);
        if (a.status !== "IN_PROGRESS" || !a.deadlineAt || a.deadlineAt > now) return false;
        await this.finalize(tx, a, now, req); return true;
      });
      if (expired && !(error instanceof ConflictException && error.message === "IDEMPOTENCY_CONFLICT")) {
        throw new ConflictException("ATTEMPT_EXPIRED");
      }
      throw error;
    }
  }
  async save(req: AuthenticatedRequest, attemptId: string, input: unknown) {
    const id = parse(uuid, attemptId), body = parse(s.saveSchema, input);
    return this.interactive(req, id, async (tx, a, now) => {
      const op = `answers:${id}`, replay = await this.replay(tx, req, op, body);
      if (replay) return replay;
      if (a.status !== "IN_PROGRESS") throw new ConflictException(a.status === "AUTO_SUBMITTED" ? "ATTEMPT_EXPIRED" : "ATTEMPT_FINALIZED");
      const answers = await this.answers(tx, a, body.changes, now);
      return this.receipt(tx, req, op, body, { clientMutationId: body.clientMutationId, attemptId: id,
        state: a.status, serverNow: now.toISOString(), savedAt: now.toISOString(), deadlineAt: a.deadlineAt?.toISOString() ?? null, answers });
    });
  }
  async flag(req: AuthenticatedRequest, attemptId: string, questionId: string, input: unknown) {
    const id = parse(uuid, attemptId), question = parse(uuid, questionId), body = parse(s.flagSchema, input);
    return this.interactive(req, id, async (tx, a, now) => {
      const op = `flag:${id}:${question}`, replay = await this.replay(tx, req, op, body);
      if (replay) return replay;
      if (a.status !== "IN_PROGRESS") throw new ConflictException(a.status === "AUTO_SUBMITTED" ? "ATTEMPT_EXPIRED" : "ATTEMPT_FINALIZED");
      const q = a.questions.find(q => q.id === question);
      if (!q?.state) throw new BadRequestException("INVALID_INPUT");
      if (q.state.flagRevision !== body.expectedFlagRevision) throw new ConflictException("FLAG_CHANGED");
      const revision = q.state.flagRevision + Number(q.state.isFlagged !== body.isFlagged);
      if (revision !== q.state.flagRevision) await tx.attemptQuestionState.update({ where: { attemptQuestionId: question },
        data: { isFlagged: body.isFlagged, flagRevision: revision, updatedAt: now } });
      return this.receipt(tx, req, op, body, { clientMutationId: body.clientMutationId, attemptId: id,
        state: a.status, savedAt: now.toISOString(), serverNow: now.toISOString(), deadlineAt: a.deadlineAt?.toISOString() ?? null,
        attemptQuestionId: question, isFlagged: body.isFlagged, flagRevision: revision });
    });
  }
  async submit(req: AuthenticatedRequest, attemptId: string, input: unknown) {
    const id = parse(uuid, attemptId), body = parse(s.submitSchema, input);
    return this.interactive(req, id, async (tx, a, now) => {
      const op = `submit:${id}`, replay = await this.replay(tx, req, op, body);
      if (replay) return replay;
      if (a.status === "IN_PROGRESS") await this.answers(tx, a, body.changes, now);
      const finalized = await this.finalize(tx, a, await this.clock(tx), req, true);
      return this.receipt(tx, req, op, body, submissionReceipt(finalized));
    });
  }
  /** Internal-only; never authenticates as a Student and cannot modify saved answers. */
  async lockDeadline(tx: Tx, attemptId: string) {
    const a = await tx.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    // Retained rows remain lockable after withdrawal. Match interactive ancestry/
    // enrollment/quiz-before-attempt order without granting interactive access.
    await this.store.courseLock(tx, a.courseId, true);
    await tx.$queryRaw`SELECT id FROM enrollments WHERE id=${a.enrollmentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM assessment_quizzes WHERE id=${a.quizId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM assessment_attempts WHERE id=${attemptId}::uuid FOR UPDATE`;
    return this.load(tx, attemptId);
  }
  async finalizeDeadline(tx: Tx, attemptId: string) {
    const a = await this.lockDeadline(tx, attemptId);
    return this.finalize(tx, a, await this.clock(tx));
  }
}
