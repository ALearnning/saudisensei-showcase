import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { RequireRoles } from "../../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../../authorization/authenticated-request.js";
import { parse, revisionInput, uuid } from "../../courses/lms.schemas.js";
import { SkillsService } from "./skills.service.js";
import * as s from "./skill.schemas.js";

@Controller("admin/skills")
@RequireRoles("admin")
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}
  @Get() list(@Query() query: unknown) { return this.skills.list(parse(s.skillList, query)); }
  @Post() create(@Req() actor: AuthenticatedRequest, @Body() body: unknown) {
    return this.skills.create(actor, parse(s.skillCreate, body));
  }
  @Get(":skillId") get(@Param("skillId") id: string) { return this.skills.get(parse(uuid, id)); }
  @Patch(":skillId") edit(@Req() actor: AuthenticatedRequest, @Param("skillId") id: string, @Body() body: unknown) {
    return this.skills.edit(actor, parse(uuid, id), parse(s.skillEdit, body));
  }
  @Post(":skillId/move") move(@Req() actor: AuthenticatedRequest, @Param("skillId") id: string, @Body() body: unknown) {
    return this.skills.move(actor, parse(uuid, id), parse(s.skillMove, body));
  }
  @Post(":skillId/archive") archive(@Req() actor: AuthenticatedRequest, @Param("skillId") id: string, @Body() body: unknown) {
    return this.skills.archive(actor, parse(uuid, id), parse(revisionInput, body).expectedRevision);
  }
}
