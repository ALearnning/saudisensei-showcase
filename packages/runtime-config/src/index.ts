import { createHash, createPrivateKey } from "node:crypto";

export type Environment = Record<string, string | undefined>;
export type RuntimeRole = "web" | "api" | "worker";
export interface ProductionProfile {
  version: 1;
  origin: string;
  /** Explicit private Compose BFF target, never inferred from a development URL. */
  internalApiOrigin?: string;
  database: { host: string; name: string };
  auth0: { domain: string; clientId: string; audience: string };
  s3: { endpoint: string; region: string; bucket: string };
  stream: { accountId: string; signingKeyId: string; allowSharedAccount: boolean };
  development: {
    origins: string[];
    databases: string[];
    auth0Domains: string[];
    clientIds: string[];
    buckets: string[];
    streamAccounts: string[];
    signingKeyIds: string[];
    streamReferences: string[];
    credentialDigests: Record<string, string[]>;
  };
}

const common = ["APP_BASE_URL", "AUTH0_DOMAIN", "AUTH0_AUDIENCE"] as const;
const web = ["AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "API_BASE_URL"] as const;
const api = ["DATABASE_URL", "WEB_ORIGIN", "SESSION_SECRET", "S3_ENDPOINT", "S3_REGION",
  "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CLOUDFLARE_STREAM_ACCOUNT_ID",
  "CLOUDFLARE_STREAM_API_TOKEN", "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
  "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"] as const;
const credentialKeys = ["AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "SESSION_SECRET",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CLOUDFLARE_STREAM_API_TOKEN",
  "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"];
const fail = (): never => { throw new Error("PRODUCTION_CONFIGURATION_INVALID"); };
const required = (env: Environment, key: string): string => {
  const value = env[key];
  if (!value || value !== value.trim()) return fail();
  return value;
};
const array = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "string" && !!v.trim());
const secureUrl = (value: string): URL => {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return fail();
  return u;
};
const issuer = (value: string): string => {
  const u = secureUrl(value.startsWith("https://") ? value : `https://${value}`);
  if (u.pathname !== "/") return fail();
  return `${u.origin}/`;
};
const same = (a: unknown, b: unknown) => { if (a !== b) fail(); };
const absent = (value: string, denied: string[]) => { if (denied.includes(value)) fail(); };

/** Never logs input, parser exceptions, profile contents or secret values.
 * A trusted operator supplies the reviewed profile and development baseline.
 * This validates configuration intent, not cloud resource permissions/ownership.
 */
