"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ArrowDown, ArrowUp, Download, Eye, File as FileIcon, FileText, Film, FolderPlus, Image as ImageIcon, Lock, RefreshCw, Replace, Send, Undo2, Unlink, Upload, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { lms, useLms, type ApiFailure } from "@/lib/lms-client";
import { fetchMediaPreview, mediaFileMetadata, uploadMediaFile } from "@/lib/admin-media-transfer";
import { ConfirmButton } from "../ui";
import { useMediaDraft } from "./use-media-draft";
import { mediaLabels, type MediaLabels } from "./labels";
import { MediaPreview } from "./MediaPreview";
import {
  ACCEPT, activeCollections, formatBytes, formatDuration, inactiveItems, isActiveStatus, isItemReadOnly, isPublished, matchesRevision, safeMeta,
  isTerminalPhase, mediaRoot, moveInList, processingPhase, publishPlan, readyReplacements, revisionPhase, seg, siblings, titleFromFilename,
  watchedRevision, type LifecycleStep, type Phase,
} from "./helpers";
import type { LibraryAdminItem, LibraryAdminList, LibraryAssetKind, LibraryCollection, LibraryMutation, MediaScope, ProcessingStatus, RenditionAccess } from "./types";
import "./admin-media.css";

type Upload = { revisionId: string; assetId: string; file: File; percent: number; status: "uploading" | "failed" | "cancelled" | "uploaded" };
type Method = "POST" | "PATCH" | "PUT";
type PreviewTarget = { item: LibraryAdminItem; revisionId: string; title: string };

function errorText(e: ApiFailure, L: MediaLabels) {
  if (e.status === 400 || e.status === 422) return L.errorValidation;
  if (e.status === 403) return L.errorForbidden;
  if (e.status === 409) return L.errorTransition;
  return L.errorGeneric;
}

const KIND_ICON: Record<LibraryAssetKind, typeof FileIcon> = { video: Film, document: FileText, image: ImageIcon, attachment: FileIcon };

