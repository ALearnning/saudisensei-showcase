import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { prisma, PrismaClient } from "@workspace/saudisensei-database";
import { LmsStore } from "../src/modules/courses/lms.store.js";
import { MediaLibraryService } from "../src/modules/media/library.service.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";
import type { Scope } from "../src/modules/media/library.schemas.js";
export async function libraryFixture() {
  const schema = `library_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const close = async () => { await db.$disconnect(); await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); };
  try {
    const root = "../../packages/database/prisma/migrations";
    for (const entry of (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const sql = await readFile(`${root}/${entry.name}/migration.sql`, "utf8");
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const statement of sql.split(/;\s*(?:\n|$)/).filter(s => s.trim())) await tx.$executeRawUnsafe(statement);
      });
    }
    const role = await db.role.create({ data: { name: "admin" } });
    const studentRole = await db.role.create({ data: { name: "student" } });
    const admin = await db.user.create({ data: { email: "admin@example.invalid", displayName: "synthetic", roles: { create: { roleId: role.id } } } });
    const student = await db.user.create({ data: { email: "student@example.invalid", displayName: "synthetic", roles: { create: { roleId: studentRole.id } } } });
    const actor = (user: typeof admin, roles: string[], mfaVerified = false) => ({
      user: { ...user, roles }, mfaVerified, requestId: randomUUID(),
    } as unknown as AuthenticatedRequest);
    const a = actor(admin, ["admin"], true), s = actor(student, ["student"]);
    const course = await db.course.create({ data: { title: "Synthetic foundation", slug: randomUUID(), status: "published", createdBy: admin.id } });
    const chapter = await db.chapter.create({ data: { courseId: course.id, title: "synthetic", status: "published", position: 0 } });
    const lesson = await db.lesson.create({ data: { courseId: course.id, chapterId: chapter.id, title: "synthetic", status: "published", body: "Required Markdown", position: 0 } });
    const enrollment = await db.enrollment.create({ data: { courseId: course.id, userId: student.id, grantedBy: admin.id } });
    const completion = await db.lessonCompletion.create({ data: { courseId: course.id, lessonId: lesson.id, enrollmentId: enrollment.id } });
    const store = new LmsStore(db), service = new MediaLibraryService(store);
    const args = { req: a, scope: "lessons" as const, parentId: lesson.id };
    const studentArgs = { ...args, req: s };
    const revision = async () => (await db.courseMediaState.findUnique({ where: { courseId: course.id } }))?.editRevision ?? 0;
    const create = async (title = "synthetic", parent: { req: AuthenticatedRequest; scope: Scope; parentId: string } = args, collectionId: string | null = null) => service.createAsset(parent, {
      expectedMediaRevision: await revision(), title, kind: "document", filename: "synthetic.txt",
      mimeType: "text/plain", bytes: 24, downloadsAllowed: false, collectionId,
    });
    // Processing evidence is an explicitly synthetic test double in a disposable
    // schema, never live scanner evidence or an application-ready endpoint.
    const ready = async (id: string) => db.mediaRevision.update({ where: { id }, data: {
      state: "ready", scanState: "clean", sha256: "a".repeat(64), scanEngine: "isolated test double",
      scannedAt: new Date(), objectKey: "synthetic-private-source", previewKey: "synthetic-private-preview",
      privateReady: true, safePreview: true,
    } });
    const publish = async (assetId: string, revisionId: string, placementId: string, parent: { req: AuthenticatedRequest; scope: Scope; parentId: string } = args) => {
      await ready(revisionId);
      await service.activate(parent, assetId, { expectedMediaRevision: await revision(), revisionId });
      await service.assetLifecycle(parent, assetId, { expectedMediaRevision: await revision(), action: "publish" });
      await service.placementLifecycle(parent, placementId, { expectedMediaRevision: await revision(), action: "publish" });
    };
    return { db, close, store, service, args, studentArgs, a, s, actor, admin, student,
      course, chapter, lesson, enrollment, completion, revision, create, ready, publish };
  } catch (error) { await close(); throw error; }
}
