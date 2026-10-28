"use client";
import { useCallback, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, PenLine } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { lms, type ApiFailure, type ApiResult } from "@/lib/lms-client";
import { moveId } from "@/lib/lms-paths";
import { Markdown } from "./Markdown";

/** Runs a mutation, surfaces generic errors/conflicts, refreshes on success. */
export function useMutator(onDone: () => void | Promise<void>, toast: (s: string) => void) {
  const [error, setError] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const run = useCallback(async <T,>(call: () => Promise<ApiResult<T>>, okText: string): Promise<T | null> => {
    setBusy(true); setError(null);
    try {
      const r = await call();
      if (!r.ok) { setError(r.error); return null; }
      toast(okText);
      await done.current();
      return r.data;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, error, setError, busy };
}

export function send<T>(method: "POST" | "PATCH" | "PUT", path: string, body: unknown) {
  return () => lms<T>(path, { method, body });
}

export function ReorderButtons({ ids, id, disabled, onMove, locale, label }: { ids: string[]; id: string; disabled?: boolean; onMove: (next: string[]) => void; locale: Locale; label: string }) {
  const t = getLms(locale).common;
  const up = moveId(ids, id, -1);
  const down = moveId(ids, id, 1);
  return (
    <span className="reorder">
      <button type="button" className="icon-btn" disabled={disabled || !up} onClick={() => up && onMove(up)} aria-label={`${t.moveUp}: ${label}`} data-testid={`button-move-up-${id}`}><ArrowUp size={15} aria-hidden="true" /></button>
      <button type="button" className="icon-btn" disabled={disabled || !down} onClick={() => down && onMove(down)} aria-label={`${t.moveDown}: ${label}`} data-testid={`button-move-down-${id}`}><ArrowDown size={15} aria-hidden="true" /></button>
    </span>
  );
}

export function Field({ label, children, help, error, id }: { label: string; children: React.ReactNode; help?: string; error?: string | null; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <small className="help" id={`${id}-help`}>{help}</small>}
      {error && <small className="field-err" role="alert" data-testid={`error-${id}`}>{error}</small>}
    </div>
  );
}

export function BodyEditor({ value, onChange, disabled, locale }: { value: string; onChange: (v: string) => void; disabled?: boolean; locale: Locale }) {
  const t = getLms(locale).admin;
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="body-editor">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "write"} className={tab === "write" ? "on" : ""} onClick={() => setTab("write")} data-testid="tab-write"><PenLine size={14} aria-hidden="true" />{t.write}</button>
        <button type="button" role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")} data-testid="tab-preview"><Eye size={14} aria-hidden="true" />{t.preview}</button>
      </div>
      {tab === "write"
        ? <textarea id="lesson-body" dir="auto" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={16} maxLength={100000} aria-describedby="lesson-body-help" data-testid="input-lesson-body" />
        : <div className="preview-pane">{value.trim() ? <Markdown source={value} /> : <p className="muted">{t.noPreview}</p>}</div>}
    </div>
  );
}