export function AdminMediaManager({ locale, scope, parentId, readOnly }: { locale: Locale; scope: MediaScope; parentId: string; readOnly: boolean }) {
  const L = mediaLabels(locale);
  const root = mediaRoot(scope, parentId);
  const q = useLms<LibraryAdminList>(root, 20_000, 60);
  const data = q.data;
  const revRef = useRef<number | null>(null);
  if (data && (revRef.current === null || data.mediaEditRevision > revRef.current)) revRef.current = data.mediaEditRevision;
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const ctrls = useRef<Record<string, AbortController>>({});
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const reloadRef = useRef(q.reload); reloadRef.current = q.reload;

  useEffect(() => () => { Object.values(ctrls.current).forEach((c) => c.abort()); }, []);
  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(null), 3500); return () => window.clearTimeout(id); }, [notice]);

  /** One mutation. Never retries a 409; chains the returned mediaEditRevision. */
  const mutate = useCallback(async (method: Method, path: string, body: Record<string, unknown>, expected?: number): Promise<LibraryMutation | null> => {
    const r = await lms<LibraryMutation>(`${root}/${path}`, { method, body: { ...body, expectedMediaRevision: expected ?? revRef.current ?? 0 } });
    if (!r.ok) { if (r.error.status === 409) setConflict(true); else setError(r.error); return null; }
    revRef.current = r.data.mediaEditRevision;
    setConflict(false);
    return r.data;
  }, [root]);

  const run = useCallback(async (fn: () => Promise<boolean>, ok = L.saved) => {
    setBusy(true); setError(null);
    try { const success = await fn(); if (success) setNotice(ok); return success; }
    finally { setBusy(false); await reloadRef.current(); }
  }, [L.saved]);

  const startUpload = useCallback((revisionId: string, assetId: string, file: File) => {
    ctrls.current[revisionId]?.abort();
    const ctrl = new AbortController(); ctrls.current[revisionId] = ctrl;
    setUploads((u) => ({ ...u, [revisionId]: { revisionId, assetId, file, percent: 0, status: "uploading" } }));
    const patch = (p: Partial<Upload>) => setUploads((u) => (u[revisionId] ? { ...u, [revisionId]: { ...u[revisionId], ...p } } : u));
    uploadMediaFile(root, revisionId, file, (percent) => patch({ percent: Math.max(0, Math.min(100, Math.round(percent))) }), ctrl.signal)
      .then(() => { patch({ status: "uploaded", percent: 100 }); setNotice(L.uploadDone); void reloadRef.current(); })
      .catch(() => { patch({ status: ctrl.signal.aborted ? "cancelled" : "failed" }); })
      .finally(() => { if (ctrls.current[revisionId] === ctrl) delete ctrls.current[revisionId]; });
  }, [root, L.uploadDone]);
  const cancelUpload = useCallback((revisionId: string) => ctrls.current[revisionId]?.abort(), []);

  const lifecycle = useCallback((item: LibraryAdminItem, steps: LifecycleStep[]) => run(async () => {
    for (const s of steps) {
      const path = s.target === "asset" ? `assets/${seg(item.asset.id)}/lifecycle` : `placements/${seg(item.placement.id)}/lifecycle`;
      if (!(await mutate("POST", path, { action: s.action }))) return false;
    }
    return true;
  }, L.done), [run, mutate, L.done]);

  const reloadAfterConflict = async () => { setConflict(false); setError(null); await q.reload(); };

  if (q.loading && !data) {
    return <section className="panel rise am" data-testid="admin-media-manager" aria-busy="true"><h2 className="panel-title">{L.title}</h2><div className="am-skel"><span className="skel" /><span className="skel" /><span className="skel" /></div></section>;
  }
  if (q.error || !data) {
    return (
      <section className="panel rise am" data-testid="admin-media-manager">
        <h2 className="panel-title">{L.title}</h2>
        <div className="notice bad" role="alert" data-testid="status-media-load-error"><AlertTriangle size={18} aria-hidden="true" /><div><strong>{L.loadFailed}</strong>
          <p><button type="button" className="btn ghost sm" onClick={() => void q.reload()} data-testid="button-media-retry-load"><RefreshCw size={14} aria-hidden="true" />{L.retry}</button></p></div></div>
      </section>
    );
  }

  const cols = activeCollections(data.collections);
  const groups: { id: string | null; title: string }[] = [{ id: null, title: L.ungrouped }, ...cols.map((c) => ({ id: c.id, title: c.title }))];
  const inactive = inactiveItems(data.items, data.collections);
  const listRev = data.mediaEditRevision;
  const shared = { locale, L, root, busy, uploads, collections: data.collections, parentReadOnly: readOnly, listRev, mutate, run, lifecycle, startUpload, cancelUpload, onPreview: setPreview, onSettled: q.reload };

  return (
    <section className="panel rise am" data-testid="admin-media-manager" aria-labelledby={`am-title-${scope}`}>
      <div className="am-head">
        <div>
          <h2 className="panel-title" id={`am-title-${scope}`}>{L.title}</h2>
          <p className="muted small">{L.lead[scope]}</p>
        </div>
        {readOnly && <span className="am-chip st-archived" data-testid="status-media-readonly"><Lock size={13} aria-hidden="true" />{L.readOnly}</span>}
      </div>

      {conflict && (
        <div className="notice warn" role="alert" data-testid="status-media-conflict">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><strong>{L.conflictTitle}</strong><p>{L.conflictBody}</p>
            <button type="button" className="btn ghost sm" onClick={() => void reloadAfterConflict()} data-testid="button-media-conflict-reload"><RefreshCw size={14} aria-hidden="true" />{L.reload}</button></div>
        </div>
      )}
      {error && !conflict && (
        <div className="notice bad" role="alert" data-testid="status-media-error"><AlertTriangle size={18} aria-hidden="true" />
          <div><strong>{errorText(error, L)}</strong><p><button type="button" className="btn ghost sm" onClick={() => { setError(null); void q.reload(); }} data-testid="button-media-error-reload"><RefreshCw size={14} aria-hidden="true" />{L.reload}</button></p></div></div>
      )}

      {!readOnly && <UploadPanel {...shared} cols={cols} />}

      {data.items.length === 0 ? (
        <div className="am-empty" data-testid="status-media-empty"><Upload size={22} aria-hidden="true" /><strong>{L.empty}</strong><span className="muted small">{L.emptyBody}</span></div>
      ) : groups.map((g) => {
        const rows = siblings(data.items, g.id);
        if (g.id !== null && rows.length === 0) return null;
        if (g.id === null && rows.length === 0 && cols.length > 0) return null;
        const ids = rows.map((r) => r.placement.id);
        return (
          <div key={g.id ?? "none"} className="am-group" data-testid={`group-media-${g.id ?? "ungrouped"}`}>
            <h3 className="am-group-title" dir="auto">{g.title}</h3>
            <ol className="am-list">{rows.map((it) => <MediaRow key={it.placement.id} item={it} siblingIds={ids} cols={cols} {...shared} />)}</ol>
          </div>
        );
      })}

      {inactive.length > 0 && (
        <details className="am-archived" data-testid="section-media-archived">
          <summary>{L.archivedSection} <span className="mono">({inactive.length})</span></summary>
          <p className="muted small">{L.archivedHint}</p>
          <ol className="am-list">{inactive.map((it) => <MediaRow key={it.placement.id} item={it} siblingIds={[]} cols={cols} {...shared} />)}</ol>
        </details>
      )}

      <CollectionsPanel {...shared} cols={cols} all={data.collections} />

      {preview && (
        <MediaPreview key={preview.revisionId} locale={locale} root={root} placementId={preview.item.placement.id} revisionId={preview.revisionId} kind={preview.item.asset.kind} title={preview.title} onClose={() => setPreview(null)} />
      )}
      <p className="sr-only" role="status" aria-live="polite">{notice ?? ""}</p>
      {notice && <div className="toast" data-testid="toast-media">{notice}</div>}
    </section>
  );
}

