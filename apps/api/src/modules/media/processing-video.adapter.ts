import { Injectable } from "@nestjs/common";
import { ProcessingError, type ProcessingVideo } from "./processing.ports.js";
const uid = (id: string) => /^[a-f0-9]{32}$/.test(id);
@Injectable()
export class ProcessingCloudflareVideo implements ProcessingVideo {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private config() {
    try {
      const account = process.env.CLOUDFLARE_STREAM_ACCOUNT_ID, token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
      const origin = new URL(process.env.APP_BASE_URL ?? "");
      if (!account || !uid(account) || !token || origin.protocol !== "https:" || origin.username || origin.password) throw 0;
      return { account, token, origin: origin.hostname };
    } catch { throw new ProcessingError("VIDEO_PROVIDER_UNAVAILABLE"); }
  }
  private async request(path: string, signal: AbortSignal, body?: object): Promise<any> {
    try {
      const c = this.config();
      const r = await this.transport(`https://api.cloudflare.com/client/v4/accounts/${c.account}/stream${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // Bounded JSON response; never include it or the request URL in any errors.
      const reader = r.body?.getReader(); let text = "";
      if (!reader) throw 0;
      try {
        let bytes = 0;
        for (;;) {
          const v = await reader.read(); if (v.done) break;
          bytes += v.value.byteLength;
          if (bytes > 65536) { await reader.cancel(); throw 0; }
          text += new TextDecoder().decode(v.value);
        }
      } finally { reader.releaseLock(); }
      const data = JSON.parse(text);
      if (!r.ok || data.success !== true || !data.result) throw 0;
      return data.result;
    } catch { throw new ProcessingError("VIDEO_PROVIDER_UNAVAILABLE"); }
  }
  async ingest(sourceUrl: string, revisionId: string, signal: AbortSignal) {
    const c = this.config();
    const r = await this.request("/copy", signal, { url: sourceUrl, requireSignedURLs: true,
      allowedOrigins: [c.origin], meta: { name: `SaudiSensei revision ${revisionId}` } });
    if (!uid(r.uid)) throw new ProcessingError("VIDEO_PROVIDER_UNAVAILABLE");
    return r.uid as string;
  }
  async inspect(reference: string, signal: AbortSignal) {
    if (!uid(reference)) throw new ProcessingError("VIDEO_PROVIDER_UNAVAILABLE", false);
    const r = await this.request(`/${reference}`, signal);
    if (r.uid !== reference) throw new ProcessingError("VIDEO_PROVIDER_UNAVAILABLE", false);
    const downloads = await this.request(`/${reference}/downloads`, signal);
    let host: string | null = null;
    try {
      const u = new URL(r.playback?.hls);
      if (u.protocol === "https:" && !u.username && !u.password &&
          /^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(u.hostname)) host = u.hostname;
    } catch { /* processing response may not yet contain playback metadata */ }
    return {
      ready: r.readyToStream === true && r.status?.state === "ready",
      failed: r.status?.state === "error", privatePlayback: r.requireSignedURLs === true,
      downloadsDisabled: typeof downloads === "object" && Object.keys(downloads).length === 0,
      originsMatch: Array.isArray(r.allowedOrigins) && r.allowedOrigins.length === 1 && r.allowedOrigins[0] === this.config().origin,
      duration: typeof r.duration === "number" ? r.duration : 0, playbackHost: host,
    };
  }
}
