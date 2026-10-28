import { mediaObjectRoot } from "@workspace/saudisensei-runtime-config";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { libraryContext, editable } from "./library.context.js";
import type { Scope } from "./library.schemas.js";
import { PROCESSING_STORAGE, type ProcessingStorage } from "./processing.ports.js";
export const uploadRequest = z.object({ method: z.enum(["single", "multipart"]) }).strict();
export const partRequest = z.object({ partNumber: z.number().int().min(1).max(256) }).strict();
export const completeRequest = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(256),
    etag: z.string().regex(/^"[a-fA-F0-9-]{1,80}"$/) }).strict()).min(1).max(256).optional(),
}).strict();
export const PART_SIZE = 8 * 1024 * 1024;
type Args = { req: AuthenticatedRequest; scope: Scope; parentId: string; revisionId: string };
const unavailable = () => new NotFoundException("MEDIA_PROCESSING_UNAVAILABLE");
const safeJob = (j: { state: string; stage: string; attempts: number; failures: number; errorCode: string | null } | null) =>
  j ? { state: j.state, stage: j.stage, attempts: j.attempts, failures: j.failures, errorCode: j.errorCode } : null;
@Injectable()
export class MediaProcessingService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(PROCESSING_STORAGE) private readonly storage: ProcessingStorage) {}
  private async context(tx: Tx, args: Args, mutate = true) {
    const ctx = await libraryContext(this.store, tx, args.req, args.scope, args.parentId, true, mutate);
    const revision = await tx.mediaRevision.findFirst({ where: { id: args.revisionId, courseId: ctx.courseId }, include: { asset: true } });
    if (!revision) throw unavailable();
    const placement = await tx.mediaPlacement.findFirst({ where: {
      assetId: revision.assetId, courseId: ctx.courseId, parentType: ctx.parentType, parentId: ctx.parentId,
    }, include: { collection: true } });
    if (!placement) throw unavailable();
    if (mutate) {
      editable(revision.asset.status); editable(placement.status);
      if (placement.collection) editable(placement.collection.status);
      if (revision.asset.stagedRevisionId !== revision.id || revision.state === "ready" ||
          revision.state === "rejected") throw new ConflictException("MEDIA_REVISION_NOT_PROCESSABLE");
    }
    return revision;
  }
  private async session(tx: Tx, args: Args) {
    const revision = await this.context(tx, args);
    const upload = await tx.mediaProcessingUpload.findUnique({ where: { revisionId: revision.id } });
    if (!upload || upload.uploaderId !== args.req.user.id) throw unavailable();
    if (upload.state !== "completed" && upload.expiresAt <= new Date()) throw new ConflictException("MEDIA_UPLOAD_EXPIRED");
    return { revision, upload };
  }
  async status(args: Args) {
    return this.store.transaction(async tx => {
      const revision = await this.context(tx, args, false);
      const job = await tx.mediaJob.findUnique({ where: { revisionId: revision.id } });
      return { revisionState: revision.state, scanState: revision.scanState, job: safeJob(job) };
    });
  }
  async upload(args: Args, input: z.infer<typeof uploadRequest>) {
    return this.store.transaction(async tx => {
      const revision = await this.context(tx, args);
      if (revision.state !== "pending") throw new ConflictException("MEDIA_UPLOAD_NOT_PENDING");
      let upload = await tx.mediaProcessingUpload.findUnique({ where: { revisionId: revision.id } });
      if (upload && (upload.method !== input.method || upload.uploaderId !== args.req.user.id)) throw unavailable();
      if (upload && (upload.state !== "issued" || upload.expiresAt <= new Date())) throw new ConflictException("MEDIA_UPLOAD_EXPIRED");
      const bytes = Number(revision.bytes);
      if (input.method === "single" && bytes > PART_SIZE) throw new BadRequestException("MULTIPART_REQUIRED");
      if (!upload) {
        const prefix = `${mediaObjectRoot()}/library/${revision.courseId}/${revision.id}`;
        upload = await tx.mediaProcessingUpload.create({ data: {
          revisionId: revision.id, uploaderId: args.req.user.id, stagingKey: `${prefix}/staging`, sourceKey: `${prefix}/source`,
          method: input.method, expiresAt: new Date(Date.now() + 86400000),
        } });
        await this.store.audit(tx, args.req, "media_processing.upload_created", "media_revision", revision.id, { method: input.method });
      }
      if (input.method === "multipart" && !upload.uploadRef) {
        const ref = await this.storage.initiate(upload.stagingKey, revision.mimeType);
        upload = await tx.mediaProcessingUpload.update({ where: { id: upload.id }, data: { uploadRef: ref } });
      }
      const uploadUrl = input.method === "single"
        ? await this.storage.upload(upload.stagingKey, bytes, revision.mimeType) : null;
      return { method: input.method, uploadUrl, partSize: PART_SIZE,
        headers: input.method === "single" ? { "Content-Type": revision.mimeType, "x-amz-server-side-encryption": "AES256" } : {},
        expiresAt: new Date(Date.now() + 120000).toISOString() };
    });
  }
  async part(args: Args, input: z.infer<typeof partRequest>) {
    return this.store.transaction(async tx => {
      const { revision, upload } = await this.session(tx, args);
      if (upload.method !== "multipart" || !upload.uploadRef || upload.state !== "issued") throw unavailable();
      const size = Math.min(PART_SIZE, Number(revision.bytes) - (input.partNumber - 1) * PART_SIZE);
      if (size <= 0) throw new BadRequestException("INVALID_PART_NUMBER");
      return { uploadUrl: await this.storage.part(upload.stagingKey, upload.uploadRef, input.partNumber, size),
        bytes: size, expiresAt: new Date(Date.now() + 120000).toISOString() };
    });
  }
  async complete(args: Args, input: z.infer<typeof completeRequest>) {
    const prior = await this.store.transaction(async tx => {
      await this.context(tx, args, false);
      const upload = await tx.mediaProcessingUpload.findUnique({ where: { revisionId: args.revisionId } });
      if (!upload || upload.uploaderId !== args.req.user.id) throw unavailable();
      return upload.state === "completed" ? tx.mediaJob.findUnique({ where: { revisionId: args.revisionId } }) : null;
    });
    if (prior) return { job: safeJob(prior) };
    // Freeze an exact staging ETag before copying. Browser capabilities can only
    // write staging; all retries must copy the same verified staging version.
    const pinned = await this.store.transaction(async tx => {
      const { revision, upload } = await this.session(tx, args);
      if (upload.state === "completed") return { revision, upload };
      if (upload.state === "issued" && upload.method === "multipart") {
        if (!input.parts || !upload.uploadRef || input.parts.length !== Math.ceil(Number(revision.bytes) / PART_SIZE) ||
            input.parts.some((p, i) => p.partNumber !== i + 1)) throw new BadRequestException("INVALID_PARTS");
        // If completion succeeded but its response was interrupted, a verified
        // staging HEAD lets this idempotent request continue without re-completing.
        let present = false;
        try { const h = await this.storage.head(upload.stagingKey); present = h.bytes === Number(revision.bytes) && h.mime === revision.mimeType; } catch {}
        if (!present) await this.storage.complete(upload.stagingKey, upload.uploadRef, Number(revision.bytes), input.parts);
      } else if (upload.method === "single" && input.parts) throw new BadRequestException("INVALID_PARTS");
      const head = await this.storage.head(upload.stagingKey);
      if (head.bytes !== Number(revision.bytes) || head.mime !== revision.mimeType) throw new ConflictException("SOURCE_INVALID");
      if (upload.sourceEtag && head.etag !== upload.sourceEtag) throw new ConflictException("SOURCE_CHANGED");
      return { revision, upload: await tx.mediaProcessingUpload.update({ where: { id: upload.id }, data: { state: "committing", sourceEtag: head.etag } }) };
    });
    if (pinned.upload.state !== "completed") {
      await this.storage.commit(pinned.upload.stagingKey, pinned.upload.sourceKey, pinned.upload.sourceEtag!, pinned.revision.mimeType);
    }
    const head = await this.storage.head(pinned.upload.sourceKey);
    if (head.bytes !== Number(pinned.revision.bytes) || head.mime !== pinned.revision.mimeType) throw new ConflictException("SOURCE_INVALID");
    return this.store.transaction(async tx => {
      const { revision, upload } = await this.session(tx, args);
      const job = await tx.mediaJob.upsert({ where: { revisionId: revision.id }, update: {}, create: { revisionId: revision.id } });
      if (upload.state !== "completed") {
        await tx.mediaProcessingUpload.update({ where: { id: upload.id }, data: { state: "completed", sourceEtag: head.etag } });
        await tx.mediaRevision.update({ where: { id: revision.id }, data: { state: "quarantined" } });
        await this.store.audit(tx, args.req, "media_processing.queued", "media_revision", revision.id);
      }
      return { job: safeJob(job) };
    });
  }
}
