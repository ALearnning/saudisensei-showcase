export type Failure = {
  status: number;
  code: string;
  requestId?: string;
  retryAfter?: number;
  rateLimitSource?: "client" | "server";
};
export type Result<T> = { ok: true; data: T } | { ok: false; error: Failure };
export type Method = "GET" | "POST" | "PATCH" | "PUT";
/** Only confirmed rejections may resume editing without reconciling a write. */
export function writeFailureKind(error: Failure) {
  if ([400, 413, 422, 429].includes(error.status)) return "rejected";
  if ([401, 403].includes(error.status)) return "denied";
  if (error.status === 409) return "conflict";
  // Network, malformed successes, server failures and unknown outcomes stay protected.
  return "uncertain";
}
/** A workspace-lifetime transport. No tokens, persistent storage, polling or mutation retries. */
export class AssessmentTransport {
  private pending = new Map<string, Promise<Result<unknown>>>();
  private times: number[] = [];
  private blockedUntil = 0;
  private denied = false;
  constructor(
    private deniedCallback: (e: Failure) => void = () => {},
    private fetcher: typeof fetch = (...a) => fetch(...a),
    private now = () => Date.now(),
  ) {}
  /** Shared server cooldown and the existing workspace request budget both apply. */
  retryAfter(): number {
    const now = this.now();
    this.times = this.times.filter((t) => t > now - 60000);
    const until = Math.max(
      this.blockedUntil,
      this.times.length >= 40 ? this.times[0] + 60000 : 0,
    );
    return Math.max(0, Math.ceil((until - now) / 1000));
  }
  request<T>(
    path: string,
    method: Method = "GET",
    body?: unknown,
  ): Promise<Result<T>> {
    if (this.denied)
      return Promise.resolve({
        ok: false,
        error: { status: 403, code: "FORBIDDEN" },
      });
    const key =
      method +
      " " +
      path +
      " " +
      (body === undefined ? "" : JSON.stringify(body));
    const dedup =
      method === "GET" || (method === "POST" && path.endsWith("/preview"));
    if (dedup && this.pending.has(key))
      return this.pending.get(key)! as Promise<Result<T>>;
    const retryAfter = this.retryAfter();
    if (retryAfter > 0)
      return Promise.resolve({
        ok: false,
        error: {
          status: 429,
          code: "RATE_LIMITED",
          retryAfter,
          rateLimitSource: this.blockedUntil > this.now() ? "server" : "client",
        },
      });
    if (!/^admin\//.test(path) || path.includes(".."))
      return Promise.resolve({
        ok: false,
        error: { status: 404, code: "NOT_FOUND" },
      });
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded && new TextEncoder().encode(encoded).length > 200000)
      return Promise.resolve({
        ok: false,
        error: { status: 413, code: "PAYLOAD_TOO_LARGE" },
      });
    this.times.push(this.now());
    const work = (async (): Promise<Result<T>> => {
      try {
        const r = await this.fetcher(`/lms-api/${path}`, {
          method,
          credentials: "same-origin",
          cache: "no-store",
          headers: encoded ? { "Content-Type": "application/json" } : undefined,
          body: encoded,
        });
        const value: unknown = await r.json().catch(() => null);
        if (this.denied)
          return { ok: false, error: { status: 403, code: "FORBIDDEN" } };
        if (r.ok)
          return value && typeof value === "object"
            ? { ok: true, data: value as T }
            : { ok: false, error: { status: 502, code: "INVALID_RESPONSE" } };
        const v = (value ?? {}) as Record<string, unknown>,
          retry = r.headers.get("retry-after");
        const error: Failure = {
          status: r.status,
          code:
            typeof v.code === "string" && /^[A-Z0-9_]{1,64}$/.test(v.code)
              ? v.code
              : "REQUEST_FAILED",
          ...(typeof v.requestId === "string" &&
          /^[A-Za-z0-9_-]{1,80}$/.test(v.requestId)
            ? { requestId: v.requestId }
            : {}),
        };
        if (r.status === 429) {
          error.rateLimitSource = "server";
          error.retryAfter =
            retry && /^\d{1,4}$/.test(retry)
              ? Math.min(3600, Math.max(1, Number(retry)))
              : 60;
          this.blockedUntil = Math.max(
            this.blockedUntil,
            this.now() + error.retryAfter * 1000,
          );
          error.retryAfter = this.retryAfter();
        }
        if (r.status === 401 || r.status === 403) {
          this.denied = true;
          this.pending.clear();
          this.deniedCallback(error);
        }
        return { ok: false, error };
      } catch {
        return { ok: false, error: { status: 0, code: "NETWORK" } };
      }
    })();
    if (dedup) {
      this.pending.set(key, work);
      void work.finally(() => this.pending.delete(key));
    }
    return work;
  }
}
