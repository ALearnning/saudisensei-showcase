import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@workspace/saudisensei-database";
import { AssessmentDatabaseFixture } from "./assessment-database.fixture.js";
import { LmsStore, type Actor } from "../src/modules/courses/lms.store.js";
import { SkillsService } from "../src/modules/assessments/skills/skills.service.js";
import { skillCreate, skillEdit, skillList } from "../src/modules/assessments/skills/skill.schemas.js";

const translated = { ar: { label: "مفاهيم جافا", description: "شرح آمن" }, en: { label: "Java concepts", description: "" } };
const rejects = (run: () => Promise<unknown>, message: string) =>
  assert.rejects(run, (e: unknown) => e instanceof HttpException && e.message === message);

test("skill DTO validation preserves authored languages, rejects injection/invalid bounds", () => {
  for (const translations of [{ ar: translated.ar }, { en: translated.en }, translated]) {
    assert.ok(skillCreate.safeParse({ slug: "java-basics", translations }).success);
  }
  for (const bad of [
    { slug: "Bad Slug", translations: translated }, { slug: "a", translations: {} },
    { slug: "a", translations: { fr: { label: "x" } } },
    { slug: "a", translations: { ar: { label: "<script>x</script>" } } },
    { slug: "a", translations: translated, status: "archived" },
  ]) assert.equal(skillCreate.safeParse(bad).success, false);
  assert.equal(skillEdit.safeParse({ expectedRevision: 0 }).success, false);
  assert.equal(skillList.parse({}).pageSize, 20);
  assert.equal(skillList.safeParse({ pageSize: 51 }).success, false);
});

test("raw taxonomy serialization failures retry boundedly then become explicit conflict", async () => {
  for (const sqlState of ["40001", "40P01"]) {
    let attempts = 0;
    const store = { transaction: async () => {
      attempts++;
      throw new Prisma.PrismaClientKnownRequestError("fixture", {
        code: "P2010", clientVersion: "fixture", meta: { code: sqlState },
      });
    } } as unknown as LmsStore;
    await rejects(() => new SkillsService(store).create({} as Actor, { slug: "test", translations: translated }), "SKILL_CHANGED");
    assert.equal(attempts, 3);
  }
});

