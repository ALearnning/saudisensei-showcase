import { before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { Auth0IdentityAdapter, MFA_CLAIM } from "../src/modules/identity/auth0.adapter.js";
import { IdentityUpstreamError } from "../src/modules/identity/identity-upstream-error.js";
import { UserInfoProfileCache } from "../src/modules/identity/userinfo-profile-cache.js";
import { IdentityGuard } from "../src/modules/authorization/identity.guard.js";
import { RolesGuard } from "../src/modules/authorization/roles.guard.js";
import { REQUIRED_ROLES } from "../src/modules/authorization/access.decorators.js";
import type { ApplicationUser, UserDirectory } from "../src/modules/users/user-directory.js";

const settings = { issuer: "https://identity.example.invalid/", audience: "https://api.example.invalid" };
const profile = { sub: "fixture", email: "fixture@example.invalid", email_verified: true, name: "Fixture" };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
before(async () => { keys = await generateKeyPair("RS256"); });
async function sign(mfa = false, expired = false, subject = "fixture") {
  return new SignJWT({ [MFA_CLAIM]: mfa }).setProtectedHeader({ alg: "RS256" })
    .setIssuer(settings.issuer).setAudience(settings.audience).setSubject(subject)
    .setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 60 : "10m").sign(keys.privateKey);
}
function fixture(now: () => number = Date.now) {
  const adapter = new Auth0IdentityAdapter();
  // Isolated unit fixtures only: actual RSA verification, no live API or provider.
  Object.assign(adapter, { settings, keys: keys.publicKey, profiles: new UserInfoProfileCache(now) });
  return adapter;
}
async function withFetch(run: (calls: () => number) => Promise<void>, response: () => Promise<Response> = async () => Response.json(profile)) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    assert.ok(String(input) === `${settings.issuer}userinfo`, "Fixture must not contact a real provider");
    calls++; return response();
  };
  try { await run(() => calls); } finally { globalThis.fetch = original; }
}

test("repeated requests reuse a validated profile, not the token authorization verdict", async () => {
  await withFetch(async calls => {
    const adapter = fixture(), token = await sign();
    await adapter.verifyAccessToken(token); await adapter.verifyAccessToken(token);
    assert.equal(calls(), 1);
    const other = await generateKeyPair("RS256");
    Object.assign(adapter, { keys: other.publicKey });
    await assert.rejects(adapter.verifyAccessToken(token), /INVALID_ACCESS_TOKEN/);
    assert.equal(calls(), 1);
  });
});

test("cache cannot confer MFA proof to a different token", async () => {
  await withFetch(async calls => {
    const adapter = fixture();
    assert.equal((await adapter.verifyAccessToken(await sign(true))).mfaVerified, true);
    assert.equal((await adapter.verifyAccessToken(await sign(false))).mfaVerified, false);
    assert.equal(calls(), 2);
  });
});

test("expired tokens are rejected without loading a cached or new profile", async () => {
  await withFetch(async calls => {
    const adapter = fixture(); await adapter.verifyAccessToken(await sign());
    await assert.rejects(adapter.verifyAccessToken(await sign(false, true)), /INVALID_ACCESS_TOKEN/);
    assert.equal(calls(), 1);
  });
});

test("subject mismatch and malformed profiles never enter the cache", async () => {
  let responseCount = 0;
  await withFetch(async calls => {
    const adapter = fixture(), token = await sign();
    await assert.rejects(adapter.verifyAccessToken(token), /IDENTITY_SUBJECT_MISMATCH/);
    await assert.rejects(adapter.verifyAccessToken(token), /INVALID_IDENTITY_PROFILE/);
    assert.equal(calls(), 2);
  }, async () => Response.json(++responseCount === 1 ? { ...profile, sub: "other-fixture" } : { sub: "fixture" }));
});

test("429 blocks additional UserInfo calls for the same identity without stale fallback", async () => {
  await withFetch(async calls => {
    const adapter = fixture(), token = await sign();
    await assert.rejects(adapter.verifyAccessToken(token), (error: unknown) =>
      error instanceof IdentityUpstreamError && error.diagnostics.reason === "RATE_LIMIT"
      && error.diagnostics.upstreamStatus === 429 && error.diagnostics.retryAfterSeconds === 116);
    await assert.rejects(adapter.verifyAccessToken(await sign(true)), (error: unknown) =>
      error instanceof IdentityUpstreamError && error.diagnostics.reason === "COOLDOWN");
    assert.equal(calls(), 1);
  }, async () => new Response(null, { status: 429, headers: { "Retry-After": "116" } }));
});

test("failed refresh remains fail closed after a warmed profile expires", async () => {
  let now = Date.now(), responseCount = 0;
  await withFetch(async calls => {
    const adapter = fixture(() => now), token = await sign();
    await adapter.verifyAccessToken(token);
    now += 30_000;
    await assert.rejects(adapter.verifyAccessToken(token), IdentityUpstreamError);
    await assert.rejects(adapter.verifyAccessToken(token), IdentityUpstreamError);
    assert.equal(calls(), 3);
  }, async () => ++responseCount === 1 ? Response.json(profile) : new Response(null, { status: 503 }));
});

test("timeouts and network errors expose only safe diagnostics", async () => {
  await withFetch(async () => {
    await assert.rejects(fixture().verifyAccessToken(await sign()), (error: unknown) =>
      error instanceof IdentityUpstreamError && error.diagnostics.reason === "TIMEOUT"
      && Object.keys(error.diagnostics).length === 2);
  }, async () => { throw new DOMException("Private provider details must not be retained", "TimeoutError"); });
});

test("cached profile does not cache account state, local roles or Admin authorization", async () => {
  await withFetch(async calls => {
    const adapter = fixture(), token = await sign();
    let reads = 0;
    let account: ApplicationUser = {
      id: "fixture", email: profile.email, displayName: "Fixture", status: "active", preferredLocale: "ar", roles: ["admin"],
    };
    const directory: UserDirectory = {
      async resolve() { reads++; return { ...account, roles: [...account.roles] }; },
      async updateProfile() { throw new Error("Unused fixture"); },
    };
    const handler = () => {};
    Reflect.defineMetadata(REQUIRED_ROLES, ["admin"], handler);
    const reflector = new Reflector();
    const identityGuard = new IdentityGuard(reflector, adapter, directory);
    const rolesGuard = new RolesGuard(reflector);
    const request = { headers: { authorization: `Bearer ${token}` }, requestId: "fixture" };
    const context = {
      getHandler: () => handler, getClass: () => Object,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await identityGuard.canActivate(context);
    assert.throws(() => rolesGuard.canActivate(context), /ADMIN_MFA_REQUIRED/);
    account = { ...account, roles: ["student"] };
    await identityGuard.canActivate(context);
    assert.throws(() => rolesGuard.canActivate(context), /ROLE_REQUIRED/);
    account = { ...account, status: "suspended" };
    await assert.rejects(identityGuard.canActivate(context), /ACCOUNT_INACTIVE/);
    assert.equal(reads, 3);
    assert.equal(calls(), 1);
  });
});
