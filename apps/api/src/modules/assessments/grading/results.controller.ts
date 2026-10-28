import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { RequireRoles } from "../../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { parse } from "../../courses/lms.schemas.js";
import { AssessmentResultsService } from "./results.service.js";

const noQuery = z.object({}).strict();
@Controller("me/assessment-attempts")
@RequireRoles("student")
export class AssessmentResultsController {
  constructor(@Inject(AssessmentResultsService) private readonly results: AssessmentResultsService) {}
  @Get(":attemptId/result") result(@Req() req: AuthenticatedRequest, @Param("attemptId") id: string, @Query() query: unknown) {
    parse(noQuery, query); return this.results.result(req, id);
  }
  @Get(":attemptId/review") review(@Req() req: AuthenticatedRequest, @Param("attemptId") id: string, @Query() query: unknown) {
    parse(noQuery, query); return this.results.review(req, id);
  }
}
