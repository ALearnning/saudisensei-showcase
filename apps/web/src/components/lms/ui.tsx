"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, CloudOff, FileQuestion, LogIn, RefreshCw, Search, ShieldAlert } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getLms, type LmsCatalog } from "@/i18n/lms";
import type { ApiFailure } from "@/lib/lms-client";
import { displayPercent, fmt } from "@/lib/lms-paths";

export function Badge({ status, locale }: { status: string; locale: Locale }) {
  const t = getLms(locale);
  const label = (t.status as Record<string, string>)[status] ?? status;
  return <span className={`badge b-${status}`} data-testid={`status-${status}`}>{label}</span>;
}

export function ReqTag({ required, locale }: { required: boolean; locale: Locale }) {
  const t = getLms(locale).common;
  return <span className={`tag ${required ? "req" : "opt"}`}>{required ? t.required : t.optional}</span>;
}

export function ProgressBar({ percentage, isCompleted, label, testId }: { percentage: number; isCompleted: boolean; label?: string; testId?: string }) {
  const p = displayPercent(percentage, isCompleted);
  return (
    <div className="progress" data-testid={testId}>
      <div className="progress-row">
        <strong className="progress-num"><bdi>{p}%</bdi></strong>
        {label && <span className="progress-label">{label}</span>}
      </div>
      <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}>
        <span className={`fill${isCompleted ? " done" : ""}`} style={{ transform: `scaleX(${p / 100})` }} />
      </div>
    </div>
  );
}

export function Skeleton({ rows = 3, tall = false }: { rows?: number; tall?: boolean }) {
  const t = "skeleton";
  return (
    <div className="sk-wrap" aria-busy="true" data-testid="status-loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className={`${t}${tall ? " tall" : ""}`} style={{ animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}

export function PageHead({ eyebrow, title, lead, actions, back }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="page-head rise">
      {back && <Link href={back.href} className="crumb" data-testid="link-back"><ChevronRight size={15} className="flip-rtl" aria-hidden="true" />{back.label}</Link>}
      <div className="page-head-row">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1 dir="auto">{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </header>
  );
}

export function mutationMessage(err: ApiFailure, t: LmsCatalog): string {
  if (err.code === "COURSE_CHANGED") return t.errors.conflictBody;
  if (err.code === "PUBLISHED_STRUCTURE_REQUIRED") return t.errors.publishRule;
  if (err.code === "LESSON_BODY_REQUIRED") return t.errors.bodyRequired;
  if (err.status === 400 || err.status === 422) return t.errors.validation;
  if (err.status === 409) return t.errors.transition;
  if (err.status === 404) return t.errors.notFoundBody;
  if (err.status === 403) return t.errors.forbiddenBody;
  if (err.status === 401) return t.errors.sessionBody;
  return t.errors.generic;
}

export function MutationError({ error, locale, onRefresh, hint }: { error: ApiFailure | null; locale: Locale; onRefresh?: () => void; hint?: string }) {
  const t = getLms(locale);
  if (!error) return null;
  const conflict = error.code === "COURSE_CHANGED";
  return (
    <div className={`notice ${conflict ? "warn" : "bad"}`} role="alert" data-testid={conflict ? "status-conflict" : "status-mutation-error"}>
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>{conflict ? t.errors.conflictTitle : mutationMessage(error, t)}</strong>
        {conflict && <p>{t.errors.conflictBody}</p>}
        {!conflict && hint && <p>{hint}</p>}
        {error.requestId && <p className="ref">{t.errors.reference}: <bdi className="mono">{error.requestId}</bdi></p>}
        {(conflict || onRefresh) && onRefresh && (
          <button type="button" className="btn ghost sm" onClick={onRefresh} data-testid="button-refresh-conflict"><RefreshCw size={14} aria-hidden="true" />{t.common.refresh}</button>
        )}
      </div>
    </div>
  );
}

export function ErrorState({ error, locale, onRetry, back }: { error: ApiFailure; locale: Locale; onRetry?: () => void; back?: { href: string; label: string } }) {
  const t = getLms(locale);
  const kind = error.status === 401 ? "session" : error.status === 403 ? "forbidden" : error.status === 404 ? "notfound" : "unavailable";
  const map = {
    session: { Icon: LogIn, title: t.errors.sessionTitle, body: t.errors.sessionBody },
    forbidden: { Icon: ShieldAlert, title: t.errors.forbiddenTitle, body: t.errors.forbiddenBody },
    notfound: { Icon: FileQuestion, title: t.errors.notFoundTitle, body: t.errors.notFoundBody },
    unavailable: { Icon: CloudOff, title: t.errors.unavailableTitle, body: t.errors.unavailableBody },
  } as const;
  const s = map[kind];
  return (
    <section className={`card state ${kind === "forbidden" ? "deny" : "warn"} rise`} data-testid={`status-${kind}`} role="status">
      <span className="icon-badge"><s.Icon size={22} aria-hidden="true" /></span>
      <h1>{s.title}</h1>
      <p className="lead">{s.body}</p>
      <div className="actions">
        {kind === "session" && <a className="btn primary" href={`/${locale}/login`} data-testid="link-sign-in">{t.errors.signIn}</a>}
        {kind === "unavailable" && onRetry && <button type="button" className="btn primary" onClick={onRetry} data-testid="button-retry"><RefreshCw size={16} aria-hidden="true" />{t.common.retry}</button>}
        {back && <Link className="btn ghost" href={back.href} data-testid="link-error-back">{back.label}</Link>}
      </div>
    </section>
  );
}

export function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="empty" data-testid="status-empty">
      <span className="empty-mark" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ConfirmButton({ label, message, onConfirm, locale, className = "btn ghost", disabled, testId, icon }: {
  label: string; message: string; onConfirm: () => void | Promise<void>; locale: Locale; className?: string; disabled?: boolean; testId: string; icon?: React.ReactNode;
}) {
  const t = getLms(locale).common;
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => ref.current?.showModal()} data-testid={testId}>{icon}{label}</button>
      <dialog ref={ref} className="confirm" aria-labelledby={`${testId}-title`}>
        <h2 id={`${testId}-title`}>{label}</h2>
        <p>{message}</p>
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} data-testid={`${testId}-confirm`} onClick={async () => {
            setBusy(true);
            try { await onConfirm(); } finally { setBusy(false); ref.current?.close(); }
          }}>{busy ? t.saving : t.confirm}</button>
          <button type="button" className="btn ghost" autoFocus onClick={() => ref.current?.close()} data-testid={`${testId}-cancel`}>{t.cancel}</button>
        </div>
      </dialog>
    </>
  );
}

