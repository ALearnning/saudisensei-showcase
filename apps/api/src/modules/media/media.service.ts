import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import { decodeJwt } from "jose";
import type { Prisma } from "@workspace/saudisensei-database";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { MEDIA_STORAGE, type MediaStorage } from "./s3-media.store.js";
import { MEDIA_SCANNER, type MediaScanner } from "./clamav.scanner.js";
import type { z } from "zod";
import { uploadInput, completeInput } from "./media.schemas.js";

const unavailable = () => new NotFoundException("MEDIA_UNAVAILABLE");
const now = () => Math.floor(Date.now() / 1000);
export function readCapabilityLifetime(expiresAt: Date | null, tokenExpiresAt: number, clock = now()): number {
  const expires = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : Number.MAX_SAFE_INTEGER;
  const seconds = Math.min(120, expires - clock, tokenExpiresAt - clock);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw unavailable();
  return seconds;
}
function safeAsset(asset: Prisma.MediaAssetGetPayload<{}>) {
  return { id: asset.id, title: asset.title, bytes: asset.bytes, status: asset.status,
    scanState: asset.scanState, downloadsAllowed: asset.downloadsAllowed, mimeType: asset.mimeType };
}
@Injectable()
export class MediaService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(MEDIA_SCANNER) private readonly scanner: MediaScanner) {}

  private async account(tx: Tx, req: AuthenticatedRequest, admin: boolean) {
    const user = await tx.user.findUnique({ where: { id: req.user.id }, include: { roles: { include: { role: true } } } });
    if (!user || user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
    const role = admin ? "admin" : "student";
    if (!user.roles.some(r => r.role.name === role) || (admin && !req.mfaVerified)) throw new ForbiddenException("MEDIA_FORBIDDEN");
  }
  private async lesson(tx: Tx, lessonId: string, req: AuthenticatedRequest, admin: boolean, allowArchived = false) {
    const initial = await tx.lesson.findUnique({ where: { id: lessonId } });
    if (!initial) throw unavailable();
    const course = await this.store.courseLock(tx, initial.courseId, !admin);
    await this.account(tx, req, admin);
    const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { chapter: true } });
    if (admin) {
      if (!allowArchived && [course.status, lesson.status, lesson.chapter.status].includes("archived")) throw new ConflictException("ARCHIVED_READ_ONLY");
      return { lesson, enrollment: null };
    }
    const enrollment = await tx.enrollment.findUnique({
      where: { userId_courseId: { userId: req.user.id, courseId: course.id } },
    });
    if (course.status !== "published" || lesson.status !== "published" ||
      lesson.chapter.status !== "published" || !lesson.body.trim() || !enrollment ||
      enrollment.status !== "active" || (enrollment.expiresAt && enrollment.expiresAt.getTime() <= Date.now())) throw unavailable();
    return { lesson, enrollment };
  }
  private async asset(tx: Tx, id: string, req: AuthenticatedRequest, admin: boolean) {
    const asset = await tx.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw unavailable();
    const context = await this.lesson(tx, asset.lessonId, req, admin);
    // Read again after the course lock: never authorize a stale pre-lock row.
    const fresh = await tx.mediaAsset.findUniqueOrThrow({ where: { id } });
    return { asset: fresh, ...context };
  }
  async list(req: AuthenticatedRequest, lessonId: string, admin: boolean) {
    return this.store.transaction(async tx => {
      await this.lesson(tx, lessonId, req, admin, true);
      const assets = await tx.mediaAsset.findMany({ where: {
        lessonId, ...(admin ? {} : { status: "published", scanState: "clean" }),
      }, orderBy: { createdAt: "asc" }, take: 100 });
      return { items: assets.map(safeAsset) };
    }, !admin);
  }
  async createUpload(req: AuthenticatedRequest, lessonId: string, input: z.infer<typeof uploadInput>) {
    return this.store.transaction(async tx => {
      const { lesson } = await this.lesson(tx, lessonId, req, true);
      const id = randomUUID(), revisionRef = randomUUID(), sessionId = randomUUID();
      const root = `pilot/media/${id}/${revisionRef}`;
      const stagingKey = `${root}/staging.txt`;
      const asset = await tx.mediaAsset.create({ data: {
        id, lessonId, courseId: lesson.courseId, revisionRef, title: input.title,
        bytes: input.bytes, mimeType: input.mimeType, downloadsAllowed: input.downloadsAllowed,
        objectKey: `${root}/source.txt`, createdBy: req.user.id,
      } });
      const providerUploadId = input.method === "multipart" ? await this.storage.initiate(stagingKey) : null;
      const expiresAt = new Date(Date.now() + 20 * 60000);
      const session = await tx.mediaUploadSession.create({ data: {
        id: sessionId, assetId: id, uploaderId: req.user.id, stagingKey,
        providerUploadId, method: input.method, expiresAt,
      } });
      const uploadUrl = input.method === "single" ? await this.storage.upload(stagingKey, input.bytes, 120) : undefined;
      await this.store.audit(tx, req, "media.upload_issued", "media_asset", id, { method: input.method, bytes: input.bytes });
      return { asset: safeAsset(asset), sessionId: session.id, method: input.method,
        uploadUrl, expiresAt: session.expiresAt.toISOString(), uploadUrlExpiresIn: 120 };
    });
  }
  private async session(tx: Tx, id: string, req: AuthenticatedRequest) {
    const session = await tx.mediaUploadSession.findUnique({ where: { id }, include: { asset: true } });
    if (!session) throw unavailable();
    await this.lesson(tx, session.asset.lessonId, req, true);
    const fresh = await tx.mediaUploadSession.findUniqueOrThrow({ where: { id }, include: { asset: true } });
    if (fresh.uploaderId !== req.user.id || fresh.state !== "issued" || fresh.expiresAt.getTime() <= Date.now()) throw unavailable();
    return fresh;
  }
  async part(req: AuthenticatedRequest, sessionId: string, partNumber: number) {
    return this.store.transaction(async tx => {
      const session = await this.session(tx, sessionId, req);
      if (session.method !== "multipart" || !session.providerUploadId) throw unavailable();
      const seconds = Math.min(120, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
      if (seconds <= 0) throw unavailable();
      const partBytes = partNumber === 1 ? Math.min(session.asset.bytes, 5 * 1024 * 1024) : session.asset.bytes - 5 * 1024 * 1024;
      if (partBytes <= 0) throw unavailable();
      const uploadUrl = await this.storage.part(session.stagingKey, session.providerUploadId, partNumber, partBytes, seconds);
      await this.store.audit(tx, req, "media.part_issued", "media_asset", session.assetId, { partNumber });
      return { uploadUrl, expiresIn: seconds, partNumber };
    });
  }
  async complete(req: AuthenticatedRequest, sessionId: string, input: z.infer<typeof completeInput>) {
    return this.store.transaction(async tx => {
      const session = await this.session(tx, sessionId, req);
      if (session.method === "multipart") {
        if (!session.providerUploadId || !input.parts?.length ||
          input.parts.some((part, index) => part.partNumber !== index + 1)) throw unavailable();
        await this.storage.complete(session.stagingKey, session.providerUploadId, input.parts);
      } else if (input.parts?.length) throw unavailable();
      const metadata = await this.storage.head(session.stagingKey);
      if (metadata.bytes !== session.asset.bytes) throw new ConflictException("MEDIA_SIZE_MISMATCH");
      await this.storage.commit(session.stagingKey, session.asset.objectKey, metadata.etag);
      const committed = await this.storage.head(session.asset.objectKey);
      if (committed.bytes !== session.asset.bytes) throw unavailable();
      await tx.mediaUploadSession.update({ where: { id: sessionId }, data: { state: "quarantined", completedAt: new Date() } });
      await this.store.audit(tx, req, "media.quarantined", "media_asset", session.assetId);
      return { asset: safeAsset(session.asset), state: "quarantined" };
    });
  }
  async scan(req: AuthenticatedRequest, assetId: string) {
    const asset = await this.store.transaction(async tx => {
      const { asset } = await this.asset(tx, assetId, req, true);
      const session = await tx.mediaUploadSession.findUnique({ where: { assetId } });
      if (session?.state !== "quarantined" || asset.status !== "draft" ||
        !["pending", "failed", "scanning"].includes(asset.scanState) ||
        (asset.scanState === "scanning" && asset.scannedAt && asset.scannedAt.getTime() > Date.now() - 120000)) throw unavailable();
      await tx.mediaAsset.update({ where: { id: assetId }, data: { scanState: "scanning", scannedAt: new Date() } });
      await this.store.audit(tx, req, "media.scan_started", "media_asset", assetId);
      return asset;
    });
    try {
      const bytes = await this.storage.read(asset.objectKey);
      if (bytes.length !== asset.bytes) throw unavailable();
      const outcome = await this.scanner.scan(bytes); // Genuine scanner required even for synthetic TXT.
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const safeText = !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
      const clean = outcome.clean && safeText;
      // Each scan attempt gets a distinct immutable preview key.
      const previewKey = `pilot/media/${asset.id}/${randomUUID()}/preview.txt`;
      if (clean) await this.storage.preview(previewKey, Buffer.from(text, "utf8"));
      return await this.store.transaction(async tx => {
        await this.asset(tx, assetId, req, true);
        const updated = await tx.mediaAsset.update({ where: { id: assetId }, data: {
          scanState: clean ? "clean" : "rejected", scanEngine: outcome.engine,
          scannedAt: new Date(), sha256: createHash("sha256").update(bytes).digest("hex"),
          previewKey: clean ? previewKey : null,
        } });
        await this.store.audit(tx, req, clean ? "media.scan_clean" : "media.scan_rejected", "media_asset", assetId);
        return { asset: safeAsset(updated) };
      });
    } catch (error) {
      await this.store.transaction(async tx => {
        await this.store.courseLock(tx, asset.courseId);
        await tx.mediaAsset.update({ where: { id: assetId }, data: { scanState: "failed", scannedAt: new Date() } });
        await this.store.audit(tx, req, "media.scan_failed", "media_asset", assetId);
      });
      throw error;
    }
  }
  async publish(req: AuthenticatedRequest, assetId: string) {
    return this.store.transaction(async tx => {
      const { asset } = await this.asset(tx, assetId, req, true);
      if (asset.status !== "draft" || asset.scanState !== "clean" || !asset.previewKey || !asset.sha256 || !asset.scannedAt) throw unavailable();
      const updated = await tx.mediaAsset.update({ where: { id: assetId }, data: { status: "published" } });
      await this.store.audit(tx, req, "media.published", "media_asset", assetId);
      return { asset: safeAsset(updated) };
    });
  }
  async access(req: AuthenticatedRequest, assetId: string, mode: "preview" | "download") {
    return this.store.transaction(async tx => {
      const { asset, enrollment } = await this.asset(tx, assetId, req, false);
      if (asset.status !== "published" || asset.scanState !== "clean" || !asset.scannedAt ||
        !asset.sha256 || !asset.previewKey || (mode === "download" && !asset.downloadsAllowed)) throw unavailable();
      // IdentityGuard has already verified the bearer token. Only its standard exp
      // bounds this capability; identity/roles are always authoritative DB reads.
      let tokenExpiresAt: unknown;
      try { tokenExpiresAt = decodeJwt(req.headers.authorization!.slice(7)).exp; } catch { throw unavailable(); }
      if (typeof tokenExpiresAt !== "number") throw unavailable();
      const seconds = readCapabilityLifetime(enrollment!.expiresAt, tokenExpiresAt);
      const expiresAt = now() + seconds;
      const url = await this.storage.access(mode === "preview" ? asset.previewKey : asset.objectKey, mode, expiresAt);
      if (now() >= expiresAt) throw unavailable();
      await this.store.audit(tx, req, "media.access_issued", "media_asset", assetId, { mode, lifetimeSeconds: seconds });
      return { url, expiresAt: new Date(expiresAt * 1000).toISOString(), expiresIn: expiresAt - now() };
    });
  }
}
