// Pure, dependency-free policy for the same-origin LMS BFF. Unit tested.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const ROUTES = [
  "GET courses", "GET courses/:id", "GET me/enrollments", "GET me/courses/:id/progress",
  "GET me/dashboard", "GET lessons/:id", "PUT me/lessons/:id/completion",
  "GET admin/dashboard", "GET admin/courses", "POST admin/courses", "GET admin/courses/:id",
  "PATCH admin/courses/:id", "POST admin/courses/:id/publish", "POST admin/courses/:id/unpublish",
  "POST admin/courses/:id/archive", "POST admin/courses/:id/chapters", "GET admin/chapters/:id",
  "PATCH admin/chapters/:id", "POST admin/chapters/:id/lessons", "GET admin/lessons/:id",
  "PATCH admin/lessons/:id", "PUT admin/courses/:id/chapter-order", "PUT admin/chapters/:id/lesson-order",
  "GET admin/students", "GET admin/students/:id", "GET admin/enrollments", "POST admin/enrollments",
  "PATCH admin/enrollments/:id",
  "GET admin/question-bank/questions", "POST admin/question-bank/questions",
  "GET admin/question-bank/questions/:id", "PATCH admin/question-bank/questions/:id",
  "GET admin/question-bank/questions/:id/revisions", "POST admin/question-bank/questions/:id/revisions",
  "GET admin/question-bank/questions/:id/revisions/:id",
  "POST admin/question-bank/questions/:id/archive",
  "GET admin/skills", "POST admin/skills", "GET admin/skills/:id", "PATCH admin/skills/:id",
  "POST admin/skills/:id/move", "POST admin/skills/:id/archive",
  "GET admin/lessons/:id/media", "POST admin/lessons/:id/media/uploads",
  "POST admin/media/uploads/:id/parts", "POST admin/media/uploads/:id/complete",
  "POST admin/media/:id/scan", "POST admin/media/:id/publish",
  "GET lessons/:id/media", "POST media/:id/access",
  "POST admin/video-pilot/:id/attach", "GET lessons/:id/video-pilot",
  "POST video-pilot/:id/playback",
  "GET me/assessment-attempts", "GET me/assessment-attempts/:id",
  "GET me/assessment-attempts/:id/result", "GET me/assessment-attempts/:id/review",
  "PUT me/assessment-attempts/:id/answers",
  "PUT me/assessment-attempts/:id/questions/:id/flag",
  "POST me/assessment-attempts/:id/submit",
  ...["courses", "chapters", "lessons"].flatMap(scope => [
    `GET ${scope}/:id/quizzes`, `GET ${scope}/:id/quizzes/:id`,
    `POST ${scope}/:id/quizzes/:id/attempts`,
  ]),
  ...["courses", "chapters", "lessons"].flatMap(scope => [
    `GET admin/${scope}/:id/quizzes`, `POST admin/${scope}/:id/quizzes`,
    `GET admin/${scope}/:id/quizzes/:id`, `PATCH admin/${scope}/:id/quizzes/:id`,
    `PUT admin/${scope}/:id/quizzes/:id/items`,
    `POST admin/${scope}/:id/quizzes/:id/preview`,
    `POST admin/${scope}/:id/quizzes/:id/answer-preview`,
    `POST admin/${scope}/:id/quizzes/:id/publish`,
    `POST admin/${scope}/:id/quizzes/:id/unpublish`,
    `POST admin/${scope}/:id/quizzes/:id/archive`,
    `GET admin/${scope}/:id/quizzes/:id/revisions`,
    `GET admin/${scope}/:id/quizzes/:id/revisions/:id`,
    `POST admin/${scope}/:id/quizzes/:id/revisions/:id/review-release`,
  ]),
  ...["courses", "chapters", "lessons"].flatMap(scope => [
    `GET ${scope}/:id/media-library`, `GET admin/${scope}/:id/media-library`,
    `POST admin/${scope}/:id/media-library/assets`,
    `PATCH admin/${scope}/:id/media-library/assets/:id`,
    `POST admin/${scope}/:id/media-library/assets/:id/revisions`,
    `POST admin/${scope}/:id/media-library/assets/:id/activate`,
    `POST admin/${scope}/:id/media-library/assets/:id/lifecycle`,
    `POST admin/${scope}/:id/media-library/placements`,
    `PATCH admin/${scope}/:id/media-library/placements/:id`,
    `POST admin/${scope}/:id/media-library/placements/:id/lifecycle`,
    `PUT admin/${scope}/:id/media-library/placement-order`,
    `POST admin/${scope}/:id/media-library/collections`,
    `PATCH admin/${scope}/:id/media-library/collections/:id`,
    `POST admin/${scope}/:id/media-library/collections/:id/lifecycle`,
    `PUT admin/${scope}/:id/media-library/collection-order`,
    `GET admin/${scope}/:id/media-library/revisions/:id/processing`,
    `POST admin/${scope}/:id/media-library/revisions/:id/processing/upload`,
    `POST admin/${scope}/:id/media-library/revisions/:id/processing/parts`,
    `POST admin/${scope}/:id/media-library/revisions/:id/processing/complete`,
    `POST admin/${scope}/:id/media-library/placements/:id/access`,
    `POST admin/${scope}/:id/media-library/placements/:id/video-preview`,
    `POST ${scope}/:id/media-library/placements/:id/access`,
    `POST ${scope}/:id/media-library/placements/:id/playback`,
    `GET admin/${scope}/:id/media-library/placements/:id/content`,
    `GET ${scope}/:id/media-library/placements/:id/content`,
  ]),
] as const;

