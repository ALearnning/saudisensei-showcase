import { BadRequestException, Body, Controller, Get, Inject, Patch, Req } from "@nestjs/common";
import { z } from "zod";
import { RequireRoles } from "../authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { USER_DIRECTORY, type UserDirectory } from "../users/user-directory.js";

export const profilePatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  preferredLocale: z.enum(["ar", "en"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

@Controller()
export class IdentityController {
  constructor(@Inject(USER_DIRECTORY) private readonly users: UserDirectory) {}
  @Get("me")
  me(@Req() request: AuthenticatedRequest) { return request.user; }

  @Patch("me")
  update(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const result = profilePatchSchema.safeParse(body);
    if (!result.success) throw new BadRequestException("INVALID_PROFILE_INPUT");
    return this.users.updateProfile(request.user.id, result.data, request.requestId);
  }

  @Get("student/protected")
  @RequireRoles("student")
  student(@Req() request: AuthenticatedRequest) { return { area: "student", user: request.user }; }

  @Get("admin/protected")
  @RequireRoles("admin")
  admin(@Req() request: AuthenticatedRequest) { return { area: "admin", user: request.user }; }
}
