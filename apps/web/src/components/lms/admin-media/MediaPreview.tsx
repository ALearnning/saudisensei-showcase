"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { lms } from "@/lib/lms-client";
import { fetchMediaPreview } from "@/lib/admin-media-transfer";
import { mediaLabels } from "./labels";
import { expiryDelay, FILE_RENEW_LEAD_MS, GRANT_TIMEOUT_MS, renewDelay, safeManifestUrl, seg, VIDEO_RENEW_LEAD_MS, withTimeout } from "./helpers";
import type { LibraryAssetKind, RenditionAccess, VideoPreviewAccess } from "./types";

type View = { kind: "loading" } | { kind: "error"; expired?: boolean } | { kind: "text"; text: string } | { kind: "blob"; url: string; type: string };

const VIDEO_REAUTH_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 60_000;

/** Private Admin preview. Mounted only while open; unmount revokes everything. */
export function MediaPreview({ locale, root, placementId, revisionId, kind, title, onClose }: {
  locale: Locale; root: string; placementId: string; revisionId: string; kind: LibraryAssetKind; title: string; onClose: () => void;
}) {
  const L = mediaLabels(locale);
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (!d.open) d.showModal();
    const onCancel = () => closeRef.current();
    d.addEventListener("close", onCancel);
    // Removing the DOM node removes it from the top layer. Calling close() in
    // cleanup queues a native close event that can reach the next StrictMode
    // effect and immediately dismiss a newly opened inspection dialog.
    return () => { d.removeEventListener("close", onCancel); };
  }, []);
  return (
    <dialog ref={ref} className="am-preview" aria-labelledby="am-preview-title" data-testid="dialog-media-preview">
      <header className="am-preview-head">
        <h2 id="am-preview-title" dir="auto">{title}</h2>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label={L.closePreview} data-testid="button-close-preview"><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="am-preview-body">
        {kind === "video"
          ? <VideoPreview locale={locale} root={root} placementId={placementId} revisionId={revisionId} />
          : <FilePreview locale={locale} root={root} placementId={placementId} revisionId={revisionId} title={title} />}
      </div>
    </dialog>
  );
}

function FilePreview({ locale, root, placementId, revisionId, title }: { locale: Locale; root: string; placementId: string; revisionId: string; title: string }) {
  const L = mediaLabels(locale);
  const [view, setView] = useState<View>({ kind: "loading" });
  useEffect(() => {
    let alive = true; let url: string | null = null; let renewT: number | undefined; let hardT: number | undefined;
    let ctrl = new AbortController();
    const clear = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
    const fail = (expired: boolean) => { window.clearTimeout(renewT); window.clearTimeout(hardT); ctrl.abort(); clear(); setView({ kind: "error", expired }); };
    async function load(first: boolean) {
      ctrl = new AbortController();
      try {
        const r = await withTimeout(lms<RenditionAccess>(`${root}/placements/${seg(placementId)}/access`, { method: "POST", body: { mode: "preview", revisionId } }), GRANT_TIMEOUT_MS, ctrl);
        if (!alive) return;
        if (!r.ok || r.data.revisionId !== revisionId) { fail(!first); return; }
        const access = r.data;
        const left = expiryDelay(access.expiresAt, Date.now());
        const next = renewDelay(access.expiresAt, Date.now(), FILE_RENEW_LEAD_MS);
        if (left === null || next === null) { fail(!first); return; }
        const blob = await withTimeout(fetchMediaPreview(access, ctrl.signal), Math.min(FETCH_TIMEOUT_MS, left), ctrl);
        if (!alive) return;
        const type = access.contentType.split(";")[0].trim().toLowerCase();
        if (type.startsWith("text/")) { const text = await blob.text(); if (!alive) return; clear(); setView({ kind: "text", text }); }
        else { const u = URL.createObjectURL(blob); clear(); url = u; setView({ kind: "blob", url: u, type }); }
        // Hard absolute-expiry teardown: fires even if renewal hangs.
        window.clearTimeout(hardT);
        hardT = window.setTimeout(() => { if (alive) fail(true); }, Math.max(0, (expiryDelay(access.expiresAt, Date.now()) ?? 0)));
        window.clearTimeout(renewT);
        renewT = window.setTimeout(() => void load(false), next);
      } catch { if (alive) fail(!first); }
    }
    void load(true);
    return () => { alive = false; ctrl.abort(); window.clearTimeout(renewT); window.clearTimeout(hardT); clear(); };
  }, [root, placementId, revisionId]);
  if (view.kind === "loading") return <div className="am-preview-wait" role="status"><span className="skel" aria-hidden="true" />{L.previewLoading}</div>;
  if (view.kind === "error") return <p className="notice bad" role="alert" data-testid="status-preview-error">{view.expired ? L.previewExpired : L.previewFailed}</p>;
  if (view.kind === "text") return <pre className="am-preview-text" dir="auto" data-testid="preview-text">{view.text}</pre>;
  if (view.type.startsWith("image/")) return <img className="am-preview-img" src={view.url} alt={title} data-testid="preview-image" />;
  return <iframe className="am-preview-doc" src={view.url} title={title} data-testid="preview-document" />;
}

