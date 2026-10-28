import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProcessingJobsStore, type Lease } from "./processing-jobs.store.js";
import { PROCESSING_STORAGE, PROCESSING_SCANNER, PROCESSING_VIDEO, ProcessingError, safeProcessingError,
  OFFICE_PROCESSING_ERROR, type ProcessingScanner, type ProcessingStorage, type ProcessingVideo } from "./processing.ports.js";
import { spoolSource, validatePlaintext, verifyMagic } from "./processing-source.js";
import { inspectNativeDocument } from "./native-document.js";
@Injectable()
export class MediaProcessingWorker implements OnModuleDestroy {
  private busy = false;
  private active?: AbortController;
  private readonly logger = new Logger(MediaProcessingWorker.name);
  constructor(@Inject(ProcessingJobsStore) private readonly jobs: ProcessingJobsStore,
    @Inject(PROCESSING_STORAGE) private readonly storage: ProcessingStorage,
    @Inject(PROCESSING_SCANNER) private readonly scanner: ProcessingScanner,
    @Inject(PROCESSING_VIDEO) private readonly video: ProcessingVideo) {}
  onModuleDestroy() { this.active?.abort(); }
  async runOne() {
    if (this.busy) return false;
    this.busy = true;
    let job: Lease | null = null;
    let folder: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController(); this.active = controller;
    try {
      job = await this.jobs.claim();
      if (!job) return false;
      const leased = job;
      timeout = setTimeout(() => controller.abort(), 900000);
      heartbeat = setInterval(() => { this.jobs.heartbeat(leased).catch(() => controller.abort()); }, 10000);
      if (job.stage === "ingest_requested") throw new ProcessingError("INGEST_OUTCOME_UNKNOWN", false);
      if (job.attempts > 100) throw new ProcessingError("JOB_TIMEOUT", false);
      const revision = await this.jobs.store.db.mediaRevision.findUniqueOrThrow({ where: { id: job.revisionId }, include: { asset: true, processingUpload: true } });
      const upload = revision.processingUpload;
      if (!upload || upload.state !== "completed" || !upload.sourceEtag) throw new ProcessingError("SOURCE_INVALID", false);
      if (job.stage === "scan") {
        folder = await mkdtemp(join(tmpdir(), "saudisensei-media-job-"));
        const file = join(folder, "source");
        const stream = await this.storage.stream(upload.sourceKey, upload.sourceEtag, controller.signal);
        const evidence = await spoolSource(stream, file, Number(revision.bytes), controller.signal);
        verifyMagic(revision.mimeType, evidence.header);
        const scan = await this.scanner.scanFile(file, Number(revision.bytes), controller.signal);
        await this.jobs.assertLease(job);
        if (!scan.clean) throw new ProcessingError("MALWARE_REJECTED", false);
        const clean = { scanState: "clean" as const, ...{ sha256: evidence.sha256, scanEngine: scan.engine, scannedAt: new Date(), objectKey: upload.sourceKey } };
        if (revision.asset.kind === "video") {
          await this.jobs.stage(job, "ingest", { ...clean, state: "processing" });
          job.stage = "ingest";
        } else {
          if (revision.mimeType === "text/plain") {
            await validatePlaintext(file, controller.signal);
            await this.jobs.finish(job, { ...clean, privateReady: true, previewKey: upload.sourceKey, safePreview: true },
              { kind: "plaintext", locator: upload.sourceKey, contentType: "text/plain; charset=utf-8" });
            return true;
          }
          if (revision.mimeType === "application/pdf" || revision.mimeType.startsWith("image/")) {
            const native = await inspectNativeDocument(file, revision.mimeType, controller.signal);
            await this.jobs.finish(job, { ...clean, privateReady: true, previewKey: upload.sourceKey,
              safePreview: true, ...(native.pageCount ? { pageCount: native.pageCount } : {}) },
            { kind: native.kind, locator: upload.sourceKey, contentType: native.contentType });
            return true;
          }
          await this.jobs.stage(job, "document", { ...clean, state: "processing" });
          job.stage = "document";
        }
      }
      if (job.stage === "document") {
        // No Office process is launched. Download-only is not conversion or a
        // promise of safe previews; originals remain subject to explicit policy.
        const office = /officedocument|msword|ms-powerpoint|opendocument/.test(revision.mimeType);
        if (!revision.asset.downloadsAllowed) throw new ProcessingError(office ? OFFICE_PROCESSING_ERROR : "PREVIEW_PROCESSOR_REQUIRED", false);
        await this.jobs.finish(job, { privateReady: true });
        return true;
      }
      if (job.stage === "ingest") {
        const url = await this.storage.sourceAccess(upload.sourceKey);
        // Persist ambiguity marker before the non-idempotent external POST.
        // A crash/timeout here must NEVER blindly create another paid ingestion.
        await this.jobs.stage(job, "ingest_requested");
        job.stage = "ingest_requested";
        const ref = await this.video.ingest(url, revision.id, controller.signal);
        await this.jobs.stage(job, "verify", {}, ref);
        job.stage = "verify"; job.providerRef = ref;
      }
      if (job.stage === "verify") {
        if (!job.providerRef) throw new ProcessingError("VIDEO_PROVIDER_FAILED", false);
        const proof = await this.video.inspect(job.providerRef, controller.signal);
        if (proof.failed) throw new ProcessingError("VIDEO_PROVIDER_FAILED", false);
        if (!proof.privatePlayback || !proof.downloadsDisabled || !proof.originsMatch) throw new ProcessingError("VIDEO_NOT_PRIVATE", false);
        if (!proof.ready) { await this.jobs.wait(job); return true; }
        if (!Number.isFinite(proof.duration) || proof.duration <= 0 || proof.duration > 7200 || !proof.playbackHost) throw new ProcessingError("VIDEO_DURATION_INVALID", false);
        await this.jobs.finish(job, { providerRef: job.providerRef, privateReady: true, duration: Math.ceil(proof.duration) },
          { kind: "stream", locator: proof.playbackHost, contentType: "application/vnd.apple.mpegurl" });
        return true;
      }
      throw new ProcessingError("SOURCE_INVALID", false);
    } catch (error) {
      const safe = controller.signal.aborted ? new ProcessingError("JOB_TIMEOUT") : safeProcessingError(error);
      if (job) {
        try { await this.jobs.fail(job, safe); } catch { /* expired lease is fenced; its next owner recovers */ }
      }
      this.logger.warn(JSON.stringify({ event: "media_processing_unavailable", reason: safe.code }));
      return !!job;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (timeout) clearTimeout(timeout);
      if (folder) await rm(folder, { force: true, recursive: true }).catch(() => {});
      this.active = undefined; this.busy = false;
    }
  }
}
