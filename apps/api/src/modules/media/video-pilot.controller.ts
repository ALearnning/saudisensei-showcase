import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { mediaId, parseMedia, emptyInput } from "./media.schemas.js";
import { VideoPilotService } from "./video-pilot.service.js";

@Controller("admin/video-pilot")
@RequireRoles("admin")
export class VideoPilotAdminController {
  constructor(@Inject(VideoPilotService) private readonly service: VideoPilotService) {}
  @Post(":id/attach")
  attach(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseMedia(z.object({ lessonId: mediaId }).strict(), body);
    return this.service.attach(req, parseMedia(mediaId, id), input.lessonId);
  }
}
@Controller()
@RequireRoles("student")
export class VideoPilotStudentController {
  constructor(@Inject(VideoPilotService) private readonly service: VideoPilotService) {}
  @Get("lessons/:lessonId/video-pilot")
  list(@Req() req: AuthenticatedRequest, @Param("lessonId") id: string) {
    return this.service.list(req, parseMedia(mediaId, id));
  }
  @Post("video-pilot/:id/playback")
  playback(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    parseMedia(emptyInput, body);
    return this.service.playback(req, parseMedia(mediaId, id));
  }
}
