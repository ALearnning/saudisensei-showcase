import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { decodeJwt } from "jose";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import type { VideoPilotTicket } from "./cloudflare-stream.pilot.js";

export const VIDEO_PILOT_SIGNER = Symbol("VIDEO_PILOT_SIGNER");
export interface VideoPilotSigner {
  playback(reference: string, host: string, expiresAt: number): VideoPilotTicket;
}

const unavailable = () => new NotFoundException("VIDEO_UNAVAILABLE");
export function videoPilotDeadline(tokenExpiry: number, enrollmentExpiry: Date | null,
  clock = Math.floor(Date.now() / 1000)) {
  const expiry = Math.min(clock + 300, tokenExpiry,
    enrollmentExpiry ? Math.floor(enrollmentExpiry.getTime() / 1000) : Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(expiry) || expiry <= clock) throw unavailable();
  return expiry;
}
@Injectable()
export class VideoPilotService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(VIDEO_PILOT_SIGNER) private readonly signer: VideoPilotSigner) {}
  private enabled() {
    // Explicitly development-only. No implicit production activation.
    if (process.env.VIDEO_PILOT_ENABLED !== "true" || process.env.NODE_ENV === "production") throw unavailable();
  }
  private async context(tx: Tx, req: AuthenticatedRequest, lessonId: string, admin: boolean) {
    const initial = await tx.lesson.findUnique({ where: { id: lessonId } });
    if (!initial) throw unavailable();
    const course = await this.store.courseLock(tx, initial.courseId, false);
    const user = await tx.user.findUnique({ where: { id: req.user.id },
      include: { roles: { include: { role: true } } } });
    if (!user || user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
    if (!user.roles.some(r => r.role.name === (admin ? "admin" : "student")) ||
        (admin && !req.mfaVerified)) throw new ForbiddenException("VIDEO_FORBIDDEN");
    const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { chapter: true } });
    if ([course.status, lesson.chapter.status, lesson.status].some(status => status !== "published") ||
        !lesson.body.trim()) throw unavailable();
    const enrollment = admin ? null : await tx.enrollment.findUnique({
      where: { userId_courseId: { userId: req.user.id, courseId: course.id } },
    });
    if (!admin && (!enrollment || enrollment.status !== "active" ||
        (enrollment.expiresAt && enrollment.expiresAt.getTime() <= Date.now()))) throw unavailable();
    return { lesson, enrollment };
  }
  async attach(req: AuthenticatedRequest, id: string, lessonId: string) {
    this.enabled();
    return this.store.transaction(async tx => {
      const { lesson } = await this.context(tx, req, lessonId, true);
      const asset = await tx.videoPilotAsset.findUnique({ where: { id } });
      if (!asset || !asset.privateReady || !asset.sha256 || !asset.scanEngine ||
          asset.status === "archived" || (asset.lessonId && asset.lessonId !== lessonId)) throw unavailable();
      await tx.videoPilotAsset.update({ where: { id }, data: {
        lessonId, courseId: lesson.courseId, status: "published",
      } });
      await this.store.audit(tx, req, "video_pilot.attached", "video_pilot_asset", id);
      return { attached: true };
    });
  }
  async list(req: AuthenticatedRequest, lessonId: string) {
    this.enabled();
    return this.store.transaction(async tx => {
      await this.context(tx, req, lessonId, false);
      const assets = await tx.videoPilotAsset.findMany({
        where: { lessonId, status: "published", privateReady: true }, orderBy: { duration: "desc" }, take: 2,
      });
      return { items: assets.map(a => ({ id: a.id, duration: a.duration })) };
    });
  }
  async playback(req: AuthenticatedRequest, id: string) {
    this.enabled();
    return this.store.transaction(async tx => {
      const first = await tx.videoPilotAsset.findUnique({ where: { id } });
      if (!first?.lessonId) throw unavailable();
      const { enrollment } = await this.context(tx, req, first.lessonId, false);
      const asset = await tx.videoPilotAsset.findUniqueOrThrow({ where: { id } });
      if (asset.lessonId !== first.lessonId || asset.status !== "published" ||
          !asset.privateReady || !asset.sha256 || !asset.scanEngine) throw unavailable();
      let tokenExpiry: unknown;
      try { tokenExpiry = decodeJwt(req.headers.authorization!.slice(7)).exp; } catch { throw unavailable(); }
      if (typeof tokenExpiry !== "number") throw unavailable();
      const expiresAt = videoPilotDeadline(tokenExpiry, enrollment!.expiresAt);
      let ticket;
      try {
        ticket = this.signer.playback(asset.providerRef, asset.playbackHost, expiresAt);
      } catch { throw new ServiceUnavailableException("VIDEO_UNAVAILABLE"); }
      if (Math.floor(Date.now() / 1000) >= expiresAt) throw unavailable();
      await this.store.audit(tx, req, "video_pilot.playback_issued", "video_pilot_asset", id,
        { lifetimeSeconds: expiresAt - Math.floor(Date.now() / 1000) });
      return { manifest: ticket.manifest, poster: ticket.poster,
        expiresAt: new Date(expiresAt * 1000).toISOString() };
    });
  }
}
