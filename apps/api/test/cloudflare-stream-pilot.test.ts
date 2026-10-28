import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { CloudflareStreamPilot } from "../src/modules/media/cloudflare-stream.pilot.js";
import { videoPilotDeadline } from "../src/modules/media/video-pilot.service.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const reference = "a".repeat(32);
const host = "customer-fixture.cloudflarestream.com";
const now = 1_800_000_000;
const config = { accountId: "b".repeat(32), apiToken: "test-token", keyId: "test-key",
  encodedJwk: Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" }))).toString("base64"),
  origin: "https://example.test" };

test("Video playback expiry is bounded by enrollment and the verified bearer token", () => {
  assert.equal(videoPilotDeadline(now + 900, null, now), now + 300);
  assert.equal(videoPilotDeadline(now + 70, null, now), now + 70);
  assert.equal(videoPilotDeadline(now + 900, new Date((now + 10) * 1000), now), now + 10);
  for (const expiry of [now, now - 1, NaN]) {
    assert.throws(() => videoPilotDeadline(expiry, null, now));
  }
});

test("Stream pilot signs RS256 with a bounded expiry and without download permission", () => {
  const provider = new CloudflareStreamPilot(config, fetch, () => now);
  const ticket = provider.playback(reference, host, now + 300);
  const token = new URL(ticket.manifest).pathname.split("/")[1]!;
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  assert.equal(JSON.parse(Buffer.from(header!, "base64url").toString()).alg, "RS256");
  assert.equal(claims.exp, now + 300);
  assert.equal(claims.sub, reference);
  assert.equal(claims.kid, config.keyId);
  assert.equal("downloadable" in claims, false);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey,
    Buffer.from(signature!, "base64url")), true);
  assert.equal(new URL(ticket.poster).pathname.includes(token), true);
});

test("Stream pilot denies unsafe hosts, invalid references and extended/expired expiry", () => {
  const provider = new CloudflareStreamPilot(config, fetch, () => now);
  for (const expiry of [now, now - 1, now + 301, NaN, now + 1.5]) {
    assert.throws(() => provider.playback(reference, host, expiry), /VIDEO_PROVIDER_UNAVAILABLE/);
  }
  for (const unsafe of ["evil.test", "customer-x.cloudflarestream.com.evil.test", "videodelivery.net/x"]) {
    assert.throws(() => provider.playback(reference, unsafe, now + 20));
  }
  assert.throws(() => provider.playback("../bad", host, now + 20));
});

test("Stream upload slots are private from creation and constrained to the approved origin/durations", async () => {
  const calls: any[] = [];
  const fake: typeof fetch = async (_url, init) => {
    calls.push(JSON.parse(init!.body as string));
    return Response.json({ success: true, result: { uid: reference,
      uploadURL: "https://upload.videodelivery.net/fixture" } });
  };
  const provider = new CloudflareStreamPilot(config, fake, () => now);
  await provider.createUpload("long");
  await provider.createUpload("short");
  assert.deepEqual(calls.map(x => x.maxDurationSeconds), [375, 75]);
  for (const body of calls) {
    assert.equal(body.requireSignedURLs, true);
    assert.deepEqual(body.allowedOrigins, ["example.test"]);
    assert.equal("scheduledDeletion" in body, false);
  }
});

test("Stream errors suppress credential-bearing provider details and invalid references", async () => {
  for (const fake of [
    async () => { throw new Error("raw secret and URL"); },
    async () => Response.json({ success: false, errors: [{ message: "raw credential" }] }),
    async () => Response.json({ success: true, result: { uid: "../invalid", uploadURL: "https://evil.test/" } }),
  ]) {
    const provider = new CloudflareStreamPilot(config, fake as typeof fetch, () => now);
    await assert.rejects(provider.createUpload("long"), { message: "VIDEO_PROVIDER_UNAVAILABLE" });
  }
});

test("Stream uses the documented pinned upload address, never an untrusted returned destination", async () => {
  const fake: typeof fetch = async () => Response.json({ success: true, result: {
    uid: reference, uploadURL: "https://evil.test/credential-capture",
  } });
  const provider = new CloudflareStreamPilot(config, fake, () => now);
  assert.equal((await provider.createUpload("short")).uploadUrl, `https://upload.videodelivery.net/${reference}`);
});
