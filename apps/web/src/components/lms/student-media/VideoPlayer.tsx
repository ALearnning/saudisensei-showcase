"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { lms } from "@/lib/lms-client";
import { safeManifestUrl } from "../admin-media/helpers";
import { studentMediaLabels } from "./labels";
import { classifyStatus, canRecoverSource, GRANT_TIMEOUT_MS, grantDeadline, hlsConfig, placementPath, renewIn, retryDelay, VIDEO_GRANT_MAX_MS, untilDeadline, VIDEO_RENEW_LEAD_MS, withTimeout, type StudentScope } from "./helpers";
import { ViewerState, type ViewerFailure } from "./ViewerState";
import type { StudentVideoPlayback } from "./types";

type HlsInstance = {
  attachMedia(v: HTMLMediaElement): void; loadSource(u: string): void; startLoad(pos?: number): void; destroy(): void; recoverMediaError(): void;
  on(ev: string, cb: (ev: string, data: { fatal?: boolean; type?: string }) => void): void;
};
type HlsCtor = { new (cfg: Record<string, unknown>): HlsInstance; isSupported(): boolean; Events: Record<string, string>; ErrorTypes: Record<string, string> };

/** Private HLS player. Each renewal recreates the player with the saved startPosition and
 *  autoStartLoad:false, starting load only after the new manifest parses (position preserved).
 *  Never reports watch progress; never marks completion. */
