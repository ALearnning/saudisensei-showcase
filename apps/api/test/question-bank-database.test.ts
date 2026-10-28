import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { PrismaClient } from "@workspace/saudisensei-database";
import { AssessmentDatabaseFixture } from "./assessment-database.fixture.js";
import { LmsStore, type Actor } from "../src/modules/courses/lms.store.js";
import { QuestionBankService } from "../src/modules/assessments/question-bank/question-bank.service.js";
import type { QuestionDraftInput } from "../src/modules/assessments/question-bank/question-bank.schemas.js";

const rejected = (fn: () => Promise<unknown>, code: string) => assert.rejects(fn,
  (e: unknown) => e instanceof HttpException && e.message === code);

test("Question Bank real services: immutable history, concurrency, taxonomy locks and audit atomicity", { timeout: 120000 }, async t => {
  const f = new AssessmentDatabaseFixture();
  let db: PrismaClient | undefined;
  try {
    await f.setup(); await f.migrate();
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", f.schema);
    db = new PrismaClient({ datasourceUrl: url.toString() });
    const database = db, store = new LmsStore(db), service = new QuestionBankService(store);
    const actor = { user: { id: f.ids.user }, requestId: randomUUID() } as Actor;
    const baseline = await f.baseline();
    const root = await db.skill.create({ data: { slug: "root", translations: { create: [{ locale: "ar", label: "جذر" }, { locale: "en", label: "Root" }] } } });
    const primary = await db.skill.create({ data: { slug: "primary", parentId: root.id, translations: { create: [{ locale: "en", label: "Primary" }] } } });
    const secondary = await db.skill.create({ data: { slug: "secondary", translations: { create: [{ locale: "ar", label: "ثانوي" }] } } });
    const base: QuestionDraftInput = {
      type: "true_false", defaultContentLocale: "ar",
      content: { ar: { prompt: "سؤال خاص" }, en: { prompt: "Private question" } },
      gradingDefinition: { type: "true_false", correctValue: false }, explanation: { ar: "تفسير خاص" },
      defaultPoints: 7, difficulty: "medium", primarySkillId: primary.id, secondarySkillIds: [secondary.id],
      cognitiveTags: ["concept", "debugging"],
    };
    const create = (draft: QuestionDraftInput = base) => service.create(actor, { draft });
    await t.test("all five real sealed types preserve opaque IDs, bilingual keys and Java presentation", async () => {
      const ids = [randomUUID(), randomUUID()];
      for (const type of ["single_choice", "multiple_choice", "true_false", "short_text", "ordering"] as const) {
        const labels = ids.map((id, i) => ({ id, label: `قيمة ${i}` }));
        const content = { prompt: "Localized question", code: { language: "java" as const, source: "int n = 2;" },
          ...(type.includes("choice") ? { options: labels } : {}), ...(type === "ordering" ? { items: labels } : {}) };
        const gradingDefinition: QuestionDraftInput["gradingDefinition"] = type === "single_choice" ? { type, correctOptionId: ids[0]! }
          : type === "multiple_choice" ? { type, correctOptionIds: ids }
            : type === "ordering" ? { type, correctOrderedItemIds: ids.slice().reverse() }
              : type === "true_false" ? { type, correctValue: false }
                : { type, normalizer: { version: 1, unicode: "NFC", lineEndings: "LF", trim: false, collapseWhitespace: false, caseFold: false },
                  acceptedByLocale: { ar: ["أَ"], en: [" output\n"] } };
        const q = await create({ ...base, type, content: { ar: content, en: content }, gradingDefinition });
        const sealed = await service.seal(actor, q.id, { expectedRevision: 0 });
        assert.deepEqual(sealed.revision.gradingDefinition, gradingDefinition);
        assert.deepEqual(sealed.revision.content, { ar: content, en: content, defaultPoints: 7 });
      }
    });
    await t.test("seal snapshots exact IDs/locales/full skill path/default points and newer edits preserve old snapshot", async () => {
      const q = await create();
      const sealed = await service.seal(actor, q.id, { expectedRevision: 0 });
      assert.equal(sealed.editRevision, 1);
      const old = await service.revision(q.id, sealed.revision.id);
      assert.equal((old.content as Record<string, unknown>).defaultPoints, 7);
      assert.match(old.checksum, /^[a-f0-9]{64}$/);
      const skills = old.skillSnapshot as { skillId: string; path: { skillId: string; labels: Record<string, string> }[] }[];
      assert.deepEqual(skills[0]!.path.map(x => x.skillId), [root.id, primary.id]);
      assert.deepEqual(skills[0]!.path[0]!.labels, { ar: "جذر", en: "Root" });
      await store.transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209,1)`;
        await tx.skillTranslation.update({ where: { skillId_locale: { skillId: primary.id, locale: "en" } }, data: { label: "Renamed" } });
        await tx.skill.update({ where: { id: primary.id }, data: { parentId: null } });
      });
      await service.edit(actor, q.id, { expectedRevision: 1, draft: { ...base, defaultPoints: 9, content: { ar: { prompt: "جديد" } }, explanation: {} } });
      const next = await service.seal(actor, q.id, { expectedRevision: 2 });
      assert.equal(next.revision.number, 2);
      assert.notEqual(next.revision.checksum, old.checksum);
      assert.deepEqual(await service.revision(q.id, old.id), old);
      await assert.rejects(() => database.questionRevision.update({ where: { id: old.id }, data: { checksum: "tampered" } }));
      await assert.rejects(() => database.questionRevision.delete({ where: { id: old.id } }));
      const history = await service.revisions(q.id, { pageSize: 1 });
      assert.equal(history.total, 2); assert.equal(history.items.length, 1);
      assert.equal(history.items[0]!.number, 2);
      assert.equal("gradingDefinition" in history.items[0]!, false);
      await rejected(() => service.revision(randomUUID(), old.id), "QUESTION_REVISION_NOT_FOUND");
    });
    await t.test("concurrent edits cannot overwrite; archive read-only retains exact revision", async () => {
      const q = await create();
      const outcomes = await Promise.allSettled([1, 2].map(n => service.edit(actor, q.id, {
        expectedRevision: 0, draft: { ...base, defaultPoints: n },
      })));
      assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
      const loser = outcomes.find(x => x.status === "rejected") as PromiseRejectedResult;
      assert.ok(loser.reason instanceof HttpException);
      assert.equal(loser.reason.getStatus(), 409);
      assert.equal((await service.get(q.id)).editRevision, 1);
      const sealed = await service.seal(actor, q.id, { expectedRevision: 1 });
      await service.archive(actor, q.id, { expectedRevision: 2 });
      assert.equal((await service.get(q.id)).status, "archived");
      await rejected(() => service.edit(actor, q.id, { expectedRevision: 3, draft: base }), "ARCHIVED_READ_ONLY");
      await rejected(() => service.seal(actor, q.id, { expectedRevision: 3 }), "ARCHIVED_READ_ONLY");
      await rejected(() => service.archive(actor, q.id, { expectedRevision: 3 }), "ARCHIVED_READ_ONLY");
      assert.deepEqual(await service.revision(q.id, sealed.revision.id), sealed.revision);
    });
    await t.test("missing primary, archived secondary and tampered persisted definitions cannot create partial history", async () => {
      const missing = await create({ ...base, primarySkillId: null });
      await rejected(() => service.seal(actor, missing.id, { expectedRevision: 0 }), "PRIMARY_SKILL_REQUIRED");
      assert.equal((await service.revisions(missing.id, {})).total, 0);
      const archived = await database.skill.create({ data: { slug: "archived-secondary",
        translations: { create: [{ locale: "en", label: "Archived" }] } } });
      await database.skill.update({ where: { id: archived.id }, data: { status: "archived" } });
      const q = await create({ ...base, secondarySkillIds: [archived.id] });
      await rejected(() => service.seal(actor, q.id, { expectedRevision: 0 }), "SKILL_NOT_ACTIVE");
      assert.equal((await service.get(q.id)).editRevision, 0);
      const tampered = await create();
      await database.questionDraft.update({ where: { questionId: tampered.id },
        data: { gradingDefinition: { type: "true_false", correctValue: "not boolean" } } });
      await rejected(() => service.seal(actor, tampered.id, { expectedRevision: 0 }), "INVALID_INPUT");
      assert.equal((await service.revisions(tampered.id, {})).total, 0);
      await rejected(() => create({ ...base, primarySkillId: randomUUID() }), "INVALID_SKILL");
    });
    await t.test("every meaningful mutation rolls back if audit fails and metadata never contains content/keys", async () => {
      const q = await create(), beforeCount = await database.question.count();
      const original = store.audit;
      store.audit = async () => { throw new Error("TEST_AUDIT_FAILURE"); };
      try {
        await assert.rejects(create, /TEST_AUDIT_FAILURE/);
        assert.equal(await database.question.count(), beforeCount);
        await assert.rejects(() => service.edit(actor, q.id, { expectedRevision: 0, draft: { ...base, defaultPoints: 100 } }), /TEST_AUDIT_FAILURE/);
        await assert.rejects(() => service.seal(actor, q.id, { expectedRevision: 0 }), /TEST_AUDIT_FAILURE/);
        await assert.rejects(() => service.archive(actor, q.id, { expectedRevision: 0 }), /TEST_AUDIT_FAILURE/);
      } finally { store.audit = original; }
      assert.deepEqual(await service.get(q.id), q);
      assert.equal((await service.revisions(q.id, {})).total, 0);
      const audits = await database.auditLog.findMany({ where: { entityType: "question" } });
      assert.ok(audits.length > 0);
      const allowed = new Set(["editRevision", "revisionId", "number", "graderVersion", "priorStatus", "nextStatus"]);
      for (const audit of audits) {
        for (const key of Object.keys(audit.metadata as object)) assert.ok(allowed.has(key), key);
        assert.doesNotMatch(JSON.stringify(audit.metadata), /correctValue|سؤال|Private|gradingDefinition/);
      }
    });
    await t.test("bounded filters and summaries contain no private grading payload", async () => {
      await create({ ...base, content: { en: { prompt: "unique-search-marker" } }, defaultContentLocale: "en", explanation: {} });
      const page = await service.list({ search: "unique-search-marker", locale: "en", status: "active",
        type: "true_false", difficulty: "medium", cognitiveTag: "concept", primarySkillId: primary.id });
      assert.equal(page.total, 1);
      assert.equal(page.items.length, 1);
      assert.equal("gradingDefinition" in page.items[0]!, false);
      assert.equal((await service.list({ search: "unique-search-marker", locale: "ar" })).total, 0);
      assert.equal((await service.list({ pageSize: 1 })).items.length, 1);
      await rejected(() => service.list({ pageSize: 51 }), "INVALID_INPUT");
    });
    await t.test("seal waits for taxonomy writer and then rejects archived secondary", async () => {
      const skill = await database.skill.create({ data: { slug: "racing", translations: { create: [{ locale: "en", label: "Racing" }] } } });
      const q = await create({ ...base, secondarySkillIds: [skill.id] });
      let ready!: () => void, release!: () => void;
      const acquired = new Promise<void>(r => { ready = r; });
      const proceed = new Promise<void>(r => { release = r; });
      const writer = store.transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209,1)`;
        await tx.skill.update({ where: { id: skill.id }, data: { status: "archived" } });
        ready(); await proceed;
      });
      await acquired;
      const seal = service.seal(actor, q.id, { expectedRevision: 0 });
      release(); await writer;
      await rejected(() => seal, "SKILL_NOT_ACTIVE");
      assert.equal((await service.revisions(q.id, {})).total, 0);
    });
    await t.test("concurrent taxonomy move seals one stable complete post-move ancestry", async () => {
      const target = await database.skill.create({ data: { slug: "move-target", translations: { create: [{ locale: "en", label: "Target" }] } } });
      const q = await create();
      let ready!: () => void, release!: () => void;
      const acquired = new Promise<void>(r => { ready = r; });
      const proceed = new Promise<void>(r => { release = r; });
      const writer = store.transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(714209,1)`;
        await tx.skill.update({ where: { id: primary.id }, data: { parentId: target.id, editRevision: { increment: 1 } } });
        ready(); await proceed;
      });
      await acquired;
      const seal = service.seal(actor, q.id, { expectedRevision: 0 });
      release(); await writer;
      const result = await seal;
      const skills = result.revision.skillSnapshot as { skillId: string; path: { skillId: string }[] }[];
      assert.deepEqual(skills.find(s => s.skillId === primary.id)!.path.map(s => s.skillId), [target.id, primary.id]);
    });
    assert.equal(await f.baseline(), baseline, "question authoring must not mutate existing LMS content/progress");
  } finally {
    await db?.$disconnect();
    await f.cleanup();
  }
});
