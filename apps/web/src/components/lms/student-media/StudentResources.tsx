"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown, Download, Eye, File as FileIcon, FileText, Film, Image as ImageIcon, Lock, RefreshCw, ScrollText, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { lms, useLms } from "@/lib/lms-client";
import { studentMediaLabels } from "./labels";
import { canDownload, countResources, formatBytes, formatDuration, GRANT_TIMEOUT_MS, groupResources, isValidDownloadGrant, NATIVE_GRANT_MAX_MS, grantLeft, placementPath, safeFilename, studentRoot, viewerKind, withTimeout, type StudentScope, type ViewerKind } from "./helpers";
import { fetchStudentContent } from "./transfer";
import { FileViewer } from "./FileViewer";
import { VideoPlayer } from "./VideoPlayer";
import type { LibraryStudentItem, LibraryStudentList, RenditionAccess } from "./types";
import "./student-media.css";

export type ResourceSource = { scope: StudentScope; parentId: string };

const KIND_ICON: Record<ViewerKind, typeof FileIcon> = { video: Film, pdf: FileText, image: ImageIcon, text: ScrollText, file: FileIcon };

/** All resource scopes for a page, sharing one open viewer at a time. */
export function StudentResources({ locale, sources, presentation, content }: { locale: Locale; sources: ResourceSource[]; presentation?: "lesson"; content?: ReactNode }) {
  const L = studentMediaLabels(locale);
  const [open, setOpen] = useState<string | null>(null);
  const valid = sources.filter((s) => studentRoot(s.scope, s.parentId));
  if (!valid.length) return null;
  if (presentation === "lesson" && valid[0]?.scope === "lessons") {
    return <ScopeSection locale={locale} source={valid[0]} open={open} setOpen={setOpen} collapsible={false}
      immersive={{ content, secondary: valid.slice(1) }} />;
  }
  return (
    <section className="sm-root" aria-labelledby="sm-heading" data-testid="section-student-resources">
      <header className="sm-head">
        <h2 id="sm-heading" className="panel-title">{L.heading}</h2>
        <p className="muted small"><Lock size={13} aria-hidden="true" /> {L.privacy}</p>
      </header>
      {valid.map((s, i) => (
        <ScopeSection key={`${s.scope}:${s.parentId}`} locale={locale} source={s} open={open} setOpen={setOpen} collapsible={valid.length > 1 && i > 0} />
      ))}
    </section>
  );
}

function ScopeSection({ locale, source, open, setOpen, collapsible, immersive }: { locale: Locale; source: ResourceSource; open: string | null; setOpen: (k: string | null) => void; collapsible: boolean; immersive?: { content?: ReactNode; secondary: ResourceSource[] } }) {
  const L = studentMediaLabels(locale);
  const q = useLms<LibraryStudentList>(studentRoot(source.scope, source.parentId));
  const listedGroups = groupResources(q.data);
  const featured = immersive ? listedGroups.flatMap(g => g.items).find(it => viewerKind(it.asset.kind, it.revision.mimeType) === "video") : undefined;
  const groups = featured ? listedGroups.map(g => ({ ...g, items: g.items.filter(it => it.placement.id !== featured.placement.id) })).filter(g => g.items.length) : listedGroups;
  const n = countResources(groups);
  const [expanded, setExpanded] = useState(!collapsible && !immersive);
  const hidden = q.data && n === 0 && collapsible; // no clutter for empty secondary scopes
  if (hidden) return null;
  const id = `sm-scope-${source.scope}`;
  const body = q.loading && !q.data
    ? <div className="sm-skel" aria-hidden="true"><span /><span /></div>
    : q.error
      ? <div className="sm-state bad" role="alert"><p>{L.listError}</p><button type="button" className="btn ghost sm" onClick={() => void q.reload()} data-testid={`button-retry-${source.scope}`}><RefreshCw size={14} aria-hidden="true" />{L.retry}</button></div>
      : n === 0
        ? <p className="sm-empty muted">{L.empty}</p>
        : groups.map((g) => (
          <div key={g.collection?.id ?? "loose"} className="sm-group">
            {(g.collection || groups.length > 1) && (
              <h4 className="sm-collection" dir="auto">{g.collection ? g.collection.title : L.general}{g.collection?.description && <small dir="auto">{g.collection.description}</small>}</h4>
            )}
            <ol className="sm-list">
              {g.items.map((it, idx) => (
                <ResourceRow key={it.placement.id} locale={locale} source={source} item={it} index={idx + 1}
                  isOpen={open === `${source.scope}:${it.placement.id}`} onToggle={(o) => setOpen(o ? `${source.scope}:${it.placement.id}` : null)} onStale={() => void q.reload()} />
              ))}
            </ol>
          </div>
        ));
  const section = (
    <section className={`sm-scope sc-${source.scope}`} aria-labelledby={id} data-testid={`section-resources-${source.scope}`}>
      <button type="button" className="sm-scope-head" aria-expanded={expanded} aria-controls={`${id}-body`} onClick={() => setExpanded((e) => !e)} data-testid={`button-toggle-${source.scope}`}>
        <span className="sm-scope-tag" aria-hidden="true" />
        <span className="sm-scope-text"><h3 id={id}>{L.scope[source.scope]}</h3><small>{L.scopeHint[source.scope]}</small></span>
        {q.data && <span className="sm-count">{L.count(n)}</span>}
        <ChevronDown size={18} className={`sm-chev${expanded ? " up" : ""}`} aria-hidden="true" />
      </button>
      <div id={`${id}-body`} hidden={!expanded}>{body}</div>
    </section>
  );
  if (!immersive) return section;
  return <div className="sslv-media-content">
    {featured && <section className="sslv-featured-video" aria-label={featured.asset.title} data-testid="section-lesson-video">
      {!open ? <VideoPlayer key={`${featured.placement.id}:${featured.revision.id}`} locale={locale} scope={source.scope} parentId={source.parentId}
        placementId={featured.placement.id} revisionId={featured.revision.id} title={featured.asset.title} onStale={() => void q.reload()} />
        : <button type="button" className="btn ghost" onClick={() => setOpen(null)} data-testid="button-return-lesson-video">
          <Film size={17} aria-hidden="true" />{locale === "ar" ? "العودة إلى فيديو الدرس" : "Return to lesson video"}
        </button>}
    </section>}
    {immersive.content}
    <details className="sslv-resources" data-testid="details-lesson-resources">
      <summary><FileText size={17} aria-hidden="true" /><span>{L.heading}</span><ChevronDown size={17} aria-hidden="true" /></summary>
      <section className="sm-root" aria-label={L.heading} data-testid="section-student-resources">
        {n > 0 || q.loading || q.error ? section : null}
        {immersive.secondary.map(s => <ScopeSection key={`${s.scope}:${s.parentId}`} locale={locale} source={s}
          open={open} setOpen={setOpen} collapsible />)}
      </section>
    </details>
  </div>;
}

