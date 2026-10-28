import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Transform } from "node:stream";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { libraryContext, missing } from "./library.context.js";
import { usableRevision } from "./library.service.js";
import { PROCESSING_STORAGE, type ProcessingStorage } from "./processing.ports.js";
import { RenditionCapabilities } from "./rendition-capability.js";
import type { Scope } from "./library.schemas.js";
export const renditionAccessInput = z.object({
  mode: z.enum(["preview", "download"]), revisionId: z.string().uuid().optional(),
}).strict();
type Args = { req: AuthenticatedRequest; scope: Scope; parentId: string; placementId: string; admin: boolean };
type Input = z.infer<typeof renditionAccessInput>;
const types: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "image", "image/png": "image", "image/webp": "image", "text/plain": "plaintext",
};
@Injectable()
export class MediaRenditionService {
  readonly tickets = new RenditionCapabilities();
  now = () => Date.now();
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(PROCESSING_STORAGE) private readonly storage: ProcessingStorage) {}
  private async facts(tx: Tx, args: Args, input: Input) {
    const ctx = await libraryContext(this.store, tx, args.req, args.scope, args.parentId, args.admin);
    const p = await tx.mediaPlacement.findFirst({ where: { id: args.placementId, courseId: ctx.courseId,
      parentType: args.scope, parentId: args.parentId },
    include: { asset: true, collection: true, course: true, chapter: true, lesson: true } });
    if (!p) throw missing();
    const a = p.asset;
    const statuses = [p.status, a.status, p.collection?.status, p.course.status, p.chapter?.status, p.lesson?.status].filter(Boolean);
    if (statuses.some(s => s === "archived" || s === "removed") ||
        (!args.admin && statuses.some(s => s !== "published"))) throw missing();
    const revisionId = input.revisionId ?? a.currentRevisionId;
    if (!revisionId || (args.admin
      ? revisionId !== a.currentRevisionId && revisionId !== a.stagedRevisionId
      : revisionId !== a.currentRevisionId)) throw missing();
    const r = await tx.mediaRevision.findFirst({ where: { id: revisionId, assetId: a.id, courseId: ctx.courseId },
      include: { renditions: true, processingUpload: true } });
    if (!usableRevision(a, r) || !r || a.kind === "video" || !types[r.mimeType]) throw missing();
    if (!r.processingUpload?.sourceEtag || r.processingUpload.state !== "completed" ||
        r.processingUpload.sourceKey !== r.objectKey) throw missing();
    if (input.mode === "download" && !a.downloadsAllowed) throw missing();
    const rendition = input.mode === "preview" ? r.renditions.find(v => v.kind === types[r.mimeType] &&
      v.locator === r.previewKey && v.locator === r.objectKey && !!v.verifiedAt) : null;
    if (input.mode === "preview" && (!r.safePreview || !rendition)) throw missing();
    const enrollment = !args.admin ? await tx.enrollment.findUnique({
      where: { userId_courseId: { userId: args.req.user.id, courseId: ctx.courseId } },
    }) : null;
    const expires = Math.min(this.now() + 120000, enrollment?.expiresAt?.getTime() ?? Infinity);
    if (expires <= this.now()) throw missing();
    return { r, rendition, expires };
  }
  async issue(args: Args, input: Input) {
    return this.store.transaction(async tx => {
      const { r, rendition, expires } = await this.facts(tx, args, input);
      const capability = this.tickets.seal({ actor: args.req.user.id, placement: args.placementId,
        parent: args.parentId, scope: args.scope, admin: args.admin, revision: r.id,
        rendition: rendition?.id ?? null, mode: input.mode, expires });
      await this.store.audit(tx, args.req, `media_rendition.${input.mode}_issued`, "media_revision", r.id,
        { mode: input.mode, audience: args.admin ? "admin" : "student" });
      return {
        url: `/lms-api/${args.admin ? "admin/" : ""}${args.scope}/${args.parentId}/media-library/placements/${args.placementId}/content`,
        capability, expiresAt: new Date(expires).toISOString(), revisionId: r.id, renditionId: rendition?.id ?? null,
        mode: input.mode, contentType: input.mode === "download" ? "application/octet-stream"
          : r.mimeType === "text/plain" ? "text/plain; charset=utf-8" : r.mimeType, pageCount: r.pageCount,
      };
    });
  }
  async content(args: Args, capability: string, signal: AbortSignal) {
    const ticket = this.tickets.open(capability, this.now());
    if (ticket.actor !== args.req.user.id || ticket.placement !== args.placementId ||
        ticket.parent !== args.parentId || ticket.scope !== args.scope || ticket.admin !== args.admin) throw missing();
    const facts = await this.store.transaction(tx => this.facts(tx, args, { mode: ticket.mode, revisionId: ticket.revision }));
    if ((facts.rendition?.id ?? null) !== ticket.rendition) throw missing();
    let source;
    try { source = await this.storage.stream(facts.r.objectKey!, facts.r.processingUpload!.sourceEtag!, signal); }
    catch { throw new ServiceUnavailableException("MEDIA_UNAVAILABLE"); }
    const expected = Number(facts.r.bytes), hash = createHash("sha256");
    let total = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        total += chunk.length;
        if (total > expected) return done(new Error("MEDIA_UNAVAILABLE"));
        hash.update(chunk); done(null, chunk);
      },
      flush(done) { done(total === expected && hash.digest("hex") === facts.r.sha256 ? null : new Error("MEDIA_UNAVAILABLE")); },
      destroy(error, done) { source.destroy(); done(error); },
    });
    source.on("error", () => bounded.destroy(new Error("MEDIA_UNAVAILABLE")));
    source.pipe(bounded);
    return { stream: bounded, bytes: expected, contentType: ticket.mode === "download" ? "application/octet-stream"
      : facts.r.mimeType === "text/plain" ? "text/plain; charset=utf-8" : facts.r.mimeType,
    disposition: ticket.mode === "download" ? "attachment; filename=\"resource\"" : "inline" };
  }
}