type HlsInstance = {
  attachMedia(v: HTMLMediaElement): void; loadSource(u: string): void; startLoad(pos?: number): void; destroy(): void;
  on(ev: string, cb: (ev: string, data: { fatal?: boolean }) => void): void;
};
type HlsCtor = { new (cfg: Record<string, unknown>): HlsInstance; isSupported(): boolean; Events: Record<string, string> };

/** Private HLS preview. Each renewal re-creates the player with the saved startPosition and
 *  autoStartLoad:false, then startLoad(saved) after manifest parse (avoids loadSource/seek race). */
function VideoPreview({ locale, root, placementId, revisionId }: { locale: Locale; root: string; placementId: string; revisionId: string }) {
  const L = mediaLabels(locale);
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "expired" | "unsupported">("loading");
  useEffect(() => {
    const el = video.current; if (!el) return;
    let alive = true; let renewT: number | undefined; let hardT: number | undefined;
    let hls: HlsInstance | null = null; let Hls: HlsCtor | null = null; let native = false;
    let ctrl = new AbortController();
    const nativeCleanup: (() => void)[] = [];
    const runNativeCleanup = () => { while (nativeCleanup.length) nativeCleanup.pop()!(); };
    const teardown = () => {
      window.clearTimeout(renewT); window.clearTimeout(hardT); ctrl.abort();
      hls?.destroy(); hls = null; runNativeCleanup();
      el.pause(); el.removeAttribute("src"); el.load();
    };
    const fail = (s: "error" | "expired") => { teardown(); if (alive) setState(s); };
    const onNativeError = () => fail("error");
    el.addEventListener("error", onNativeError);

    const authorize = async () => {
      ctrl = new AbortController();
      const r = await withTimeout(lms<VideoPreviewAccess>(`${root}/placements/${seg(placementId)}/video-preview`, { method: "POST", body: { revisionId } }), GRANT_TIMEOUT_MS, ctrl);
      if (!r.ok || r.data.revisionId !== revisionId) return null;
      const url = safeManifestUrl(r.data.manifestUrl, window.location.origin);
      const next = renewDelay(r.data.expiresAt, Date.now(), VIDEO_RENEW_LEAD_MS);
      const left = expiryDelay(r.data.expiresAt, Date.now());
      return url && next !== null && left !== null ? { url, next, left } : null;
    };
    const schedule = (a: { next: number; left: number }) => {
      window.clearTimeout(renewT); window.clearTimeout(hardT);
      renewT = window.setTimeout(() => void renew(), Math.min(VIDEO_REAUTH_MS, a.next));
      hardT = window.setTimeout(() => fail("expired"), a.left);
    };
    const mount = (url: string, startAt: number, resumePlaying: boolean) => {
      if (Hls && !native) {
        hls?.destroy();
        const h = new Hls({ enableWorker: true, autoStartLoad: false, startPosition: startAt });
        hls = h;
        h.on(Hls.Events.MANIFEST_PARSED, () => {
          if (hls !== h) return;
          h.startLoad(startAt);
          if (resumePlaying) void el.play().catch(() => undefined);
        });
        h.on(Hls.Events.ERROR, (_e, data) => { if (hls === h && data?.fatal) fail("error"); });
        h.attachMedia(el);
        h.loadSource(url);
      } else {
        runNativeCleanup();
        const onMeta = () => {
          if (startAt > 0) el.currentTime = startAt;
          if (resumePlaying) void el.play().catch(() => undefined);
        };
        el.addEventListener("loadedmetadata", onMeta, { once: true });
        nativeCleanup.push(() => el.removeEventListener("loadedmetadata", onMeta));
        el.src = url;
      }
    };
    async function start() {
      try {
        const a = await authorize(); if (!alive) return;
        if (!a) { fail("error"); return; }
        const mod = await import("hls.js"); if (!alive) return;
        Hls = mod.default as unknown as HlsCtor;
        if (!Hls.isSupported()) {
          if (!el!.canPlayType("application/vnd.apple.mpegurl")) { teardown(); setState("unsupported"); return; }
          native = true;
        }
        mount(a.url, 0, false);
        setState("ready"); schedule(a);
      } catch { if (alive) fail("error"); }
    }
    async function renew() {
      try {
        const a = await authorize(); if (!alive) return;
        if (!a) { fail("expired"); return; }
        mount(a.url, el!.currentTime, !el!.paused);
        schedule(a);
      } catch { if (alive) fail("expired"); }
    }
    void start();
    return () => { alive = false; el.removeEventListener("error", onNativeError); teardown(); };
  }, [root, placementId, revisionId]);
  return (
    <div className="am-video">
      {state === "loading" && <div className="am-preview-wait" role="status"><span className="skel" aria-hidden="true" />{L.previewLoading}</div>}
      {(state === "error" || state === "expired" || state === "unsupported") && (
        <p className="notice bad" role="alert" data-testid="status-preview-error">{state === "expired" ? L.previewExpired : state === "unsupported" ? L.videoUnsupported : L.previewFailed}</p>
      )}
      <video ref={video} controls playsInline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()} hidden={state !== "ready"} data-testid="preview-video" />
    </div>
  );
}
