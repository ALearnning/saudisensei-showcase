import { ServiceUnavailableException } from "@nestjs/common";

export interface SafeIdentityDiagnostics {
  stage: "JWKS" | "USERINFO" | "PROFILE_CACHE";
  reason: "TIMEOUT" | "NETWORK" | "HTTP" | "RATE_LIMIT" | "COOLDOWN" | "CAPACITY";
  upstreamStatus?: number;
  retryAfterSeconds?: number;
}

// Deliberately never retains a raw provider error, URL, token or response body.
export class IdentityUpstreamError extends ServiceUnavailableException {
  constructor(readonly diagnostics: Readonly<SafeIdentityDiagnostics>) {
    super("IDENTITY_UNAVAILABLE");
  }
}
