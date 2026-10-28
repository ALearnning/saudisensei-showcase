import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma, PrismaClient } from "@workspace/saudisensei-database";
import { LmsStore, type Actor } from "../src/modules/courses/lms.store.js";
import { CoursesService } from "../src/modules/courses/courses.service.js";
import { StructureService } from "../src/modules/courses/structure.service.js";
import { EnrollmentsService } from "../src/modules/enrollments/enrollments.service.js";
import { LearningService } from "../src/modules/progress/learning.service.js";
import { ProgressService } from "../src/modules/progress/progress.service.js";

test("real concurrent LMS transactions serialize edits, positions and revocation", async () => {
  // Dedicated ephemeral schema: fixtures are never visible to the application.
  // The runtime-only connection value is never printed or written to a file.
  const schema = `lms_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let created = false;
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    const migrationRoot = new URL("../../../../packages/database/prisma/migrations/", import.meta.url);
    for (const name of ["20261011235305_phase1a_foundation", "20261012000100_phase1a_constraints", "20261013010000_phase1b_lms"]) {
      const sql = await readFile(new URL(`${name}/migration.sql`, migrationRoot), "utf8");
      for (const statement of sql.split(";").filter((s) => s.trim())) await db.$executeRawUnsafe(statement);
    }
    const fixture = await db.user.create({ data: { email: "concurrency@fixture.invalid", displayName: "Ephemeral fixture" } });
    const role = await db.role.create({ data: { name: "student" } });
    await db.userRole.create({ data: { userId: fixture.id, roleId: role.id } });
    const actor: Actor = { user: { id: fixture.id, email: fixture.email, displayName: fixture.displayName,
      status: "active", roles: ["student", "admin"], preferredLocale: "ar" }, requestId: randomUUID() };
    const store = new LmsStore(db);
    const courses = new CoursesService(store), structure = new StructureService(store);
    const enrollments = new EnrollmentsService(store), progress = new ProgressService(store);
    const learning = new LearningService(store, enrollments, progress);
    const course = await courses.create(actor, { title: "Concurrent", description: "" });
    const edits = await Promise.allSettled(["Left", "Right"].map((title) => courses.edit(course.id, actor, { title, expectedRevision: 0 })));
    assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(edits.filter((r) => r.status === "rejected").length, 1);
    assert.equal((await courses.get(course.id)).editRevision, 1);
    assert.equal(await db.auditLog.count({ where: { action: "course.edited" } }), 1);
    const additions = await Promise.allSettled(["A", "B"].map((title) => structure.createChapter(course.id, actor, { title, expectedRevision: 1 })));
    assert.equal(additions.filter((r) => r.status === "fulfilled").length, 1);
    const chapter = (await courses.get(course.id)).chapters[0]!;
    assert.equal(chapter.position, 0);
    const lesson = await structure.createLesson(chapter.id, actor, { title: "Lesson", body: "Text", isRequired: true, expectedRevision: 2 });
    let revision = (await structure.editLesson(lesson.id, actor, { expectedRevision: lesson.editRevision, status: "published" })).editRevision;
    revision = (await structure.editChapter(chapter.id, actor, { expectedRevision: revision, status: "published" })).editRevision;
    await courses.transition(course.id, actor, revision, "published");
    const enrollment = await enrollments.grant(actor, course.id, fixture.id);
    const race = await Promise.allSettled([learning.complete(fixture.id, lesson.id), enrollments.change(actor, enrollment.id, "revoked")]);
    assert.equal(race[1]!.status, "fulfilled");
    assert.equal((await db.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).status, "revoked");
    assert.ok(await db.lessonCompletion.count({ where: { enrollmentId: enrollment.id } }) <= 1);
    await assert.rejects(learning.complete(fixture.id, lesson.id), { message: "RESOURCE_NOT_FOUND" });
  } finally {
    await db.$disconnect();
    if (created) await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
});
