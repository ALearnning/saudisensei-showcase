// Pure Student media helpers. No DOM, no network, never logs.
import type { LibraryCollection, LibraryStudentItem, LibraryStudentList } from "./types";

export type StudentScope = "courses" | "chapters" | "lessons";
export const SCOPES: readonly StudentScope[] = ["courses", "chapters", "lessons"];

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const CONTENT_RE = new RegExp(`^/lms-api/(courses|chapters|lessons)/(${UUID})/media-library/placements/(${UUID})/content$`);
const CAPABILITY_RE = /^[A-Za-z0-9_-]{40,2048}$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
export const isScope = (v: unknown): v is StudentScope => typeof v === "string" && (SCOPES as readonly string[]).includes(v);
export const isCapability = (v: unknown): v is string => typeof v === "string" && CAPABILITY_RE.test(v);

/** BFF-relative library root (lms() adds /lms-api/). Null when ids are not exact UUIDs. */
export function studentRoot(scope: StudentScope, parentId: string): string | null {
  return isScope(scope) && isUuid(parentId) ? `${scope}/${parentId}/media-library` : null;
}
export function placementPath(scope: StudentScope, parentId: string, placementId: string, action: "access" | "playback"): string | null {
  const root = studentRoot(scope, parentId);
  return root && isUuid(placementId) ? `${root}/placements/${placementId}/${action}` : null;
}

/** Accepts ONLY the exact same-origin content path for the expected scope/parent/placement.
 *  Rejects queries, fragments, credentials, other origins, encodings and Admin routes. */
