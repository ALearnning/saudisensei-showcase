import test from "node:test";
import assert from "node:assert/strict";
import { ProcessingCloudflareVideo } from "../src/modules/media/processing-video.adapter.js";
import { ProcessingError } from "../src/modules/media/processing.ports.js";
test("general video adapter requests signed-only copy and independently verifies private readiness/download policy", async () => {
  // Temporary synthetic configuration; never reads or prints actual credentials.
  const names = ["CLOUDFLARE_STREAM_ACCOUNT_ID", "CLOUDFLARE_STREAM_API_TOKEN", "APP_BASE_URL"] as const;
  const old = names.map(n => process.env[n]);
  process.env.CLOUDFLARE_STREAM_ACCOUNT_ID = "a".repeat(32);
  process.env.CLOUDFLARE_STREAM_API_TOKEN = "synthetic-not-a-token";
  process.env.APP_BASE_URL = "https://synthetic.invalid";
  const ref = "b".repeat(32);
  const calls: { path: string; method: string; body?: any }[] = [];
  let download = false, privatePlayback = true, wrongReference = false;
  const transport = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.split("/stream")[1]!;
    calls.push({ path, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const result = path.endsWith("/downloads") ? (download ? { default: { status: "ready" } } : {}) :
      path === "/copy" ? { uid: ref } : {
        uid: wrongReference ? "c".repeat(32) : ref, requireSignedURLs: privatePlayback, allowedOrigins: ["synthetic.invalid"],
        readyToStream: true, status: { state: "ready" }, duration: 375,
        playback: { hls: `https://customer-synthetic.cloudflarestream.com/${ref}/manifest/video.m3u8` },
      };
    return new Response(JSON.stringify({ success: true, result }));
  }) as typeof fetch;
  try {
    const adapter = new ProcessingCloudflareVideo(transport);
    const signal = new AbortController().signal;
    assert.ok(await adapter.ingest("https://synthetic.invalid/private-source", "synthetic-revision", signal) === ref);
    assert.equal(calls[0]?.body.requireSignedURLs, true);
    assert.deepEqual(calls[0]?.body.allowedOrigins, ["synthetic.invalid"]);
    const ready = await adapter.inspect(ref, signal);
    assert.equal(ready.ready && ready.privatePlayback && ready.downloadsDisabled && ready.originsMatch, true);
    download = true; assert.equal((await adapter.inspect(ref, signal)).downloadsDisabled, false);
    privatePlayback = false; assert.equal((await adapter.inspect(ref, signal)).privatePlayback, false);
    wrongReference = true;
    await assert.rejects(adapter.inspect(ref, signal), (e: unknown) => e instanceof ProcessingError);
    assert.equal(calls.some(c => c.method !== "GET" && c.path.includes("/downloads")), false);
    const failed = new ProcessingCloudflareVideo(async () => { throw new Error("RAW_SENSITIVE_PROVIDER_BODY"); });
    await assert.rejects(failed.inspect(ref, signal), (e: unknown) => e instanceof ProcessingError && e.message === "VIDEO_PROVIDER_UNAVAILABLE");
  } finally { names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; }); }
});
