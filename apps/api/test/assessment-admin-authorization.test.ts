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
import { QuestionBankService } from "../src/modules/assessments/question-bank/question-bank.service.js";
import { SkillsService } from "../src/modules/assessments/skills/skills.service.js";

// Isolated guard fixtures only: no application mock auth or real Auth0 credentials.
const id = randomUUID();
let calls = 0;
const stub = new Proxy({}, { get: (_t, key) => key === "then" ? undefined
  : async () => { calls++; return { fixture: true }; } });
let app: INestApplication;
before(async () => {
  const module = await Test.createTestingModule({ imports: [IdentityModule, AssessmentsModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue({
      async verifyAccessToken(token: string) {
        if (!["admin", "admin-no-mfa", "student", "inactive", "unverified"].includes(token)) throw new UnauthorizedException("INVALID_ACCESS_TOKEN");
        return { issuer: "https://fixture.invalid/", subject: token, email: "fixture@example.invalid",
          displayName: "Fixture", emailVerified: token !== "unverified", mfaVerified: token === "admin" };
      },
    })
    .overrideProvider(USER_DIRECTORY).useValue({ async resolve(identity: { subject: string }) {
      return { id, email: "fixture@example.invalid", displayName: "Fixture", preferredLocale: "ar",
        status: identity.subject === "inactive" ? "suspended" : "active",
        roles: identity.subject === "student" ? ["student"] : ["student", "admin"] };
    } })
    .overrideProvider(QuestionBankService).useValue(stub)
    .overrideProvider(SkillsService).useValue(stub)
    .compile();
  app = module.createNestApplication(); configureApp(app); await app.init();
});
after(async () => { await app?.close(); });
type Route = ["get" | "post" | "patch", string, object?];
const question = `admin/question-bank/questions/${id}`;
const routes: Route[] = [
  ["get", "admin/question-bank/questions"], ["post", "admin/question-bank/questions", {}],
  ["get", question], ["patch", question, {}], ["post", `${question}/revisions`, { expectedRevision: 0 }],
  ["get", `${question}/revisions`], ["get", `${question}/revisions/${id}`],
  ["post", `${question}/archive`, { expectedRevision: 0 }],
  ["get", "admin/skills"], ["post", "admin/skills", { slug: "skill", translations: { ar: { label: "مهارة" } } }],
  ["get", `admin/skills/${id}`], ["patch", `admin/skills/${id}`, { expectedRevision: 0, slug: "new" }],
  ["post", `admin/skills/${id}/move`, { expectedRevision: 0, parentId: null }],
  ["post", `admin/skills/${id}/archive`, { expectedRevision: 0 }],
];
function invoke([method, path, body]: Route, token?: string) {
  let req = request(app.getHttpServer())[method](`/api/v1/${path}`);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  if (body) req = req.send(body);
  return req;
}
for (const [name, token, status] of [
  ["anonymous", undefined, 401], ["Student", "student", 403],
  ["Admin without signed MFA", "admin-no-mfa", 403],
  ["inactive account", "inactive", 403], ["unverified identity", "unverified", 403],
] as const) {
  test(`all 14 Q3 Admin read/mutation endpoints deny ${name} before business access`, async () => {
    const before = calls;
    for (const route of routes) assert.equal((await invoke(route, token)).status, status, route[1]);
    assert.equal(calls, before);
  });
}
test("verified Admin with upstream signed MFA reaches all 14 Q3 controllers", async () => {
  const before = calls;
  for (const route of routes) assert.ok([200, 201].includes((await invoke(route, "admin")).status), route[1]);
  assert.equal(calls - before, routes.length);
});
test("no Student Question Bank, taxonomy, generic builder or result endpoints exposed", async () => {
  for (const path of ["question-bank/questions", "skills", `me/assessment-attempts/${id}/results`, "admin/quizzes"]) {
    assert.equal((await invoke(["get", path], "student")).status, 404);
  }
});
