import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { decodeJwt } from "jose";
import { LmsStore } from "../courses/lms.store.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import type { Scope } from "./library.schemas.js";
import { libraryContext, missing } from "./library.context.js";
import { usableRevision } from "./library.service.js";
import { VIDEO_PILOT_SIGNER, videoPilotDeadline, type VideoPilotSigner } from "./video-pilot.service.js";
@Injectable()
export class MediaAdminVideoService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(VIDEO_PILOT_SIGNER) private readonly signer: VideoPilotSigner) {}
  async preview(args: { req: AuthenticatedRequest; scope: Scope; parentId: string; placementId: string }, revisionId: string) {
    return this.store.transaction(async tx => {
      // Inspection issues a new bearer capability; archived ancestors may be
      // listed but must not acquire fresh playback, just like other authoring actions.
      const ctx = await libraryContext(this.store, tx, args.req, args.scope, args.parentId, true, true);
      const placement = await tx.mediaPlacement.findFirst({ where: { id: args.placementId,
        courseId: ctx.courseId, parentId: args.parentId, parentType: args.scope },
      include: { asset: true, course: true, chapter: true, lesson: true, collection: true } });
      if (!placement || [placement.status, placement.asset.status, placement.course.status,
        placement.chapter?.status, placement.lesson?.status, placement.collection?.status].some(v => v === "archived" || v === "removed")) throw missing();
      const asset = placement.asset;
      const revision = await tx.mediaRevision.findFirst({ where: { id: revisionId, assetId: asset.id, courseId: ctx.courseId },
        include: { renditions: true } });
      if (asset.kind !== "video" || (revisionId !== asset.currentRevisionId && revisionId !== asset.stagedRevisionId) ||
          !usableRevision(asset, revision) || !revision?.providerRef) throw missing();
      const rendition = revision.renditions.find(r => r.kind === "stream" && r.verifiedAt);
      if (!rendition) throw missing();
      let expiresAt: number;
      try {
        const expiry = decodeJwt(args.req.headers.authorization!.slice(7)).exp;
        if (typeof expiry !== "number") throw 0;
        expiresAt = videoPilotDeadline(expiry, null);
      } catch { throw missing(); }
      let ticket;
      try { ticket = this.signer.playback(revision.providerRef, rendition.locator, expiresAt); }
      catch { throw new ServiceUnavailableException("VIDEO_UNAVAILABLE"); }
      if (Math.floor(Date.now() / 1000) >= expiresAt) throw missing();
      await this.store.audit(tx, args.req, "media_video.admin_preview_issued", "media_revision", revision.id, { lifetimeSeconds: expiresAt - Math.floor(Date.now() / 1000) });
      return { manifestUrl: ticket.manifest, expiresAt: new Date(expiresAt * 1000).toISOString(),
        revisionId: revision.id, duration: revision.duration };
    });
  }
}
