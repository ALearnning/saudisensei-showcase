import { Body, Controller, Get, Header, Inject, Param, Post, Req } from "@nestjs/common";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { MediaProcessingService, uploadRequest, partRequest, completeRequest } from "./processing.service.js";
import { id, scope, parse } from "./library.schemas.js";
const args = (req: AuthenticatedRequest, p: Record<string, string>) => ({
  req, scope: parse(scope, p.scope), parentId: parse(id, p.parentId), revisionId: parse(id, p.revisionId),
});
@Controller("admin/:scope/:parentId/media-library/revisions/:revisionId/processing")
@RequireRoles("admin")
export class MediaProcessingController {
  constructor(@Inject(MediaProcessingService) private readonly processing: MediaProcessingService) {}
  @Get() @Header("Cache-Control", "private, no-store")
  status(@Req() req: AuthenticatedRequest, @Param() p: Record<string, string>) { return this.processing.status(args(req, p)); }
  @Post("upload") @Header("Cache-Control", "private, no-store")
  upload(@Req() req: AuthenticatedRequest, @Param() p: Record<string, string>, @Body() body: unknown) {
    return this.processing.upload(args(req, p), parse(uploadRequest, body));
  }
  @Post("parts") @Header("Cache-Control", "private, no-store")
  part(@Req() req: AuthenticatedRequest, @Param() p: Record<string, string>, @Body() body: unknown) {
    return this.processing.part(args(req, p), parse(partRequest, body));
  }
  @Post("complete") @Header("Cache-Control", "private, no-store")
  complete(@Req() req: AuthenticatedRequest, @Param() p: Record<string, string>, @Body() body: unknown) {
    return this.processing.complete(args(req, p), parse(completeRequest, body));
  }
}
