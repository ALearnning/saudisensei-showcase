import { NextRequest, NextResponse } from "next/server";
import { getAuth0 } from "@/lib/auth0";
import {
  apiBase, buildUpstreamUrl, exceedsBytes, genericError, isAllowedFetchSite, isSameOrigin, matchBffRoute, sanitizeQuery, readBoundedBody, safeRetryAfter,
  isRenditionContentRoute, privateContentHeaders,
} from "@/lib/bff-policy";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const MAX_BODY = 200_000;

function fail(code: string, status: number) {
  return NextResponse.json({ code }, { status, headers: NO_STORE });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const method = req.method;
  if (!matchBffRoute(method, path ?? [])) return fail("NOT_FOUND", 404);
  const appBase = process.env.APP_BASE_URL;
  const base = apiBase({ API_BASE_URL: process.env.API_BASE_URL, APP_BASE_URL: appBase });
  if (!appBase || !base) return fail("UNAVAILABLE", 503);

  let body: string | undefined;
  if (method === "GET") {
    if (!isAllowedFetchSite(req.headers.get("sec-fetch-site"))) return fail("FORBIDDEN_ORIGIN", 403);
  } else {
    if (!isSameOrigin(req.headers.get("origin"), appBase)) return fail("FORBIDDEN_ORIGIN", 403);
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return fail("UNSUPPORTED_MEDIA_TYPE", 415);
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY) return fail("PAYLOAD_TOO_LARGE", 413);
    const incoming = await readBoundedBody(req.body, MAX_BODY);
    if (!incoming.ok) return fail(incoming.code, incoming.status);
    body = incoming.text;
    if (exceedsBytes(body, MAX_BODY)) return fail("PAYLOAD_TOO_LARGE", 413);
    try {
      const parsed: unknown = JSON.parse(body || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("VALIDATION_FAILED", 400);
      body = JSON.stringify(parsed);
    } catch {
      return fail("VALIDATION_FAILED", 400);
    }
  }

  const auth0 = getAuth0();
  if (!auth0) return fail("AUTH_NOT_CONFIGURED", 503);
  const session = await auth0.getSession();
  if (!session) return fail("UNAUTHENTICATED", 401);
  let token: string;
  try {
    token = (await auth0.getAccessToken()).token;
  } catch {
    return fail("UNAUTHENTICATED", 401);
  }

  // Only fixed headers are forwarded; client-supplied auth/role/actor headers are never trusted.
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const renditionContent = isRenditionContentRoute(method, path);
  if (renditionContent) {
    const capability = req.headers.get("x-media-capability") ?? "";
    if (!/^[A-Za-z0-9_-]{40,2048}$/.test(capability)) return fail("MEDIA_UNAVAILABLE", 404);
    headers["X-Media-Capability"] = capability;
    headers.Accept = "application/octet-stream";
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let upstream: Response;
  try {
    upstream = await fetch(buildUpstreamUrl(base, path, sanitizeQuery(req.nextUrl.searchParams, { method, path })), {
      method, headers, body, cache: "no-store", redirect: "manual",
      // New scan endpoint only: bounded real scanner can take longer than JSON CRUD.
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(renditionContent ? 120_000 :
        method === "POST" && path[0] === "admin" && path[1] === "media" && path[3] === "scan" ? 60_000 : 10_000)]),
    });
  } catch {
    return fail("UPSTREAM_UNAVAILABLE", 502);
  }
  if (renditionContent && upstream.ok) {
    const safeHeaders = privateContentHeaders(upstream.headers);
    if (!safeHeaders || !upstream.body || upstream.status !== 200) {
      await upstream.body?.cancel().catch(() => {});
      return fail("UPSTREAM_INVALID", 502);
    }
    // Preserve backpressure; PDFs/images/plaintext are never materialized as a
    // large string or buffer in the BFF. Future viewers fetch then render safely.
    return new NextResponse(upstream.body, { status: 200, headers: safeHeaders });
  }
  const text = await upstream.text().catch(() => "");
  if (upstream.ok) {
    if (!text) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    try {
      JSON.parse(text);
    } catch {
      return fail("UPSTREAM_INVALID", 502);
    }
    return new NextResponse(text, { status: upstream.status, headers: NO_STORE });
  }
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
  const retryAfter = safeRetryAfter(upstream.headers.get("retry-after"));
  return NextResponse.json(genericError(parsed, status >= 500 ? "UPSTREAM_ERROR" : "REQUEST_FAILED"), {
    status, headers: { ...NO_STORE, ...(retryAfter ? { "Retry-After": retryAfter } : {}) },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