test("Q3 skill taxonomy services on disposable PostgreSQL preserve identity and audit atomically", { timeout: 120000 }, async t => {
  const fixture = new AssessmentDatabaseFixture();
  let db: PrismaClient | undefined;
  try {
    await fixture.setup(); await fixture.migrate();
    const baseline = await fixture.baseline();
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", fixture.schema);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const store = new LmsStore(db);
    const skills = new SkillsService(store);
    const actor = { user: { id: fixture.ids.user }, requestId: randomUUID() } as Actor;
    let root = await skills.create(actor, { slug: "java", translations: translated });
    let child = await skills.create(actor, { slug: "java-child", parentId: root.id, translations: { ar: translated.ar } });
    await t.test("AR/EN/bilingual, bounded traversal/search, stable ID on rename and translation replacement", async () => {
      const detail = await skills.get(child.id);
      assert.equal(detail.ancestors[0].id, root.id);
      root = await skills.edit(actor, root.id, { expectedRevision: 0, slug: "java-renamed",
        translations: { en: translated.en } });
      assert.equal(root.editRevision, 1);
      assert.deepEqual(Object.keys(root.translations), ["en"]);
      assert.equal((await skills.list(skillList.parse({ parentId: root.id }))).items[0].id, child.id);
      assert.equal((await skills.list(skillList.parse({ parentId: "root" }))).total, 1);
      assert.equal((await skills.list(skillList.parse({ search: "مفاهيم", pageSize: 1 }))).items.length, 1);
      await rejects(() => skills.create(actor, { slug: root.slug, translations: translated }), "SKILL_SLUG_EXISTS");
    });
    await t.test("optimistic concurrency rejects stale and simultaneous edits without silent overwrite", async () => {
      await rejects(() => skills.edit(actor, root.id, { expectedRevision: 0, slug: "old" }), "SKILL_CHANGED");
      const results = await Promise.allSettled(["first", "second"].map(slug =>
        skills.edit(actor, child.id, { expectedRevision: child.editRevision, slug })));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      child = await skills.get(child.id);
    });
    await t.test("cycle prevention, valid move and immutable IDs", async () => {
      await rejects(() => skills.move(actor, root.id, { expectedRevision: root.editRevision, parentId: child.id }), "SKILL_CYCLE_OR_DEPTH");
      const originalId = child.id;
      child = await skills.move(actor, child.id, { expectedRevision: child.editRevision, parentId: null });
      assert.equal(child.id, originalId); assert.equal(child.parentId, null);
      child = await skills.move(actor, child.id, { expectedRevision: child.editRevision, parentId: root.id });
    });
    await t.test("eight levels include descendant subtree when moving", async () => {
      let node = root;
      for (let n = 2; n <= 8; n++) node = await skills.create(actor, {
        slug: `depth-${n}`, parentId: node.id, translations: translated,
      });
      await rejects(() => skills.create(actor, { slug: "depth-nine", parentId: node.id, translations: translated }), "SKILL_CYCLE_OR_DEPTH");
      await rejects(() => skills.move(actor, child.id, { expectedRevision: child.editRevision, parentId: node.id }), "SKILL_CYCLE_OR_DEPTH");
    });
    await t.test("archive is leaf-safe, retains references, and prevents new use", async () => {
      await rejects(() => skills.archive(actor, root.id, root.editRevision), "SKILL_HAS_ACTIVE_CHILDREN");
      child = await skills.archive(actor, child.id, child.editRevision);
      assert.equal(child.status, "archived");
      await rejects(() => skills.edit(actor, child.id, { expectedRevision: child.editRevision, slug: "restore" }), "ARCHIVED_READ_ONLY");
      await rejects(() => skills.create(actor, { slug: "under-archive", parentId: child.id, translations: translated }), "SKILL_PARENT_ARCHIVED");
      assert.equal((await skills.get(child.id)).id, child.id);
    });
    await t.test("concurrent archive versus child creation cannot leave an active child under an archived parent", async () => {
      const parent = await skills.create(actor, { slug: "race-parent", translations: translated });
      const results = await Promise.allSettled([
        skills.archive(actor, parent.id, 0),
        skills.create(actor, { slug: "race-child", parentId: parent.id, translations: translated }),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const current = await skills.get(parent.id);
      const children = await skills.list(skillList.parse({ parentId: parent.id, status: "active" }));
      assert.equal(children.total, current.status === "archived" ? 0 : 1);
    });
    await t.test("audit failure rolls back create, translations and edits", async () => {
      const before = await db!.skill.count();
      const old = await skills.get(root.id);
      const failing = new LmsStore(db!);
      failing.audit = async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE"); };
      const denied = new SkillsService(failing);
      await assert.rejects(denied.create(actor, { slug: "not-committed", translations: translated }), /SYNTHETIC_AUDIT_FAILURE/);
      await assert.rejects(denied.edit(actor, root.id, { expectedRevision: old.editRevision,
        slug: "not-edited", translations: { ar: translated.ar } }), /SYNTHETIC_AUDIT_FAILURE/);
      assert.equal(await db!.skill.count(), before);
      assert.deepEqual(await skills.get(root.id), old);
    });
    await t.test("audit metadata is allowlisted and LMS history remains unchanged", async () => {
      const entries = await db!.auditLog.findMany({ where: { action: { startsWith: "assessment.skill." } } });
      for (const entry of entries) {
        for (const key of Object.keys(entry.metadata as object)) {
          assert.ok(["parentId", "editRevision", "translationsChanged", "beforeParentId", "afterParentId"].includes(key));
        }
        assert.equal(JSON.stringify(entry.metadata).includes("Java concepts"), false);
      }
      assert.equal(await fixture.baseline(), baseline);
    });
  } finally { await db?.$disconnect(); await fixture.cleanup(); }
});
