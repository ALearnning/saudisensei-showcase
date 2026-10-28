import { test } from "node:test";
import assert from "node:assert/strict";
import { UserInfoProfileCache, retryAfterSeconds } from "../src/modules/identity/userinfo-profile-cache.js";
import { IdentityUpstreamError } from "../src/modules/identity/identity-upstream-error.js";

const profile = { sub: "fixture", email: "fixture@example.invalid", email_verified: true };

test("successful profiles expire at exactly thirty seconds", async () => {
  let now = 1000, calls = 0;
  const cache = new UserInfoProfileCache(() => now);
  const read = () => cache.get("token", "identity", 100_000, async () => { calls++; return profile; });
  await read(); now = 30_999; await read(); assert.equal(calls, 1);
  now = 31_000; await read(); assert.equal(calls, 2);
});

test("profile lifetime is capped by token expiration", async () => {
  let now = 1000, calls = 0;
  const cache = new UserInfoProfileCache(() => now);
  const read = () => cache.get("token", "identity", 1500, async () => { calls++; return profile; });
  await read(); now = 1500; await read(); await read();
  assert.equal(calls, 3);
});

test("concurrent identical tokens share one in-flight load", async () => {
  let finish!: (value: typeof profile) => void;
  let calls = 0;
  const cache = new UserInfoProfileCache(() => 1000);
  const load = () => { calls++; return new Promise<typeof profile>(resolve => { finish = resolve; }); };
  const requests = Array.from({ length: 8 }, () => cache.get("token", "identity", 100_000, load));
  assert.equal(calls, 1);
  finish(profile);
  const results = await Promise.all(requests);
  assert.equal(results.length, 8);
  assert.ok(Object.isFrozen(results[0]));
});

test("failed refresh never serves the expired profile and is not cached", async () => {
  let now = 1000;
  const cache = new UserInfoProfileCache(() => now);
  await cache.get("token", "identity", 100_000, async () => profile);
  now = 31_000;
  let calls = 0;
  const fail = async () => { calls++; throw new IdentityUpstreamError({ stage: "USERINFO", reason: "NETWORK" }); };
  await assert.rejects(cache.get("token", "identity", 100_000, fail), IdentityUpstreamError);
  await assert.rejects(cache.get("token", "identity", 100_000, fail), IdentityUpstreamError);
  assert.equal(calls, 2);
});

test("unverified profiles are never cached as successes", async () => {
  const cache = new UserInfoProfileCache(() => 1000);
  let calls = 0;
  const load = async () => { calls++; return { ...profile, email_verified: false }; };
  await cache.get("token", "identity", 100_000, load);
  await cache.get("token", "identity", 100_000, load);
  assert.equal(calls, 2);
});

test("quota cooldown applies to refreshed tokens for the same user and expires", async () => {
  let now = 1000, calls = 0;
  const cache = new UserInfoProfileCache(() => now);
  cache.block("identity", 116);
  const read = () => cache.get("different-token", "identity", 200_000, async () => { calls++; return profile; });
  await assert.rejects(read(), (error: unknown) =>
    error instanceof IdentityUpstreamError && error.diagnostics.retryAfterSeconds === 116);
  now = 116_999; await assert.rejects(read(), IdentityUpstreamError);
  assert.equal(calls, 0);
  now = 117_000; await read(); assert.equal(calls, 1);
});

test("another user is not blocked by an individual quota cooldown", async () => {
  const cache = new UserInfoProfileCache(() => 1000);
  cache.block("blocked-user", 60);
  const result = await cache.get("other-token", "other-user", 100_000, async () => profile);
  assert.equal(result.email_verified, true);
});

test("success storage is bounded and evicts the least recently used profile", async () => {
  const cache = new UserInfoProfileCache(() => 1000, 2);
  let calls = 0;
  const read = (key: string) => cache.get(key, key, 100_000, async () => { calls++; return profile; });
  await read("a"); await read("b"); await read("a"); await read("c"); await read("b");
  assert.equal(calls, 4);
});

test("in-flight capacity and cooldown overflow fail closed", async () => {
  const cache = new UserInfoProfileCache(() => 1000, 1);
  let finish!: (value: typeof profile) => void;
  const pending = cache.get("a", "a", 100_000, () => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(cache.get("b", "b", 100_000, async () => profile), IdentityUpstreamError);
  finish(profile); await pending;
  cache.block("a", 60); cache.block("b", 120);
  await assert.rejects(cache.get("c", "c", 200_000, async () => profile), IdentityUpstreamError);
});

test("Retry-After accepts seconds or dates and clamps malformed/unbounded delays", () => {
  assert.equal(retryAfterSeconds("116"), 116);
  assert.equal(retryAfterSeconds("Thu, 01 Jan 1970 00:00:02 GMT", 1000), 1);
  assert.equal(retryAfterSeconds(null), 60);
  assert.equal(retryAfterSeconds("invalid"), 60);
  assert.equal(retryAfterSeconds("9999999999"), 3600);
  assert.equal(retryAfterSeconds("0"), 1);
});
