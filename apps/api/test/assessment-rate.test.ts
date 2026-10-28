import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AssessmentRateGuard, assessmentLimits, type AssessmentOperation } from "../src/modules/assessments/assessment-rate.guard.js";

function fixture() {
  let operation: AssessmentOperation = "save", user = "one";
  const reflector = { getAllAndOverride: () => operation } as unknown as Reflector;
  const ctx = { getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: user ? { id: user } : undefined }) }) } as unknown as ExecutionContext;
  const guard = new AssessmentRateGuard(reflector);
  return { call: () => guard.canActivate(ctx), operation: (v: AssessmentOperation) => { operation = v; },
    user: (v: string) => { user = v; } };
}
test("assessment operation budgets are identity-scoped and submission remains independent", () => {
  const f = fixture();
  for (let i = 0; i < 30; i++) assert.equal(f.call(), true);
  assert.throws(f.call, /ASSESSMENT_RATE_LIMITED/);
  f.operation("submit");
  for (let i = 0; i < 10; i++) assert.equal(f.call(), true);
  assert.throws(f.call, /ASSESSMENT_RATE_LIMITED/);
  f.user("two"); assert.equal(f.call(), true);
});
test("start and flag limits remain bounded and missing identity fails closed", () => {
  const f = fixture();
  for (const operation of ["start", "flag"] as const) {
    f.operation(operation);
    for (let i = 0; i < assessmentLimits[operation]; i++) f.call();
    assert.throws(f.call, /ASSESSMENT_RATE_LIMITED/);
  }
  f.user(""); assert.throws(f.call, /AUTHENTICATION_REQUIRED/);
});
