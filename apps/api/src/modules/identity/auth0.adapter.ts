import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { z } from "zod";
import type { IdentityAdapter, VerifiedIdentity } from "./identity-adapter.js";
import { IdentityUpstreamError } from "./identity-upstream-error.js";
import { UserInfoProfileCache, retryAfterSeconds, type UserInfoProfile } from "./userinfo-profile-cache.js";

const profileSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().max(320),
  email_verified: z.boolean(),
  name: z.string().optional(),
});

export const MFA_CLAIM = "urn:saudisensei:mfa";

export async function verifySignedAccessToken(
  token: string,
  key: Parameters<typeof jwtVerify>[1],
  settings: { issuer: string; audience: string },
): Promise<{ subject: string; mfaVerified: boolean }> {
  const { subject, mfaVerified } = await verifyTokenClaims(token, key, settings);
  return { subject, mfaVerified };
}

async function verifyTokenClaims(
  token: string,
  key: Parameters<typeof jwtVerify>[1],
  settings: { issuer: string; audience: string },
): Promise<{ subject: string; mfaVerified: boolean; expiresAt: number }> {
  const verified = await jwtVerify(token, key, {
    issuer: settings.issuer,
    audience: settings.audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "iat", "exp"],
    maxTokenAge: "1h",
    clockTolerance: 5,
  });
  if (!verified.payload.sub || verified.payload.sub.length > 255) throw new Error("Invalid subject");
  return { subject: verified.payload.sub, mfaVerified: verified.payload[MFA_CLAIM] === true, expiresAt: verified.payload.exp! * 1000 };
}

export function getAuth0Settings(env: NodeJS.ProcessEnv = process.env) {
  const domain = env.AUTH0_DOMAIN;
  const audience = env.AUTH0_AUDIENCE;
  if (!domain || !audience) return null;
  const url = new URL(domain.startsWith("https://") ? domain : `https://${domain}`);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "") || !audience.trim()) {
    throw new Error("Auth0 requires an HTTPS issuer origin and a nonempty API audience.");
  }
  return { issuer: `${url.origin}/`, audience };
}

@Injectable()
export class Auth0IdentityAdapter implements IdentityAdapter {
  private readonly settings = getAuth0Settings();
  private readonly keys = this.settings
    ? createRemoteJWKSet(new URL(".well-known/jwks.json", this.settings.issuer), { timeoutDuration: 5000 })
    : null;
  private readonly profiles = new UserInfoProfileCache();

  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    if (!this.settings || !this.keys) throw new ServiceUnavailableException("AUTH_NOT_CONFIGURED");
    let claims: { subject: string; mfaVerified: boolean; expiresAt: number };
    try {
      // Always verify before looking at cached data. No JWT or MFA verdict is cached.
      claims = await verifyTokenClaims(token, this.keys, this.settings);
    } catch (error) {
      if (error instanceof errors.JWKSTimeout) throw new IdentityUpstreamError({ stage: "JWKS", reason: "TIMEOUT" });
      throw new UnauthorizedException("INVALID_ACCESS_TOKEN");
    }
    // Bind successes to the entire token; share only rate-limit cooldowns per identity.
    // Neither raw bearer tokens nor identity IDs are used as map keys or logged.
    const tokenKey = createHash("sha256").update(JSON.stringify([this.settings.issuer, this.settings.audience, token])).digest("hex");
    const identityKey = createHash("sha256").update(JSON.stringify([this.settings.issuer, claims.subject])).digest("hex");
    const profile = await this.profiles.get(tokenKey, identityKey, claims.expiresAt, () => this.loadProfile(token, claims.subject, identityKey));
    return {
      issuer: this.settings.issuer, subject: claims.subject,
      email: profile.email, emailVerified: profile.email_verified,
      displayName: (profile.name || profile.email).slice(0, 120),
      mfaVerified: claims.mfaVerified,
    };
  }

  private async loadProfile(token: string, subject: string, identityKey: string): Promise<UserInfoProfile> {
    let response: Response;
    try {
      response = await fetch(new URL("userinfo", this.settings!.issuer), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new IdentityUpstreamError({ stage: "USERINFO", reason: timeout ? "TIMEOUT" : "NETWORK" });
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      throw new UnauthorizedException("INVALID_ACCESS_TOKEN");
    }
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response.headers.get("retry-after"));
      this.profiles.block(identityKey, seconds);
      void response.body?.cancel().catch(() => {});
      throw new IdentityUpstreamError({ stage: "USERINFO", reason: "RATE_LIMIT", upstreamStatus: 429, retryAfterSeconds: seconds });
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new IdentityUpstreamError({ stage: "USERINFO", reason: "HTTP", upstreamStatus: response.status });
    }
    let profile: z.infer<typeof profileSchema>;
    try {
      profile = profileSchema.parse(await response.json());
    } catch {
      throw new UnauthorizedException("INVALID_IDENTITY_PROFILE");
    }
    if (profile.sub !== subject) throw new UnauthorizedException("IDENTITY_SUBJECT_MISMATCH");
    return { ...profile, name: profile.name?.slice(0, 120) };
  }
}