export function Pager({ page, pageSize, total, onPage, locale }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; locale: Locale }) {
  const t = getLms(locale).common;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (total <= pageSize && page <= 1) return <p className="muted small" data-testid="text-total">{fmt(t.total, { n: total })}</p>;
  return (
    <nav className="pager" aria-label={fmt(t.pageOf, { p: page, n: pages })}>
      <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="button-page-prev"><ChevronRight size={15} className="flip-rtl" aria-hidden="true" />{t.prev}</button>
      <span className="muted small" data-testid="text-page">{fmt(t.pageOf, { p: page, n: pages })} · {fmt(t.total, { n: total })}</span>
      <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="button-page-next">{t.next}<ChevronLeft size={15} className="flip-rtl" aria-hidden="true" /></button>
    </nav>
  );
}

/** Debounced search input; reports trimmed value. */
export function SearchBox({ placeholder, onSearch, label, testId = "input-search" }: { placeholder: string; onSearch: (v: string) => void; label: string; testId?: string }) {
  const [v, setV] = useState("");
  const cb = useRef(onSearch);
  cb.current = onSearch;
  useEffect(() => {
    const id = window.setTimeout(() => cb.current(v.trim()), 300);
    return () => window.clearTimeout(id);
  }, [v]);
  return (
    <label className="search">
      <Search size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" value={v} maxLength={100} placeholder={placeholder} onChange={(e) => setV(e.target.value)} data-testid={testId} />
    </label>
  );
}

export function Toast({ text }: { text: string | null }) {
  return <div className="toast-region" role="status" aria-live="polite">{text && <span className="toast" data-testid="status-toast">{text}</span>}</div>;
}

export function useToast() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const id = window.setTimeout(() => setText(null), 2600);
    return () => window.clearTimeout(id);
  }, [text]);
  return [text, setText] as const;
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { year: "numeric", month: "short", day: "numeric" });
}
