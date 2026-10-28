// Pure UI helpers for the Admin media manager. No DOM, no network.
import type { LibraryAdminItem, LibraryAssetKind, LibraryCollection, LibraryRevision, LibraryStatus, MediaScope, ProcessingStatus } from "./types";

export const mediaRoot = (scope: MediaScope, parentId: string) => `admin/${scope}/${encodeURIComponent(parentId)}/media-library`;
export const seg = (id: string) => encodeURIComponent(id);

export const isActiveStatus = (s: LibraryStatus) => s === "draft" || s === "published";

export type Phase = "awaiting" | "scanning" | "processing" | "transcoding" | "ready" | "failed" | "rejected";
export const isTerminalPhase = (p: Phase) => p === "ready" || p === "failed" || p === "rejected";

/** Maps processing status to a coarse, safe phase. Never surfaces raw job fields. */
export function processingPhase(p: ProcessingStatus | null | undefined): Phase {
  if (!p) return "awaiting";
  if (p.revisionState === "ready") return "ready";
  if (p.revisionState === "rejected" || p.scanState === "rejected") return "rejected";
  if (p.revisionState === "failed" || p.job?.state === "permanently_failed") return "failed";
  if (!p.job) return p.revisionState === "pending" ? "awaiting" : p.revisionState === "quarantined" ? "scanning" : "processing";
  if (p.job.stage === "scan" || p.revisionState === "quarantined") return "scanning";
  if (p.job.stage === "ingest" || p.job.stage === "ingest_requested" || p.job.stage === "verify") return "transcoding";
  return "processing";
}

export function revisionPhase(r: LibraryRevision | null | undefined): Phase {
  if (!r) return "awaiting";
  if (r.state === "ready") return "ready";
  if (r.state === "rejected" || r.scanState === "rejected") return "rejected";
  if (r.state === "failed") return "failed";
  if (r.state === "quarantined" || r.scanState === "scanning") return "scanning";
  if (r.state === "processing") return "processing";
  return "awaiting";
}

/** Revision the row should watch: staged replacement first, else an unfinished current revision. */
export function watchedRevision(item: LibraryAdminItem): LibraryRevision | null {
  const staged = item.asset.stagedRevisionId ? item.revisions.find((r) => r.id === item.asset.stagedRevisionId) : undefined;
  if (staged && !isTerminalPhase(revisionPhase(staged))) return staged;
  if (item.revision && !isTerminalPhase(revisionPhase(item.revision))) return item.revision;
  return null;
}

export function readyReplacements(item: LibraryAdminItem): LibraryRevision[] {
  return item.revisions.filter((r) => r.state === "ready" && r.id === item.asset.stagedRevisionId && r.id !== item.asset.currentRevisionId);
}

export function canPreview(item: LibraryAdminItem): boolean {
  return !!item.revision && item.revision.state === "ready";
}

export function isItemReadOnly(item: LibraryAdminItem, collections: readonly LibraryCollection[], parentReadOnly: boolean): boolean {
  if (parentReadOnly || !isActiveStatus(item.asset.status) || !isActiveStatus(item.placement.status)) return true;
  const c = item.placement.collectionId ? collections.find((x) => x.id === item.placement.collectionId) : null;
  return !!c && !isActiveStatus(c.status);
}

export const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/** Active rows for a given collection (null = ungrouped), ordered. */
export function siblings(items: readonly LibraryAdminItem[], collectionId: string | null): LibraryAdminItem[] {
  return items.filter((i) => isActiveStatus(i.placement.status) && isActiveStatus(i.asset.status) && (i.placement.collectionId ?? null) === collectionId)
    .sort((a, b) => byPosition(a.placement, b.placement));
}

export function activeCollections(cs: readonly LibraryCollection[]): LibraryCollection[] {
  return cs.filter((c) => isActiveStatus(c.status)).sort(byPosition);
}

export function inactiveItems(items: readonly LibraryAdminItem[], collections: readonly LibraryCollection[]): LibraryAdminItem[] {
  const live = new Set(activeCollections(collections).map((c) => c.id));
  return items.filter((i) => !isActiveStatus(i.placement.status) || !isActiveStatus(i.asset.status) || (i.placement.collectionId !== null && !live.has(i.placement.collectionId)));
}

export function moveInList(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const i = ids.indexOf(id); const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; return next;
}

export type LifecycleStep = { target: "asset" | "placement"; action: "publish" | "unpublish" | "archive" | "remove" };
/** Publish = asset (if draft) then placement (if draft). Unpublish hides only this placement. */
export function publishPlan(item: LibraryAdminItem): LifecycleStep[] {
  const s: LifecycleStep[] = [];
  if (item.asset.status === "draft") s.push({ target: "asset", action: "publish" });
  if (item.placement.status === "draft") s.push({ target: "placement", action: "publish" });
  return s;
}
export const isPublished = (item: LibraryAdminItem) => item.asset.status === "published" && item.placement.status === "published";

export const FILE_RENEW_LEAD_MS = 15_000;
export const VIDEO_RENEW_LEAD_MS = 30_000;
export const GRANT_TIMEOUT_MS = 20_000;

/** Milliseconds until absolute expiry, or null when malformed/already expired (fail closed). */
export function expiryDelay(expiresAt: unknown, now: number): number | null {
  if (typeof expiresAt !== "string") return null;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return null;
  const left = exp - now;
  return left > 0 ? left : null;
}

/** Delay before renewing: `leadMs` before expiry. Short grants renew at half-life, never under 1s.
 *  Returns null (fail closed, no renewal loop) when malformed or under 2s remain. */
export function renewDelay(expiresAt: unknown, now: number, leadMs: number): number | null {
  const left = expiryDelay(expiresAt, now);
  if (left === null || left < 2000) return null;
  const d = left - leadMs;
  return d >= 1000 ? d : Math.max(1000, Math.floor(left / 2));
}

/** Rejects if `p` does not settle within `ms`; aborts the controller when it times out. */
export function withTimeout<T>(p: Promise<T>, ms: number, ctrl?: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => { ctrl?.abort(); reject(new Error("TIMEOUT")); }, ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

/** Validates a private HLS manifest URL without hardcoding provider hosts. */
export function safeManifestUrl(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const u = new URL(raw, origin);
    if (u.username || u.password) return null;
    if (u.protocol !== "https:" && u.origin !== origin) return null;
    return u.toString();
  } catch { return null; }
}

// Mirrors the transfer helper's supported formats; mediaFileMetadata stays the source of truth.
export const ACCEPT = ".pdf,.txt,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,application/pdf,text/plain,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";

export type FileMeta = { filename: string; mimeType: string; bytes: number; kind: "document" | "image" | "video" };
/** Runs the authoritative metadata validator; returns null instead of throwing. */
export function safeMeta(file: File, validate: (f: File) => FileMeta): FileMeta | null {
  try { return validate(file); } catch { return null; }
}
/** Retry must use the immutable file recorded on the pending revision. */
export function matchesRevision(meta: FileMeta | null, r: { filename: string; mimeType: string; bytes: number } | null | undefined): boolean {
  return !!meta && !!r && meta.filename === r.filename && meta.bytes === r.bytes && meta.mimeType === r.mimeType;
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]{1,8}$/, "").replace(/[_]+/g, " ").trim();
  return (base || name).slice(0, 255);
}

export function formatBytes(n: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"]; let v = n; let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: u === 0 ? 0 : 1 }).format(v)} ${units[u]}`;
}

export function formatDuration(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec); const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export const kindIcon = (k: LibraryAssetKind) => k;
export const isConflict = (e: { status: number } | null | undefined) => e?.status === 409;
