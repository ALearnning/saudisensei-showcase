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
import { LmsModule } from "../src/modules/courses/lms.module.js";
import { CoursesService } from "../src/modules/courses/courses.service.js";
import { StructureService } from "../src/modules/courses/structure.service.js";
import { EnrollmentsService } from "../src/modules/enrollments/enrollments.service.js";
import { LearningService } from "../src/modules/progress/learning.service.js";
import { LmsQueries } from "../src/modules/dashboards/lms.queries.js";

const id = randomUUID();
const profile = { id, email: "isolated@example.invalid", displayName: "Isolated fixture", status: "active", preferredLocale: "ar", roles: ["student"] };
let calls = 0;
const stub = new Proxy({}, { get: (_target, key) => key === "then" ? undefined : async () => { calls++; return { checkedByTest: true }; } });
const adapter = { async verifyAccessToken(token: string) {
  if (!["student", "admin", "admin-no-mfa", "inactive", "unverified"].includes(token)) throw new UnauthorizedException("INVALID_ACCESS_TOKEN");
  return { issuer: "https://fixture.invalid/", subject: token, email: profile.email, displayName: profile.displayName,
    emailVerified: token !== "unverified", mfaVerified: token === "admin" };
} };
let app: INestApplication;
before(async () => {
  const builder = Test.createTestingModule({ imports: [IdentityModule, LmsModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue(adapter)
    .overrideProvider(USER_DIRECTORY).useValue({
      async resolve(identity: { subject: string }) {
        return { ...profile, roles: identity.subject.startsWith("admin") ? ["student", "admin"] : ["student"],
          status: identity.subject === "inactive" ? "suspended" : "active" };
      },
    });
  for (const service of [CoursesService, StructureService, EnrollmentsService, LearningService, LmsQueries])
    builder.overrideProvider(service).useValue(stub);
  app = (await builder.compile()).createNestApplication();
  configureApp(app); await app.init();
});
after(async () => { await app.close(); });

const adminRoutes: [string, string, object?][] = [
  ["get", "admin/dashboard"], ["get", "admin/courses"], ["post", "admin/courses", { title: "A" }],
  ["get", `admin/courses/${id}`], ["patch", `admin/courses/${id}`, { title: "A", expectedRevision: 0 }],
  ...["publish", "unpublish", "archive"].map((action): [string, string, object] => ["post", `admin/courses/${id}/${action}`, { expectedRevision: 0 }]),
  ["post", `admin/courses/${id}/chapters`, { title: "A", expectedRevision: 0 }],
  ["get", `admin/chapters/${id}`], ["patch", `admin/chapters/${id}`, { title: "A", expectedRevision: 0 }],
  ["post", `admin/chapters/${id}/lessons`, { title: "A", body: "# Lesson", expectedRevision: 0 }],
  ["get", `admin/lessons/${id}`], ["patch", `admin/lessons/${id}`, { body: "A", expectedRevision: 0 }],
  ["put", `admin/courses/${id}/chapter-order`, { orderedIds: [], expectedRevision: 0 }],
  ["put", `admin/chapters/${id}/lesson-order`, { orderedIds: [], expectedRevision: 0 }],
  ["get", "admin/students"], ["get", `admin/students/${id}`], ["get", "admin/enrollments"],
  ["post", "admin/enrollments", { studentId: id, courseId: id }],
  ["patch", `admin/enrollments/${id}`, { status: "revoked" }],
];
const studentRoutes: [string, string, object?][] = [
  ["get", "courses"], ["get", `courses/${id}`], ["get", "me/enrollments"],
  ["get", `me/courses/${id}/progress`], ["get", "me/dashboard"], ["get", `lessons/${id}`],
  ["put", `me/lessons/${id}/completion`, {}],
];
async function invoke(route: [string, string, object?], token?: string) {
  const [method, path, data] = route;
  const agent = request(app.getHttpServer());
  const req = method === "post" ? agent.post(`/api/v1/${path}`) : method === "put" ? agent.put(`/api/v1/${path}`)
    : method === "patch" ? agent.patch(`/api/v1/${path}`) : agent.get(`/api/v1/${path}`);
  if (token) req.auth(token, { type: "bearer" });
  if (data) req.send(data);
  return req;
}
test("every new LMS endpoint blocks anonymous access before business execution", async () => {
  const beforeCalls = calls;
  for (const route of [...adminRoutes, ...studentRoutes]) assert.equal((await invoke(route)).status, 401, route[1]);
  assert.equal(calls, beforeCalls);
});
test("every Admin endpoint denies Students, including direct mutations", async () => {
  const beforeCalls = calls;
  for (const route of adminRoutes) assert.equal((await invoke(route, "student")).status, 403, route[1]);
  assert.equal(calls, beforeCalls);
});
test("every Admin endpoint preserves signed MFA enforcement", async () => {
  const beforeCalls = calls;
  for (const route of adminRoutes) {
    const result = await invoke(route, "admin-no-mfa");
    assert.equal(result.status, 403, route[1]); assert.equal(result.body.code, "ADMIN_MFA_REQUIRED");
  }
  assert.equal(calls, beforeCalls);
});
test("existing verified Admin and Student principals reach the correct controllers", async () => {
  for (const route of adminRoutes) {
    const result = await invoke(route, "admin");
    assert.ok([200, 201].includes(result.status), route[1]);
  }
  for (const route of studentRoutes) assert.equal((await invoke(route, "student")).status, 200, route[1]);
});
test("unverified and suspended identities remain blocked on new LMS routes", async () => {
  const beforeCalls = calls;
  for (const token of ["unverified", "inactive"]) {
    assert.equal((await invoke(["get", "me/dashboard"], token)).status, 403);
    assert.equal((await invoke(["post", "admin/courses", { title: "A" }], token)).status, 403);
  }
  assert.equal(calls, beforeCalls);
});
test("new curriculum endpoints strictly reject client actor/role/status and malformed IDs", async () => {
  assert.equal((await invoke(["post", "admin/courses", { title: "A", createdBy: id }], "admin")).status, 400);
  assert.equal((await invoke(["patch", `admin/courses/${id}`, { expectedRevision: 0, status: "published" }], "admin")).status, 400);
  assert.equal((await invoke(["put", `me/lessons/${id}/completion`, { percentage: 100, studentId: id }], "student")).status, 400);
  assert.equal((await invoke(["get", "courses/not-a-uuid"], "student")).status, 400);
});