type Shared = {
  locale: Locale; L: MediaLabels; root: string; busy: boolean; uploads: Record<string, Upload>; collections: LibraryCollection[]; parentReadOnly: boolean; listRev: number;
  mutate: (m: Method, path: string, body: Record<string, unknown>, expected?: number) => Promise<LibraryMutation | null>;
  run: (fn: () => Promise<boolean>, ok?: string) => Promise<boolean>;
  lifecycle: (item: LibraryAdminItem, steps: LifecycleStep[]) => Promise<boolean>;
  startUpload: (revisionId: string, assetId: string, file: File) => void; cancelUpload: (revisionId: string) => void;
  onPreview: (p: PreviewTarget) => void; onSettled: () => Promise<void>;
};

function UploadPanel({ L, locale, busy, mutate, run, startUpload, cols }: Shared & { cols: LibraryCollection[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [bad, setBad] = useState(false);
  const [touched, setTouched] = useState(false);
  const [over, setOver] = useState(false);
  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!safeMeta(f, mediaFileMetadata)) { setBad(true); setFile(null); return; }
    setBad(false); setFile(f); setTitle((t) => t || titleFromFilename(f.name));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setTouched(true);
    if (!file || !title.trim()) return;
    const meta = safeMeta(file, mediaFileMetadata);
    if (!meta) { setBad(true); return; }
    const f = file;
    await run(async () => {
      const r = await mutate("POST", "assets", { title: title.trim(), kind: meta.kind, filename: meta.filename, mimeType: meta.mimeType, bytes: meta.bytes, downloadsAllowed: false, collectionId: collectionId || null });
      const revId = r?.revision?.id ?? r?.asset?.stagedRevisionId ?? null;
      if (!r || !r.asset || !revId) return false;
      startUpload(revId, r.asset.id, f);
      setFile(null); setTitle(""); setTouched(false); if (input.current) input.current.value = "";
      return true;
    }, L.uploading);
  };
  return (
    <form className="am-upload" onSubmit={submit} noValidate data-testid="form-media-upload">
      <div className={`am-drop${over ? " is-over" : ""}`} data-testid="dropzone-media"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}>
        <Upload size={20} aria-hidden="true" />
        {file ? (
          <span className="am-file"><bdi dir="auto" className="mono">{file.name}</bdi><span className="muted small">{formatBytes(file.size, locale)}</span></span>
        ) : <span>{L.drop}</span>}
        <label className="btn ghost sm am-pick" htmlFor="am-file-input">{file ? L.change : L.choose}</label>
        <input ref={input} id="am-file-input" className="sr-only" type="file" accept={ACCEPT} aria-label={L.fileLabel} aria-describedby="am-file-help"
          onChange={(e) => pick(e.target.files?.[0])} data-testid="input-media-file" />
        <small id="am-file-help" className="muted small am-help">{L.supported}</small>
      </div>
      {bad && <small className="field-err" role="alert" data-testid="error-media-file">{L.unsupported}</small>}
      <div className="am-upload-fields">
        <div className="field">
          <label htmlFor="am-new-title">{L.titleLabel}</label>
          <input id="am-new-title" dir="auto" maxLength={255} value={title} aria-invalid={touched && !title.trim()} onChange={(e) => setTitle(e.target.value)} data-testid="input-media-title" />
          {touched && !title.trim() && <small className="field-err" role="alert">{L.titleRequired}</small>}
        </div>
        {cols.length > 0 && (
          <div className="field">
            <label htmlFor="am-new-col">{L.collectionLabel}</label>
            <select id="am-new-col" value={collectionId} onChange={(e) => setCollectionId(e.target.value)} data-testid="select-media-collection">
              <option value="">{L.noCollection}</option>
              {cols.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}
        <button className="btn primary" disabled={busy || !file} data-testid="button-media-upload"><Upload size={15} aria-hidden="true" />{L.upload}</button>
      </div>
      <p className="muted small">{L.newFileHint}</p>
    </form>
  );
}

/** Polls processing for one revision while non-terminal; refetches on focus; reloads root once settled. */
function useProcessing(root: string, revisionId: string | null, onSettled: () => Promise<void>) {
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const settled = useRef(onSettled); settled.current = onSettled;
  useEffect(() => {
    setStatus(null);
    if (!revisionId) return;
    let alive = true; let timer: number | undefined; let n = 0;
    const tick = async () => {
      window.clearTimeout(timer);
      const r = await lms<ProcessingStatus>(`${root}/revisions/${seg(revisionId)}/processing`);
      if (!alive) return;
      if (r.ok) {
        setStatus(r.data);
        if (isTerminalPhase(processingPhase(r.data))) { void settled.current(); return; }
      }
      n += 1;
      if (n < 400) timer = window.setTimeout(() => void tick(), n < 30 ? 4000 : 10_000);
    };
    void tick();
    const onFocus = () => { if (document.visibilityState === "visible") void tick(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; window.clearTimeout(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [root, revisionId]);
  return status;
}

function PhaseChip({ phase, L, testId }: { phase: Phase; L: MediaLabels; testId: string }) {
  return <span className={`am-chip ph-${phase}`} data-testid={testId}>{!isTerminalPhase(phase) && <span className="am-pulse" aria-hidden="true" />}{L.phase[phase]}</span>;
}

function MediaRow(p: Shared & { item: LibraryAdminItem; siblingIds: string[]; cols: LibraryCollection[] }) {
  const { item, L, locale, root, busy, uploads, collections, parentReadOnly, listRev, mutate, run, lifecycle, startUpload, cancelUpload, onPreview, onSettled, siblingIds, cols } = p;
  const { asset, placement, revision } = item;
  const pid = placement.id;
  const ro = isItemReadOnly(item, collections, parentReadOnly);
  const watched = watchedRevision(item);
  const proc = useProcessing(root, ro ? null : watched?.id ?? null, onSettled);
  const up = watched ? uploads[watched.id] : undefined;
  const staged = asset.stagedRevisionId ? item.revisions.find((r) => r.id === asset.stagedRevisionId) ?? null : null;
  const currentPhase: Phase = revision ? (watched?.id === revision.id && proc ? processingPhase(proc) : revisionPhase(revision)) : "awaiting";
  const stagedPhase: Phase | null = staged && staged.id !== revision?.id ? (watched?.id === staged.id && proc ? processingPhase(proc) : revisionPhase(staged)) : null;
  const ready = readyReplacements(item);
  const [pickRev, setPickRev] = useState("");
  const chosen = ready.find((r) => r.id === pickRev)?.id ?? ready[0]?.id ?? "";
  const { draft, values, dirty, edit, accept } = useMediaDraft({ title: asset.title, downloadsAllowed: asset.downloadsAllowed }, listRev);
  const [touched, setTouched] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const retryInput = useRef<HTMLInputElement>(null);
  const [dl, setDl] = useState(false);
  const [rowMsg, setRowMsg] = useState<string | null>(null);
  const Icon = KIND_ICON[asset.kind];
  const fmtLocale = locale === "ar" ? "ar" : "en";
  const visibleStatus = !isActiveStatus(asset.status) ? asset.status : !isActiveStatus(placement.status) ? placement.status : isPublished(item) ? "published" : "draft";
  const stale = dirty && draft.revision !== listRev;

  const save = (expected: number) => run(async () => {
    const body: Record<string, unknown> = {};
    if (values.title.trim() !== asset.title) body.title = values.title.trim();
    if (values.downloadsAllowed !== asset.downloadsAllowed) body.downloadsAllowed = values.downloadsAllowed;
    const saved = await mutate("PATCH", `assets/${seg(asset.id)}`, body, expected);
    if (saved?.asset) accept({ title: saved.asset.title, downloadsAllowed: saved.asset.downloadsAllowed }, saved.mediaEditRevision);
    return !!saved;
  });

  const stageReplacement = (file: File) => {
    const meta = safeMeta(file, mediaFileMetadata);
    if (!meta) { setRowMsg(L.unsupported); return; }
    setRowMsg(null);
    void run(async () => {
      const r = await mutate("POST", `assets/${seg(asset.id)}/revisions`, { filename: meta.filename, mimeType: meta.mimeType, bytes: meta.bytes });
      const revId = r?.revision?.id ?? r?.asset?.stagedRevisionId ?? null;
      if (!r || !revId) return false;
      startUpload(revId, asset.id, file); return true;
    }, L.uploading);
  };

  const download = async () => {
    if (!revision) return;
    setDl(true);
    try {
      const r = await lms<RenditionAccess>(`${root}/placements/${seg(pid)}/access`, { method: "POST", body: { mode: "download", revisionId: revision.id } });
      if (!r.ok) { return; }
      const blob = await fetchMediaPreview(r.data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = revision.filename; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { /* safe silent failure; no raw errors surfaced */ } finally { setDl(false); }
  };

  const moveIds = (d: -1 | 1) => moveInList(siblingIds, pid, d);
  const reorder = (next: string[]) => void run(async () => !!(await mutate("PUT", "placement-order", { collectionId: placement.collectionId ?? null, ids: next })));

  return (
    <li className={`am-row${ro ? " is-ro" : ""}`} data-testid={`row-media-${pid}`}>
      <div className="am-row-top">
        {!ro && siblingIds.length > 1 && (
          <span className="reorder">
            <button type="button" className="icon-btn" disabled={busy || !moveIds(-1)} onClick={() => { const n = moveIds(-1); if (n) reorder(n); }} aria-label={`${L.moveUp}: ${asset.title}`} data-testid={`button-media-move-up-${pid}`}><ArrowUp size={15} aria-hidden="true" /></button>
            <button type="button" className="icon-btn" disabled={busy || !moveIds(1)} onClick={() => { const n = moveIds(1); if (n) reorder(n); }} aria-label={`${L.moveDown}: ${asset.title}`} data-testid={`button-media-move-down-${pid}`}><ArrowDown size={15} aria-hidden="true" /></button>
          </span>
        )}
        <span className={`am-kind k-${asset.kind}`} aria-hidden="true"><Icon size={18} /></span>
        <div className="am-row-main">
          <strong dir="auto" className="am-row-title">{asset.title}</strong>
          <span className="am-meta muted small">
            <span>{L.kind[asset.kind]}</span>
            {revision && <bdi dir="auto" className="mono am-fname">{revision.filename}</bdi>}
            {revision && <span>{formatBytes(revision.bytes, fmtLocale)}</span>}
            {revision?.pageCount ? <span>{L.pages.replace("{n}", String(revision.pageCount))}</span> : null}
            {formatDuration(revision?.duration ?? null) && <span className="mono">{formatDuration(revision?.duration ?? null)}</span>}
          </span>
        </div>
        <div className="am-chips" data-testid={`status-media-${pid}`}>
          <span className={`am-chip st-${visibleStatus}`}>{L.status[visibleStatus]}</span>
          <PhaseChip phase={up?.status === "uploading" && watched?.id === revision?.id ? "awaiting" : currentPhase} L={L} testId={`status-media-phase-${pid}`} />
          <span className="am-chip st-policy">{asset.downloadsAllowed && asset.kind !== "video" ? L.downloadable : L.viewOnly}</span>
        </div>
      </div>

      {up && up.status !== "uploaded" && (
        <UploadProgress up={up} L={L} onCancel={() => cancelUpload(up.revisionId)} onRetry={() => startUpload(up.revisionId, up.assetId, up.file)} pid={pid} />
      )}
      {!up && !ro && watched && revisionPhase(watched) === "awaiting" && (!proc || processingPhase(proc) === "awaiting") && (
        <div className="am-retry">
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => retryInput.current?.click()} data-testid={`button-media-retry-upload-${pid}`}><RefreshCw size={14} aria-hidden="true" />{L.retryUpload}</button>
          <input ref={retryInput} type="file" className="sr-only" tabIndex={-1} accept={ACCEPT} aria-label={L.retryUpload}
            onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f || !watched) return;
              if (!matchesRevision(safeMeta(f, mediaFileMetadata), watched)) { setRowMsg(L.retryMismatch); return; }
              setRowMsg(null); startUpload(watched.id, asset.id, f);
            }} />
        </div>
      )}
      {rowMsg && <p className="field-err" role="alert" data-testid={`error-media-row-${pid}`}>{rowMsg}</p>}
      {stagedPhase && (
        <div className={`am-replace-state${stagedPhase === "failed" || stagedPhase === "rejected" ? " bad" : ""}`} data-testid={`status-media-replacement-${pid}`}>
          <span>{stagedPhase === "failed" || stagedPhase === "rejected" ? L.replacementFailed : L.replacementPending}</span>
          {!isTerminalPhase(stagedPhase) && <PhaseChip phase={stagedPhase} L={L} testId={`status-media-replacement-phase-${pid}`} />}
          {staged && <bdi dir="auto" className="mono small">{staged.filename}</bdi>}
        </div>
      )}

      {!ro && (
        <form className="am-edit" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (values.title.trim()) void save(draft.revision); }}>
          <div className="field">
            <label htmlFor={`am-title-${pid}`}>{L.titleLabel}</label>
            <input id={`am-title-${pid}`} dir="auto" maxLength={255} value={values.title} disabled={busy} aria-invalid={touched && !values.title.trim()} onChange={(e) => edit({ title: e.target.value })} data-testid={`input-media-title-${pid}`} />
            {touched && !values.title.trim() && <small className="field-err" role="alert">{L.titleRequired}</small>}
          </div>
          <label className="checkline">
            <input type="checkbox" checked={asset.kind !== "video" && values.downloadsAllowed} disabled={busy || asset.kind === "video"} onChange={(e) => edit({ downloadsAllowed: e.target.checked })} data-testid={`checkbox-media-downloads-${pid}`} />
            <span>{L.downloads}</span>
          </label>
          <div className="am-edit-actions">
            <button className="btn primary sm" disabled={busy || !dirty} data-testid={`button-media-save-${pid}`}>{busy ? L.saving : L.save}</button>
            {stale && <button type="button" className="btn ghost sm" disabled={busy || !values.title.trim()} onClick={() => void save(listRev)} data-testid={`button-media-apply-latest-${pid}`}>{L.applyLatest}</button>}
          </div>
        </form>
      )}

      <div className="am-actions">
        {!ro && canShowPreview(item) && <button type="button" className="btn ghost sm" onClick={() => revision && onPreview({ item, revisionId: revision.id, title: asset.title })} data-testid={`button-media-preview-${pid}`}><Eye size={14} aria-hidden="true" />{ready.length > 0 ? L.previewCurrent : L.preview}</button>}
        {!ro && canShowPreview(item) && asset.downloadsAllowed && asset.kind !== "video" && (
          <button type="button" className="btn ghost sm" disabled={dl} onClick={() => void download()} data-testid={`button-media-download-${pid}`}><Download size={14} aria-hidden="true" />{L.download}</button>
        )}
        {!ro && (
          <>
            {!isPublished(item) && (
              <ConfirmButton locale={locale} label={L.publish} message={L.publishConfirm} className="btn primary sm" disabled={busy || revision?.state !== "ready"}
                onConfirm={() => void lifecycle(item, publishPlan(item))} testId={`button-media-publish-${pid}`} icon={<Send size={14} aria-hidden="true" />} />
            )}
            {placement.status === "published" && (
              <ConfirmButton locale={locale} label={L.unpublish} message={L.unpublishConfirm} className="btn ghost sm" disabled={busy}
                onConfirm={() => void lifecycle(item, [{ target: "placement", action: "unpublish" }])} testId={`button-media-unpublish-${pid}`} icon={<Undo2 size={14} aria-hidden="true" />} />
            )}
            {cols.length > 0 && (
              <span className="am-move">
                <label className="sr-only" htmlFor={`am-move-${pid}`}>{L.moveTo}</label>
                <select id={`am-move-${pid}`} value={placement.collectionId ?? ""} disabled={busy}
                  onChange={(e) => { const v = e.target.value || null; void run(async () => !!(await mutate("PATCH", `placements/${seg(pid)}`, { collectionId: v }))); }} data-testid={`select-media-move-${pid}`}>
                  <option value="">{L.noCollection}</option>
                  {cols.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </span>
            )}
            <button type="button" className="btn ghost sm" disabled={busy || (!!stagedPhase && !isTerminalPhase(stagedPhase))} onClick={() => replaceInput.current?.click()}
              title={L.replaceHint} data-testid={`button-media-replace-${pid}`}><Replace size={14} aria-hidden="true" />{L.replace}</button>
            <input ref={replaceInput} type="file" className="sr-only" tabIndex={-1} accept={ACCEPT} aria-label={L.replaceUpload}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) stageReplacement(f); e.target.value = ""; }} data-testid={`input-media-replace-${pid}`} />
            <ConfirmButton locale={locale} label={L.archive} message={L.archiveConfirm} className="btn danger sm" disabled={busy}
              onConfirm={() => void lifecycle(item, [{ target: "asset", action: "archive" }])} testId={`button-media-archive-${pid}`} icon={<Archive size={14} aria-hidden="true" />} />
            <ConfirmButton locale={locale} label={L.remove} message={L.removeConfirm} className="btn danger sm" disabled={busy}
              onConfirm={() => void lifecycle(item, [{ target: "placement", action: "remove" }])} testId={`button-media-remove-${pid}`} icon={<Unlink size={14} aria-hidden="true" />} />
          </>
        )}
      </div>

      {!ro && ready.length > 0 && (
        <div className="am-activate" data-testid={`group-media-replacement-${pid}`}>
          <div className="field">
            <label htmlFor={`am-rev-${pid}`}>{L.replacementSelect}</label>
            <select id={`am-rev-${pid}`} value={chosen} onChange={(e) => setPickRev(e.target.value)} disabled={busy} data-testid={`select-media-replacement-${pid}`}>
              {ready.map((r) => <option key={r.id} value={r.id}>{`${r.filename} · ${formatBytes(r.bytes, fmtLocale)}`}</option>)}
            </select>
          </div>
          <button type="button" className="btn ghost sm" disabled={!chosen} onClick={() => onPreview({ item, revisionId: chosen, title: L.replacementPreviewTitle.replace("{t}", asset.title) })}
            data-testid={`button-media-preview-replacement-${pid}`}><Eye size={14} aria-hidden="true" />{L.previewReplacement}</button>
          <ConfirmButton locale={locale} label={L.activate} message={L.activateConfirm} className="btn primary sm" disabled={busy || !chosen}
            onConfirm={() => void run(async () => !!(await mutate("POST", `assets/${seg(asset.id)}/activate`, { revisionId: chosen })), L.done)}
            testId={`button-media-activate-${pid}`} icon={<RefreshCw size={14} aria-hidden="true" />} />
        </div>
      )}
    </li>
  );
}

