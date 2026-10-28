import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { configureApp } from "../src/config/configure-app.js";
import { IdentityModule } from "../src/modules/identity/identity.module.js";
import { IDENTITY_ADAPTER } from "../src/modules/identity/identity-adapter.js";
import { USER_DIRECTORY } from "../src/modules/users/user-directory.js";
import { AssessmentsModule } from "../src/modules/assessments/assessments.module.js";
import { AttemptsService } from "../src/modules/assessments/attempts/attempts.service.js";

const id = randomUUID();
let calls = 0;
const stub = new Proxy({}, { get: (_target, key) => key === "then" ? undefined :
  async () => { calls++; return { fixture: true }; } });
let app: INestApplication;
before(async () => {
  const module = await Test.createTestingModule({ imports: [IdentityModule, AssessmentsModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue({
      async verifyAccessToken(token: string) {
        if (!["admin-only", "student", "inactive", "unverified"].includes(token)) throw new UnauthorizedException();
        return { issuer: "https://fixture.invalid/", subject: token, email: "fixture@example.invalid",
          displayName: "Fixture", emailVerified: token !== "unverified", mfaVerified: false };
      },
    })
    .overrideProvider(USER_DIRECTORY).useValue({ async resolve(identity: { subject: string }) {
      return { id, email: "fixture@example.invalid", displayName: "Fixture", preferredLocale: "ar",
        status: identity.subject === "inactive" ? "suspended" : "active",
        roles: identity.subject === "admin-only" ? ["admin"] : ["student"] };
    } })
    .overrideProvider(AttemptsService).useValue(stub).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
after(async () => { await app?.close(); });
type Route = ["get" | "post" | "put", string];
const own = `me/assessment-attempts/${id}`;
const routes: Route[] = [["get", "me/assessment-attempts"], ["get", own],
  ["put", `${own}/answers`], ["put", `${own}/questions/${id}/flag`], ["post", `${own}/submit`]];
for (const scope of ["courses", "chapters", "lessons"]) {
  const base = `${scope}/${id}/quizzes`;
  routes.push(["get", base], ["get", `${base}/${id}`], ["post", `${base}/${id}/attempts`]);
}
function invoke([method, path]: Route, token?: string) {
  let req = request(app.getHttpServer())[method](`/api/v1/${path}`);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (method !== "get") req = req.send({});
  return req;
}
for (const [name, token, status] of [
  ["anonymous", undefined, 401], ["Admin lacking Student role", "admin-only", 403],
  ["inactive account", "inactive", 403], ["unverified identity", "unverified", 403],
] as const) {
  test(`all Q5 Student routes deny ${name} before business execution`, async () => {
    const count = calls;
    for (const route of routes) assert.equal((await invoke(route, token)).status, status, route[1]);
    assert.equal(calls, count);
  });
}
test("verified active Student reaches all Q5 handlers without Admin MFA", async () => {
  const count = calls;
  for (const route of routes) assert.ok([200, 201].includes((await invoke(route, "student")).status), route[1]);
  assert.equal(calls - count, routes.length);
});
test("unapproved plural results and public grade routes remain absent", async () => {
  for (const suffix of ["results", "grade"])
    assert.equal((await invoke(["get", `${own}/${suffix}`], "student")).status, 404);
});
