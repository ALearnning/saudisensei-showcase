import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { libraryFixture } from "./media-library.fixture.js";
import { MediaProcessingService, PART_SIZE, uploadRequest, completeRequest } from "../src/modules/media/processing.service.js";
import { ProcessingJobsStore } from "../src/modules/media/processing-jobs.store.js";
import { MediaProcessingWorker } from "../src/modules/media/processing-worker.js";
import { ProcessingError, safeProcessingError, type ProcessingStorage, type ProcessingScanner, type ProcessingVideo } from "../src/modules/media/processing.ports.js";
import { ProcessingClamAvScanner, currentSignatures } from "../src/modules/media/processing-clamav.scanner.js";
import { processingKey } from "../src/modules/media/processing-s3.store.js";
import { spoolSource, verifyMagic } from "../src/modules/media/processing-source.js";

class MemoryStorage implements ProcessingStorage {
  objects = new Map<string, { body: Buffer; mime: string; etag: string }>();
  async upload() { return "https://synthetic.invalid/temporary-write"; }
  async initiate() { return "synthetic-multipart-ref"; }
  async part() { return "https://synthetic.invalid/temporary-part"; }
  async complete() {}
  async head(key: string) {
    const v = this.objects.get(key); if (!v) throw new ProcessingError("MEDIA_STORAGE_UNAVAILABLE");
    return { bytes: v.body.length, mime: v.mime, etag: v.etag };
  }
  async commit(staging: string, source: string, etag: string) {
    const v = this.objects.get(staging);
    if (!v || v.etag !== etag) throw new ProcessingError("MEDIA_STORAGE_UNAVAILABLE");
    this.objects.set(source, { ...v, body: Buffer.from(v.body) });
  }
  async stream(key: string) {
    const v = this.objects.get(key); if (!v) throw new ProcessingError("MEDIA_STORAGE_UNAVAILABLE");
    return Readable.from([v.body]);
  }
  async sourceAccess() { return "https://synthetic.invalid/temporary-private-source"; }
}
test("durable processing uses fenced leases, private evidence and unchanged learning rows", async t => {
  const f = await libraryFixture();
  const storage = new MemoryStorage(), api = new MediaProcessingService(f.store, storage), jobs = new ProcessingJobsStore(f.store);
  let scanCount = 0, ingestCount = 0;
  let scannerError: ProcessingError | undefined, malware = false, providerError = false, providerReady = true, privatePlayback = true;
  const scanner: ProcessingScanner = { scanFile: async () => {
    scanCount++; if (scannerError) throw scannerError;
    return { clean: !malware, engine: "synthetic processing scanner double" };
  } };
  const video: ProcessingVideo = {
    ingest: async () => { ingestCount++; if (providerError) throw new Error("RAW_PROVIDER_SECRET"); return "b".repeat(32); },
    inspect: async () => ({ ready: providerReady, failed: false, privatePlayback, downloadsDisabled: true,
      originsMatch: true, duration: 375, playbackHost: "customer-synthetic.cloudflarestream.com" }),
  };
  const worker = () => new MediaProcessingWorker(jobs, storage, scanner, video);
  const original = JSON.stringify({
    course: await f.db.course.findUnique({ where: { id: f.course.id } }),
    completion: await f.db.lessonCompletion.findMany(), enrollment: await f.db.enrollment.findMany(),
  });
  async function prepared(kind = "document", mime = "text/plain", filename = "synthetic.txt", downloadsAllowed = false) {
    const r = await f.service.createAsset(f.args, { expectedMediaRevision: await f.revision(), title: "Synthetic processing",
      kind: kind as "document", filename, mimeType: mime, bytes: 24, downloadsAllowed, collectionId: null });
    const args = { ...f.args, revisionId: r.revision!.id };
    await api.upload(args, { method: "single" });
    const u = await f.db.mediaProcessingUpload.findUniqueOrThrow({ where: { revisionId: args.revisionId } });
    const body = Buffer.alloc(24, "x"); if (kind === "video") body.write("ftyp", 4);
    storage.objects.set(u.stagingKey, { body, mime, etag: '"abcdef"' });
    await api.complete(args, {});
    return { ...r, args, upload: u };
  }
  try {
    await t.test("completion deduplicates jobs; unscanned revision cannot activate", async () => {
      const r = await prepared();
      await api.complete(r.args, {});
      assert.equal(await f.db.mediaJob.count({ where: { revisionId: r.args.revisionId } }), 1);
      await assert.rejects(f.service.activate(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), revisionId: r.args.revisionId }));
      await worker().runOne();
      const state = await api.status(r.args);
      assert.equal(state.job?.state, "succeeded");
      assert.equal(state.scanState, "clean"); assert.equal(state.revisionState, "ready");
      assert.equal((await api.complete(r.args, {})).job?.state, "succeeded");
      assert.equal((await f.db.contentMediaAsset.findUniqueOrThrow({ where: { id: r.asset!.id } })).currentRevisionId, null);
    });
    await t.test("concurrent claims have one owner and lease fencing survives interrupted recovery", async () => {
      const r = await prepared();
      const [a, b] = await Promise.all([jobs.claim(), jobs.claim()]);
      assert.equal(Number(!!a) + Number(!!b), 1);
      const old = a ?? b; assert.ok(old);
      await f.db.mediaJob.update({ where: { id: old.id }, data: { leaseUntil: new Date(0) } });
      await worker().runOne();
      await assert.rejects(jobs.finish(old, { privateReady: true }), (e: unknown) => e instanceof ProcessingError && e.code === "LEASE_LOST");
      assert.equal((await api.status(r.args)).job?.state, "succeeded");
      assert.equal(await f.db.mediaProcessingAttempt.count({ where: { jobId: old.id, state: "interrupted" } }), 1);
    });
    await t.test("unavailable and stale scanners fail closed with bounded retries", async () => {
      for (const code of ["SCANNER_UNAVAILABLE", "SCANNER_STALE", "SCANNER_TIMEOUT"]) {
        const r = await prepared(); scannerError = new ProcessingError(code);
        const j = await f.db.mediaJob.findUniqueOrThrow({ where: { revisionId: r.args.revisionId } });
        await f.db.mediaJob.update({ where: { id: j.id }, data: { maxAttempts: 1 } });
        await worker().runOne();
        const status = await api.status(r.args);
        assert.equal(status.job?.state, "permanently_failed");
        assert.notEqual(status.scanState, "clean"); assert.notEqual(status.revisionState, "ready");
      }
      scannerError = undefined;
    });
    await t.test("retryable failures delay and stop at the configured attempt bound", async () => {
      const r = await prepared(); scannerError = new ProcessingError("SCANNER_UNAVAILABLE");
      await worker().runOne();
      let j = await f.db.mediaJob.findUniqueOrThrow({ where: { revisionId: r.args.revisionId } });
      assert.equal(j.state, "retryable"); assert.ok(j.availableAt > new Date());
      assert.equal(await worker().runOne(), false);
      await f.db.mediaJob.update({ where: { id: j.id }, data: { availableAt: new Date(0), maxAttempts: 2 } });
      await worker().runOne(); scannerError = undefined;
      assert.equal((await api.status(r.args)).job?.state, "permanently_failed");
    });
    await t.test("malware rejection cannot become ready or published", async () => {
      const r = await prepared(); malware = true; await worker().runOne(); malware = false;
      const status = await api.status(r.args);
      assert.equal(status.scanState, "rejected"); assert.equal(status.revisionState, "rejected");
      await assert.rejects(f.service.activate(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), revisionId: r.args.revisionId }));
    });
    await t.test("provider ingestion failure is redacted and never blindly duplicated", async () => {
      const r = await prepared("video", "video/mp4", "synthetic.mp4");
      providerError = true; const before = ingestCount; await worker().runOne(); providerError = false;
      const status = await api.status(r.args);
      assert.equal(status.job?.errorCode, "INGEST_OUTCOME_UNKNOWN"); assert.equal(status.job?.state, "permanently_failed");
      await worker().runOne(); assert.equal(ingestCount, before + 1);
      assert.ok(!JSON.stringify(status).includes("RAW_PROVIDER_SECRET"));
    });
    await t.test("independent readiness polling recovers without rescanning or ingesting twice", async () => {
      const r = await prepared("video", "video/mp4", "synthetic.mp4");
      providerReady = false; const scans = scanCount, ingests = ingestCount; await worker().runOne();
      assert.equal((await api.status(r.args)).revisionState, "processing");
      const j = await f.db.mediaJob.findUniqueOrThrow({ where: { revisionId: r.args.revisionId } });
      assert.equal(j.stage, "verify"); providerReady = true;
      await f.db.mediaJob.update({ where: { id: j.id }, data: { availableAt: new Date(0) } });
      await worker().runOne();
      assert.equal((await api.status(r.args)).revisionState, "ready");
      assert.equal(scanCount, scans + 1); assert.equal(ingestCount, ingests + 1);
    });
    await t.test("provider readiness cannot override private playback policy", async () => {
      const r = await prepared("video", "video/mp4", "synthetic.mp4");
      privatePlayback = false; await worker().runOne(); privatePlayback = true;
      assert.equal((await api.status(r.args)).job?.errorCode, "VIDEO_NOT_PRIVATE");
      assert.notEqual((await api.status(r.args)).revisionState, "ready");
    });
    await t.test("processing failure leaves a published revision and completion history unchanged", async () => {
      const r = await f.create();
      await f.publish(r.asset!.id, r.revision!.id, r.placement!.id);
      const staged = await f.service.stage(f.args, r.asset!.id, { expectedMediaRevision: await f.revision(), filename: "replacement.txt", mimeType: "text/plain", bytes: 24 });
      const args = { ...f.args, revisionId: staged.revision!.id };
      await api.upload(args, { method: "single" });
      const u = await f.db.mediaProcessingUpload.findUniqueOrThrow({ where: { revisionId: args.revisionId } });
      storage.objects.set(u.stagingKey, { body: Buffer.alloc(24, "x"), mime: "text/plain", etag: '"abcdef"' });
      await api.complete(args, {}); malware = true; await worker().runOne(); malware = false;
      const a = await f.db.contentMediaAsset.findUniqueOrThrow({ where: { id: r.asset!.id } });
      assert.ok(a.currentRevisionId === r.revision!.id); assert.equal(a.status, "published");
      assert.equal((await f.service.list(f.studentArgs, false)).items.filter(i => i.asset.id === a.id).length, 1);
    });
    await t.test("readiness and audit commit atomically; raw failures never enter audits", async () => {
      const r = await prepared();
      const audit = f.store.audit.bind(f.store);
      f.store.audit = async (...args) => {
        if (args[2] === "media_processing.ready") throw new Error("SENSITIVE_RAW_FAILURE");
        return audit(...args);
      };
      await worker().runOne(); f.store.audit = audit;
      assert.notEqual((await api.status(r.args)).revisionState, "ready");
      const j = await f.db.mediaJob.findUniqueOrThrow({ where: { revisionId: r.args.revisionId } });
      await f.db.mediaJob.update({ where: { id: j.id }, data: { availableAt: new Date(0) } });
      await worker().runOne();
      assert.equal((await api.status(r.args)).revisionState, "ready");
      const logs = JSON.stringify((await f.db.auditLog.findMany()).map(l => l.metadata));
      assert.ok(!/SENSITIVE_RAW_FAILURE|RAW_PROVIDER_SECRET|https:|pilot\/library|providerRef|leaseToken/.test(logs));
    });
    await t.test("Student, missing MFA, inactive Admin, cross-parent and archived mutations are denied", async () => {
      const r = await prepared();
      for (const req of [f.s, f.actor(f.admin, ["admin"], false)]) {
        await assert.rejects(api.upload({ ...r.args, req }, { method: "single" }));
      }
      await f.db.user.update({ where: { id: f.admin.id }, data: { status: "suspended" } });
      await assert.rejects(api.status(r.args));
      await f.db.user.update({ where: { id: f.admin.id }, data: { status: "active" } });
      await assert.rejects(api.status({ ...r.args, scope: "courses", parentId: f.course.id }));
      await f.db.chapter.update({ where: { id: f.chapter.id }, data: { status: "archived" } });
      await worker().runOne();
      assert.notEqual((await api.status(r.args)).revisionState, "ready");
      await f.db.chapter.update({ where: { id: f.chapter.id }, data: { status: "published" } });
    });
    await t.test("Office conversion stays disabled rather than claiming an unverified safe preview", async () => {
      const r = await prepared("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "synthetic.docx");
      const v = storage.objects.get(r.upload.sourceKey)!; v.body.set([0x50, 0x4b, 0x03, 0x04]);
      await worker().runOne();
      assert.equal((await api.status(r.args)).job?.errorCode, "OFFICE_ISOLATION_REQUIRED");
      assert.notEqual((await api.status(r.args)).revisionState, "ready");
    });
    await t.test("large multipart part sizes are server-derived; clients cannot submit readiness", async () => {
      const r = await f.service.createAsset(f.args, { expectedMediaRevision: await f.revision(), title: "Large synthetic metadata only",
        kind: "video", filename: "large.mp4", mimeType: "video/mp4", bytes: PART_SIZE + 1234, downloadsAllowed: false, collectionId: null });
      const args = { ...f.args, revisionId: r.revision!.id };
      await assert.rejects(api.upload(args, { method: "single" }));
      await api.upload(args, { method: "multipart" });
      assert.equal((await api.part(args, { partNumber: 2 })).bytes, 1234);
      await assert.rejects(api.part(args, { partNumber: 3 }));
      assert.equal(uploadRequest.safeParse({ method: "single", scanState: "clean" }).success, false);
      assert.equal(completeRequest.safeParse({ ready: true }).success, false);
    });
    await t.test("curriculum, enrollment, completion rows and timestamps remain byte-for-byte unchanged", async () => {
      const after = JSON.stringify({
        course: await f.db.course.findUnique({ where: { id: f.course.id } }),
        completion: await f.db.lessonCompletion.findMany(), enrollment: await f.db.enrollment.findMany(),
      });
      assert.ok(original === after);
    });
  } finally { await f.close(); }
});
test("source streaming has exact bounds and rejects format spoofing without buffering full files", async () => {
  const folder = await mkdtemp(join(tmpdir(), "media-spool-test-"));
  try {
    await assert.rejects(spoolSource(Readable.from([Buffer.alloc(100)]), join(folder, "too-large"), 20, new AbortController().signal));
    await assert.rejects(spoolSource(Readable.from([Buffer.alloc(5)]), join(folder, "too-short"), 20, new AbortController().signal));
    assert.throws(() => verifyMagic("video/mp4", Buffer.from("not a video")));
    assert.throws(() => processingKey("outside/source"));
    assert.equal(safeProcessingError(new Error("secret bearer token")).message, "PROCESSING_UNAVAILABLE");
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("signature freshness validation never accepts absent, stale or implausibly future databases", () => {
  assert.throws(() => currentSignatures("ClamAV 1.4.3"));
  assert.throws(() => currentSignatures("ClamAV 1.4.3/1/2000-01-01"));
  assert.throws(() => currentSignatures(`ClamAV 1.4.3/1/${new Date(Date.now() + 86400000).toISOString()}`));
});
test("genuine path-based ClamAV accepts clean local text and rejects harmless EICAR", async () => {
  const folder = await mkdtemp(join(tmpdir(), "media-real-scan-"));
  const scanner = new ProcessingClamAvScanner();
  try {
    const clean = join(folder, "clean.txt"), infected = join(folder, "test-eicar.txt");
    await writeFile(clean, "Synthetic clean durable processing fixture.");
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    await writeFile(infected, eicar);
    assert.equal((await scanner.scanFile(clean, 43, new AbortController().signal)).clean, true);
    assert.equal((await scanner.scanFile(infected, eicar.length, new AbortController().signal)).clean, false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
