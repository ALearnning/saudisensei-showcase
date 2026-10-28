import { IdentityUpstreamError } from "./identity-upstream-error.js";

export interface UserInfoProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

export const PROFILE_TTL_MS = 30_000;
const DEFAULT_CAPACITY = 1000;

/** Process-local, bounded cache of validated profiles, never authorization decisions. */
export class UserInfoProfileCache {
  private readonly entries = new Map<string, { profile: Readonly<UserInfoProfile>; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<Readonly<UserInfoProfile>>>();
  private readonly cooldowns = new Map<string, number>();
  private overflowCooldownUntil = 0;

  constructor(private readonly now: () => number = Date.now, private readonly capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("Invalid profile cache capacity");
  }

  block(identityKey: string, seconds: number): void {
    const until = this.now() + Math.max(1, Math.min(3600, Math.ceil(seconds))) * 1000;
    for (const [key, expiry] of this.cooldowns) if (expiry <= this.now()) this.cooldowns.delete(key);
    if (!this.cooldowns.has(identityKey) && this.cooldowns.size >= this.capacity) {
      // Fail closed rather than evict an active per-user rate-limit cooldown.
      this.overflowCooldownUntil = Math.max(this.overflowCooldownUntil, until);
    } else {
      this.cooldowns.set(identityKey, Math.max(this.cooldowns.get(identityKey) ?? 0, until));
    }
  }

  async get(
    tokenKey: string,
    identityKey: string,
    tokenExpiresAt: number,
    load: () => Promise<UserInfoProfile>,
  ): Promise<Readonly<UserInfoProfile>> {
    const now = this.now();
    const cached = this.entries.get(tokenKey);
    if (cached && cached.expiresAt > now && tokenExpiresAt > now) {
      this.entries.delete(tokenKey);
      this.entries.set(tokenKey, cached);
      return cached.profile;
    }
    this.entries.delete(tokenKey);
    const blockedUntil = Math.max(this.cooldowns.get(identityKey) ?? 0, this.overflowCooldownUntil);
    if (blockedUntil > now) {
      throw new IdentityUpstreamError({
        stage: "USERINFO", reason: "COOLDOWN", upstreamStatus: 429,
        retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000),
      });
    }
    this.cooldowns.delete(identityKey);
    const shared = this.pending.get(tokenKey);
    if (shared) return shared;
    if (this.pending.size >= this.capacity) {
      throw new IdentityUpstreamError({ stage: "PROFILE_CACHE", reason: "CAPACITY" });
    }
    const work = (async () => {
      const profile = Object.freeze({ ...await load() });
      const expiresAt = Math.min(this.now() + PROFILE_TTL_MS, tokenExpiresAt);
      if (profile.email_verified === true && expiresAt > this.now()) {
        for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key);
        if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(tokenKey, { profile, expiresAt });
      }
      return profile;
    })();
    this.pending.set(tokenKey, work);
    try {
      return await work;
    } finally {
      if (this.pending.get(tokenKey) === work) this.pending.delete(tokenKey);
    }
  }
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value) return 60;
  const trimmed = value.trim();
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : (Date.parse(trimmed) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : 60;
}
