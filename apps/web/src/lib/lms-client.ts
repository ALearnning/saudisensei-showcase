"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ApiFailure = { status: number; code: string; requestId?: string };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** Same-origin call to the BFF. No tokens ever reach the browser. */
export async function lms<T>(path: string, init?: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown }): Promise<ApiResult<T>> {
  const hasBody = init?.body !== undefined;
  try {
    const res = await fetch(`/lms-api/${path.replace(/^\/+/, "")}`, {
      method: init?.method ?? "GET",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(init!.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) {
      const o = (json ?? {}) as { code?: unknown; requestId?: unknown };
      return { ok: false, error: { status: res.status, code: typeof o.code === "string" ? o.code : "ERROR", requestId: typeof o.requestId === "string" ? o.requestId : undefined } };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: { status: 0, code: "NETWORK" } };
  }
}

type State<T> = { data?: T; error?: ApiFailure; loading: boolean };

/** Fresh on mount, on window focus/visibility, and finite background polling. */
export function useLms<T>(path: string | null, pollMs = 30_000, maxPolls = 20) {
  const [state, setState] = useState<State<T>>({ loading: path !== null });
  const pathRef = useRef(path);
  pathRef.current = path;
  const seq = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const p = pathRef.current;
    if (p === null) return;
    const mine = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    const r = await lms<T>(p);
    if (mine !== seq.current) return;
    if (r.ok) setState({ data: r.data, loading: false });
    else setState((s) => {
      const hard = [401, 403, 404].includes(r.error.status);
      return hard || !s.data ? { error: r.error, loading: false } : { ...s, loading: false };
    });
  }, []);

  useEffect(() => {
    // New resource: never show the previous path's data/error.
    setState({ loading: path !== null });
    if (path === null) { seq.current += 1; return; }
    void load(false);
    const onFocus = () => void load(true);
    const onVis = () => { if (document.visibilityState === "visible") void load(true); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      if (n >= maxPolls) window.clearInterval(id);
      if (document.visibilityState === "visible") void load(true);
    }, pollMs);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(id);
      seq.current += 1; // invalidate any in-flight response for this path
    };
  }, [path, load, pollMs, maxPolls]);

  const reload = useCallback(() => load(true), [load]);
  const setData = useCallback((fn: (d: T | undefined) => T | undefined) => setState((s) => ({ ...s, data: fn(s.data) })), []);
  return { ...state, reload, setData };
}
