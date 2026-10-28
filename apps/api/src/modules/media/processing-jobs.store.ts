import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@workspace/saudisensei-database";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { ProcessingError } from "./processing.ports.js";
export type Lease = Prisma.MediaJobGetPayload<object> & { leaseToken: string };
export type ProcessingResult = {
  state?: "quarantined" | "processing" | "ready";
  scanState?: "clean"; sha256?: string; scanEngine?: string; scannedAt?: Date;
  objectKey?: string; previewKey?: string; providerRef?: string; privateReady?: boolean; safePreview?: boolean; duration?: number; pageCount?: number;
};
@Injectable()
export class ProcessingJobsStore {
  constructor(@Inject(LmsStore) readonly store: LmsStore) {}
  async claim(): Promise<Lease | null> {
    return this.store.transaction(async tx => {
      const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM media_jobs WHERE
          (state IN ('queued','retryable') AND available_at<=now()) OR
          (state='running' AND lease_until<now())
        ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!candidates[0]) return null;
      const job = await tx.mediaJob.findUniqueOrThrow({ where: { id: candidates[0].id } });
      if (job.state === "running") {
        await tx.mediaProcessingAttempt.updateMany({ where: { jobId: job.id, state: "running" },
          data: { state: "interrupted", errorCode: "WORKER_INTERRUPTED", finishedAt: new Date() } });
      }
      const leaseToken = randomUUID();
      const updated = await tx.mediaJob.update({ where: { id: job.id }, data: {
        state: "running", leaseToken, leaseUntil: new Date(Date.now() + 45000), attempts: { increment: 1 },
      } });
      await tx.mediaProcessingAttempt.create({ data: { jobId: job.id, number: updated.attempts } });
      return { ...updated, leaseToken };
    });
  }
  async heartbeat(job: Lease) {
    const r = await this.store.db.mediaJob.updateMany({ where: {
      id: job.id, state: "running", leaseToken: job.leaseToken, leaseUntil: { gt: new Date() },
    }, data: { leaseUntil: new Date(Date.now() + 45000) } });
    if (r.count !== 1) throw new ProcessingError("LEASE_LOST", false);
  }
  private async locked(tx: Tx, job: Lease) {
    await tx.$queryRaw`SELECT id FROM media_jobs WHERE id=${job.id}::uuid FOR UPDATE`;
    const current = await tx.mediaJob.findUniqueOrThrow({ where: { id: job.id } });
    if (current.state !== "running" || current.leaseToken !== job.leaseToken ||
        !current.leaseUntil || current.leaseUntil <= new Date()) throw new ProcessingError("LEASE_LOST", false);
    return current;
  }
  async assertLease(job: Lease) { await this.heartbeat(job); }
  async stage(job: Lease, stage: string, evidence: ProcessingResult = {}, providerRef?: string) {
    return this.store.transaction(async tx => {
      await this.locked(tx, job);
      if (Object.keys(evidence).length) await tx.mediaRevision.update({ where: { id: job.revisionId }, data: evidence });
      await tx.mediaJob.update({ where: { id: job.id }, data: { stage, ...(providerRef ? { providerRef } : {}) } });
    });
  }
  private async audit(tx: Tx, job: Lease, action: string, code?: string) {
    const revision = await tx.mediaRevision.findUniqueOrThrow({ where: { id: job.revisionId } });
    // Existing audit actor is the author who requested the processing, not a
    // fictitious system user. No private locator/provider output is audit metadata.
    await this.store.audit(tx, { user: { id: revision.createdBy } as any, requestId: job.id },
      action, "media_revision", job.revisionId, { stage: job.stage, ...(code ? { reason: code } : {}) });
  }
  async finish(job: Lease, result: ProcessingResult, rendition?: { kind: string; locator: string; contentType: string }) {
    return this.store.transaction(async tx => {
      const revision = await tx.mediaRevision.findUniqueOrThrow({ where: { id: job.revisionId } });
      await this.store.courseLock(tx, revision.courseId);
      await this.locked(tx, job);
      const asset = await tx.contentMediaAsset.findUniqueOrThrow({ where: { id: revision.assetId } });
      const placement = await tx.mediaPlacement.findUnique({ where: { assetId: asset.id }, include: { chapter: true, lesson: true, collection: true, course: true } });
      if (!placement || [asset.status, placement.status, placement.course.status, placement.chapter?.status,
        placement.lesson?.status, placement.collection?.status].some(s => s === "archived" || s === "removed")) throw new ProcessingError("PARENT_READ_ONLY", false);
      await tx.mediaRevision.update({ where: { id: job.revisionId }, data: { ...result, state: "ready" } });
      if (rendition) await tx.mediaRendition.create({ data: { revisionId: job.revisionId, ...rendition, verifiedAt: new Date() } });
      await tx.mediaJob.update({ where: { id: job.id }, data: { state: "succeeded", leaseToken: null, leaseUntil: null, errorCode: null } });
      await tx.mediaProcessingAttempt.update({ where: { jobId_number: { jobId: job.id, number: job.attempts } },
        data: { state: "succeeded", finishedAt: new Date() } });
      await this.audit(tx, job, "media_processing.ready");
      // Editorial pointers/publication and curriculum/completions are untouched.
    });
  }
  async wait(job: Lease) {
    return this.store.transaction(async tx => {
      const current = await this.locked(tx, job);
      if (current.polls >= 60) throw new ProcessingError("JOB_TIMEOUT", false);
      await tx.mediaJob.update({ where: { id: job.id }, data: { state: "queued", polls: { increment: 1 },
        availableAt: new Date(Date.now() + 15000), leaseToken: null, leaseUntil: null } });
      await tx.mediaProcessingAttempt.update({ where: { jobId_number: { jobId: job.id, number: job.attempts } },
        data: { state: "succeeded", finishedAt: new Date() } });
    });
  }
  async fail(job: Lease, error: ProcessingError) {
    if (error.code === "LEASE_LOST") return;
    return this.store.transaction(async tx => {
      const current = await this.locked(tx, job);
      const terminal = !error.retryable || current.failures + 1 >= current.maxAttempts ||
        current.attempts >= 100 || current.stage === "ingest_requested";
      const code = current.stage === "ingest_requested" ? "INGEST_OUTCOME_UNKNOWN" : error.code;
      await tx.mediaJob.update({ where: { id: job.id }, data: {
        state: terminal ? "permanently_failed" : "retryable", failures: { increment: 1 }, errorCode: code,
        leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(current.failures, 6))),
      } });
      await tx.mediaProcessingAttempt.update({ where: { jobId_number: { jobId: job.id, number: job.attempts } },
        data: { state: "failed", errorCode: code, finishedAt: new Date() } });
      if (terminal) await tx.mediaRevision.update({ where: { id: job.revisionId }, data: {
        state: code === "MALWARE_REJECTED" ? "rejected" : "failed",
        ...(code === "MALWARE_REJECTED" ? { scanState: "rejected" } : {}),
      } });
      await this.audit(tx, job, terminal ? "media_processing.failed" : "media_processing.retry", code);
    });
  }
}