function ResourceRow({ locale, source, item, index, isOpen, onToggle, onStale }: {
  locale: Locale; source: ResourceSource; item: LibraryStudentItem; index: number; isOpen: boolean; onToggle: (o: boolean) => void; onStale: () => void;
}) {
  const L = studentMediaLabels(locale);
  const v = viewerKind(item.asset.kind, item.revision.mimeType);
  const Icon = KIND_ICON[v];
  const [dl, setDl] = useState<"idle" | "busy" | "error">("idle");
  const meta = [L.kinds[v], v === "pdf" && item.revision.pageCount ? L.pages(item.revision.pageCount) : null,
    v === "video" ? formatDuration(item.revision.duration) : formatBytes(item.revision.bytes, locale)].filter(Boolean).join(" · ");
  const viewable = v !== "file";
  const downloadable = canDownload(item);

  async function download() {
    if (!downloadable || dl === "busy") return; // view-only never requests original-download authorization
    const path = placementPath(source.scope, source.parentId, item.placement.id, "access");
    if (!path) return;
    setDl("busy");
    try {
      const ctrl = new AbortController();
      const r = await withTimeout(lms<RenditionAccess>(path, { method: "POST", body: { mode: "download", revisionId: item.revision.id } }), GRANT_TIMEOUT_MS, ctrl);
      if (!r.ok) { setDl("error"); if ([404, 409, 410].includes(r.error.status)) onStale(); return; }
      const left = grantLeft(r.data.expiresAt, Date.now(), NATIVE_GRANT_MAX_MS);
      if (!isValidDownloadGrant(r.data, item.revision.id) || left === null) { setDl("error"); return; }
      const blob = await withTimeout(fetchStudentContent(r.data, { scope: source.scope, parentId: source.parentId, placementId: item.placement.id }, ctrl.signal), Math.min(120_000, left), ctrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = safeFilename(item.revision.filename, item.asset.title); a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setDl("idle");
    } catch { setDl("error"); }
  }

  return (
    <li className={`sm-item${isOpen ? " open" : ""}`} data-testid={`row-resource-${index}`}>
      <div className="sm-row">
        <span className="sm-idx" aria-hidden="true">{String(index).padStart(2, "0")}</span>
        <span className={`sm-icon k-${v}`} aria-hidden="true"><Icon size={18} /></span>
        <div className="sm-info">
          <span className="sm-title" dir="auto"><bdi>{item.asset.title}</bdi></span>
          <span className="sm-meta"><bdi className="sm-fname">{item.revision.filename}</bdi><span>{meta}</span>
            {!downloadable && v !== "video" && <span className="sm-vo"><Lock size={11} aria-hidden="true" />{L.viewOnly}</span>}</span>
        </div>
        <div className="sm-actions">
          {viewable && (
            <button type="button" className={`btn sm ${isOpen ? "ghost" : "primary"}`} aria-expanded={isOpen} onClick={() => onToggle(!isOpen)} data-testid={`button-open-resource-${index}`}>
              {isOpen ? <X size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}{isOpen ? L.close : L.open}
            </button>
          )}
          {downloadable && (
            <button type="button" className="btn ghost sm" onClick={() => void download()} disabled={dl === "busy"} data-testid={`button-download-resource-${index}`}>
              <Download size={14} aria-hidden="true" />{dl === "busy" ? L.downloading : L.download}
            </button>
          )}
        </div>
      </div>
      {dl === "error" && <p className="sm-inline-err" role="alert">{L.downloadFailed}</p>}
      {isOpen && viewable && (
        <div className="sm-viewer">
          {v === "video"
            ? <VideoPlayer locale={locale} scope={source.scope} parentId={source.parentId} placementId={item.placement.id} revisionId={item.revision.id} title={item.asset.title} onStale={onStale} />
            : <FileViewer locale={locale} scope={source.scope} parentId={source.parentId} placementId={item.placement.id} revisionId={item.revision.id} viewer={v} title={item.asset.title} onStale={onStale} />}
        </div>
      )}
    </li>
  );
}