export function studentContentPath(raw: unknown, origin: string, expected: { scope: StudentScope; parentId: string; placementId: string }): string | null {
  if (typeof raw !== "string" || raw.length > 512 || /[\s\\%?#]/.test(raw)) return null;
  // The raw value itself must be the exact path (optionally prefixed by this origin): no dot segments.
  const rawPath = raw.startsWith(`${origin}/`) ? raw.slice(origin.length) : raw;
  if (!CONTENT_RE.test(rawPath)) return null;
  let u: URL;
  try { u = new URL(raw, origin); } catch { return null; }
  if (u.origin !== origin || u.username || u.password || u.search || u.hash) return null;
  const m = CONTENT_RE.exec(u.pathname);
  if (!m) return null;
  const [, scope, parent, placement] = m;
  if (scope !== expected.scope || parent.toLowerCase() !== expected.parentId.toLowerCase() || placement.toLowerCase() !== expected.placementId.toLowerCase()) return null;
  return u.pathname;
}

export const baseType = (ct: unknown) => (typeof ct === "string" ? ct.split(";")[0].trim().toLowerCase() : "");

export type ViewerKind = "video" | "pdf" | "image" | "text" | "file";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export function viewerKind(kind: string, mimeType: string): ViewerKind {
  if (kind === "video") return "video";
  const t = baseType(mimeType);
  if (t === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(t)) return "image";
  if (t === "text/plain") return "text";
  return "file";
}
/** The granted content type must match the viewer chosen from the listing. */
export function contentMatches(viewer: ViewerKind, contentType: string): boolean {
  const t = baseType(contentType);
  if (viewer === "pdf") return t === "application/pdf";
  if (viewer === "image") return IMAGE_TYPES.has(t);
  if (viewer === "text") return t === "text/plain";
  return false;
}

export type FailureKind = "transient" | "session" | "denied" | "unavailable";
/** Maps an HTTP status (0 = network) to a coarse, displayable class. */
export function classifyStatus(status: number): FailureKind {
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return "transient";
  if (status === 401) return "session";
  if (status === 403) return "denied";
  return "unavailable";
}

export const MAX_RETRIES = 3;
const RETRY_DELAYS = [1500, 4000, 9000];
/** Bounded backoff; null when retries are exhausted. */
export function retryDelay(attempt: number): number | null {
  return attempt >= 0 && attempt < MAX_RETRIES ? RETRY_DELAYS[attempt] : null;
}

export const FILE_RENEW_LEAD_MS = 20_000;
export const VIDEO_RENEW_LEAD_MS = 45_000;
export const GRANT_TIMEOUT_MS = 20_000;
export const FETCH_TIMEOUT_MS = 60_000;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** TXT page size for DOM rendering only; content is never truncated. */
export const MAX_TEXT_CHARS = 200_000;
/** Page start offsets covering the whole text; never splits a UTF-16 surrogate pair. */
export function textPageStarts(text: string, size: number = MAX_TEXT_CHARS): number[] {
  const step = Math.max(2, Math.trunc(size));
  const starts = [0];
  let i = 0;
  while (text.length - i > step) {
    let next = i + step;
    const c = text.charCodeAt(next);
    if (c >= 0xdc00 && c <= 0xdfff) next -= 1;
    starts.push(next); i = next;
  }
  return starts;
}
export function textPage(text: string, starts: readonly number[], page: number): string {
  const p = Math.min(Math.max(0, Math.trunc(page)), Math.max(0, starts.length - 1));
  return text.slice(starts[p] ?? 0, starts[p + 1] ?? text.length);
}
export const NATIVE_GRANT_MAX_MS = 120_000;
export const VIDEO_GRANT_MAX_MS = 300_000;

/** Milliseconds until expiry, clamped to the validated lifetime cap. Null when malformed/expired. */
export function grantLeft(expiresAt: unknown, now: number, capMs: number): number | null {
  if (typeof expiresAt !== "string") return null;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return null;
  const left = Math.min(exp - now, capMs);
  return left > 0 ? left : null;
}
/** Absolute deadline (epoch ms) fixed at grant validation; null when malformed/expired. */
export function grantDeadline(expiresAt: unknown, now: number, capMs: number): number | null {
  const left = grantLeft(expiresAt, now, capMs);
  return left === null ? null : now + left;
}
/** Remaining ms to a fixed deadline; later async work can never extend it. */
export const untilDeadline = (deadline: number, now: number): number | null => (deadline - now > 0 ? deadline - now : null);
export const MAX_SOURCE_RECOVERIES = 3;
/** Consecutive source-recovery budget; reset only after real playback resumes. */
export const canRecoverSource = (consecutive: number) => consecutive >= 0 && consecutive < MAX_SOURCE_RECOVERIES;
/** Renewal delay: leadMs before expiry, half-life for short grants. Null under 2s (fail closed). */
export function renewIn(left: number | null, leadMs: number): number | null {
  if (left === null || left < 2000) return null;
  const d = left - leadMs;
  return d >= 1000 ? d : Math.max(1000, Math.floor(left / 2));
}

export function withTimeout<T>(p: Promise<T>, ms: number, ctrl?: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => { ctrl?.abort(); reject(new Error("TIMEOUT")); }, ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
/** Defensive Student filter: published placement, ready revision, published collection (or none). */
export function isVisibleItem(i: LibraryStudentItem, liveCollections: ReadonlySet<string>): boolean {
  if (!i || i.placement?.status !== "published" || i.revision?.state !== "ready") return false;
  if (!isUuid(i.placement.id) || !isUuid(i.revision.id)) return false;
  return i.placement.collectionId === null || liveCollections.has(i.placement.collectionId);
}
export type ResourceGroup = { collection: LibraryCollection | null; items: LibraryStudentItem[] };
/** Flat ordering: ungrouped items first, then each published collection in position order. */
export function groupResources(list: LibraryStudentList | undefined | null): ResourceGroup[] {
  if (!list) return [];
  const cols = (list.collections ?? []).filter((c) => c.status === "published").sort(byPos);
  const live = new Set(cols.map((c) => c.id));
  const items = (list.items ?? []).filter((i) => isVisibleItem(i, live));
  const out: ResourceGroup[] = [];
  const loose = items.filter((i) => i.placement.collectionId === null).sort((a, b) => byPos(a.placement, b.placement));
  if (loose.length) out.push({ collection: null, items: loose });
  for (const c of cols) {
    const xs = items.filter((i) => i.placement.collectionId === c.id).sort((a, b) => byPos(a.placement, b.placement));
    if (xs.length) out.push({ collection: c, items: xs });
  }
  return out;
}
export const countResources = (g: ResourceGroup[]) => g.reduce((n, x) => n + x.items.length, 0);

/** Only a fresh download grant for an explicitly downloadable, non-video item may download. */
export function canDownload(item: Pick<LibraryStudentItem, "asset">): boolean {
  return item.asset.downloadsAllowed === true && item.asset.kind !== "video";
}
export function isValidDownloadGrant(a: { mode?: unknown; revisionId?: unknown }, revisionId: string): boolean {
  return a.mode === "download" && a.revisionId === revisionId;
}
export function isValidPreviewGrant(a: { mode?: unknown; revisionId?: unknown }, revisionId: string): boolean {
  return a.mode === "preview" && a.revisionId === revisionId;
}

/** Safe download filename: strips path separators/control chars; falls back to title. */
export function safeFilename(name: unknown, fallback: string): string {
  const raw = typeof name === "string" ? name : "";
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_").replace(/^\.+/, "").trim().slice(0, 180);
  return s || fallback.replace(/[^\p{L}\p{N} _-]+/gu, "_").slice(0, 120) || "file";
}

export function formatBytes(n: number, locale: string): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const units = locale === "ar" ? ["بايت", "ك.ب", "م.ب", "ج.ب"] : ["B", "KB", "MB", "GB"];
  let v = n; let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: u === 0 ? 0 : 1 }).format(v)} ${units[u]}`;
}
export function formatDuration(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
export const clampPage = (p: number, total: number) => (total < 1 ? 1 : Math.min(total, Math.max(1, Math.trunc(Number.isFinite(p) ? p : 1))));
/** Arrow-key page step honouring reading direction. */
export function arrowStep(key: string, rtl: boolean): -1 | 0 | 1 {
  if (key === "ArrowRight") return rtl ? -1 : 1;
  if (key === "ArrowLeft") return rtl ? 1 : -1;
  if (key === "PageDown") return 1;
  if (key === "PageUp") return -1;
  return 0;
}

/** Bounded HLS buffering: avoids unlimited synthetic prefetch. startPosition set before autostart. */
export function hlsConfig(startPosition: number): Record<string, unknown> {
  return {
    enableWorker: true, autoStartLoad: false, startPosition: Math.max(0, Number.isFinite(startPosition) ? startPosition : 0),
    maxBufferLength: 30, maxMaxBufferLength: 90, backBufferLength: 30, maxBufferSize: 60 * 1000 * 1000,
    manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 2,
  };
}
