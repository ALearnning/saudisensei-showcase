import "reflect-metadata";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { IdentityModule } from "../src/modules/identity/identity.module.js";
import { IDENTITY_ADAPTER, type IdentityAdapter, type VerifiedIdentity } from "../src/modules/identity/identity-adapter.js";
import { USER_DIRECTORY, type ApplicationUser, type UserDirectory } from "../src/modules/users/user-directory.js";
import { configureApp } from "../src/config/configure-app.js";

const id = randomUUID();
const profile: ApplicationUser = {
  id, email: "fixture@example.invalid", displayName: "Test identity",
  status: "active", preferredLocale: "ar", roles: ["student"],
};
const identities = new Map<string, VerifiedIdentity>();
for (const subject of ["student", "admin", "admin-no-mfa", "suspended", "deleted", "unverified", "forged-roles"]) {
  identities.set(subject, {
    issuer: "https://identity.example.invalid/", subject,
    email: profile.email, emailVerified: subject !== "unverified", displayName: profile.displayName,
    mfaVerified: subject === "admin",
  });
}
const adapter: IdentityAdapter = {
  async verifyAccessToken(token) {
    const identity = identities.get(token);
    if (!identity) throw new UnauthorizedException("INVALID_ACCESS_TOKEN");
    return identity;
  },
};
let writes = 0;
const users: UserDirectory = {
  async resolve(identity) {
    return {
      ...profile,
      status: identity.subject === "suspended" ? "suspended" : identity.subject === "deleted" ? "deleted" : "active",
      roles: identity.subject.startsWith("admin") ? ["student", "admin"] : ["student"],
    };
  },
  async updateProfile(_userId, patch) {
    writes += 1;
    return { ...profile, ...patch };
  },
};
let app: INestApplication;
before(async () => {
  const module = await Test.createTestingModule({ imports: [IdentityModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue(adapter)
    .overrideProvider(USER_DIRECTORY).useValue(users)
    .compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.init();
});
after(async () => { await app.close(); });

test("unauthenticated access is denied on every protected endpoint", async () => {
  for (const path of ["me", "student/protected", "admin/protected"]) {
    const response = await request(app.getHttpServer()).get(`/api/v1/${path}`);
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "AUTHENTICATION_REQUIRED");
    assert.equal(response.body.user, undefined);
  }
});
test("malformed authorization header is rejected", async () => {
  assert.equal((await request(app.getHttpServer()).get("/api/v1/me").set("Authorization", "Basic student")).status, 401);
});
test("invalid access token is rejected", async () => {
  assert.equal((await request(app.getHttpServer()).get("/api/v1/me").auth("invalid", { type: "bearer" })).status, 401);
});
test("Student can access Student route", async () => {
  const response = await request(app.getHttpServer()).get("/api/v1/student/protected").auth("student", { type: "bearer" });
  assert.equal(response.status, 200);
  assert.equal(response.body.area, "student");
});
test("Student cannot access Admin route", async () => {
  const response = await request(app.getHttpServer()).get("/api/v1/admin/protected").auth("student", { type: "bearer" });
  assert.equal(response.status, 403);
  assert.equal(response.body.user, undefined);
});
test("Admin can access Admin route", async () => {
  const response = await request(app.getHttpServer()).get("/api/v1/admin/protected").auth("admin", { type: "bearer" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.user.roles, ["student", "admin"]);
});
test("Admin without verified MFA cannot access Admin route", async () => {
  const response = await request(app.getHttpServer()).get("/api/v1/admin/protected").auth("admin-no-mfa", { type: "bearer" });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "ADMIN_MFA_REQUIRED");
});
test("suspended user is denied on all protected routes", async () => {
  for (const path of ["me", "student/protected", "admin/protected"]) {
    const response = await request(app.getHttpServer()).get(`/api/v1/${path}`).auth("suspended", { type: "bearer" });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "ACCOUNT_INACTIVE");
  }
});
test("deleted user is denied", async () => {
  assert.equal((await request(app.getHttpServer()).get("/api/v1/me").auth("deleted", { type: "bearer" })).status, 403);
});
test("unverified email is denied before application provisioning", async () => {
  const response = await request(app.getHttpServer()).get("/api/v1/me").auth("unverified", { type: "bearer" });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "EMAIL_VERIFICATION_REQUIRED");
});
test("roles cannot be assigned from client input", async () => {
  const initial = writes;
  const response = await request(app.getHttpServer()).patch("/api/v1/me").auth("student", { type: "bearer" })
    .send({ displayName: "Untrusted", roles: ["admin"] });
  assert.equal(response.status, 400);
  assert.equal(writes, initial);
});
test("identity and application status cannot be assigned from client input", async () => {
  for (const body of [{ status: "active" }, { userId: randomUUID() }, { email: "attacker@example.invalid" }, { role: "admin" }]) {
    assert.equal((await request(app.getHttpServer()).patch("/api/v1/me").auth("student", { type: "bearer" }).send(body)).status, 400);
  }
});
test("roles from query parameters or headers are ignored", async () => {
  assert.equal((await request(app.getHttpServer()).get("/api/v1/admin/protected?role=admin")
    .set("X-Role", "admin").auth("forged-roles", { type: "bearer" })).status, 403);
});
test("permitted profile fields can be updated", async () => {
  const response = await request(app.getHttpServer()).patch("/api/v1/me").auth("student", { type: "bearer" })
    .send({ displayName: "اسم الطالب", preferredLocale: "en" });
  assert.equal(response.status, 200);
  assert.equal(response.body.displayName, "اسم الطالب");
  assert.deepEqual(response.body.roles, ["student"]);
});
test("responses are not cacheable and receive server-owned request IDs", async () => {
  const response = await request(app.getHttpServer()).get("/api/v1/me").auth("student", { type: "bearer" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.headers["x-request-id"], /^[0-9a-f-]{36}$/);
});