export function VideoPlayer({ locale, scope, parentId, placementId, revisionId, title, onStale }: {
  locale: Locale; scope: StudentScope; parentId: string; placementId: string; revisionId: string; title: string; onStale: () => void;
}) {
  const L = studentMediaLabels(locale);
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "ready" | ViewerFailure>("loading");
  const [buffering, setBuffering] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [nonce, setNonce] = useState(0);
  const staleRef = useRef(onStale); staleRef.current = onStale;

  useEffect(() => {
    const el = video.current; if (!el) return;
    let alive = true; let stopped = false; let recoveries = 0; let renewT: number | undefined; let hardT: number | undefined; let retryT: number | undefined;
    let hls: HlsInstance | null = null; let Hls: HlsCtor | null = null; let native = false; let mounted = false; let mediaRecovered = false;
    let ctrl = new AbortController();
    const path = placementPath(scope, parentId, placementId, "playback");
    const nativeCleanup: (() => void)[] = [];
    const runNativeCleanup = () => { while (nativeCleanup.length) nativeCleanup.pop()!(); };
    const clearTimers = () => { window.clearTimeout(renewT); window.clearTimeout(hardT); window.clearTimeout(retryT); };
    const teardown = () => {
      clearTimers(); ctrl.abort(); hls?.destroy(); hls = null; runNativeCleanup(); mounted = false;
      el.pause(); el.removeAttribute("src"); el.load();
    };
    const live = () => alive && !stopped;
    const fail = (s: ViewerFailure) => {
      if (stopped) return;
      stopped = true; teardown();
      if (!alive) return;
      setState(s); setBuffering(false); setReconnecting(false);
      if (s === "unavailable") { try { staleRef.current(); } catch { /* silent */ } }
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    // Only real forward playback proves a source recovery succeeded.
    let recoveredAt = -1;
    const onTime = () => { if (recoveries > 0 && recoveredAt >= 0 && el.currentTime > recoveredAt + 2) { recoveries = 0; recoveredAt = -1; } };
    const recoverSource = () => {
      if (!live()) return;
      if (!canRecoverSource(recoveries)) { fail("renewal"); return; }
      recoveries += 1; recoveredAt = el.currentTime;
      void renew(0, true);
    };
    const onNativeError = () => { if (native && mounted) recoverSource(); };
    el.addEventListener("waiting", onWaiting); el.addEventListener("stalled", onWaiting);
    el.addEventListener("playing", onPlaying); el.addEventListener("canplay", onPlaying); el.addEventListener("seeked", onPlaying);
    el.addEventListener("error", onNativeError); el.addEventListener("timeupdate", onTime);
    if (!path) { setState("unavailable"); return () => { alive = false; }; }

    async function authorize(): Promise<{ ok: true; url: string; deadline: number } | { ok: false; kind: ReturnType<typeof classifyStatus> }> {
      ctrl = new AbortController();
      try {
        const r = await withTimeout(lms<StudentVideoPlayback>(path!, { method: "POST", body: { revisionId } }), GRANT_TIMEOUT_MS, ctrl);
        if (!r.ok) return { ok: false, kind: classifyStatus(r.error.status) };
        if (r.data.revisionId !== revisionId) return { ok: false, kind: "unavailable" };
        const url = safeManifestUrl(r.data.manifestUrl, window.location.origin);
        const deadline = grantDeadline(r.data.expiresAt, Date.now(), VIDEO_GRANT_MAX_MS);
        return url && deadline !== null ? { ok: true, url, deadline } : { ok: false, kind: "unavailable" };
      } catch { return { ok: false, kind: "transient" }; }
    }
    function schedule(deadline: number) {
      clearTimers();
      const left = untilDeadline(deadline, Date.now());
      if (left === null) { fail("expired"); return; }
      hardT = window.setTimeout(() => fail("expired"), left);
      const next = renewIn(left, VIDEO_RENEW_LEAD_MS);
      if (next !== null) renewT = window.setTimeout(() => void renew(0, false), next);
    }
    function mount(url: string, startAt: number, resume: boolean) {
      mounted = true; mediaRecovered = false;
      if (Hls && !native) {
        hls?.destroy();
        const h = new Hls(hlsConfig(startAt)); // startPosition fixed BEFORE any load starts
        hls = h;
        h.on(Hls.Events.MANIFEST_PARSED, () => {
          if (hls !== h) return;
          h.startLoad(startAt);
          if (resume) void el!.play().catch(() => undefined);
        });
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (hls !== h || !data?.fatal) return;
          if (data.type === Hls!.ErrorTypes.MEDIA_ERROR && !mediaRecovered) { mediaRecovered = true; h.recoverMediaError(); return; }
          if (data.type === Hls!.ErrorTypes.NETWORK_ERROR) { recoverSource(); return; }
          fail("corrupt");
        });
        h.attachMedia(el!);
        h.loadSource(url);
      } else {
        runNativeCleanup();
        const onMeta = () => { if (startAt > 0) el!.currentTime = startAt; if (resume) void el!.play().catch(() => undefined); };
        el!.addEventListener("loadedmetadata", onMeta, { once: true });
        nativeCleanup.push(() => el!.removeEventListener("loadedmetadata", onMeta));
        el!.src = url;
      }
    }
    async function start(attempt: number) {
      if (!live()) return;
      const a = await authorize(); if (!live()) return;
      if (!a.ok) {
        const d = a.kind === "transient" ? retryDelay(attempt) : null;
        if (d !== null) { retryT = window.setTimeout(() => void start(attempt + 1), d); return; }
        fail(a.kind); return;
      }
      try {
        if (!Hls) {
          const mod = await import("hls.js"); if (!live()) return;
          Hls = mod.default as unknown as HlsCtor;
          if (!Hls.isSupported()) {
            if (!el!.canPlayType("application/vnd.apple.mpegurl")) { fail("unsupported"); return; }
            native = true;
          }
        }
        if (untilDeadline(a.deadline, Date.now()) === null) { fail("expired"); return; }
        mount(a.url, 0, false);
        setState("ready"); schedule(a.deadline);
      } catch { fail("transient"); }
    }
    let renewing = false;
    async function renew(attempt: number, recovering: boolean) {
      if (!live() || (renewing && attempt === 0)) return;
      renewing = true;
      const at = el!.currentTime; const playing = !el!.paused;
      if (recovering) setReconnecting(true);
      const a = await authorize(); if (!live()) { renewing = false; return; }
      if (!a.ok) {
        const d = a.kind === "transient" ? retryDelay(attempt) : null;
        if (d !== null) { setReconnecting(true); window.clearTimeout(retryT); retryT = window.setTimeout(() => void renew(attempt + 1, recovering), d); return; }
        renewing = false;
        fail(a.kind === "transient" ? "renewal" : a.kind); return;
      }
      renewing = false;
      if (untilDeadline(a.deadline, Date.now()) === null) { fail("expired"); return; }
      mount(a.url, at, playing);
      setReconnecting(false);
      schedule(a.deadline);
    }

    setState("loading"); setBuffering(false); setReconnecting(false);
    void start(0);
    return () => {
      alive = false; stopped = true;
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("waiting", onWaiting); el.removeEventListener("stalled", onWaiting);
      el.removeEventListener("playing", onPlaying); el.removeEventListener("canplay", onPlaying); el.removeEventListener("seeked", onPlaying);
      el.removeEventListener("error", onNativeError);
      teardown();
    };
  }, [scope, parentId, placementId, revisionId, nonce]);

  const failed = state !== "loading" && state !== "ready";
  return (
    <div className="sm-video" data-testid="viewer-video">
      {state === "loading" && <ViewerState locale={locale} state="loading" />}
      {failed && <ViewerState locale={locale} state={state as ViewerFailure} onRetry={() => setNonce((n) => n + 1)} />}
      <div className="sm-video-frame" hidden={state !== "ready"}>
        <video ref={video} controls playsInline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture
          aria-label={title} onContextMenu={(e) => e.preventDefault()} data-testid="video-player" />
        {(buffering || reconnecting) && state === "ready" && (
          <div className="sm-overlay" role="status" data-testid={reconnecting ? "status-reconnecting" : "status-buffering"}>
            <span className="sm-spin" aria-hidden="true" />{reconnecting ? L.reconnecting : L.buffering}
          </div>
        )}
      </div>
    </div>
  );
}
