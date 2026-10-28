import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { RequireRoles } from "../../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { AttemptsService } from "./attempts.service.js";
import { AssessmentBudget } from "../assessment-rate.guard.js";

@Controller(":scope/:parentId/quizzes")
@RequireRoles("student")
export class StudentQuizzesController {
  constructor(@Inject(AttemptsService) private readonly service: AttemptsService) {}
  @Get() list(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Query() q: unknown) {
    return this.service.listQuizzes(req, scope, parent, q);
  }
  @Get(":quizId") get(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Query() q: unknown) {
    return this.service.quiz(req, scope, parent, id, q);
  }
  @AssessmentBudget("start")
  @Post(":quizId/attempts") start(@Req() req: AuthenticatedRequest, @Param("scope") scope: string, @Param("parentId") parent: string, @Param("quizId") id: string, @Body() body: unknown) {
    return this.service.start(req, scope, parent, id, body);
  }
}