export type BffMethod = "GET" | "POST" | "PATCH" | "PUT";

export function isRenditionContentRoute(method: string, path: readonly string[]): boolean {
  const p = path[0] === "admin" ? path.slice(1) : path;
  return method === "GET" && p.length === 6 && ["courses", "chapters", "lessons"].includes(p[0]) &&
    ID.test(p[1]) && p[2] === "media-library" && p[3] === "placements" && ID.test(p[4]) && p[5] === "content";
}
/** Fixed private-byte response headers; never relay provider redirects/cookies/URLs. */
export function privateContentHeaders(upstream: Headers): Headers | null {
  const type = upstream.get("content-type") ?? "";
  const length = upstream.get("content-length") ?? "";
  const disposition = upstream.get("content-disposition");
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain; charset=utf-8", "application/octet-stream"].includes(type) ||
      !/^\d{1,9}$/.test(length) || Number(length) < 1 || Number(length) > 100 * 1024 * 1024 ||
      !["inline", "attachment; filename=\"resource\""].includes(disposition ?? "") ||
      (type === "application/octet-stream") !== (disposition === "attachment; filename=\"resource\"")) return null;
  return new Headers({
    "Content-Type": type, "Content-Length": length, "Content-Disposition": disposition!,
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
    "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "none",
  });
}

export function matchBffRoute(method: string, segments: readonly string[]): boolean {
  return ROUTES.some((route) => {
    const [m, p] = route.split(" ");
    if (m !== method) return false;
    const parts = p.split("/");
    return parts.length === segments.length &&
      parts.every((part, i) => (part === ":id" ? ID.test(segments[i]) : part === segments[i]));
  });
}

const STATUS = new Set(["draft", "published", "archived", "active", "revoked", "expired"]);

