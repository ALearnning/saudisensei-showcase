import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import { LmsStore, type Actor, type Tx } from "../../courses/lms.store.js";
import type { SkillCreate, SkillEdit, SkillList, SkillMove, SkillTranslations } from "./skill.schemas.js";

type SkillRow = Prisma.SkillGetPayload<{ include: { translations: true } }>;
export function skillView(row: SkillRow) {
  const translations: SkillTranslations = {};
  for (const t of row.translations) {
    if (t.locale === "ar" || t.locale === "en") translations[t.locale] = { label: t.label, description: t.description };
  }
  return { id: row.id, slug: row.slug, parentId: row.parentId, status: row.status,
    editRevision: row.editRevision, createdAt: row.createdAt.toISOString(), translations };
}
const missing = () => new NotFoundException("SKILL_NOT_FOUND");

@Injectable()
export class SkillsService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}
  private async mutation<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    // Raw lock failures use P2010/SQLSTATE, unlike Prisma's P2034 writes.
    // Keep this retry adaptation local to assessments, not existing LMS paths.
    for (let attempt = 0; ; attempt++) {
      try { return await this.store.transaction(work); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" &&
          ["40001", "40P01"].includes(String(error.meta?.code))) {
          if (attempt < 2) continue;
          throw new ConflictException("SKILL_CHANGED");
        }
        throw error;
      }
    }
  }
  private async serialize(tx: Tx) {
    // Same lock as Q2's deferred structural check and question sealing. Acquire
    // before row locks so concurrent archive/move/seal cannot capture mixed paths.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209,1)`;
  }
  private async getRow(tx: Tx, id: string) {
    const skill = await tx.skill.findUnique({ where: { id }, include: { translations: true } });
    if (!skill) throw missing();
    return skill;
  }
  private async writable(tx: Tx, id: string, expectedRevision: number) {
    await tx.$queryRaw`SELECT id FROM assessment_skills WHERE id=${id}::uuid FOR UPDATE`;
    const skill = await this.getRow(tx, id);
    if (skill.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
    if (skill.editRevision !== expectedRevision) throw new ConflictException("SKILL_CHANGED");
    return skill;
  }
  private translationRows(translations: SkillTranslations) {
    return (["ar", "en"] as const).flatMap(locale => translations[locale] ? [{ locale, ...translations[locale]! }] : []);
  }
  private async ancestors(tx: Tx, parentId: string | null, requireActive = false) {
    const rows: SkillRow[] = [];
    const seen = new Set<string>();
    while (parentId !== null) {
      if (seen.has(parentId) || rows.length >= 8) throw new ConflictException("SKILL_CYCLE_OR_DEPTH");
      seen.add(parentId);
      // An advisory lock does not refresh a Serializable snapshot. Locking the
      // actual ancestor forces serialization retry if it changed while waiting.
      if (requireActive) await tx.$queryRaw`SELECT id FROM assessment_skills WHERE id=${parentId}::uuid FOR SHARE`;
      const row = await this.getRow(tx, parentId);
      if (requireActive && row.status !== "active") throw new ConflictException("SKILL_PARENT_ARCHIVED");
      rows.unshift(row);
      parentId = row.parentId;
    }
    return rows;
  }
  private async uniqueSlug(tx: Tx, slug: string, exceptId?: string) {
    const existing = await tx.skill.findUnique({ where: { slug }, select: { id: true } });
    if (existing && existing.id !== exceptId) throw new ConflictException("SKILL_SLUG_EXISTS");
  }
  list(query: SkillList) {
    return this.store.transaction(async tx => {
      const where: Prisma.SkillWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.parentId ? { parentId: query.parentId === "root" ? null : query.parentId } : {}),
        ...(query.search ? { OR: [{ slug: { contains: query.search, mode: "insensitive" } },
          { translations: { some: { label: { contains: query.search, mode: "insensitive" } } } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.skill.count({ where }),
        tx.skill.findMany({ where, include: { translations: true }, orderBy: [{ slug: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      ]);
      return { items: rows.map(skillView), page: query.page, pageSize: query.pageSize, total };
    }, true);
  }
  get(id: string) {
    return this.store.transaction(async tx => {
      const row = await this.getRow(tx, id);
      return { ...skillView(row), ancestors: (await this.ancestors(tx, row.parentId)).map(skillView) };
    }, true);
  }
  create(actor: Actor, input: SkillCreate) {
    return this.mutation(async tx => {
      await this.serialize(tx);
      const ancestors = await this.ancestors(tx, input.parentId ?? null, true);
      if (ancestors.length >= 8) throw new ConflictException("SKILL_CYCLE_OR_DEPTH");
      await this.uniqueSlug(tx, input.slug);
      const row = await tx.skill.create({ data: {
        slug: input.slug, parentId: input.parentId ?? null,
        translations: { create: this.translationRows(input.translations) },
      }, include: { translations: true } });
      await this.store.audit(tx, actor, "assessment.skill.created", "skill", row.id, { parentId: row.parentId });
      return skillView(row);
    });
  }
  edit(actor: Actor, id: string, input: SkillEdit) {
    return this.mutation(async tx => {
      await this.serialize(tx);
      await this.writable(tx, id, input.expectedRevision);
      if (input.slug !== undefined) await this.uniqueSlug(tx, input.slug, id);
      if (input.translations !== undefined) {
        await tx.skillTranslation.deleteMany({ where: { skillId: id } });
        await tx.skillTranslation.createMany({ data: this.translationRows(input.translations).map(t => ({ skillId: id, ...t })) });
      }
      const row = await tx.skill.update({ where: { id }, data: {
        ...(input.slug === undefined ? {} : { slug: input.slug }), editRevision: { increment: 1 },
      }, include: { translations: true } });
      await this.store.audit(tx, actor, "assessment.skill.edited", "skill", id,
        { editRevision: row.editRevision, translationsChanged: input.translations !== undefined });
      return skillView(row);
    });
  }
  move(actor: Actor, id: string, input: SkillMove) {
    return this.mutation(async tx => {
      await this.serialize(tx);
      const before = await this.writable(tx, id, input.expectedRevision);
      const ancestors = await this.ancestors(tx, input.parentId, true);
      if (ancestors.some(p => p.id === id) || input.parentId === id) throw new ConflictException("SKILL_CYCLE_OR_DEPTH");
      const [subtree] = await tx.$queryRaw<{ depth: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, 1 AS depth FROM assessment_skills WHERE id=${id}::uuid
          UNION ALL
          SELECT s.id, p.depth+1 FROM assessment_skills s JOIN subtree p ON s.parent_id=p.id WHERE p.depth<9
        ) SELECT max(depth)::integer AS depth FROM subtree`;
      if (ancestors.length + subtree.depth > 8) throw new ConflictException("SKILL_CYCLE_OR_DEPTH");
      const row = await tx.skill.update({ where: { id }, data: { parentId: input.parentId, editRevision: { increment: 1 } },
        include: { translations: true } });
      await this.store.audit(tx, actor, "assessment.skill.moved", "skill", id,
        { beforeParentId: before.parentId, afterParentId: row.parentId, editRevision: row.editRevision });
      return skillView(row);
    });
  }
  archive(actor: Actor, id: string, expectedRevision: number) {
    return this.mutation(async tx => {
      await this.serialize(tx);
      await this.writable(tx, id, expectedRevision);
      // No implicit subtree archive, reassignment or orphan active descendants.
      if (await tx.skill.count({ where: { parentId: id, status: "active" } })) {
        throw new ConflictException("SKILL_HAS_ACTIVE_CHILDREN");
      }
      const row = await tx.skill.update({ where: { id }, data: { status: "archived", editRevision: { increment: 1 } },
        include: { translations: true } });
      await this.store.audit(tx, actor, "assessment.skill.archived", "skill", id, { editRevision: row.editRevision });
      return skillView(row);
    });
  }
}
