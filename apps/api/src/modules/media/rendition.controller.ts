import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { pipeline } from "node:stream/promises";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { MediaRenditionService, renditionAccessInput } from "./rendition.service.js";
import { MediaAdminVideoService } from "./admin-video.service.js";
import { MediaStudentVideoService } from "./student-video.service.js";
import { z } from "zod";
import * as s from "./library.schemas.js";
type Params = Record<string, string>;
function args(req: AuthenticatedRequest, p: Params, admin: boolean) {
  return { req, scope: s.parse(s.scope, p.scope), parentId: s.parse(s.id, p.parentId),
    placementId: s.parse(s.id, p.placementId), admin };
}
async function bytes(service: MediaRenditionService, req: AuthenticatedRequest, p: Params,
  admin: boolean, token: string, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  try {
    const value = await service.content(args(req, p, admin), token ?? "", controller.signal);
    res.set({
      "Cache-Control": "no-store", "Content-Type": value.contentType,
      "Content-Length": String(value.bytes), "Content-Disposition": value.disposition,
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
      "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "none",
    });
    await pipeline(value.stream, res);
  } catch (error) {
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    throw error;
  } finally { res.off("close", abort); }
}
@Controller("admin/:scope/:parentId/media-library/placements/:placementId")
@RequireRoles("admin")
export class MediaRenditionAdminController {
  constructor(@Inject(MediaRenditionService) private readonly service: MediaRenditionService,
    @Inject(MediaAdminVideoService) private readonly video: MediaAdminVideoService) {}
  @Post("video-preview") videoPreview(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.video.preview(args(req, p, true), s.parse(z.object({ revisionId: s.id }).strict(), body).revisionId);
  }
  @Post("access") access(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.service.issue(args(req, p, true), s.parse(renditionAccessInput, body));
  }
  @Get("content") content(@Req() req: AuthenticatedRequest, @Param() p: Params,
    @Headers("x-media-capability") token: string, @Res() res: Response) {
    return bytes(this.service, req, p, true, token, res);
  }
}
@Controller(":scope/:parentId/media-library/placements/:placementId")
@RequireRoles("student")
export class MediaRenditionStudentController {
  constructor(@Inject(MediaRenditionService) private readonly service: MediaRenditionService,
    @Inject(MediaStudentVideoService) private readonly video: MediaStudentVideoService) {}
  @Post("playback") playback(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.video.playback(args(req, p, false), s.parse(z.object({ revisionId: s.id }).strict(), body).revisionId);
  }
  @Post("access") access(@Req() req: AuthenticatedRequest, @Param() p: Params, @Body() body: unknown) {
    return this.service.issue(args(req, p, false), s.parse(renditionAccessInput, body));
  }
  @Get("content") content(@Req() req: AuthenticatedRequest, @Param() p: Params,
    @Headers("x-media-capability") token: string, @Res() res: Response) {
    return bytes(this.service, req, p, false, token, res);
  }
}
