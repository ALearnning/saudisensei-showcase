import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../modules/authorization/authenticated-request.js";
import { IdentityUpstreamError } from "../modules/identity/identity-upstream-error.js";

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpError");
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = host.switchToHttp().getResponse<Response>();
    const transport = error && typeof error === "object" ? error as { status?: number; type?: string } : {};
    const status = error instanceof HttpException ? error.getStatus()
      : transport.type === "entity.too.large" ? 413
      : transport.type === "entity.parse.failed" ? 400 : 500;
    const code = error instanceof HttpException && /^[A-Z_]+$/.test(error.message)
      ? error.message : status === 413 ? "PAYLOAD_TOO_LARGE" : status === 404 ? "NOT_FOUND" : "REQUEST_FAILED";
    const identity = error instanceof IdentityUpstreamError ? error.diagnostics : undefined;
    if (identity?.retryAfterSeconds) response.setHeader("Retry-After", identity.retryAfterSeconds);
    if (status >= 500) this.logger.error({
      requestId: request.requestId, status, code,
      ...(identity ? {
        stage: identity.stage, reason: identity.reason,
        ...(identity.upstreamStatus ? { upstreamStatus: identity.upstreamStatus } : {}),
        ...(identity.retryAfterSeconds ? { retryAfterSeconds: identity.retryAfterSeconds } : {}),
      } : {}),
    });
    response.status(status).json({ code, requestId: request.requestId });
  }
}
