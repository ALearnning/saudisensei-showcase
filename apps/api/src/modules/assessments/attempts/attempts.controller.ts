import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { RequireRoles } from "../../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { AttemptsService } from "./attempts.service.js";
import { AssessmentBudget } from "../assessment-rate.guard.js";

@Controller("me/assessment-attempts")
@RequireRoles("student")
export class AttemptsController {
  constructor(@Inject(AttemptsService) private readonly service: AttemptsService) {}
  @Get() history(@Req() req: AuthenticatedRequest, @Query() q: unknown) { return this.service.history(req, q); }
  @Get(":attemptId") resume(@Req() req: AuthenticatedRequest, @Param("attemptId") id: string) { return this.service.resume(req, id); }
  @AssessmentBudget("save")
  @Put(":attemptId/answers") save(@Req() req: AuthenticatedRequest, @Param("attemptId") id: string, @Body() body: unknown) { return this.service.save(req, id, body); }
  @AssessmentBudget("flag")
  @Put(":attemptId/questions/:questionId/flag") flag(@Req() req: AuthenticatedRequest, @Param("attemptId") id: string, @Param("questionId") question: string, @Body() body: unknown) { return this.service.flag(req, id, question, body); }
  @AssessmentBudget("submit")
  @Post(":attemptId/submit") submit(@Req() req: AuthenticatedRequest, @Param("attemptId") id: string, @Body() body: unknown) { return this.service.submit(req, id, body); }
}
