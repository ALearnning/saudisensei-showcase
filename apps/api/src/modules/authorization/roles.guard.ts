import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRED_ROLES } from "./access.decorators.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<("student" | "admin")[]>(
      REQUIRED_ROLES, [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user || !required.every((role) => user.roles.includes(role))) throw new ForbiddenException("ROLE_REQUIRED");
    if (required.includes("admin") && !request.mfaVerified) throw new ForbiddenException("ADMIN_MFA_REQUIRED");
    return true;
  }
}
