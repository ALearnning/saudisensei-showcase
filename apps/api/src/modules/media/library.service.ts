import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { editable, libraryContext, missing, type LibraryContext } from "./library.context.js";
import * as s from "./library.schemas.js";
import type { z } from "zod";

type Asset = Prisma.ContentMediaAssetGetPayload<object>;
type Revision = Prisma.MediaRevisionGetPayload<object>;
type Placement = Prisma.MediaPlacementGetPayload<object>;
type Collection = Prisma.MediaCollectionGetPayload<object>;
type ScopeArgs = { req: AuthenticatedRequest; scope: s.Scope; parentId: string };
const owned = (ctx: LibraryContext) => ({ courseId: ctx.courseId, parentType: ctx.parentType, parentId: ctx.parentId });
const safeAsset = (a: Asset) => ({ id: a.id, kind: a.kind, title: a.title, status: a.status,
  downloadsAllowed: a.downloadsAllowed, currentRevisionId: a.currentRevisionId, stagedRevisionId: a.stagedRevisionId });
const safeRevision = (r: Revision) => ({ id: r.id, filename: r.filename, mimeType: r.mimeType,
  bytes: Number(r.bytes), state: r.state, scanState: r.scanState, duration: r.duration, pageCount: r.pageCount });
const safePlacement = (p: Placement) => ({ id: p.id, assetId: p.assetId, collectionId: p.collectionId, status: p.status, position: p.position });
const safeCollection = (c: Collection) => ({ id: c.id, title: c.title, description: c.description, status: c.status, position: c.position });
type MutationValue = {
  asset?: ReturnType<typeof safeAsset>; revision?: ReturnType<typeof safeRevision>;
  placement?: ReturnType<typeof safePlacement>; collection?: ReturnType<typeof safeCollection>; ids?: string[];
};
export function usableRevision(asset: Pick<Asset, "kind" | "downloadsAllowed">, r: Revision | null): boolean {
  if (!r || r.state !== "ready" || r.scanState !== "clean" || !r.privateReady ||
      !r.objectKey || !r.scanEngine || !r.scannedAt || !r.sha256 || !/^[a-f0-9]{64}$/.test(r.sha256)) return false;
  if (asset.kind === "video") return !asset.downloadsAllowed && !!r.providerRef;
  return asset.downloadsAllowed || (!!r.previewKey && r.safePreview);
}
@Injectable()
export class MediaLibraryService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}
  private write(args: ScopeArgs, expected: number, action: string,
    work: (tx: Tx, ctx: LibraryContext) => Promise<MutationValue>) {
    return this.store.transaction(async tx => {
      const ctx = await libraryContext(this.store, tx, args.req, args.scope, args.parentId, true, true);
      const state = await tx.courseMediaState.upsert({ where: { courseId: ctx.courseId },
        create: { courseId: ctx.courseId }, update: {} });
      if (state.editRevision !== expected) throw new ConflictException("MEDIA_CHANGED");
      const value = await work(tx, ctx);
      const next = await tx.courseMediaState.update({ where: { courseId: ctx.courseId }, data: { editRevision: { increment: 1 } } });
      const subject = value.asset?.id ?? value.revision?.id ?? value.placement?.id ?? value.collection?.id ?? ctx.parentId;
      await this.store.audit(tx, args.req, action, "media_library", subject, {
        scope: args.scope, mediaEditRevision: next.editRevision, ...(value.ids ? { orderedIds: value.ids } : {}),
      });
      return { ...value, mediaEditRevision: next.editRevision };
    });
  }
  private async collection(tx: Tx, ctx: LibraryContext, id: string | null) {
    if (!id) return null;
    const collection = await tx.mediaCollection.findFirst({ where: { id, ...owned(ctx) } });
    if (!collection) throw missing();
    editable(collection.status);
    return collection;
  }
  private async asset(tx: Tx, ctx: LibraryContext, id: string) {
    const asset = await tx.contentMediaAsset.findFirst({ where: { id, courseId: ctx.courseId } });
    const placement = await tx.mediaPlacement.findFirst({ where: { assetId: id, ...owned(ctx) } });
    if (!asset || !placement) throw missing();
    editable(asset.status); editable(placement.status);
    await this.collection(tx, ctx, placement.collectionId);
    return asset;
  }
  private async placement(tx: Tx, ctx: LibraryContext, id: string) {
    const p = await tx.mediaPlacement.findFirst({ where: { id, ...owned(ctx) } });
    if (!p) throw missing();
    await this.asset(tx, ctx, p.assetId);
    return p;
  }
  private async nextPosition(tx: Tx, ctx: LibraryContext, collectionId: string | null) {
    const last = await tx.mediaPlacement.aggregate({ where: { ...owned(ctx), collectionId }, _max: { position: true } });
    return (last._max.position ?? -1) + 1;
  }
  private async createRevision(tx: Tx, ctx: LibraryContext, req: AuthenticatedRequest, asset: Asset,
    input: Pick<s.FileInput, "filename" | "mimeType" | "bytes">) {
    s.validateFormat(asset.kind, input, asset.downloadsAllowed);
    return tx.mediaRevision.create({ data: {
      assetId: asset.id, courseId: ctx.courseId, filename: input.filename, mimeType: input.mimeType,
      bytes: BigInt(input.bytes), createdBy: req.user.id,
    } });
  }
  async list(args: ScopeArgs, admin: boolean) {
    return this.store.transaction(async tx => {
      const ctx = await libraryContext(this.store, tx, args.req, args.scope, args.parentId, admin);
      const collections = await tx.mediaCollection.findMany({ where: { ...owned(ctx), ...(!admin ? { status: "published" } : {}) },
        orderBy: [{ position: "asc" }, { id: "asc" }] });
      const placements = await tx.mediaPlacement.findMany({ where: { ...owned(ctx), ...(!admin ? { status: "published" } : {}) },
        orderBy: [{ position: "asc" }, { id: "asc" }] });
      const visibleCollections = new Set(collections.map(c => c.id));
      const assets = await tx.contentMediaAsset.findMany({ where: { id: { in: placements.map(p => p.assetId) } } });
      const revisions = await tx.mediaRevision.findMany({ where: { assetId: { in: assets.map(a => a.id) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const items = placements.flatMap(p => {
        const a = assets.find(v => v.id === p.assetId)!;
        const current = revisions.find(r => r.id === a.currentRevisionId) ?? null;
        if (!admin && (a.status !== "published" || !usableRevision(a, current) ||
            (p.collectionId && !visibleCollections.has(p.collectionId)))) return [];
        return [{ placement: safePlacement(p), asset: admin ? safeAsset(a) : {
          id: a.id, kind: a.kind, title: a.title, downloadsAllowed: a.downloadsAllowed,
        }, revision: current ? safeRevision(current) : null,
        ...(admin ? { revisions: revisions.filter(r => r.assetId === a.id).map(safeRevision) } : {}) }];
      });
      return { items, collections: collections.map(safeCollection),
        ...(admin ? { mediaEditRevision: (await tx.courseMediaState.findUnique({ where: { courseId: ctx.courseId } }))?.editRevision ?? 0 } : {}) };
    });
  }
  createAsset(args: ScopeArgs, input: z.infer<typeof s.assetInput>) {
    return this.write(args, input.expectedMediaRevision, "media_library.asset_created", async (tx, ctx) => {
      s.validateFormat(input.kind, input, input.downloadsAllowed);
      await this.collection(tx, ctx, input.collectionId);
      let asset = await tx.contentMediaAsset.create({ data: {
        courseId: ctx.courseId, kind: input.kind, title: input.title, downloadsAllowed: input.downloadsAllowed, createdBy: args.req.user.id,
      } });
      const revision = await this.createRevision(tx, ctx, args.req, asset, input);
      asset = await tx.contentMediaAsset.update({ where: { id: asset.id }, data: { stagedRevisionId: revision.id } });
      const placement = await tx.mediaPlacement.create({ data: { ...owned(ctx), chapterId: ctx.chapterId, lessonId: ctx.lessonId,
        assetId: asset.id, collectionId: input.collectionId, position: await this.nextPosition(tx, ctx, input.collectionId) } });
      return { asset: safeAsset(asset), revision: safeRevision(revision), placement: safePlacement(placement) };
    });
  }
  updateAsset(args: ScopeArgs, id: string, input: z.infer<typeof s.assetUpdate>) {
    return this.write(args, input.expectedMediaRevision, "media_library.asset_updated", async (tx, ctx) => {
      const asset = await this.asset(tx, ctx, id);
      const candidate = { ...asset, ...(input.downloadsAllowed !== undefined ? { downloadsAllowed: input.downloadsAllowed } : {}) };
      if (candidate.kind === "video" && candidate.downloadsAllowed) throw new BadRequestException("VIDEO_DOWNLOAD_DISABLED");
      if (asset.status === "published" && !usableRevision(candidate,
        await tx.mediaRevision.findUnique({ where: { id: asset.currentRevisionId! } }))) throw new ConflictException("MEDIA_NOT_READY");
      const updated = await tx.contentMediaAsset.update({ where: { id }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}), downloadsAllowed: candidate.downloadsAllowed,
      } });
      return { asset: safeAsset(updated) };
    });
  }
  stage(args: ScopeArgs, id: string, input: s.FileInput) {
    return this.write(args, input.expectedMediaRevision, "media_library.revision_staged", async (tx, ctx) => {
      const asset = await this.asset(tx, ctx, id);
      const revision = await this.createRevision(tx, ctx, args.req, asset, input);
      const updated = await tx.contentMediaAsset.update({ where: { id }, data: { stagedRevisionId: revision.id } });
      return { asset: safeAsset(updated), revision: safeRevision(revision) };
    });
  }
  activate(args: ScopeArgs, id: string, input: z.infer<typeof s.activateInput>) {
    return this.write(args, input.expectedMediaRevision, "media_library.replacement_activated", async (tx, ctx) => {
      const asset = await this.asset(tx, ctx, id);
      const revision = await tx.mediaRevision.findFirst({ where: { id: input.revisionId, assetId: id, courseId: ctx.courseId } });
      if (asset.stagedRevisionId !== input.revisionId || !usableRevision(asset, revision)) throw new ConflictException("MEDIA_NOT_READY");
      const updated = await tx.contentMediaAsset.update({ where: { id }, data: {
        currentRevisionId: input.revisionId, stagedRevisionId: null,
      } });
      return { asset: safeAsset(updated) };
    });
  }
  assetLifecycle(args: ScopeArgs, id: string, input: z.infer<typeof s.lifecycleInput>) {
    return this.write(args, input.expectedMediaRevision, `media_library.asset_${input.action}`, async (tx, ctx) => {
      const asset = await this.asset(tx, ctx, id);
      if (input.action === "publish" && (!asset.currentRevisionId ||
          !usableRevision(asset, await tx.mediaRevision.findUnique({ where: { id: asset.currentRevisionId } })))) throw new ConflictException("MEDIA_NOT_READY");
      const status = { publish: "published", unpublish: "draft", archive: "archived", remove: "removed" }[input.action];
      return { asset: safeAsset(await tx.contentMediaAsset.update({ where: { id }, data: { status } })) };
    });
  }
  attach(args: ScopeArgs, input: z.infer<typeof s.attachInput>) {
    return this.write(args, input.expectedMediaRevision, "media_library.placement_created", async (tx, ctx) => {
      const asset = await tx.contentMediaAsset.findFirst({ where: { id: input.assetId, courseId: ctx.courseId } });
      if (!asset) throw missing();
      editable(asset.status);
      await this.collection(tx, ctx, input.collectionId);
      if (await tx.mediaPlacement.findUnique({ where: { assetId: asset.id } })) throw new ConflictException("MEDIA_ALREADY_PLACED");
      const placement = await tx.mediaPlacement.create({ data: { ...owned(ctx), chapterId: ctx.chapterId,
        lessonId: ctx.lessonId, assetId: asset.id, collectionId: input.collectionId,
        position: await this.nextPosition(tx, ctx, input.collectionId) } });
      return { placement: safePlacement(placement) };
    });
  }
  move(args: ScopeArgs, id: string, input: z.infer<typeof s.placementUpdate>) {
    return this.write(args, input.expectedMediaRevision, "media_library.collection_membership_changed", async (tx, ctx) => {
      await this.placement(tx, ctx, id); await this.collection(tx, ctx, input.collectionId);
      const placement = await tx.mediaPlacement.update({ where: { id }, data: { collectionId: input.collectionId,
        position: await this.nextPosition(tx, ctx, input.collectionId) } });
      return { placement: safePlacement(placement) };
    });
  }
  placementLifecycle(args: ScopeArgs, id: string, input: z.infer<typeof s.lifecycleInput>) {
    return this.write(args, input.expectedMediaRevision, `media_library.placement_${input.action}`, async (tx, ctx) => {
      const placement = await this.placement(tx, ctx, id);
      const asset = await this.asset(tx, ctx, placement.assetId);
      if (input.action === "publish" && (asset.status !== "published" || !asset.currentRevisionId ||
        !usableRevision(asset, await tx.mediaRevision.findUnique({ where: { id: asset.currentRevisionId } })))) throw new ConflictException("MEDIA_NOT_READY");
      const status = { publish: "published", unpublish: "draft", archive: "archived", remove: "removed" }[input.action];
      return { placement: safePlacement(await tx.mediaPlacement.update({ where: { id }, data: { status } })) };
    });
  }
  createCollection(args: ScopeArgs, input: z.infer<typeof s.collectionInput>) {
    return this.write(args, input.expectedMediaRevision, "media_library.collection_created", async (tx, ctx) => {
      const last = await tx.mediaCollection.aggregate({ where: owned(ctx), _max: { position: true } });
      return { collection: safeCollection(await tx.mediaCollection.create({ data: {
        ...owned(ctx), chapterId: ctx.chapterId, lessonId: ctx.lessonId, title: input.title,
        description: input.description, position: (last._max.position ?? -1) + 1,
      } })) };
    });
  }
  updateCollection(args: ScopeArgs, id: string, input: z.infer<typeof s.collectionUpdate>) {
    return this.write(args, input.expectedMediaRevision, "media_library.collection_updated", async (tx, ctx) => {
      await this.collection(tx, ctx, id);
      return { collection: safeCollection(await tx.mediaCollection.update({ where: { id }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}),
      } })) };
    });
  }
  collectionLifecycle(args: ScopeArgs, id: string, input: z.infer<typeof s.lifecycleInput>) {
    return this.write(args, input.expectedMediaRevision, `media_library.collection_${input.action}`, async (tx, ctx) => {
      await this.collection(tx, ctx, id);
      const status = { publish: "published", unpublish: "draft", archive: "archived", remove: "removed" }[input.action];
      return { collection: safeCollection(await tx.mediaCollection.update({ where: { id }, data: { status } })) };
    });
  }
  reorder(args: ScopeArgs, input: z.infer<typeof s.orderInput>, collections = false) {
    return this.write(args, input.expectedMediaRevision, "media_library.order_changed", async (tx, ctx) => {
      if (!collections) await this.collection(tx, ctx, input.collectionId);
      const active = { notIn: ["archived", "removed"] };
      let ids: string[];
      if (collections) ids = (await tx.mediaCollection.findMany({ where: { ...owned(ctx), status: active } })).map(v => v.id);
      else {
        const placements = await tx.mediaPlacement.findMany({ where: { ...owned(ctx), collectionId: input.collectionId, status: active } });
        const assets = new Set((await tx.contentMediaAsset.findMany({ where: { id: { in: placements.map(p => p.assetId) }, status: active } })).map(a => a.id));
        ids = placements.filter(p => assets.has(p.assetId)).map(p => p.id);
      }
      if (ids.length !== input.ids.length || input.ids.some(id => !ids.includes(id))) throw new BadRequestException("INVALID_MEDIA_ORDER");
      for (const [position, id] of input.ids.entries()) {
        if (collections) await tx.mediaCollection.update({ where: { id }, data: { position } });
        else await tx.mediaPlacement.update({ where: { id }, data: { position } });
      }
      return { ids: input.ids };
    });
  }
}
