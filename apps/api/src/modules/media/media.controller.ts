import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { MediaService } from "./media.service.js";
import * as s from "./media.schemas.js";

@Controller("admin")
@RequireRoles("admin")
export class MediaAdminController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Get("lessons/:lessonId/media") list(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string) {
    return this.media.list(req, s.parseMedia(s.mediaId, id), true);
  }
  @Post("lessons/:lessonId/media/uploads") upload(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string, @Body() body: unknown) {
    return this.media.createUpload(req, s.parseMedia(s.mediaId, id), s.parseMedia(s.uploadInput, body));
  }
  @Post("media/uploads/:sessionId/parts") part(@Req() req: AuthenticatedRequest, @Param("sessionId") id: string, @Body() body: unknown) {
    return this.media.part(req, s.parseMedia(s.mediaId, id), s.parseMedia(s.partInput, body).partNumber);
  }
  @Post("media/uploads/:sessionId/complete") complete(@Req() req: AuthenticatedRequest, @Param("sessionId") id: string, @Body() body: unknown) {
    return this.media.complete(req, s.parseMedia(s.mediaId, id), s.parseMedia(s.completeInput, body));
  }
  @Post("media/:assetId/scan") scan(@Req() req: AuthenticatedRequest, @Param("assetId") id: string, @Body() body: unknown) {
    s.parseMedia(s.emptyInput, body);
    return this.media.scan(req, s.parseMedia(s.mediaId, id));
  }
  @Post("media/:assetId/publish") publish(@Req() req: AuthenticatedRequest, @Param("assetId") id: string, @Body() body: unknown) {
    s.parseMedia(s.emptyInput, body);
    return this.media.publish(req, s.parseMedia(s.mediaId, id));
  }
}
@Controller()
@RequireRoles("student")
export class MediaStudentController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Get("lessons/:lessonId/media") list(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string) {
    return this.media.list(req, s.parseMedia(s.mediaId, id), false);
  }
  @Post("media/:assetId/access") access(@Req() req: AuthenticatedRequest, @Param("assetId") id: string, @Body() body: unknown) {
    return this.media.access(req, s.parseMedia(s.mediaId, id), s.parseMedia(s.accessInput, body).mode);
  }
}
