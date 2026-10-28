import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, Prisma } from "@workspace/saudisensei-database";

after(async () => { await prisma.$disconnect(); });
test("database has all ten domain tables and no content translations", async () => {
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  const names = tables.map((row) => row.table_name);
  for (const table of ["users", "user_identities", "roles", "user_roles", "courses", "chapters", "lessons", "enrollments", "lesson_completions", "audit_logs"]) {
    assert.ok(names.includes(table), table);
  }
  for (const table of ["course_translations", "chapter_translations", "lesson_translations"]) assert.ok(!names.includes(table));
});
test("role seed includes Student and Admin without a fabricated account", async () => {
  const roles = await prisma.role.findMany({ select: { name: true } });
  assert.ok(roles.some((role) => role.name === "student"));
  assert.ok(roles.some((role) => role.name === "admin"));
});
test("completion cannot reference a lesson from another course; history cannot cascade-delete", async () => {
  const rollback = new Error("TEST_TRANSACTION_ROLLBACK");
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: "constraint-fixture@example.invalid", displayName: "Fixture" } });
      const a = await tx.course.create({ data: { slug: randomUUID(), title: "دورة A", createdBy: user.id } });
      const b = await tx.course.create({ data: { slug: randomUUID(), title: "Course B", createdBy: user.id } });
      const chapter = await tx.chapter.create({ data: { courseId: b.id, title: "Mixed code", position: 1 } });
      const lesson = await tx.lesson.create({ data: { chapterId: chapter.id, courseId: b.id, title: "درس code", body: "const x = 1;", position: 1 } });
      const enrollment = await tx.enrollment.create({ data: { userId: user.id, courseId: a.id, grantedBy: user.id } });
      await tx.$executeRawUnsafe("SAVEPOINT invalid_completion");
      await assert.rejects(
        tx.lessonCompletion.create({ data: { enrollmentId: enrollment.id, lessonId: lesson.id, courseId: a.id } }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
      );
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_completion");
      await tx.$executeRawUnsafe("SAVEPOINT invalid_delete");
      await assert.rejects(
        tx.course.delete({ where: { id: b.id } }),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
      );
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_delete");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
