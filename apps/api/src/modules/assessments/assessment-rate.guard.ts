import { applyDecorators, CanActivate, ExecutionContext, HttpException, Inject, Injectable, SetMetadata, UseGuards } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";

export const ASSESSMENT_BUDGET = "assessment:budget";
export const assessmentLimits = { start: 5, save: 30, flag: 30, submit: 10 } as const;
export type AssessmentOperation = keyof typeof assessmentLimits;
export const AssessmentBudget = (operation: AssessmentOperation) =>
  applyDecorators(SetMetadata(ASSESSMENT_BUDGET, operation), UseGuards(AssessmentRateGuard));

/** Additional per-identity budgets, never an exemption from the global limiter.
 * Independent buckets reserve submission capacity from autosave/flag traffic.
 * Process-local protection; durable concurrency/idempotency remain database-owned.
 */
@Injectable()
export class AssessmentRateGuard implements CanActivate {
  private readonly windows = new Map<string, { until: number; count: number }>();
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const operation = this.reflector.getAllAndOverride<AssessmentOperation>(
      ASSESSMENT_BUDGET, [context.getHandler(), context.getClass()]);
    if (!operation) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user?.id) throw new HttpException("AUTHENTICATION_REQUIRED", 401);
    const now = Date.now(), key = `${req.user.id}:${operation}`;
    let window = this.windows.get(key);
    if (!window || window.until <= now) {
      if (this.windows.size >= 10000) {
        for (const [entry, value] of this.windows) if (value.until <= now) this.windows.delete(entry);
        if (!this.windows.has(key) && this.windows.size >= 10000)
          throw new HttpException("ASSESSMENT_RATE_LIMITED", 429);
      }
      window = { until: now + 60000, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= assessmentLimits[operation]) throw new HttpException("ASSESSMENT_RATE_LIMITED", 429);
    window.count++;
    return true;
  }
}
