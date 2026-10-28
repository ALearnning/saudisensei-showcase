"use client";
import { AlertTriangle, Clock, Lock, RefreshCw, WifiOff } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { studentMediaLabels } from "./labels";

export type ViewerFailure = "transient" | "session" | "denied" | "unavailable" | "expired" | "renewal" | "unsupported" | "corrupt" | "noViewer";

/** Uniform loading/error surface. Never shows provider errors, URLs, tokens or ids. */
export function ViewerState({ locale, state, onRetry }: { locale: Locale; state: "loading" | ViewerFailure; onRetry?: () => void }) {
  const L = studentMediaLabels(locale);
  if (state === "loading") {
    return <div className="sm-state" role="status" data-testid="status-viewer-loading"><span className="sm-spin" aria-hidden="true" />{L.loading}</div>;
  }
  const Icon = state === "transient" ? WifiOff : state === "expired" ? Clock : state === "denied" || state === "session" ? Lock : AlertTriangle;
  const retryable = state !== "denied" && state !== "session" && state !== "unsupported" && state !== "noViewer" && state !== "corrupt";
  return (
    <div className={`sm-state bad s-${state}`} role="alert" data-testid={`status-viewer-${state}`}>
      <Icon size={20} aria-hidden="true" />
      <p>{L.states[state]}</p>
      {retryable && onRetry && <button type="button" className="btn ghost sm" onClick={onRetry} data-testid="button-viewer-retry"><RefreshCw size={14} aria-hidden="true" />{L.retry}</button>}
    </div>
  );
}
