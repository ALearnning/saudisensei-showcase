import { before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { getAuth0Settings, MFA_CLAIM, verifySignedAccessToken } from "../src/modules/identity/auth0.adapter.js";

const settings = { issuer: "https://identity.example.invalid/", audience: "https://api.example.invalid" };
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
before(async () => { keys = await generateKeyPair("RS256"); });
async function sign(overrides: { issuer?: string; audience?: string; expired?: boolean; noSubject?: boolean; mfa?: boolean } = {}) {
  const jwt = new SignJWT({ arbitraryRoles: ["admin"], [MFA_CLAIM]: overrides.mfa ?? false }).setProtectedHeader({ alg: "RS256" })
    .setIssuer(overrides.issuer ?? settings.issuer).setAudience(overrides.audience ?? settings.audience)
    .setIssuedAt().setExpirationTime(overrides.expired ? Math.floor(Date.now() / 1000) - 60 : "10m");
  if (!overrides.noSubject) jwt.setSubject("auth0|fixture");
  return jwt.sign(keys.privateKey);
}
test("valid signed API token yields identity subject, not roles", async () => {
  assert.deepEqual(await verifySignedAccessToken(await sign(), keys.publicKey, settings), { subject: "auth0|fixture", mfaVerified: false });
});
test("only a signed provider MFA claim supplies proof of MFA", async () => {
  assert.equal((await verifySignedAccessToken(await sign({ mfa: true }), keys.publicKey, settings)).mfaVerified, true);
});
test("wrong issuer is rejected", async () => {
  await assert.rejects(verifySignedAccessToken(await sign({ issuer: "https://other.example.invalid/" }), keys.publicKey, settings));
});
test("wrong audience is rejected", async () => {
  await assert.rejects(verifySignedAccessToken(await sign({ audience: "another-api" }), keys.publicKey, settings));
});
test("expired token is rejected", async () => {
  await assert.rejects(verifySignedAccessToken(await sign({ expired: true }), keys.publicKey, settings));
});
test("missing subject is rejected", async () => {
  await assert.rejects(verifySignedAccessToken(await sign({ noSubject: true }), keys.publicKey, settings));
});
test("token signed by an untrusted key is rejected", async () => {
  const other = await generateKeyPair("RS256");
  await assert.rejects(verifySignedAccessToken(await sign(), other.publicKey, settings));
});
test("missing configuration does not enable alternate authentication", () => {
  assert.equal(getAuth0Settings({}), null);
});
test("issuer URL must be an HTTPS origin", () => {
  assert.throws(() => getAuth0Settings({ AUTH0_DOMAIN: "http://identity.example.invalid", AUTH0_AUDIENCE: "api" }));
  assert.throws(() => getAuth0Settings({ AUTH0_DOMAIN: "https://identity.example.invalid/unsafe-path", AUTH0_AUDIENCE: "api" }));
});
