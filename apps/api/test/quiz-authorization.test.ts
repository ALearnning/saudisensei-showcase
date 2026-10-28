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
import { QuizzesService } from "../src/modules/assessments/quizzes/quizzes.service.js";

// Test-only identity fixtures exercise real global guards; no app authentication changes.
const id = randomUUID();
let calls = 0;
const stub = new Proxy({}, { get: (_target, key) => key === "then" ? undefined :
  async () => { calls++; return { fixture: true }; } });
let app: INestApplication;
before(async () => {
  const module = await Test.createTestingModule({ imports: [IdentityModule, AssessmentsModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue({
      async verifyAccessToken(token: string) {
        if (!["admin", "admin-no-mfa", "student", "inactive", "unverified"].includes(token)) throw new UnauthorizedException();
        return { issuer: "https://fixture.invalid/", subject: token, email: "fixture@example.invalid",
          displayName: "Fixture", emailVerified: token !== "unverified", mfaVerified: token === "admin" };
      },
    })
    .overrideProvider(USER_DIRECTORY).useValue({ async resolve(identity: { subject: string }) {
      return { id, email: "fixture@example.invalid", displayName: "Fixture", preferredLocale: "ar",
        status: identity.subject === "inactive" ? "suspended" : "active",
        roles: identity.subject === "student" ? ["student"] : ["student", "admin"] };
    } })
    .overrideProvider(QuizzesService).useValue(stub).compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
after(async () => { await app?.close(); });
type Route = ["get" | "post" | "patch" | "put", string];
const routes: Route[] = [];
for (const scope of ["courses", "chapters", "lessons"]) {
  const base = `admin/${scope}/${id}/quizzes`, quiz = `${base}/${id}`;
  routes.push(["get", base], ["post", base], ["get", quiz], ["patch", quiz], ["put", `${quiz}/items`],
    ...["preview", "answer-preview", "publish", "unpublish", "archive"].map(action => ["post", `${quiz}/${action}`] as Route),
    ["get", `${quiz}/revisions`], ["get", `${quiz}/revisions/${id}`], ["post", `${quiz}/revisions/${id}/review-release`]);
}
function invoke([method, path]: Route, token?: string) {
  let req = request(app.getHttpServer())[method](`/api/v1/${path}`);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (method !== "get") req = req.send({});
  return req;
}
for (const [name, token, status] of [
  ["anonymous", undefined, 401], ["Student", "student", 403],
  ["Admin without signed MFA", "admin-no-mfa", 403],
  ["inactive account", "inactive", 403], ["unverified identity", "unverified", 403],
] as const) {
  test(`all Q4 operations across three parent scopes deny ${name}`, async () => {
    const count = calls;
    for (const route of routes) assert.equal((await invoke(route, token)).status, status, route[1]);
    assert.equal(calls, count);
  });
}
test("verified active Admin with signed MFA reaches all Q4 operations", async () => {
  const count = calls;
  for (const route of routes) assert.ok([200, 201].includes((await invoke(route, "admin")).status), route[1]);
  assert.equal(calls - count, 39);
});
test("Q6 still excludes public grading and unrestricted quiz presentation routes", async () => {
  for (const path of [`me/assessment-attempts/${id}/results`, `me/quizzes/${id}/attempts`, `quizzes/${id}/preview`])
    assert.equal((await invoke(["get", path], "student")).status, 404);
});
