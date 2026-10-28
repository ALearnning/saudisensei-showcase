"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { lms } from "@/lib/lms-client";
import { studentMediaLabels } from "./labels";
import { classifyStatus, contentMatches, FETCH_TIMEOUT_MS, FILE_RENEW_LEAD_MS, GRANT_TIMEOUT_MS, grantDeadline, isValidPreviewGrant, untilDeadline, NATIVE_GRANT_MAX_MS, placementPath, renewIn, retryDelay, textPage, textPageStarts, withTimeout, type StudentScope, type ViewerKind } from "./helpers";
import { ContentError, fetchStudentContent } from "./transfer";
import { PdfViewer } from "./PdfViewer";
import { ViewerState, type ViewerFailure } from "./ViewerState";
import type { RenditionAccess } from "./types";

type Content = { type: "text"; text: string } | { type: "image"; url: string } | { type: "pdf"; data: Uint8Array };
type View = { kind: "loading" } | { kind: "ready"; content: Content; reconnecting: boolean } | { kind: "error"; failure: ViewerFailure };

/** Private preview of PDF/image/TXT. Renewal re-checks authorization (preview mode only, never
 *  download) and keeps already-received bytes; denial or hard expiry tears everything down. */
export function FileViewer({ locale, scope, parentId, placementId, revisionId, viewer, title, onStale }: {
  locale: Locale; scope: StudentScope; parentId: string; placementId: string; revisionId: string; viewer: ViewerKind; title: string; onStale: () => void;
}) {
  const L = studentMediaLabels(locale);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  const failRef = useRef<(f: ViewerFailure) => void>(() => undefined);

  useEffect(() => {
    let alive = true; let stopped = false; let objectUrl: string | null = null; let hasContent = false;
    let renewT: number | undefined; let hardT: number | undefined; let retryT: number | undefined;
    let ctrl = new AbortController(); let currentDeadline = 0;
    const path = placementPath(scope, parentId, placementId, "access");
    const clearTimers = () => { window.clearTimeout(renewT); window.clearTimeout(hardT); window.clearTimeout(retryT); };
    const release = () => { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; } hasContent = false; };
    const live = () => alive && !stopped;
    const fail = (failure: ViewerFailure) => {
      if (stopped) return;
      stopped = true; clearTimers(); ctrl.abort(); release();
      if (!alive) return;
      setView({ kind: "error", failure });
      if (failure === "unavailable") onStaleRef();
    };
    failRef.current = fail;
    const onStaleRef = () => { try { onStale(); } catch { /* never surface */ } };
    if (!path || viewer === "video" || viewer === "file") { setView({ kind: "error", failure: "noViewer" }); return () => { alive = false; }; }

    async function grant(): Promise<{ ok: true; a: RenditionAccess; deadline: number } | { ok: false; kind: ReturnType<typeof classifyStatus> }> {
      ctrl = new AbortController();
      try {
        const r = await withTimeout(lms<RenditionAccess>(path!, { method: "POST", body: { mode: "preview", revisionId } }), GRANT_TIMEOUT_MS, ctrl);
        if (!r.ok) return { ok: false, kind: classifyStatus(r.error.status) };
        const deadline = grantDeadline(r.data.expiresAt, Date.now(), NATIVE_GRANT_MAX_MS);
        if (!isValidPreviewGrant(r.data, revisionId) || deadline === null || !contentMatches(viewer, r.data.contentType)) return { ok: false, kind: "unavailable" };
        return { ok: true, a: r.data, deadline };
      } catch { return { ok: false, kind: "transient" }; }
    }

    function schedule(deadline: number) {
      clearTimers();
      const left = untilDeadline(deadline, Date.now());
      if (left === null) { fail("expired"); return; }
      hardT = window.setTimeout(() => fail("expired"), left);
      const next = renewIn(left, FILE_RENEW_LEAD_MS);
      if (next !== null) renewT = window.setTimeout(() => void cycle(0), next);
    }

    async function cycle(attempt: number) {
      if (!live()) return;
      const g = await grant(); if (!live()) return;
      if (!g.ok) {
        if (g.kind === "transient") {
          if (hasContent && untilDeadline(currentDeadline, Date.now()) === null) { fail("expired"); return; }
          const d = retryDelay(attempt);
          if (d !== null) {
            if (hasContent) setView((v) => (v.kind === "ready" ? { ...v, reconnecting: true } : v));
            window.clearTimeout(retryT); retryT = window.setTimeout(() => void cycle(attempt + 1), d);
            return;
          }
          fail(hasContent ? "renewal" : "transient"); return;
        }
        fail(g.kind); return;
      }
      if (!hasContent) {
        try {
          const blob = await withTimeout(fetchStudentContent(g.a, { scope, parentId, placementId }, ctrl.signal), Math.min(FETCH_TIMEOUT_MS, untilDeadline(g.deadline, Date.now()) ?? 1), ctrl);
          if (!live()) return;
          let content: Content;
          if (viewer === "text") {
            const text = await blob.text(); if (!live()) return;
            content = { type: "text", text };
          } else if (viewer === "image") {
            objectUrl = URL.createObjectURL(blob); content = { type: "image", url: objectUrl };
          } else {
            content = { type: "pdf", data: new Uint8Array(await blob.arrayBuffer()) }; if (!live()) return;
          }
          hasContent = true;
          setView({ kind: "ready", content, reconnecting: false });
        } catch (e) {
          if (!live()) return;
          const st = e instanceof ContentError ? e.status : 0;
          if (st === -1) { fail("corrupt"); return; }
          const k = classifyStatus(st);
          if (k === "transient") { const d = retryDelay(attempt); if (d !== null) { retryT = window.setTimeout(() => void cycle(attempt + 1), d); return; } }
          fail(k); return;
        }
      } else {
        setView((v) => (v.kind === "ready" && v.reconnecting ? { ...v, reconnecting: false } : v));
      }
      currentDeadline = g.deadline;
      schedule(g.deadline);
    }

    setView({ kind: "loading" });
    void cycle(0);
    return () => { alive = false; stopped = true; failRef.current = () => undefined; clearTimers(); ctrl.abort(); release(); };
    // onStale intentionally excluded: parent callback identity must not restart authorization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, parentId, placementId, revisionId, viewer, nonce]);

  if (view.kind === "loading") return <ViewerState locale={locale} state="loading" />;
  if (view.kind === "error") return <ViewerState locale={locale} state={view.failure} onRetry={() => setNonce((n) => n + 1)} />;
  const c = view.content;
  return (
    <div className="sm-file">
      {view.reconnecting && <p className="sm-banner" role="status" data-testid="status-reconnecting">{L.reconnecting}</p>}
      {c.type === "text" && (
        <TextViewer locale={locale} text={c.text} title={title} />
      )}
      {c.type === "image" && (
        <figure className="sm-image" data-testid="viewer-image">
          <img src={c.url} alt={title} draggable={false} onContextMenu={(e) => e.preventDefault()} onError={() => failRef.current("corrupt")} />
        </figure>
      )}
      {c.type === "pdf" && <PdfViewer locale={locale} data={c.data} title={title} onCorrupt={() => failRef.current("corrupt")} />}
    </div>
  );
}

/** Paginated plaintext: full text stays in memory, one bounded part rendered as a text node. */
function TextViewer({ locale, text, title }: { locale: Locale; text: string; title: string }) {
  const L = studentMediaLabels(locale);
  const starts = useMemo(() => textPageStarts(text), [text]);
  const [page, setPage] = useState(0);
  const total = starts.length;
  const cur = Math.min(page, total - 1);
  const Prev = locale === "ar" ? ChevronRight : ChevronLeft; const Next = locale === "ar" ? ChevronLeft : ChevronRight;
  return (
    <div className="sm-textwrap">
      {total > 1 && (
        <div className="sm-pdf-bar" role="toolbar" aria-label={title}>
          <button type="button" className="icon-btn" onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0} aria-label={L.textPrev} data-testid="button-text-prev"><Prev size={18} aria-hidden="true" /></button>
          <span className="sm-pdf-page" aria-live="polite" data-testid="text-text-part">{L.textPart} {cur + 1} {L.of} {total}</span>
          <button type="button" className="icon-btn" onClick={() => setPage(Math.min(total - 1, cur + 1))} disabled={cur >= total - 1} aria-label={L.textNext} data-testid="button-text-next"><Next size={18} aria-hidden="true" /></button>
        </div>
      )}
      <pre className="sm-text" dir="auto" tabIndex={0} aria-label={`${L.textLabel}: ${title}`} data-testid="viewer-text">{textPage(text, starts, cur)}</pre>
    </div>
  );
}
