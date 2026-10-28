import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma, PrismaClient } from "@workspace/saudisensei-database";
import { LmsStore } from "../src/modules/courses/lms.store.js";
import { MediaService, readCapabilityLifetime } from "../src/modules/media/media.service.js";
import type { MediaStorage } from "../src/modules/media/s3-media.store.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";
import { parseMedia, uploadInput } from "../src/modules/media/media.schemas.js";
import { ClamAvScanner } from "../src/modules/media/clamav.scanner.js";
import { Test } from "@nestjs/testing";
import { IdentityModule } from "../src/modules/identity/identity.module.js";
import { IDENTITY_ADAPTER } from "../src/modules/identity/identity-adapter.js";
import { USER_DIRECTORY } from "../src/modules/users/user-directory.js";
import { MediaModule } from "../src/modules/media/media.module.js";
import { configureApp } from "../src/config/configure-app.js";
import { UnauthorizedException } from "@nestjs/common";
import request from "supertest";

test("media capability TTL is bounded by enrollment and identity expiry", () => {
  assert.equal(readCapabilityLifetime(null, 1000, 100), 120);
  assert.equal(readCapabilityLifetime(new Date(130000), 1000, 100), 30);
  assert.equal(readCapabilityLifetime(null, 110, 100), 10);
  assert.throws(() => readCapabilityLifetime(new Date(100000), 1000, 100));
  assert.throws(() => readCapabilityLifetime(null, NaN, 100));
});
test("pilot upload validates formats, byte bounds and rejects caller storage/scan fields", () => {
  assert.equal(parseMedia(uploadInput, { title: "test.txt", bytes: 16, mimeType: "text/plain" }).method, "single");
  for (const input of [
    { title: "x", bytes: 16, mimeType: "text/html" },
    { title: "x", bytes: 0, mimeType: "text/plain" },
    { title: "x", bytes: 6291457, mimeType: "text/plain" },
    { title: "x", bytes: 16, mimeType: "text/plain", objectKey: "outside" },
    { title: "x", bytes: 16, mimeType: "text/plain", scanState: "clean" },
  ]) assert.throws(() => parseMedia(uploadInput, input));
});

