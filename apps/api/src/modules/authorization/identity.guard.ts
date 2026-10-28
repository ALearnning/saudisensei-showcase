import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IDENTITY_ADAPTER, type IdentityAdapter } from "../identity/identity-adapter.js";
import { USER_DIRECTORY, type UserDirectory } from "../users/user-directory.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import { PUBLIC_ROUTE } from "./access.decorators.js";

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IDENTITY_ADAPTER) private readonly adapter: IdentityAdapter,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !/^Bearer [^\s,]+$/i.test(header) || header.length > 16384) {
      throw new UnauthorizedException("AUTHENTICATION_REQUIRED");
    }
    const identity = await this.adapter.verifyAccessToken(header.slice(7));
    if (!identity.emailVerified) throw new ForbiddenException("EMAIL_VERIFICATION_REQUIRED");
    const user = await this.users.resolve(identity, request.requestId);
    if (user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
    request.user = user;
    request.mfaVerified = identity.mfaVerified;
    return true;
  }
}
