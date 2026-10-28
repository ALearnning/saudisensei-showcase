import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { RequireRoles } from "../../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { QuestionBankService } from "./question-bank.service.js";

@Controller("admin/question-bank/questions")
@RequireRoles("admin")
export class QuestionBankController {
  constructor(@Inject(QuestionBankService) private readonly service: QuestionBankService) {}
  @Get() list(@Query() query: unknown) { return this.service.list(query); }
  @Post() create(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.service.create(req, body); }
  @Get(":questionId") get(@Param("questionId") id: string) { return this.service.get(id); }
  @Patch(":questionId") edit(@Req() req: AuthenticatedRequest, @Param("questionId") id: string, @Body() body: unknown) {
    return this.service.edit(req, id, body);
  }
  @Post(":questionId/revisions") seal(@Req() req: AuthenticatedRequest, @Param("questionId") id: string, @Body() body: unknown) {
    return this.service.seal(req, id, body);
  }
  @Get(":questionId/revisions") revisions(@Param("questionId") id: string, @Query() query: unknown) {
    return this.service.revisions(id, query);
  }
  @Get(":questionId/revisions/:revisionId") revision(@Param("questionId") id: string, @Param("revisionId") revisionId: string) {
    return this.service.revision(id, revisionId);
  }
  @Post(":questionId/archive") archive(@Req() req: AuthenticatedRequest, @Param("questionId") id: string, @Body() body: unknown) {
    return this.service.archive(req, id, body);
  }
}