test("mounted media routes preserve identity/role/MFA guards before touching storage", async () => {
  let businessCalls = 0;
  const business = {
    createUpload: async () => { businessCalls++; return { items: [] }; },
  };
  const profile = { id: randomUUID(), email: "fixture@example.invalid", displayName: "fixture",
    status: "active", preferredLocale: "ar", roles: ["student"] };
  const module = await Test.createTestingModule({ imports: [IdentityModule, MediaModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue({
      verifyAccessToken: async (token: string) => {
        if (token === "invalid") throw new UnauthorizedException("AUTHENTICATION_REQUIRED");
        return { emailVerified: token !== "unverified", mfaVerified: token === "admin-mfa" };
      },
    }).overrideProvider(USER_DIRECTORY).useValue({
      resolve: async (identity: { mfaVerified: boolean }) => ({
        ...profile, roles: identity.mfaVerified ? ["admin"] : profile.roles,
      }),
    }).overrideProvider(MediaService).useValue(business).compile();
  const app = module.createNestApplication(); configureApp(app); await app.init();
  try {
    const url = `/api/v1/admin/lessons/${randomUUID()}/media/uploads`;
    await request(app.getHttpServer()).post(url).send({}).expect(401);
    await request(app.getHttpServer()).post(url).set("Authorization", "Bearer invalid").send({}).expect(401);
    await request(app.getHttpServer()).post(url).set("Authorization", "Bearer student").send({}).expect(403);
    await request(app.getHttpServer()).post(url).set("Authorization", "Bearer unverified").send({}).expect(403);
    assert.equal(businessCalls, 0);
    profile.roles = ["admin"];
    await request(app.getHttpServer()).post(url).set("Authorization", "Bearer admin-no-mfa").send({}).expect(403);
    await request(app.getHttpServer()).post(url).set("Authorization", "Bearer admin-mfa")
      .send({ title: "fixture.txt", bytes: 16, mimeType: "text/plain" }).expect(201);
    assert.equal(businessCalls, 1);
  } finally { await app.close(); }
});

// Isolated schema plus storage/scanner test doubles: never touches live assets,
// never claims genuine scanner/live Auth0 evidence. Production has no bypass.
test("media database lifecycle, fresh authorization, audit and lesson-history isolation", async () => {
  const schema = `media_test_${randomUUID().replaceAll("-", "")}`;
  const baseUrl = process.env.DATABASE_URL!;
  const url = new URL(baseUrl); url.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let created = false;
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
    const migrations = [
      "20261011235305_phase1a_foundation", "20261012000100_phase1a_constraints",
      "20261013010000_phase1b_lms", "20261014010000_phase1c_media_pilot",
    ];
    for (const name of migrations) {
      const sql = await readFile(`../../packages/database/prisma/migrations/${name}/migration.sql`, "utf8");
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const statement of sql.split(/;\s*(?:\n|$)/).filter(s => s.trim())) await tx.$executeRawUnsafe(statement);
      });
    }
    const role = await db.role.create({ data: { name: "admin" } });
    const studentRole = await db.role.create({ data: { name: "student" } });
    const admin = await db.user.create({ data: { email: "admin@example.invalid", displayName: "fixture", roles: { create: { roleId: role.id } } } });
    const student = await db.user.create({ data: { email: "student@example.invalid", displayName: "fixture", roles: { create: { roleId: studentRole.id } } } });
    const stranger = await db.user.create({ data: { email: "stranger@example.invalid", displayName: "fixture", roles: { create: { roleId: studentRole.id } } } });
    const actor = (user: typeof admin, roles: string[], mfaVerified = false) => ({
      user: { ...user, roles }, mfaVerified, requestId: randomUUID(),
      headers: { authorization: `Bearer ${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.test-signature` },
    } as unknown as AuthenticatedRequest);
    const a = actor(admin, ["admin"], true), s = actor(student, ["student"]), other = actor(stranger, ["student"]);
    const course = await db.course.create({ data: { title: "Synthetic media fixture", slug: randomUUID(), status: "published", createdBy: admin.id } });
    const chapter = await db.chapter.create({ data: { courseId: course.id, title: "fixture", status: "published", position: 0 } });
    const lesson = await db.lesson.create({ data: { courseId: course.id, chapterId: chapter.id, title: "fixture", status: "published", body: "Required Markdown", position: 0 } });
    const enrollment = await db.enrollment.create({ data: { courseId: course.id, userId: student.id, grantedBy: admin.id } });
    const completion = await db.lessonCompletion.create({ data: { courseId: course.id, lessonId: lesson.id, enrollmentId: enrollment.id } });
    const bytes = Buffer.from("Synthetic unit fixture only.\n");
    const objects = new Map<string, Buffer>();
    let issuedReads = 0, uploadedKey = "";
    const storage: MediaStorage = {
      upload: async key => { uploadedKey = key; objects.set(key, bytes); return "https://storage.invalid/upload"; },
      initiate: async () => "test-upload", part: async () => "https://storage.invalid/part",
      complete: async () => {}, abort: async () => {},
      head: async key => ({ bytes: objects.get(key)!.length, etag: '"abcdef"' }),
      commit: async (staging, dest) => { objects.set(dest, Buffer.from(objects.get(staging)!)); },
      read: async key => Buffer.from(objects.get(key)!),
      preview: async (key, body) => { assert.equal(objects.has(key), false); objects.set(key, body); },
      access: async () => { issuedReads++; return "https://storage.invalid/read"; },
    };
    const store = new LmsStore(db);
    const media = new MediaService(store, storage, { scan: async () => ({ clean: true, engine: "isolated test double" }) });
    await assert.rejects(media.createUpload(s, lesson.id, { title: "x", mimeType: "text/plain", bytes: bytes.length, method: "single", downloadsAllowed: true }));
    await assert.rejects(media.createUpload(actor(admin, ["admin"], false), lesson.id, { title: "x", mimeType: "text/plain", bytes: bytes.length, method: "single", downloadsAllowed: true }));
    const upload = await media.createUpload(a, lesson.id, { title: "fixture.txt", mimeType: "text/plain", bytes: bytes.length, method: "single", downloadsAllowed: false });
    assert.ok(uploadedKey.startsWith("pilot/"));
    assert.equal(upload.asset.scanState, "pending");
    await media.complete(a, upload.sessionId, {});
    await assert.rejects(media.access(s, upload.asset.id, "preview"));
    await assert.rejects(media.publish(a, upload.asset.id));
    assert.equal((await media.list(s, lesson.id, false)).items.length, 0);
    const persisted = await db.mediaAsset.findUniqueOrThrow({ where: { id: upload.asset.id } });
    objects.set(uploadedKey, Buffer.from("tampered staging after completion"));
    assert.deepEqual(objects.get(persisted.objectKey), bytes, "committed source unaffected by browser staging replay");
    await media.scan(a, upload.asset.id);
    await assert.rejects(media.access(s, upload.asset.id, "preview"), "clean but unpublished remains unavailable");
    await media.publish(a, upload.asset.id);
    const access = await media.access(s, upload.asset.id, "preview");
    assert.equal(access.expiresIn, 120);
    assert.equal((await media.access(s, upload.asset.id, "preview")).expiresIn, 120, "renewal rereads DB");
    await assert.rejects(media.access(s, upload.asset.id, "download"), "view-only policy enforced");
    await assert.rejects(media.access(other, upload.asset.id, "preview"));
    const reads = issuedReads;
    await db.enrollment.update({ where: { id: enrollment.id }, data: { status: "revoked" } });
    await assert.rejects(media.access(s, upload.asset.id, "preview"));
    assert.equal(issuedReads, reads);
    await db.enrollment.update({ where: { id: enrollment.id }, data: {
      status: "active", enrolledAt: new Date(Date.now() - 60000), expiresAt: new Date(Date.now() - 1000),
    } });
    await assert.rejects(media.access(s, upload.asset.id, "preview"));
    await db.enrollment.update({ where: { id: enrollment.id }, data: { expiresAt: null } });
    await db.user.update({ where: { id: student.id }, data: { status: "suspended" } });
    await assert.rejects(media.access(s, upload.asset.id, "preview"));
    await db.user.update({ where: { id: student.id }, data: { status: "active" } });
    await db.lesson.update({ where: { id: lesson.id }, data: { status: "draft" } });
    await assert.rejects(media.access(s, upload.asset.id, "preview"));
    assert.deepEqual(await db.lessonCompletion.findUniqueOrThrow({ where: { id: completion.id } }), completion);
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: course.id } })).editRevision, 0);
    const actions = (await db.auditLog.findMany()).map(log => log.action);
    for (const action of ["media.upload_issued", "media.quarantined", "media.scan_started", "media.scan_clean", "media.published", "media.access_issued"]) assert.ok(actions.includes(action));
    assert.equal((await db.auditLog.findMany()).some(log => /https:|staging\.txt|source\.txt/.test(JSON.stringify(log.metadata))), false);
  } finally {
    await db.$disconnect();
    if (created) await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
});

test("real scanner never returns clean when signatures/tool are unavailable", async () => {
  // Deterministically point to a nonexistent signature directory, without saving
  // environment changes or fabricating a clean result.
  const old = process.env.CLAMAV_DATABASE_DIR;
  process.env.CLAMAV_DATABASE_DIR = `/tmp/no-signatures-${randomUUID()}`;
  try { await assert.rejects(new ClamAvScanner().scan(Buffer.from("synthetic")), { message: "MEDIA_SCANNER_UNAVAILABLE" }); }
  finally { if (old === undefined) delete process.env.CLAMAV_DATABASE_DIR; else process.env.CLAMAV_DATABASE_DIR = old; }
});
