import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { libraryFixture } from "./media-library.fixture.js";
import { MediaProcessingService } from "../src/modules/media/processing.service.js";
import { ProcessingJobsStore } from "../src/modules/media/processing-jobs.store.js";
import { MediaProcessingWorker } from "../src/modules/media/processing-worker.js";
import { MediaRenditionService } from "../src/modules/media/rendition.service.js";
import { ProcessingError, type ProcessingStorage, type ProcessingScanner, type ProcessingVideo } from "../src/modules/media/processing.ports.js";
class FixtureStorage implements ProcessingStorage {
  objects = new Map<string, { bytes: Buffer; mime: string }>();
  async upload() { return "https://synthetic.invalid/upload"; }
  async initiate() { return "synthetic"; }
  async part() { return "https://synthetic.invalid/part"; }
  async complete() {}
  async head(key: string) {
    const value = this.objects.get(key); if (!value) throw new ProcessingError("MEDIA_STORAGE_UNAVAILABLE");
    return { bytes: value.bytes.length, mime: value.mime, etag: `"${createHash("sha256").update(value.bytes).digest("hex")}"` };
  }
  async commit(staging: string, source: string) { this.objects.set(source, this.objects.get(staging)!); }
  async stream(key: string, etag: string) {
    if ((await this.head(key)).etag !== etag) throw new ProcessingError("MEDIA_STORAGE_UNAVAILABLE");
    return Readable.from([this.objects.get(key)!.bytes]);
  }
  async sourceAccess() { throw new Error("NO_VIDEO_CALL_ALLOWED"); return ""; }
}
test("general private renditions preserve authorization, lifecycle, publication and learning history", async t => {
  const f = await libraryFixture();
  const storage = new FixtureStorage();
  // Explicit scanner double for orchestration; the unchanged genuine ClamAV
  // clean/EICAR acceptance test separately exercises the real scanner.
  const scanner: ProcessingScanner = { scanFile: async () => ({ clean: true, engine: "synthetic scanner double" }) };
  const video: ProcessingVideo = { ingest: async () => { throw new Error("NO_VIDEO_CALL_ALLOWED"); },
    inspect: async () => { throw new Error("NO_VIDEO_CALL_ALLOWED"); } };
  const uploads = new MediaProcessingService(f.store, storage);
  const worker = new MediaProcessingWorker(new ProcessingJobsStore(f.store), storage, scanner, video);
  const access = new MediaRenditionService(f.store, storage);
  const original = JSON.stringify({ course: await f.db.course.findMany(), chapters: await f.db.chapter.findMany(),
    lessons: await f.db.lesson.findMany(), enrollment: await f.db.enrollment.findMany(), completion: await f.db.lessonCompletion.findMany() });
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  async function prepare(body: Buffer, mimeType: string, filename: string, kind: "document" | "image" = "document") {
    const asset = await f.service.createAsset(f.args, { expectedMediaRevision: await f.revision(), title: "Synthetic native resource",
      kind, filename, mimeType, bytes: body.length, downloadsAllowed: false, collectionId: null });
    const revisionId = asset.revision!.id;
    await uploads.upload({ ...f.args, revisionId }, { method: "single" });
    const upload = await f.db.mediaProcessingUpload.findUniqueOrThrow({ where: { revisionId } });
    storage.objects.set(upload.stagingKey, { bytes: body, mime: mimeType });
    await uploads.complete({ ...f.args, revisionId }, {});
    await worker.runOne();
    return { ...asset, revisionId, upload,
      admin: { ...f.args, placementId: asset.placement!.id, admin: true },
      student: { ...f.studentArgs, placementId: asset.placement!.id, admin: false } };
  }
  async function publish(r: Awaited<ReturnType<typeof prepare>>) {
    await f.service.activate(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), revisionId: r.revisionId });
    await f.service.assetLifecycle(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), action: "publish" });
    await f.service.placementLifecycle(f.args, r.placement!.id, { expectedMediaRevision: await f.revision(), action: "publish" });
  }
  const read = async (args: Parameters<typeof access.content>[0], token: string) => {
    const result = await access.content(args, token, new AbortController().signal);
    const chunks: Buffer[] = []; for await (const c of result.stream) chunks.push(c);
    return { ...result, bytesRead: Buffer.concat(chunks) };
  };
  try {
    const r = await prepare(pdfBytes, "application/pdf", "synthetic.pdf");
    await t.test("scanned native PDF creates immutable exact-revision rendition and page count", async () => {
      const revision = await f.db.mediaRevision.findUniqueOrThrow({ where: { id: r.revisionId }, include: { renditions: true } });
      assert.equal(revision.state, "ready"); assert.equal(revision.scanState, "clean");
      assert.equal(revision.pageCount, 2); assert.equal(revision.safePreview, true);
      assert.equal(revision.renditions.length, 1); assert.equal(revision.renditions[0].kind, "pdf");
      assert.equal(revision.renditions[0].revisionId, revision.id);
      await assert.rejects(f.db.mediaRendition.update({ where: { id: revision.renditions[0].id }, data: { contentType: "text/html" } }));
    });
    await t.test("Admin may inspect clean ready draft/staged PDF with MFA; Student cannot", async () => {
      const grant = await access.issue(r.admin, { mode: "preview", revisionId: r.revisionId });
      assert.equal(grant.pageCount, 2); assert.equal(grant.contentType, "application/pdf");
      assert.ok((await read(r.admin, grant.capability)).bytesRead.equals(pdfBytes));
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      await assert.rejects(access.issue({ ...r.admin, req: f.actor(f.admin, ["admin"], false) }, { mode: "preview", revisionId: r.revisionId }));
      await assert.rejects(access.issue({ ...r.admin, req: f.s }, { mode: "preview" }));
      await assert.rejects(access.issue(r.admin, { mode: "download", revisionId: r.revisionId }));
    });
    await publish(r);
    await t.test("published exact revision issues 120-second actor-bound header capability, never an S3 URL", async () => {
      const before = Date.now(); const grant = await access.issue(r.student, { mode: "preview" });
      assert.equal(grant.revisionId, r.revisionId);
      assert.ok(Date.parse(grant.expiresAt) >= before + 119000 && Date.parse(grant.expiresAt) <= Date.now() + 120000);
      assert.ok(grant.url.startsWith("/lms-api/")); assert.ok(!/https:|s3|pilot\/|source|[?#]/.test(grant.url));
      assert.ok(!grant.capability.includes(f.student.id));
      const body = await read(r.student, grant.capability);
      assert.equal(body.disposition, "inline"); assert.ok(body.bytesRead.equals(pdfBytes));
      await assert.rejects(read({ ...r.student, req: f.a }, grant.capability));
      await assert.rejects(read(r.admin, grant.capability));
      await assert.rejects(read(r.student, grant.capability.slice(0, -2) + "zz"));
    });
    await t.test("view-only original download is denied; explicit Admin policy allows attachment only", async () => {
      await assert.rejects(access.issue(r.student, { mode: "download" }));
      await f.service.updateAsset(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), downloadsAllowed: true });
      const grant = await access.issue(r.student, { mode: "download" });
      const result = await read(r.student, grant.capability);
      assert.equal(result.contentType, "application/octet-stream"); assert.match(result.disposition, /^attachment/);
      assert.ok(result.bytesRead.equals(pdfBytes));
      await f.service.updateAsset(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), downloadsAllowed: false });
      await assert.rejects(read(r.student, grant.capability));
    });
    await t.test("expired capability denies bytes; fresh reauthorized renewal works", async () => {
      const grant = await access.issue(r.student, { mode: "preview" });
      const originalClock = access.now; access.now = () => Date.parse(grant.expiresAt) + 1;
      await assert.rejects(read(r.student, grant.capability)); access.now = originalClock;
      const renewed = await access.issue(r.student, { mode: "preview" });
      assert.notEqual(renewed.capability, grant.capability);
      assert.ok((await read(r.student, renewed.capability)).bytesRead.equals(pdfBytes));
    });
    await t.test("revoked/expired enrollment denies fresh access and previously issued stream grants", async () => {
      const grant = await access.issue(r.student, { mode: "preview" });
      await f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { status: "revoked" } });
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      await assert.rejects(read(r.student, grant.capability));
      await f.db.enrollment.update({ where: { id: f.enrollment.id },
        data: { status: "active", expiresAt: new Date(f.enrollment.enrolledAt.getTime() + 1) } });
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      await f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { expiresAt: new Date(Date.now() + 30000) } });
      const short = await access.issue(r.student, { mode: "preview" });
      assert.ok(Date.parse(short.expiresAt) <= Date.now() + 30000);
      await f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { expiresAt: null } });
    });
    await t.test("inactive local accounts and cross-course/parent guesses cannot issue or redeem", async () => {
      await f.db.user.update({ where: { id: f.student.id }, data: { status: "suspended" } });
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      await f.db.user.update({ where: { id: f.student.id }, data: { status: "active" } });
      await assert.rejects(access.issue({ ...r.student, parentId: randomUUID() }, { mode: "preview" }));
      await assert.rejects(access.issue({ ...r.student, scope: "courses", parentId: f.course.id }, { mode: "preview" }));
      const other = await f.db.course.create({ data: { title: "Other synthetic", slug: randomUUID(), status: "published", createdBy: f.admin.id } });
      await assert.rejects(access.issue({ ...r.admin, scope: "courses", parentId: other.id }, { mode: "preview" }));
      await f.db.course.delete({ where: { id: other.id } });
    });
    await t.test("unpublished and archived resources, placements, collections and parents deny fresh access", async () => {
      for (const [table, id] of [[f.db.contentMediaAsset, r.asset!.id], [f.db.mediaPlacement, r.placement!.id],
        [f.db.chapter, f.chapter.id], [f.db.lesson, f.lesson.id], [f.db.course, f.course.id]] as const) {
        for (const status of ["draft", "archived"]) {
          await (table as any).update({ where: { id }, data: { status } });
          await assert.rejects(access.issue(r.student, { mode: "preview" }));
          if (status === "archived") await assert.rejects(access.issue(r.admin, { mode: "preview" }));
        }
        await (table as any).update({ where: { id }, data: { status: "published" } });
      }
      const c = await f.service.createCollection(f.args, { expectedMediaRevision: await f.revision(), title: "Synthetic collection", description: "" });
      await f.service.move(f.args, r.placement!.id, { expectedMediaRevision: await f.revision(), collectionId: c.collection!.id });
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      await f.service.collectionLifecycle(f.args, c.collection!.id, { expectedMediaRevision: await f.revision(), action: "publish" });
      assert.ok((await access.issue(r.student, { mode: "preview" })).capability);
      await f.db.mediaCollection.update({ where: { id: c.collection!.id }, data: { status: "archived" } });
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      await assert.rejects(access.issue(r.admin, { mode: "preview" }));
      await f.db.mediaCollection.update({ where: { id: c.collection!.id }, data: { status: "published" } });
      await f.service.move(f.args, r.placement!.id, { expectedMediaRevision: await f.revision(), collectionId: null });
    });
    await t.test("all approved native image formats and escaped plaintext integrate into general placements", async () => {
      for (const format of ["jpeg", "png", "webp"] as const) {
        const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).toFormat(format).toBuffer();
        const image = await prepare(bytes, `image/${format}`, `image.${format}`, "image"); await publish(image);
        const grant = await access.issue(image.student, { mode: "preview" });
        assert.equal(grant.contentType, `image/${format}`);
        assert.ok((await read(image.student, grant.capability)).bytesRead.equals(bytes));
      }
      const text = Buffer.from("<script>never interpreted</script>\nنص");
      const plain = await prepare(text, "text/plain", "escaped.txt"); await publish(plain);
      const grant = await access.issue(plain.student, { mode: "preview" });
      assert.equal(grant.contentType, "text/plain; charset=utf-8");
      assert.ok((await read(plain.student, grant.capability)).bytesRead.equals(text));
      const list = await f.service.list(f.studentArgs, false);
      assert.equal(list.items.length, 5);
      assert.ok(list.items.every((item, i) => i === 0 || item.placement.position > list.items[i - 1].placement.position));
      assert.ok(!/pilot\/|sourceEtag|objectKey|previewKey|locator|capability/.test(JSON.stringify(list)));
    });
    await t.test("failed replacement preserves old publication; activation invalidates old revision grants", async () => {
      const grant = await access.issue(r.student, { mode: "preview" });
      const bad = Buffer.from("%PDF-1.7\nmalformed replacement\n%%EOF");
      const stage = await f.service.stage(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(),
        filename: "failed.pdf", mimeType: "application/pdf", bytes: bad.length });
      const revisionId = stage.revision!.id;
      await uploads.upload({ ...f.args, revisionId }, { method: "single" });
      const u = await f.db.mediaProcessingUpload.findUniqueOrThrow({ where: { revisionId } });
      storage.objects.set(u.stagingKey, { bytes: bad, mime: "application/pdf" });
      await uploads.complete({ ...f.args, revisionId }, {}); await worker.runOne();
      await assert.rejects(f.service.activate(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), revisionId }));
      assert.ok((await read(r.student, grant.capability)).bytesRead.equals(pdfBytes));
      await assert.rejects(access.issue(r.admin, { mode: "preview", revisionId }));
      const replacement = await f.service.stage(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(),
        filename: "replacement.pdf", mimeType: "application/pdf", bytes: pdfBytes.length });
      const next = replacement.revision!.id;
      await uploads.upload({ ...f.args, revisionId: next }, { method: "single" });
      const upload = await f.db.mediaProcessingUpload.findUniqueOrThrow({ where: { revisionId: next } });
      storage.objects.set(upload.stagingKey, { bytes: pdfBytes, mime: "application/pdf" });
      await uploads.complete({ ...f.args, revisionId: next }, {}); await worker.runOne();
      await assert.rejects(access.issue(r.student, { mode: "preview", revisionId: next }));
      assert.equal((await access.issue(r.admin, { mode: "preview", revisionId: next })).revisionId, next);
      await f.service.activate(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), revisionId: next });
      await assert.rejects(read(r.student, grant.capability));
      assert.equal((await access.issue(r.student, { mode: "preview" })).revisionId, next);
    });
    await t.test("byte streams are pinned to the verified committed object, never a changed source", async () => {
      const grant = await access.issue(r.student, { mode: "preview" });
      const revision = await f.db.mediaRevision.findUniqueOrThrow({ where: { id: grant.revisionId } });
      const value = storage.objects.get(revision.objectKey!)!;
      storage.objects.set(revision.objectKey!, { ...value, bytes: Buffer.from("modified") });
      await assert.rejects(read(r.student, grant.capability));
      storage.objects.set(revision.objectKey!, value);
    });
    await t.test("audit failure rolls back issuance, and audit metadata never contains access credentials", async () => {
      const audit = f.store.audit.bind(f.store);
      f.store.audit = async () => { throw new Error("synthetic audit unavailable"); };
      await assert.rejects(access.issue(r.student, { mode: "preview" }));
      f.store.audit = audit;
      assert.ok(!/capability|https:|pilot\/|objectKey|locator|sourceEtag/.test(JSON.stringify((await f.db.auditLog.findMany()).map(v => v.metadata))));
    });
    await t.test("lesson completion, curriculum revision, progress inputs and enrollment history remain unchanged", async () => {
      // Restore only deliberate authorization-test mutations' automatic timestamps
      // before comparing the durable learning fields; media never writes them.
      const before = JSON.parse(original);
      const current = { course: await f.db.course.findMany(), chapters: await f.db.chapter.findMany(),
        lessons: await f.db.lesson.findMany(), enrollment: await f.db.enrollment.findMany(), completion: await f.db.lessonCompletion.findMany() };
      for (const key of ["course", "chapters", "lessons", "enrollment"] as const) {
        const expected = before[key].map(({ updatedAt: _a, ...v }: any) => v);
        const actual = JSON.parse(JSON.stringify(current[key])).map(({ updatedAt: _a, ...v }: any) => v);
        assert.deepEqual(actual, expected);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(current.completion)), before.completion);
    });
  } finally { await f.close(); }
});
