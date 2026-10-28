/**
 * Unmounted provider adapter for the bounded development security pilot.
 * No controller or production provider selection is introduced here.
 * Provider references and capabilities must stay inside trusted server code.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export class VideoPilotError extends Error {
  constructor(readonly code: string) { super(code); this.name = "VideoPilotError"; }
}
const denied = () => new VideoPilotError("VIDEO_PROVIDER_UNAVAILABLE");
const uid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const playbackHost = (value: string) => /^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(value);

export interface VideoPilotMetadata {
  ready: boolean; failed: boolean; privatePlayback: boolean; duration: number;
  playbackHost: string | null; originsMatch: boolean;
}
export interface VideoPilotTicket {
  manifest: string; poster: string; expiresAt: number;
}
export interface BoundedVideoProvider {
  createUpload(fixture: "long" | "short"): Promise<{ reference: string; uploadUrl: string }>;
  inspect(reference: string): Promise<VideoPilotMetadata>;
  playback(reference: string, host: string, expiresAt: number): VideoPilotTicket;
}
export class CloudflareStreamPilot implements BoundedVideoProvider {
  private readonly key: KeyObject;
  private readonly originHost: string;
  constructor(private readonly config: {
    accountId: string; apiToken: string; keyId: string; encodedJwk: string; origin: string;
  }, private readonly transport: typeof fetch = fetch,
  private readonly clock: () => number = () => Math.floor(Date.now() / 1000)) {
    try {
      const origin = new URL(config.origin);
      if (origin.protocol !== "https:" || origin.username || origin.password ||
          !/^[a-f0-9]{32}$/.test(config.accountId) || !config.apiToken || !config.keyId) throw denied();
      this.originHost = origin.hostname;
      this.key = createPrivateKey({
        key: JSON.parse(Buffer.from(config.encodedJwk, "base64").toString("utf8")), format: "jwk",
      });
      if (this.key.asymmetricKeyType !== "rsa" ||
          (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw denied();
    } catch { throw denied(); }
  }
  private async request(path: string, body?: object): Promise<any> {
    try {
      const response = await this.transport(
        `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/stream${path}`,
        { method: body ? "POST" : "GET", redirect: "error",
          headers: { Authorization: `Bearer ${this.config.apiToken}`, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) },
      );
      const data = await response.json();
      if (!response.ok || data.success !== true || data.result === undefined) throw denied();
      return data.result;
    } catch { throw denied(); }
  }
  async createUpload(fixture: "long" | "short") {
    if (fixture !== "long" && fixture !== "short") throw denied();
    const result = await this.request("/direct_upload", {
      maxDurationSeconds: fixture === "long" ? 375 : 75,
      requireSignedURLs: true, allowedOrigins: [this.originHost],
      expiry: new Date((this.clock() + 600) * 1000).toISOString(),
      meta: { name: `SaudiSensei bounded synthetic video ${fixture}`, pilot: "phase1c-private-video" },
    });
    if (!uid(result.uid)) throw denied();
    // The documented basic-upload endpoint is indexed by this same UID.
    // Construct a pinned destination instead of trusting a returned URL/redirect.
    return { reference: result.uid, uploadUrl: `https://upload.videodelivery.net/${result.uid}` };
  }
  async inspect(reference: string): Promise<VideoPilotMetadata> {
    if (!uid(reference)) throw denied();
    const result = await this.request(`/${reference}`);
    let host: string | null = null;
    if (result.playback?.hls) {
      try {
        const url = new URL(result.playback.hls);
        if (url.protocol !== "https:" || url.username || url.password || !playbackHost(url.hostname)) throw denied();
        host = url.hostname;
      } catch { throw denied(); }
    }
    return {
      ready: result.readyToStream === true && result.status?.state === "ready",
      failed: result.status?.state === "error",
      privatePlayback: result.requireSignedURLs === true,
      duration: typeof result.duration === "number" ? result.duration : 0,
      playbackHost: host,
      originsMatch: Array.isArray(result.allowedOrigins) && result.allowedOrigins.length === 1 &&
        result.allowedOrigins[0] === this.originHost,
    };
  }
  playback(reference: string, host: string, expiresAt: number): VideoPilotTicket {
    const now = this.clock();
    if (!uid(reference) || !playbackHost(host) || !Number.isSafeInteger(expiresAt) ||
        expiresAt <= now || expiresAt > now + 300) throw denied();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    // Both the header and payload kid are required by Stream. No downloadable claim.
    const unsigned = `${encode({ alg: "RS256", kid: this.config.keyId, typ: "JWT" })}.${encode({
      sub: reference, kid: this.config.keyId, exp: expiresAt, nbf: now - 5,
    })}`;
    const token = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), this.key).toString("base64url")}`;
    return { manifest: `https://${host}/${token}/manifest/video.m3u8`,
      poster: `https://${host}/${token}/thumbnails/thumbnail.jpg`, expiresAt };
  }
}
