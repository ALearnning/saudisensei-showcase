import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { assertProductionConfiguration, assertProductionData, mediaObjectRoot } from "../dist/index.js";

// Entirely synthetic, offline inputs. Never inherit the workspace environment.
const hash = value => createHash("sha256").update(value).digest("hex");
const privateJwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "jwk" });
const credentialKeys = ["AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "SESSION_SECRET",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CLOUDFLARE_STREAM_API_TOKEN",
  "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"];
function fixture(role) {
  const profile = {
    version: 1, origin: "https://release.example.invalid",
    database: { host: "db.example.invalid", name: "learning_production" },
    auth0: { domain: "production.example.invalid", clientId: "production-client", audience: "learning-api" },
    s3: { endpoint: "https://storage.example.invalid", region: "approved-region", bucket: "learning-production-media" },
    stream: { accountId: "a".repeat(32), signingKeyId: "production-key", allowSharedAccount: false },
    development: {
      origins: ["https://preview.example.invalid"], databases: ["db.example.invalid/learning_development"],
      auth0Domains: ["development.example.invalid"], clientIds: ["development-client"],
      buckets: ["learning-dev-media"], streamAccounts: ["b".repeat(32)],
      signingKeyIds: ["development-key"], streamReferences: ["c".repeat(32)],
      credentialDigests: Object.fromEntries(credentialKeys.map(key => [key, [hash("synthetic-development-value")]])),
    },
  };
  const env = { NODE_ENV: "production", SAUDISENSEI_ENVIRONMENT: "production",
    APP_BASE_URL: profile.origin, AUTH0_DOMAIN: profile.auth0.domain, AUTH0_AUDIENCE: profile.auth0.audience };
  if (role === "web") Object.assign(env, {
    AUTH0_CLIENT_ID: profile.auth0.clientId, AUTH0_CLIENT_SECRET: "synthetic-production-client-secret",
    AUTH0_SECRET: "a".repeat(64), API_BASE_URL: "http://127.0.0.1:8080/api/v1/",
  });
  else Object.assign(env, {
    DATABASE_URL: "postgresql://runtime:synthetic-password@db.example.invalid/learning_production?sslmode=require&sslaccept=strict&sslcert=/run/database-tls/ca.crt",
    WEB_ORIGIN: profile.origin, SESSION_SECRET: "synthetic-production-session-secret",
    S3_ENDPOINT: profile.s3.endpoint, S3_REGION: profile.s3.region, S3_BUCKET: profile.s3.bucket,
    S3_ACCESS_KEY_ID: "synthetic-production-access", S3_SECRET_ACCESS_KEY: "synthetic-production-storage-secret",
    CLOUDFLARE_STREAM_ACCOUNT_ID: profile.stream.accountId, CLOUDFLARE_STREAM_API_TOKEN: "synthetic-production-token",
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: profile.stream.signingKeyId,
    CLOUDFLARE_STREAM_SIGNING_KEY_JWK: JSON.stringify(privateJwk),
  });
  const serialize = () => { env.SAUDISENSEI_PRODUCTION_PROFILE = JSON.stringify(profile); };
  serialize();
  return { profile, env, serialize };
}
const rejected = (role, env) => assert.throws(() => assertProductionConfiguration(role, env),
  { message: "PRODUCTION_CONFIGURATION_INVALID" });

