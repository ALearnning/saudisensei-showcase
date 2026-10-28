import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import { LmsStore, type Actor, type Tx } from "../../courses/lms.store.js";
import { parse, uuid } from "../../courses/lms.schemas.js";
import * as s from "./question-bank.schemas.js";

const include = { draft: true, skills: true, cognitiveTags: true } as const;
type Aggregate = Prisma.QuestionGetPayload<{ include: typeof include }>;
type QuestionRevision = Prisma.QuestionRevisionGetPayload<Record<string, never>>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const GRADER_VERSION = "deterministic-v1";

function draftDto(q: Aggregate) {
  const d = q.draft;
  if (!d) throw new ConflictException("QUESTION_DRAFT_MISSING");
  return {
    type: d.type, defaultContentLocale: d.defaultContentLocale, content: d.content,
    gradingDefinition: d.gradingDefinition, explanation: d.explanation,
    defaultPoints: d.defaultPoints, difficulty: d.difficulty,
    primarySkillId: q.skills.find(x => x.role === "primary")?.skillId ?? null,
    secondarySkillIds: q.skills.filter(x => x.role === "secondary").map(x => x.skillId).sort(),
    cognitiveTags: q.cognitiveTags.map(x => x.code).sort(),
  };
}
function detail(q: Aggregate) {
  return { id: q.id, status: q.status, editRevision: q.editRevision,
    currentRevisionId: q.currentRevisionId, createdAt: q.createdAt.toISOString(), draft: draftDto(q) };
}
/** Server-private Admin DTO: deliberately independent of Student projection. */
function revisionDto(r: QuestionRevision) {
  return { id: r.id, questionId: r.questionId, number: r.number, type: r.type,
    defaultContentLocale: r.defaultContentLocale, content: r.content,
    gradingDefinition: r.gradingDefinition, explanation: r.explanation,
    difficulty: r.difficulty, skillSnapshot: r.skillSnapshot, cognitiveTags: r.cognitiveTags,
    schemaVersion: r.schemaVersion, graderVersion: r.graderVersion, checksum: r.checksum,
    createdAt: r.createdAt.toISOString() };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

@Injectable()
export class QuestionBankService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}

  private async mutation<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    // Prisma wraps serialization failures from parameterized raw locks as
    // P2010 instead of P2034. Preserve the store's bounded retry semantics.
    for (let attempt = 0; ; attempt++) {
      try { return await this.store.transaction(work); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" &&
          ["40001", "40P01"].includes(String(error.meta?.code))) {
          if (attempt < 2) continue;
          throw new ConflictException("QUESTION_CHANGED");
        }
        throw error;
      }
    }
  }
  private async load(tx: Tx, id: string) {
    const q = await tx.question.findUnique({ where: { id }, include });
    if (!q) throw new NotFoundException("QUESTION_NOT_FOUND");
    return q;
  }
  private async lock(tx: Tx, id: string, expectedRevision: number) {
    await tx.$queryRaw`SELECT id FROM assessment_questions WHERE id=${id}::uuid FOR UPDATE`;
    const q = await this.load(tx, id);
    if (q.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
    if (q.editRevision !== expectedRevision) throw new ConflictException("QUESTION_CHANGED");
    return q;
  }
  private async taxonomyLock(tx: Tx) {
    // FIRST lock on seal and assignment writes. Shared order with taxonomy
    // mutations prevents move/archive racing against full ancestry snapshots.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209, 1)`;
  }
  private async saveDraft(tx: Tx, id: string, draft: s.QuestionDraftInput) {
    const assigned = [...(draft.primarySkillId ? [draft.primarySkillId] : []), ...draft.secondarySkillIds];
    if (assigned.length && await tx.skill.count({ where: { id: { in: assigned } } }) !== assigned.length) {
      throw new BadRequestException("INVALID_SKILL");
    }
    const data = { type: draft.type, defaultContentLocale: draft.defaultContentLocale,
      content: json(draft.content), gradingDefinition: json(draft.gradingDefinition),
      explanation: json(draft.explanation), difficulty: draft.difficulty, defaultPoints: draft.defaultPoints };
    await tx.questionDraft.upsert({ where: { questionId: id }, create: { questionId: id, ...data }, update: data });
    await tx.questionSkill.deleteMany({ where: { questionId: id } });
    if (assigned.length) await tx.questionSkill.createMany({ data: assigned.map(skillId => ({
      questionId: id, skillId, role: skillId === draft.primarySkillId ? "primary" : "secondary",
    })) });
    await tx.questionCognitiveTag.deleteMany({ where: { questionId: id } });
    if (draft.cognitiveTags.length) await tx.questionCognitiveTag.createMany({
      data: draft.cognitiveTags.map(code => ({ questionId: id, code })),
    });
  }
  async create(actor: Actor, input: unknown) {
    const { draft } = parse(s.questionCreateSchema, input);
    return this.mutation(async tx => {
      await this.taxonomyLock(tx);
      const q = await tx.question.create({ data: { createdBy: actor.user.id } });
      await this.saveDraft(tx, q.id, draft);
      await this.store.audit(tx, actor, "assessment.question.created", "question", q.id, { editRevision: 0 });
      return detail(await this.load(tx, q.id));
    });
  }
  async edit(actor: Actor, questionId: string, input: unknown) {
    const id = parse(uuid, questionId);
    const { draft, expectedRevision } = parse(s.questionEditSchema, input);
    return this.mutation(async tx => {
      await this.taxonomyLock(tx);
      await this.lock(tx, id, expectedRevision);
      await this.saveDraft(tx, id, draft);
      await tx.question.update({ where: { id }, data: { editRevision: { increment: 1 } } });
      await this.store.audit(tx, actor, "assessment.question.edited", "question", id, { editRevision: expectedRevision + 1 });
      return detail(await this.load(tx, id));
    });
  }
  async get(questionId: string) {
    const id = parse(uuid, questionId);
    return this.store.transaction(async tx => detail(await this.load(tx, id)), true);
  }
  async list(input: unknown) {
    const q = parse(s.questionListSchema, input);
    const draftWhere: Prisma.QuestionDraftWhereInput = {
      ...(q.type ? { type: q.type } : {}), ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      ...(q.locale ? { content: { path: [q.locale], not: Prisma.DbNull } } : {}),
      ...(q.search ? { OR: (q.locale ? [q.locale] : ["ar", "en"]).map(locale => ({
        content: { path: [locale, "prompt"], string_contains: q.search },
      })) } : {}),
    };
    const where: Prisma.QuestionWhereInput = {
      ...(q.status ? { status: q.status } : {}), draft: { is: draftWhere },
      ...(q.primarySkillId ? { skills: { some: { role: "primary", skillId: q.primarySkillId } } } : {}),
      ...(q.cognitiveTag ? { cognitiveTags: { some: { code: q.cognitiveTag } } } : {}),
    };
    return this.store.transaction(async tx => {
      const [rows, total] = await Promise.all([
        tx.question.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.question.count({ where }),
      ]);
      // Lists never include private keys, explanations or prompt text.
      return { items: rows.map(r => ({ id: r.id, status: r.status, editRevision: r.editRevision,
        currentRevisionId: r.currentRevisionId, createdAt: r.createdAt.toISOString(),
        type: r.draft!.type, difficulty: r.draft!.difficulty, defaultContentLocale: r.draft!.defaultContentLocale,
        locales: Object.keys(r.draft!.content as object),
        primarySkillId: r.skills.find(x => x.role === "primary")?.skillId ?? null,
        cognitiveTags: r.cognitiveTags.map(x => x.code).sort() })),
        page: q.page, pageSize: q.pageSize, total };
    }, true);
  }
  private async snapshotSkills(tx: Tx, draft: s.QuestionDraftInput) {
    if (!draft.primarySkillId) throw new BadRequestException("PRIMARY_SKILL_REQUIRED");
    const assigned = [draft.primarySkillId, ...draft.secondarySkillIds.slice().sort()];
    const snapshots = [];
    for (const skillId of assigned) {
      const path: { skillId: string; slug: string; labels: Record<string, string> }[] = [];
      const seen = new Set<string>();
      let id: string | null = skillId;
      let parentId: string | null = null;
      while (id) {
        if (seen.has(id) || seen.size >= 8) throw new ConflictException("INVALID_SKILL_HIERARCHY");
        seen.add(id);
        // An advisory-lock wait does not refresh a SERIALIZABLE snapshot.
        // Row locks force a stale snapshot to abort/retry if a taxonomy writer
        // committed during that wait (including secondary/ancestor changes).
        await tx.$queryRaw`SELECT id FROM assessment_skills WHERE id=${id}::uuid FOR SHARE`;
        const skill: Prisma.SkillGetPayload<{ include: { translations: true } }> | null =
          await tx.skill.findUnique({ where: { id }, include: { translations: true } });
        if (!skill || skill.status !== "active") throw new BadRequestException("SKILL_NOT_ACTIVE");
        const labels = Object.fromEntries(skill.translations.sort((a, b) => a.locale.localeCompare(b.locale))
          .map(t => [t.locale, t.label]));
        if (!Object.keys(labels).length) throw new BadRequestException("SKILL_TRANSLATION_REQUIRED");
        if (id === skillId) parentId = skill.parentId;
        path.unshift({ skillId: skill.id, slug: skill.slug, labels });
        id = skill.parentId;
      }
      const leaf = path[path.length - 1]!;
      snapshots.push({ skillId, role: skillId === draft.primarySkillId ? "primary" : "secondary",
        slug: leaf.slug, parentId, labels: leaf.labels, path, ancestorIds: path.slice(0, -1).map(x => x.skillId) });
    }
    if (Buffer.byteLength(JSON.stringify(snapshots)) > 45000) throw new BadRequestException("SKILL_SNAPSHOT_TOO_LARGE");
    return snapshots;
  }
  async seal(actor: Actor, questionId: string, input: unknown) {
    const id = parse(uuid, questionId);
    const { expectedRevision } = parse(s.questionRevisionInputSchema, input);
    return this.mutation(async tx => {
      await this.taxonomyLock(tx);
      const q = await this.lock(tx, id, expectedRevision);
      const draft = parse(s.questionDraftSchema, draftDto(q));
      const skillSnapshot = await this.snapshotSkills(tx, draft);
      const latest = await tx.questionRevision.findFirst({ where: { questionId: id }, orderBy: { number: "desc" }, select: { number: true } });
      // Q2 has no revision default_points column. Preserve it in immutable
      // content beside locale entries (never retrofit an old revision).
      const data = { id: randomUUID(), questionId: id, number: (latest?.number ?? 0) + 1,
        type: draft.type, defaultContentLocale: draft.defaultContentLocale,
        content: { ...draft.content, defaultPoints: draft.defaultPoints },
        gradingDefinition: draft.gradingDefinition, explanation: draft.explanation,
        difficulty: draft.difficulty, skillSnapshot, cognitiveTags: draft.cognitiveTags.slice().sort(),
        schemaVersion: 1, graderVersion: GRADER_VERSION };
      const checksum = createHash("sha256").update(canonical(data)).digest("hex");
      const sealed = await tx.questionRevision.create({ data: {
        ...data, content: json(data.content), gradingDefinition: json(data.gradingDefinition),
        explanation: json(data.explanation), skillSnapshot: json(skillSnapshot),
        cognitiveTags: json(data.cognitiveTags), checksum, createdBy: actor.user.id,
      } });
      await tx.question.update({ where: { id }, data: { currentRevisionId: sealed.id, editRevision: { increment: 1 } } });
      await this.store.audit(tx, actor, "assessment.question.revision_sealed", "question", id,
        { revisionId: sealed.id, number: sealed.number, editRevision: expectedRevision + 1, graderVersion: GRADER_VERSION });
      return { revision: revisionDto(sealed), editRevision: expectedRevision + 1 };
    });
  }
  async revision(questionId: string, revisionId: string) {
    const question = parse(uuid, questionId), id = parse(uuid, revisionId);
    const row = await this.store.db.questionRevision.findFirst({ where: { id, questionId: question } });
    if (!row) throw new NotFoundException("QUESTION_REVISION_NOT_FOUND");
    return revisionDto(row);
  }
  async revisions(questionId: string, input: unknown) {
    const id = parse(uuid, questionId), q = parse(s.questionPaginationSchema, input);
    return this.store.transaction(async tx => {
      await this.load(tx, id);
      const where = { questionId: id };
      const [rows, total] = await Promise.all([
        tx.questionRevision.findMany({ where, orderBy: { number: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          select: { id: true, questionId: true, number: true, type: true, defaultContentLocale: true, createdAt: true } }),
        tx.questionRevision.count({ where }),
      ]);
      return { items: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })), page: q.page, pageSize: q.pageSize, total };
    }, true);
  }
  async archive(actor: Actor, questionId: string, input: unknown) {
    const id = parse(uuid, questionId), { expectedRevision } = parse(s.questionRevisionInputSchema, input);
    return this.mutation(async tx => {
      await this.lock(tx, id, expectedRevision);
      await tx.question.update({ where: { id }, data: { status: "archived", editRevision: { increment: 1 } } });
      await this.store.audit(tx, actor, "assessment.question.archived", "question", id,
        { priorStatus: "active", nextStatus: "archived", editRevision: expectedRevision + 1 });
      return detail(await this.load(tx, id));
    });
  }
}
