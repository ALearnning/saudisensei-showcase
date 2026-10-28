import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { RequireRoles } from "../../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { QuizzesService } from "./quizzes.service.js";

@Controller("admin/:scope/:parentId/quizzes")
@RequireRoles("admin")
export class QuizzesController {
  constructor(@Inject(QuizzesService) private readonly service: QuizzesService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Query() q: unknown) {
    return this.service.list(req, scope, parent, q);
  }
  @Post() create(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Body() body: unknown) {
    return this.service.create(req, scope, parent, body);
  }
  @Get(":quizId") get(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string) {
    return this.service.get(req, scope, parent, id);
  }
  @Patch(":quizId") edit(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.edit(req, scope, parent, id, body);
  }
  @Put(":quizId/items") items(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.replaceItems(req, scope, parent, id, body);
  }
  @Post(":quizId/preview") preview(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.preview(req, scope, parent, id, body);
  }
  @Post(":quizId/answer-preview") answerPreview(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.answerPreview(req, scope, parent, id, body);
  }
  @Post(":quizId/publish") publish(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.publish(req, scope, parent, id, body);
  }
  @Post(":quizId/unpublish") unpublish(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.unpublish(req, scope, parent, id, body);
  }
  @Post(":quizId/archive") archive(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.archive(req, scope, parent, id, body);
  }
  @Get(":quizId/revisions") revisions(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Query() q: unknown) {
    return this.service.revisions(req, scope, parent, id, q);
  }
  @Get(":quizId/revisions/:revisionId") revision(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Param("revisionId") revision: string) {
    return this.service.revision(req, scope, parent, id, revision);
  }
  @Post(":quizId/revisions/:revisionId/review-release") release(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Param("revisionId") revision: string, @Body() body: unknown) {
    return this.service.release(req, scope, parent, id, revision, body);
  }
}