for (const role of ["web", "api"]) {
  test(`${role}: complete isolated configuration resolves`, () => {
    const { env } = fixture(role);
    assert.equal(assertProductionConfiguration(role, env)?.version, 1);
  });
  test(`${role}: missing required configuration never falls back`, () => {
    const { env } = fixture(role);
    for (const key of Object.keys(env)) {
      const copy = { ...env }; delete copy[key];
      if (key === "NODE_ENV") copy.SAUDISENSEI_ENVIRONMENT = "production";
      rejected(role, copy);
    }
  });
  test(`${role}: test credentials, flags and dev admin input are rejected`, () => {
    for (const key of ["AUTH0_TEST_EMAIL", "AUTH0_TEST_PASSWORD", "AUTH0_ADMIN_TEST_EMAIL",
      "AUTH0_ADMIN_TEST_PASSWORD", "AUTH0_ADMIN_TEST_MFA_CODE", "DEV_ADMIN_SUBJECT",
      "VIDEO_PILOT_ENABLED", "CONFIRM_DEV_ADMIN", "PRIVATE_BROWSER_TOKEN", "NEXT_PUBLIC_SESSION_SECRET"]) {
      rejected(role, { ...fixture(role).env, [key]: "" });
    }
  });
  test(`${role}: malformed manifest diagnostics never include supplied data`, () => {
    const { env } = fixture(role);
    env.SAUDISENSEI_PRODUCTION_PROFILE = "{DO_NOT_DISCLOSE";
    rejected(role, env);
  });
}
test("development is unchanged and contradictory production markers are rejected", () => {
  assert.equal(assertProductionConfiguration("web", { NODE_ENV: "development", AUTH0_TEST_EMAIL: "synthetic" }), undefined);
  rejected("web", { NODE_ENV: "development", SAUDISENSEI_ENVIRONMENT: "production" });
});
test("production preview, HTTP, credentials, fragments and non-origin URLs are rejected", () => {
  for (const value of ["https://preview.replit.dev", "http://release.example.invalid",
    "https://localhost", "https://user:password@release.example.invalid", "https://release.example.invalid/ar",
    "https://release.example.invalid/#fragment"]) {
    const { env, profile, serialize } = fixture("web");
    profile.origin = value; env.APP_BASE_URL = value; serialize(); rejected("web", env);
  }
});
test("BFF cannot target a development or arbitrary remote API", () => {
  const { env } = fixture("web");
  for (const value of ["https://preview.replit.dev/api/v1", "https://other.example.invalid/api/v1",
    "http://other.example.invalid/api/v1", "http://127.0.0.1:8080/not-api"]) {
    rejected("web", { ...env, API_BASE_URL: value });
  }
});
test("development Auth0 issuer/client and copied credentials are rejected", () => {
  for (const field of ["domain", "clientId"]) {
    const { env, profile, serialize } = fixture("web");
    if (field === "domain") { profile.auth0.domain = "development.example.invalid"; env.AUTH0_DOMAIN = profile.auth0.domain; }
    else { profile.auth0.clientId = "development-client"; env.AUTH0_CLIENT_ID = profile.auth0.clientId; }
    serialize(); rejected("web", env);
  }
  rejected("web", { ...fixture("web").env, AUTH0_CLIENT_SECRET: "synthetic-development-value" });
});
test("role-specific secrets are not accepted in the wrong process", () => {
  rejected("web", { ...fixture("web").env, S3_SECRET_ACCESS_KEY: "synthetic" });
  rejected("api", { ...fixture("api").env, AUTH0_CLIENT_SECRET: "synthetic" });
  rejected("worker", fixture("api").env);
});
test("worker accepts the isolated backend contract only with fixed scanner/scratch paths", () => {
  const { env } = fixture("api");
  const worker = { ...env, CLAMAV_DATABASE_DIR: "/var/lib/clamav", TMPDIR: "/work" };
  assert.equal(assertProductionConfiguration("worker", worker)?.version, 1);
  rejected("worker", { ...worker, TMPDIR: "/tmp" });
  rejected("worker", { ...worker, CLAMAV_DATABASE_DIR: "/tmp/pilot" });
  rejected("worker", { ...worker, AUTH0_ADMIN_TEST_PASSWORD: "" });
});
test("private Compose BFF routing is opt-in and never permits arbitrary HTTP targets", () => {
  const { env, profile, serialize } = fixture("web");
  env.API_BASE_URL = "http://api:8080/api/v1";
  rejected("web", env);
  profile.internalApiOrigin = "http://api:8080"; serialize();
  assert.equal(assertProductionConfiguration("web", env)?.version, 1);
  for (const target of ["http://other:8080/api/v1", "http://api:8081/api/v1",
    "http://api:8080/not-api", "http://user:pass@api:8080/api/v1"]) {
    rejected("web", { ...env, API_BASE_URL: target });
  }
  profile.internalApiOrigin = "http://arbitrary-host:8080"; serialize();
  rejected("web", env);
});
test("database TLS and approved database identity are mandatory", () => {
  const { env } = fixture("api");
  rejected("api", { ...env, DATABASE_URL: env.DATABASE_URL.replace("sslmode=require", "sslmode=disable") });
  rejected("api", { ...env, DATABASE_URL: env.DATABASE_URL.replace("sslaccept=strict", "sslaccept=accept_invalid_certs") });
  rejected("api", { ...env, DATABASE_URL: env.DATABASE_URL.replace("&sslcert=/run/database-tls/ca.crt", "") });
  rejected("api", { ...env, DATABASE_URL: `${env.DATABASE_URL}&sslaccept=accept_invalid_certs` });
  rejected("api", { ...env, DATABASE_URL: env.DATABASE_URL.replace("learning_production", "learning_development") });
});
test("even an accidentally approved development database target is rejected", () => {
  const { env, profile, serialize } = fixture("api");
  profile.database.name = "learning_development"; env.DATABASE_URL = env.DATABASE_URL.replace("learning_production", "learning_development");
  serialize(); rejected("api", env);
});
test("development bucket and credential fingerprints are rejected", () => {
  const { env, profile, serialize } = fixture("api");
  profile.s3.bucket = "learning-dev-media"; env.S3_BUCKET = profile.s3.bucket; serialize(); rejected("api", env);
  rejected("api", { ...fixture("api").env, S3_SECRET_ACCESS_KEY: "synthetic-development-value" });
});
test("shared Stream account requires explicit approval but never accepts the pilot signing key", () => {
  const { env, profile, serialize } = fixture("api");
  profile.stream.accountId = "b".repeat(32); env.CLOUDFLARE_STREAM_ACCOUNT_ID = profile.stream.accountId;
  serialize(); rejected("api", env);
  profile.stream.allowSharedAccount = true; serialize();
  assert.ok(assertProductionConfiguration("api", env));
  profile.stream.signingKeyId = "development-key"; env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = profile.stream.signingKeyId;
  serialize(); rejected("api", env);
});
test("private signing material and baseline cannot be omitted", () => {
  const { env, profile, serialize } = fixture("api");
  rejected("api", { ...env, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: JSON.stringify({ kty: "RSA", n: "public", e: "AQAB" }) });
  rejected("api", { ...env, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: JSON.stringify({ ...privateJwk, kid: "wrong-key" }) });
  profile.development.streamReferences = []; serialize(); rejected("api", env);
});
test("read-only data preflight rejects every fixture/foreign-data category and wrong database marker", () => {
  const { profile } = fixture("api");
  const state = { environment: "production", database: profile.database.name, fixtureCourses: 0,
    legacyMedia: 0, pilotVideos: 0, pilotRevisions: 0, foreignIdentities: 0, foreignMedia: 0 };
  assert.doesNotThrow(() => assertProductionData(profile, state));
  for (const key of ["fixtureCourses", "legacyMedia", "pilotVideos", "pilotRevisions", "foreignIdentities", "foreignMedia"]) {
    for (const value of [1, -1, NaN]) assert.throws(() => assertProductionData(profile, { ...state, [key]: value }),
      { message: "PRODUCTION_DATA_ISOLATION_INVALID" });
  }
  assert.throws(() => assertProductionData(profile, { ...state, environment: null }));
  assert.throws(() => assertProductionData(profile, { ...state, database: "development" }));
});
test("media namespaces remain disjoint without changing the development prefix", () => {
  assert.equal(mediaObjectRoot({ NODE_ENV: "development" }), "pilot");
  assert.equal(mediaObjectRoot({ NODE_ENV: "production" }), "production");
});
