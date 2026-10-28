import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArgumentsHost } from "@nestjs/common";
import { HttpErrorFilter } from "../src/common/http-error.filter.js";
import { IdentityUpstreamError } from "../src/modules/identity/identity-upstream-error.js";

test("identity dependency logging is correlated and exposes only safe diagnostic fields", () => {
  let logged: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  let status = 0;
  const headers: Record<string, unknown> = {};
  const response = {
    setHeader(key: string, value: unknown) { headers[key] = value; },
    status(value: number) { status = value; return this; },
    json(value: Record<string, unknown>) { body = value; },
  };
  const filter = new HttpErrorFilter();
  Object.assign(filter, { logger: { error(value: Record<string, unknown>) { logged = value; } } });
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ requestId: "fixture-request" }), getResponse: () => response }),
  } as unknown as ArgumentsHost;
  filter.catch(new IdentityUpstreamError({
    stage: "USERINFO", reason: "RATE_LIMIT", upstreamStatus: 429, retryAfterSeconds: 116,
  }), host);
  assert.equal(status, 503);
  assert.equal(headers["Retry-After"], 116);
  assert.deepEqual(body, { code: "IDENTITY_UNAVAILABLE", requestId: "fixture-request" });
  assert.deepEqual(Object.keys(logged).sort(), ["code", "reason", "requestId", "retryAfterSeconds", "stage", "status", "upstreamStatus"]);
  assert.equal(logged.requestId, "fixture-request");
  assert.equal(logged.upstreamStatus, 429);
});
