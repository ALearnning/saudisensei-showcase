"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { studentMediaLabels } from "./labels";
import { arrowStep, clampPage } from "./helpers";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { pdfTaskCleanup } from "./pdf-lifecycle";

type PdfDoc = PDFDocumentProxy;

let workerPort: Worker | null = null;
/** Client-only pdf.js with a bundled, self-hosted worker. Eval, XFA, scripting and annotations are off. */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerPort) {
    workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    pdfjs.GlobalWorkerOptions.workerPort = workerPort;
  }
  return pdfjs;
}

const MAX_CANVAS_PIXELS = 12_000_000;
const ZOOMS = [0.75, 1, 1.25, 1.5, 2];

export function PdfViewer({ locale, data, title, onCorrupt }: { locale: Locale; data: Uint8Array; title: string; onCorrupt: () => void }) {
  const L = studentMediaLabels(locale);
  const rtl = locale === "ar";
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [pageInput, setPageInput] = useState("1");
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const corruptRef = useRef(onCorrupt); corruptRef.current = onCorrupt;

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    const dispose = pdfTaskCleanup(() => task);
    (async () => {
      try {
        const pdfjs = await loadPdfjs(); if (!alive) return;
        task = pdfjs.getDocument({
          // pdf.js v6 has no eval option; no annotation/scripting layer is ever created.
          data: data.slice(),
          enableXfa: false,
          disableAutoFetch: true,
          disableStream: true,
          stopAtErrors: false,
          useSystemFonts: true,
        });
        const d = await task.promise;
        if (!alive) return;
        setDoc(d); setPage(1); setPageInput("1");
      } catch { if (alive) corruptRef.current(); }
    })();
    return () => { alive = false; dispose(); };
  }, [data]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !width || !canvas.current) return;
    let alive = true; let rt: { cancel(): void } | null = null;
    setRendering(true);
    (async () => {
      try {
        const p = await doc.getPage(clampPage(page, doc.numPages)); if (!alive) return;
        const base = p.getViewport({ scale: 1 });
        const scale = (width / base.width) * ZOOMS[zoomIdx];
        const vp = p.getViewport({ scale });
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (vp.width * vp.height * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.max(0.5, Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height)));
        const c = canvas.current!; const ctx = c.getContext("2d"); if (!ctx) throw new Error("CTX");
        c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
        c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
        const task = p.render({ canvas: c, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        rt = task; await task.promise;
        if (alive) setRendering(false);
      } catch (e) { if (alive && (e as { name?: string })?.name !== "RenderingCancelledException") { setRendering(false); corruptRef.current(); } }
    })();
    return () => { alive = false; rt?.cancel(); };
  }, [doc, page, width, zoomIdx]);

  const total = doc?.numPages ?? 0;
  const go = (n: number) => { const p = clampPage(n, total); setPage(p); setPageInput(String(p)); };
  const onKey = (e: React.KeyboardEvent) => { const s = arrowStep(e.key, rtl); if (s && total) { e.preventDefault(); go(page + s); } };
  const Prev = rtl ? ChevronRight : ChevronLeft; const Next = rtl ? ChevronLeft : ChevronRight;

  return (
    <div className="sm-pdf" data-testid="viewer-pdf">
      <div className="sm-pdf-bar" role="toolbar" aria-label={title}>
        <button type="button" className="icon-btn" onClick={() => go(page - 1)} disabled={!doc || page <= 1} aria-label={L.pdf.prev} data-testid="button-pdf-prev"><Prev size={18} aria-hidden="true" /></button>
        <form className="sm-pdf-page" onSubmit={(e) => { e.preventDefault(); go(Number(pageInput)); }}>
          <label htmlFor="sm-pdf-page-input" className="sr-only">{L.pdf.page}</label>
          <span aria-hidden="true">{L.pdf.page}</span>
          <input id="sm-pdf-page-input" inputMode="numeric" value={pageInput} disabled={!doc} onChange={(e) => setPageInput(e.target.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))))}
            onBlur={() => go(Number(pageInput))} data-testid="input-pdf-page" />
          <span>{L.pdf.of} <span data-testid="text-pdf-total">{total || "–"}</span></span>
        </form>
        <button type="button" className="icon-btn" onClick={() => go(page + 1)} disabled={!doc || page >= total} aria-label={L.pdf.next} data-testid="button-pdf-next"><Next size={18} aria-hidden="true" /></button>
        <span className="sm-pdf-sp" />
        <button type="button" className="icon-btn" onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} aria-label={L.pdf.zoomOut} data-testid="button-pdf-zoom-out"><Minus size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-btn" onClick={() => setZoomIdx(1)} disabled={zoomIdx === 1} aria-label={L.pdf.fit} data-testid="button-pdf-fit"><Maximize2 size={15} aria-hidden="true" /></button>
        <button type="button" className="icon-btn" onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIdx === ZOOMS.length - 1} aria-label={L.pdf.zoomIn} data-testid="button-pdf-zoom-in"><Plus size={16} aria-hidden="true" /></button>
      </div>
      <div ref={wrap} className="sm-pdf-stage" tabIndex={0} onKeyDown={onKey} aria-label={`${title} — ${L.pdf.page} ${page} ${L.pdf.of} ${total}`} onContextMenu={(e) => e.preventDefault()}>
        <div className="sm-pdf-canvas-wrap" dir="ltr">
          <canvas ref={canvas} role="img" aria-label={`${L.pdf.page} ${page}`} data-testid="canvas-pdf-page" />
        </div>
        {(rendering || !doc) && <div className="sm-overlay" role="status"><span className="sm-spin" aria-hidden="true" />{L.pdf.rendering}</div>}
      </div>
      <p className="sr-only" aria-live="polite">{total ? `${L.pdf.page} ${page} ${L.pdf.of} ${total}` : ""}</p>
    </div>
  );
}