export function assertProductionConfiguration(
  role: RuntimeRole, env: Environment = process.env,
): ProductionProfile | undefined {
  try {
    if (!["web", "api", "worker"].includes(role)) fail();
    if (env.NODE_ENV !== "production") {
      if (env.SAUDISENSEI_ENVIRONMENT === "production" || env.SAUDISENSEI_PRODUCTION_PROFILE) fail();
      return undefined;
    }
    same(env.SAUDISENSEI_ENVIRONMENT, "production");
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined && (/^(?:DEV_|PILOT_|PRIVATE_BROWSER_|AUTH0_(?:ADMIN_)?TEST_)/.test(key) ||
          /^NEXT_PUBLIC_.*(?:SECRET|TOKEN|PASSWORD|ACCESS_KEY|PRIVATE_KEY)/.test(key) ||
          ["VIDEO_PILOT_ENABLED", "CONFIRM_DEV_ADMIN"].includes(key))) fail();
    }
    for (const key of [...common, ...(role === "web" ? web : api)]) required(env, key);
    for (const key of role === "web" ? api : web) {
      if (env[key] !== undefined) fail();
    }
    const p: ProductionProfile = JSON.parse(required(env, "SAUDISENSEI_PRODUCTION_PROFILE"));
    same(p.version, 1);
    if (p.internalApiOrigin !== undefined && p.internalApiOrigin !== "http://api:8080") fail();
    if (role === "worker" &&
        (required(env, "CLAMAV_DATABASE_DIR") !== "/var/lib/clamav" ||
         required(env, "TMPDIR") !== "/work")) fail();
    const d = p.development;
    for (const list of [d.origins, d.databases, d.auth0Domains, d.clientIds, d.buckets,
      d.streamAccounts, d.signingKeyIds, d.streamReferences]) if (!array(list)) fail();
    for (const key of credentialKeys) {
      const digests = d.credentialDigests[key];
      if (!array(digests) || digests.some(v => !/^[a-f0-9]{64}$/.test(v))) fail();
      if (env[key] !== undefined) absent(createHash("sha256").update(env[key]!).digest("hex"), digests);
    }
    const origin = secureUrl(required(env, "APP_BASE_URL"));
    if (origin.pathname !== "/" || /(^localhost$|^127\.|^\[::1\]$|\.local$|\.replit\.dev$)/i.test(origin.hostname)) fail();
    same(origin.origin, p.origin);
    absent(origin.origin, d.origins);
    same(issuer(required(env, "AUTH0_DOMAIN")), issuer(p.auth0.domain));
    absent(issuer(p.auth0.domain), d.auth0Domains.map(issuer));
    absent(p.auth0.clientId, d.clientIds);
    same(required(env, "AUTH0_AUDIENCE"), p.auth0.audience);
    if (!p.auth0.audience || !p.auth0.clientId) fail();
    // An isolated issuer prevents the dedicated development identities from
    // authenticating. No token-validation, MFA or identity-resolution policy changes.
    if (role === "web") {
      same(required(env, "AUTH0_CLIENT_ID"), p.auth0.clientId);
      if (!/^[a-f0-9]{64}$/i.test(required(env, "AUTH0_SECRET")) ||
          required(env, "AUTH0_CLIENT_SECRET").length < 16) fail();
      const target = new URL(required(env, "API_BASE_URL"));
      const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
      const privateApi = p.internalApiOrigin !== undefined && target.origin === p.internalApiOrigin;
      if (target.username || target.password || target.search || target.hash ||
          target.pathname.replace(/\/$/, "") !== "/api/v1" ||
           !(target.protocol === "https:" || (target.protocol === "http:" && (loopback || privateApi))) ||
           (!loopback && !privateApi && target.origin !== origin.origin)) fail();
    } else {
      same(required(env, "WEB_ORIGIN"), origin.origin);
      const db = new URL(required(env, "DATABASE_URL"));
      if (!["postgres:", "postgresql:"].includes(db.protocol) || !db.username || !db.password ||
           db.searchParams.get("sslmode") !== "require" ||
           db.searchParams.get("sslaccept") !== "strict" ||
           db.searchParams.get("sslcert") !== "/run/database-tls/ca.crt" ||
           ["sslmode", "sslaccept", "sslcert"].some(key => db.searchParams.getAll(key).length !== 1)) fail();
      same(db.host, p.database.host);
      same(decodeURIComponent(db.pathname.slice(1)), p.database.name);
      if (!p.database.host || !p.database.name) fail();
      absent(`${db.host}/${p.database.name}`, d.databases);
      same(required(env, "S3_ENDPOINT"), p.s3.endpoint);
      const storage = secureUrl(p.s3.endpoint);
      if (storage.pathname !== "/") fail();
      same(required(env, "S3_REGION"), p.s3.region);
      same(required(env, "S3_BUCKET"), p.s3.bucket);
      if (!p.s3.region || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(p.s3.bucket) ||
          /(?:^|[-.])(dev|test|pilot)(?:[-.]|$)/i.test(p.s3.bucket)) fail();
      absent(p.s3.bucket, d.buckets);
      same(required(env, "CLOUDFLARE_STREAM_ACCOUNT_ID"), p.stream.accountId);
      same(required(env, "CLOUDFLARE_STREAM_SIGNING_KEY_ID"), p.stream.signingKeyId);
      if (!/^[a-f0-9]{32}$/.test(p.stream.accountId) || !p.stream.signingKeyId ||
          typeof p.stream.allowSharedAccount !== "boolean") fail();
      if (!p.stream.allowSharedAccount) absent(p.stream.accountId, d.streamAccounts);
      absent(p.stream.signingKeyId, d.signingKeyIds);
      const jwk = JSON.parse(required(env, "CLOUDFLARE_STREAM_SIGNING_KEY_JWK"));
      if (jwk.kty !== "RSA" || !jwk.n || !jwk.e || !jwk.d) fail();
      const signingKey = createPrivateKey({ key: jwk, format: "jwk" });
      if (signingKey.asymmetricKeyType !== "rsa" ||
          (signingKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
          (jwk.kid !== undefined && jwk.kid !== p.stream.signingKeyId)) fail();
      if (required(env, "SESSION_SECRET").length < 32) fail();
    }
    return p;
  } catch { return fail(); }
}

/** Key namespace only: startup validates the complete production profile.
 * Development keeps the exact approved pilot prefix and fixtures.
 */
export function mediaObjectRoot(env: Environment = process.env): "pilot" | "production" {
  return env.NODE_ENV === "production" ? "production" : "pilot";
}

export interface ProductionDataState {
  environment: string | null;
  database: string;
  fixtureCourses: number;
  legacyMedia: number;
  pilotVideos: number;
  pilotRevisions: number;
  foreignIdentities: number;
  foreignMedia: number;
}
export function assertProductionData(profile: ProductionProfile, state: ProductionDataState): void {
  if (state.environment !== "production" || state.database !== profile.database.name ||
      [state.fixtureCourses, state.legacyMedia, state.pilotVideos, state.pilotRevisions,
        state.foreignIdentities, state.foreignMedia].some(n => !Number.isSafeInteger(n) || n !== 0)) {
    throw new Error("PRODUCTION_DATA_ISOLATION_INVALID");
  }
}