export function sanitizeQuery(params: URLSearchParams, context?: { method: string; path: readonly string[] }): string {
  const path = context?.path ?? [];
  const studentQuiz = ["courses", "chapters", "lessons"].includes(path[0]) &&
    ID.test(path[1] ?? "") && path[2] === "quizzes";
  const studentAttempt = path[0] === "me" && path[1] === "assessment-attempts";
  if (studentQuiz || studentAttempt) {
    const out = new URLSearchParams();
    const list = context?.method === "GET" && (
      (studentQuiz && path.length === 3) || (studentAttempt && path.length === 2));
    const detail = context?.method === "GET" && studentQuiz && path.length === 4 && ID.test(path[3]);
    if (list || detail) {
      const locale = params.get("locale");
      if (locale === "ar" || locale === "en") out.set("locale", locale);
    }
    if (list) {
      const size = params.get("pageSize");
      if (size && /^\d{1,2}$/.test(size) && Number(size) >= 1 && Number(size) <= 50) out.set("pageSize", size);
      const cursor = params.get("cursor");
      if (cursor && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) out.set("cursor", cursor);
    }
    const query = out.toString();
    return query ? `?${query}` : "";
  }
  const quizParent = path[0] === "admin" && ["courses", "chapters", "lessons"].includes(path[1]) &&
    ID.test(path[2] ?? "") && path[3] === "quizzes";
  if (quizParent) {
    const list = context?.method === "GET" && path.length === 4;
    const revisions = context?.method === "GET" && path.length === 6 && ID.test(path[4]) && path[5] === "revisions";
    const out = new URLSearchParams();
    const filters: Record<string, (value: string) => boolean> = {};
    if (list || revisions) {
      filters.page = value => /^\d{1,6}$/.test(value) && Number(value) >= 1 && Number(value) <= 100000;
      filters.pageSize = value => /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 50;
    }
    if (list) {
      filters.status = value => ["draft", "published", "archived"].includes(value);
      filters.mode = value => ["practice", "graded"].includes(value);
      filters.required = value => ["true", "false"].includes(value);
      filters.locale = value => ["ar", "en"].includes(value);
    }
    for (const [key, valid] of Object.entries(filters)) {
      const value = params.get(key);
      if (value && valid(value)) out.set(key, value);
    }
    const query = out.toString();
    return query ? `?${query}` : "";
  }
  const questionList = context?.method === "GET" && path.join("/") === "admin/question-bank/questions";
  const skillList = context?.method === "GET" && path.join("/") === "admin/skills";
  const revisionList = context?.method === "GET" && path.length === 5 &&
    path[0] === "admin" && path[1] === "question-bank" && path[2] === "questions" &&
    ID.test(path[3]) && path[4] === "revisions";
  if (questionList || skillList || revisionList) {
    const out = new URLSearchParams();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const filters: Record<string, (value: string) => boolean> = {
      page: value => /^\d{1,6}$/.test(value) && Number(value) >= 1 && Number(value) <= 100000,
      pageSize: value => /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 50,
    };
    if (!revisionList) {
      filters.search = value => value.length <= (questionList ? 200 : 120);
      filters.status = value => ["active", "archived"].includes(value);
    }
    if (skillList) filters.parentId = value => value === "root" || uuid.test(value);
    if (questionList) {
      filters.type = value => ["single_choice", "multiple_choice", "true_false", "short_text", "ordering"].includes(value);
      filters.primarySkillId = value => uuid.test(value);
      filters.cognitiveTag = value => ["concept", "code_tracing", "debugging", "problem_solving", "implementation"].includes(value);
      filters.difficulty = value => ["easy", "medium", "hard"].includes(value);
      filters.locale = value => ["ar", "en"].includes(value);
    }
    for (const [key, valid] of Object.entries(filters)) {
      const value = params.get(key);
      if (value && valid(value)) out.set(key, value);
    }
    const query = out.toString();
    return query ? `?${query}` : "";
  }
  const out = new URLSearchParams();
  for (const key of ["page", "pageSize", "search", "status", "courseId", "studentId"]) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    if ((key === "page" || key === "pageSize") && !/^\d{1,4}$/.test(value)) continue;
    if (key === "search" && value.length > 100) continue;
    if (key === "status" && !STATUS.has(value)) continue;
    if ((key === "courseId" || key === "studentId") && !ID.test(value)) continue;
    out.set(key, value);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

/** Non-GET browser mutations must carry an Origin exactly equal to the configured app origin. */
export function isSameOrigin(originHeader: string | null, appBaseUrl: string | undefined): boolean {
  if (!originHeader || !appBaseUrl) return false;
  try {
    return originHeader === new URL(appBaseUrl).origin;
  } catch {
    return false;
  }
}

/** GET reads reject explicit cross-site fetch metadata. */
export function isAllowedFetchSite(site: string | null): boolean {
  return site === null || site === "same-origin" || site === "none";
}

export function apiBase(env: { API_BASE_URL?: string; APP_BASE_URL?: string }): string | null {
  try {
    const raw = env.API_BASE_URL ?? (env.APP_BASE_URL ? new URL("/api/v1/", env.APP_BASE_URL).toString() : null);
    return raw ? raw.replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

export function buildUpstreamUrl(base: string, segments: readonly string[], query: string): string {
  return `${base}/${segments.map(encodeURIComponent).join("/")}${query}`;
}

/** Forward only a bounded delay, never arbitrary provider/header contents. */
export function safeRetryAfter(value: string | null): string | undefined {
  if (!value || !/^\d{1,4}$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds >= 1 && seconds <= 3600 ? String(seconds) : undefined;
}

/** Reduce any upstream error body to the generic, secret-free envelope. */
export function genericError(body: unknown, fallback: string): { code: string; requestId?: string } {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const code = typeof o.code === "string" && /^[A-Z0-9_]{1,64}$/.test(o.code) ? o.code : fallback;
  const requestId = typeof o.requestId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(o.requestId) ? o.requestId : undefined;
  return requestId ? { code, requestId } : { code };
}

/** Bound streamed bytes too: Content-Length can be absent or untrusted. */
export async function readBoundedBody(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<
  { ok: true; text: string } | { ok: false; status: 400 | 413; code: string }
> {
  if (!stream) return { ok: true, text: "" };
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, status: 400, code: "VALIDATION_FAILED" };
  } finally {
    reader.releaseLock();
  }
}

/** UTF-8 byte bound (Arabic and other multi-byte text counts by bytes, not UTF-16 units). */
export function exceedsBytes(text: string, max: number): boolean {
  return new TextEncoder().encode(text).byteLength > max;
}