const canShowPreview = (i: LibraryAdminItem) => !!i.revision && i.revision.state === "ready";

function UploadProgress({ up, L, onCancel, onRetry, pid }: { up: Upload; L: MediaLabels; onCancel: () => void; onRetry: () => void; pid: string }) {
  return (
    <div className="am-progress" data-testid={`progress-media-upload-${pid}`}>
      {up.status === "uploading" ? (
        <>
          <div className="am-bar" role="progressbar" aria-label={L.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={up.percent}>
            <span style={{ transform: `scaleX(${up.percent / 100})` }} />
          </div>
          <span className="mono small">{up.percent}%</span>
          <button type="button" className="btn ghost sm" onClick={onCancel} data-testid={`button-media-cancel-upload-${pid}`}><X size={14} aria-hidden="true" />{L.cancelUpload}</button>
        </>
      ) : (
        <>
          <p className="small" role="alert">{up.status === "cancelled" ? L.uploadCancelled : L.uploadFailed}</p>
          <button type="button" className="btn ghost sm" onClick={onRetry} data-testid={`button-media-retry-upload-${pid}`}><RefreshCw size={14} aria-hidden="true" />{L.retryUpload}</button>
        </>
      )}
    </div>
  );
}

function CollectionsPanel({ L, locale, busy, parentReadOnly, listRev, mutate, run, cols, all }: Shared & { cols: LibraryCollection[]; all: LibraryCollection[] }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [touched, setTouched] = useState(false);
  const ids = useMemo(() => cols.map((c) => c.id), [cols]);
  const inactive = all.filter((c) => !isActiveStatus(c.status));
  return (
    <div className="am-collections" data-testid="section-media-collections">
      <h3 className="am-group-title">{L.collections}</h3>
      <p className="muted small">{L.collectionsLead}</p>
      {cols.length === 0 ? <p className="muted small">{L.noCollections}</p> : (
        <ol className="am-list">
          {cols.map((c) => <CollectionRow key={c.id} c={c} ids={ids} L={L} locale={locale} busy={busy} readOnly={parentReadOnly} listRev={listRev} mutate={mutate} run={run} />)}
        </ol>
      )}
      {inactive.length > 0 && <p className="muted small am-inactive-cols">{L.archivedSection}: {inactive.map((c, i) => <span key={c.id}>{i > 0 && " · "}<bdi dir="auto">{c.title}</bdi> ({L.status[c.status]})</span>)}</p>}
      {!parentReadOnly && (
        <form className="am-add-col" noValidate onSubmit={async (e) => {
          e.preventDefault(); setTouched(true); if (!title.trim()) return;
          const body: Record<string, unknown> = { title: title.trim() }; if (desc.trim()) body.description = desc.trim();
          if (await run(async () => !!(await mutate("POST", "collections", body)))) { setTitle(""); setDesc(""); setTouched(false); }
        }}>
          <div className="field"><label htmlFor="am-col-title">{L.collectionTitle}</label>
            <input id="am-col-title" dir="auto" maxLength={255} value={title} aria-invalid={touched && !title.trim()} onChange={(e) => setTitle(e.target.value)} data-testid="input-collection-title" />
            {touched && !title.trim() && <small className="field-err" role="alert">{L.titleRequired}</small>}</div>
          <div className="field"><label htmlFor="am-col-desc">{L.collectionDesc}</label>
            <input id="am-col-desc" dir="auto" maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="input-collection-description" /></div>
          <button className="btn ghost" disabled={busy} data-testid="button-add-collection"><FolderPlus size={15} aria-hidden="true" />{L.addCollection}</button>
        </form>
      )}
    </div>
  );
}

function CollectionRow({ c, ids, L, locale, busy, readOnly, listRev, mutate, run }: { c: LibraryCollection; ids: string[]; L: MediaLabels; locale: Locale; busy: boolean; readOnly: boolean; listRev: number; mutate: Shared["mutate"]; run: Shared["run"] }) {
  const { draft, values, dirty, edit, accept } = useMediaDraft({ title: c.title, description: c.description ?? "" }, listRev);
  const up = moveInList(ids, c.id, -1); const down = moveInList(ids, c.id, 1);
  const order = (next: string[]) => void run(async () => !!(await mutate("PUT", "collection-order", { ids: next })));
  const lc = (action: "publish" | "unpublish" | "archive") => void run(async () => !!(await mutate("POST", `collections/${seg(c.id)}/lifecycle`, { action })), L.done);
  const save = (expected: number) => void run(async () => {
    const body: Record<string, unknown> = {};
    if (values.title.trim() !== c.title) body.title = values.title.trim();
    if (values.description.trim() !== (c.description ?? "")) body.description = values.description.trim();
    const saved = await mutate("PATCH", `collections/${seg(c.id)}`, body, expected);
    if (saved?.collection) accept({ title: saved.collection.title, description: saved.collection.description ?? "" }, saved.mediaEditRevision);
    return !!saved;
  });
  return (
    <li className="am-row am-col-row" data-testid={`row-collection-${c.id}`}>
      <div className="am-row-top">
        {!readOnly && ids.length > 1 && (
          <span className="reorder">
            <button type="button" className="icon-btn" disabled={busy || !up} onClick={() => up && order(up)} aria-label={`${L.moveUp}: ${c.title}`} data-testid={`button-collection-move-up-${c.id}`}><ArrowUp size={15} aria-hidden="true" /></button>
            <button type="button" className="icon-btn" disabled={busy || !down} onClick={() => down && order(down)} aria-label={`${L.moveDown}: ${c.title}`} data-testid={`button-collection-move-down-${c.id}`}><ArrowDown size={15} aria-hidden="true" /></button>
          </span>
        )}
        <div className="am-row-main"><strong dir="auto">{c.title}</strong>{c.description && <span className="muted small" dir="auto">{c.description}</span>}</div>
        <span className={`am-chip st-${c.status}`} data-testid={`status-collection-${c.id}`}>{L.status[c.status]}</span>
      </div>
      {!readOnly && (
        <form className="am-edit" noValidate onSubmit={(e) => { e.preventDefault(); if (values.title.trim()) save(draft.revision); }}>
          <div className="field"><label htmlFor={`am-ct-${c.id}`}>{L.collectionTitle}</label>
            <input id={`am-ct-${c.id}`} dir="auto" maxLength={255} value={values.title} disabled={busy} onChange={(e) => edit({ title: e.target.value })} data-testid={`input-collection-title-${c.id}`} /></div>
          <div className="field"><label htmlFor={`am-cd-${c.id}`}>{L.collectionDesc}</label>
            <input id={`am-cd-${c.id}`} dir="auto" maxLength={1000} value={values.description} disabled={busy} onChange={(e) => edit({ description: e.target.value })} data-testid={`input-collection-description-${c.id}`} /></div>
          <div className="am-edit-actions">
            <button className="btn primary sm" disabled={busy || !dirty || !values.title.trim()} data-testid={`button-collection-save-${c.id}`}>{L.save}</button>
            {dirty && draft.revision !== listRev && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => save(listRev)} data-testid={`button-collection-apply-latest-${c.id}`}>{L.applyLatest}</button>}
          </div>
          <div className="am-actions">
            {c.status === "draft" && <ConfirmButton locale={locale} label={L.publish} message={L.publishConfirm} className="btn primary sm" disabled={busy} onConfirm={() => lc("publish")} testId={`button-collection-publish-${c.id}`} icon={<Send size={14} aria-hidden="true" />} />}
            {c.status === "published" && <ConfirmButton locale={locale} label={L.unpublish} message={L.unpublishConfirm} className="btn ghost sm" disabled={busy} onConfirm={() => lc("unpublish")} testId={`button-collection-unpublish-${c.id}`} icon={<Undo2 size={14} aria-hidden="true" />} />}
            <ConfirmButton locale={locale} label={L.archive} message={L.archiveConfirm} className="btn danger sm" disabled={busy} onConfirm={() => lc("archive")} testId={`button-collection-archive-${c.id}`} icon={<Archive size={14} aria-hidden="true" />} />
          </div>
        </form>
      )}
    </li>
  );
}
