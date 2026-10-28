import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { MediaLibraryService } from "./library.service.js";
import * as s from "./library.schemas.js";
type Params = Record<string, string>;
function args(req: AuthenticatedRequest, p: Params) {
  return { req, scope: s.parse(s.scope, p.scope), parentId: s.parse(s.id, p.parentId) };
}
@Controller("admin/:scope/:parentId/media-library")
@RequireRoles("admin")
export class MediaLibraryAdminController {
  constructor(@Inject(MediaLibraryService) private readonly library: MediaLibraryService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Param() p: Params) { return this.library.list(args(req, p), true); }
  @Post("assets") create(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.createAsset(args(req, p), s.parse(s.assetInput, body));
  }
  @Patch("assets/:assetId") update(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.updateAsset(args(req, p), s.parse(s.id, p.assetId), s.parse(s.assetUpdate, body));
  }
  @Post("assets/:assetId/revisions") stage(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.stage(args(req, p), s.parse(s.id, p.assetId), s.parse(s.revisionInput, body));
  }
  @Post("assets/:assetId/activate") activate(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.activate(args(req, p), s.parse(s.id, p.assetId), s.parse(s.activateInput, body));
  }
  @Post("assets/:assetId/lifecycle") assetLifecycle(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.assetLifecycle(args(req, p), s.parse(s.id, p.assetId), s.parse(s.lifecycleInput, body));
  }
  @Post("placements") attach(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.attach(args(req, p), s.parse(s.attachInput, body));
  }
  @Patch("placements/:placementId") move(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.move(args(req, p), s.parse(s.id, p.placementId), s.parse(s.placementUpdate, body));
  }
  @Post("placements/:placementId/lifecycle") placementLifecycle(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.placementLifecycle(args(req, p), s.parse(s.id, p.placementId), s.parse(s.lifecycleInput, body));
  }
  @Put("placement-order") reorder(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.reorder(args(req, p), s.parse(s.orderInput, body));
  }
  @Post("collections") collection(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.createCollection(args(req, p), s.parse(s.collectionInput, body));
  }
  @Patch("collections/:collectionId") updateCollection(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.updateCollection(args(req, p), s.parse(s.id, p.collectionId), s.parse(s.collectionUpdate, body));
  }
  @Post("collections/:collectionId/lifecycle") collectionLifecycle(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.library.collectionLifecycle(args(req, p), s.parse(s.id, p.collectionId), s.parse(s.lifecycleInput, body));
  }
  @Put("collection-order") collectionOrder(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    const input = s.parse(s.collectionOrderInput, body);
    return this.library.reorder(args(req, p), { ...input, collectionId: null }, true);
  }
}
@Controller(":scope/:parentId/media-library")
@RequireRoles("student")
export class MediaLibraryStudentController {
  constructor(@Inject(MediaLibraryService) private readonly library: MediaLibraryService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Param() p: Params) { return this.library.list(args(req, p), false); }
}
