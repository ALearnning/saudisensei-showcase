import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { decodeJwt } from "jose";
import { LmsStore } from "../courses/lms.store.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import type { Scope } from "./library.schemas.js";
import { libraryContext, missing } from "./library.context.js";
import { usableRevision } from "./library.service.js";
import { VIDEO_PILOT_SIGNER, videoPilotDeadline, type VideoPilotSigner } from "./video-pilot.service.js";

@Injectable()
export class MediaStudentVideoService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(VIDEO_PILOT_SIGNER) private readonly signer: VideoPilotSigner) {}

  async playback(args: { req: AuthenticatedRequest; scope: Scope; parentId: string; placementId: string }, revisionId: string) {
    return this.store.transaction(async tx => {
      const ctx = await libraryContext(this.store, tx, args.req, args.scope, args.parentId, false);
      const p = await tx.mediaPlacement.findFirst({ where: { id: args.placementId, courseId: ctx.courseId,
        parentId: args.parentId, parentType: args.scope },
      include: { asset: true, course: true, chapter: true, lesson: true, collection: true } });
      if (!p || [p.status, p.asset.status, p.course.status, p.chapter?.status,
        p.lesson?.status, p.collection?.status].filter(Boolean).some(v => v !== "published") ||
        (p.collectionId && !p.collection)) throw missing();
      if (p.asset.kind !== "video" || p.asset.currentRevisionId !== revisionId) throw missing();
      const revision = await tx.mediaRevision.findFirst({ where: { id: revisionId, assetId: p.assetId, courseId: ctx.courseId },
        include: { renditions: true } });
      if (!usableRevision(p.asset, revision) || !revision?.providerRef) throw missing();
      const stream = revision.renditions.find(r => r.kind === "stream" && r.verifiedAt);
      if (!stream) throw missing();
      const enrollment = await tx.enrollment.findUnique({ where: {
        userId_courseId: { userId: args.req.user.id, courseId: ctx.courseId },
      } });
      if (!enrollment || enrollment.status !== "active") throw missing();
      let expiresAt: number;
      try {
        // Global bearer guards already verify issuer/audience/RS256/expiry.
        // Decode only to shorten this downstream capability, never to authenticate.
        const expiry = decodeJwt(args.req.headers.authorization!.slice(7)).exp;
        if (typeof expiry !== "number") throw 0;
        expiresAt = videoPilotDeadline(expiry, enrollment.expiresAt);
      } catch { throw missing(); }
      let ticket;
      try { ticket = this.signer.playback(revision.providerRef, stream.locator, expiresAt); }
      catch { throw new ServiceUnavailableException("VIDEO_UNAVAILABLE"); }
      if (Math.floor(Date.now() / 1000) >= expiresAt) throw missing();
      await this.store.audit(tx, args.req, "media_video.playback_issued", "media_revision", revision.id,
        { audience: "student", lifetimeSeconds: expiresAt - Math.floor(Date.now() / 1000) });
      return { manifestUrl: ticket.manifest, expiresAt: new Date(expiresAt * 1000).toISOString(),
        revisionId: revision.id, duration: revision.duration };
    });
  }
}
