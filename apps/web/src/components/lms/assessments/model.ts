import type {
  AdminQuestionDraft,
  AdminQuestionType,
  AdminQuizDetail,
  AdminQuizDraft,
  AdminQuizItemInput,
  AdminQuizRevision,
  AssessmentQuizPolicy,
  AdminSkillDetail,
  AdminSkillView,
  AdminQuizPreviewQuestion,
} from "@workspace/saudisensei-api-client";
export type Locale = "ar" | "en";
export function assessmentTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    calendar: "gregory",
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}
export type PinnedPresentation = AdminQuizPreviewQuestion & {
  revisionNumber?: number;
};
/** Only exact references still in the local composition may retain loaded content. */
export function mergePinnedPresentations(
  previous: Record<string, PinnedPresentation>,
  loaded: PinnedPresentation[],
  items: AdminQuizItemInput[],
): Record<string, PinnedPresentation> {
  const next = { ...previous };
  for (const p of loaded) {
    if (
      items.some(
        (i) =>
          i.questionId === p.questionId &&
          i.questionRevisionId === p.questionRevisionId,
      )
    )
      next[p.questionRevisionId] = { ...previous[p.questionRevisionId], ...p };
  }
  return Object.fromEntries(
    Object.entries(next).filter(([id, p]) =>
      items.some(
        (i) => i.questionRevisionId === id && i.questionId === p.questionId,
      ),
    ),
  );
}
export type Scope = "courses" | "chapters" | "lessons";
export const scopes: Scope[] = ["courses", "chapters", "lessons"];
export const questionTypes: AdminQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "ordering",
  "short_text",
];
export const visibility = [
  "after_grading",
  "after_attempt_limit",
  "manual_release",
  "never",
] as const;
export type Visibility = (typeof visibility)[number];
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Route =
  | { kind: "home" }
  | { kind: "bank" }
  | { kind: "skills" }
  | { kind: "quizzes" }
  | { kind: "question"; id: string }
  | { kind: "quiz"; id: string; scope: Scope; parent: string };
export function parseRoute(s: string[] = []): Route | null {
  if (!s.length) return { kind: "home" };
  if (s.length === 1 && s[0] === "question-bank") return { kind: "bank" };
  if (
    s.length === 2 &&
    s[0] === "question-bank" &&
    (s[1] === "new" || uuid.test(s[1]))
  )
    return { kind: "question", id: s[1] };
  if (s.length === 1 && s[0] === "skills") return { kind: "skills" };
  if (s.length === 1 && s[0] === "quizzes") return { kind: "quizzes" };
  if (
    s.length === 4 &&
    s[0] === "quizzes" &&
    scopes.includes(s[1] as Scope) &&
    uuid.test(s[2]) &&
    (s[3] === "new" || uuid.test(s[3]))
  )
    return { kind: "quiz", scope: s[1] as Scope, parent: s[2], id: s[3] };
  return null;
}
export const href = (l: Locale, suffix = "") =>
  `/${l}/admin/assessments${suffix ? "/" + suffix : ""}`;
export const quizPath = (scope: Scope, parent: string, id?: string) =>
  `admin/${scope}/${encodeURIComponent(parent)}/quizzes${id ? "/" + encodeURIComponent(id) : ""}`;
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const localesOf = (content: { ar?: unknown; en?: unknown }): Locale[] =>
  (["ar", "en"] as const).filter((l) => content[l] !== undefined);
export const selectedLocale = (
  content: { ar?: unknown; en?: unknown },
  preferred: Locale,
  fallback: Locale,
): Locale => (content[preferred] ? preferred : fallback);
export function skillLabel(s: AdminSkillView, l: Locale) {
  return (
    s.translations[l]?.label ??
    s.translations.ar?.label ??
    s.translations.en?.label ??
    s.slug
  );
}
export function skillPath(s: AdminSkillDetail, l: Locale) {
  return [...s.ancestors, s].map((x) => skillLabel(x, l)).join(" / ");
}
export const within = (a: Visibility, b: Visibility) =>
  b === "never" || b === a || a === "after_grading";
export function policyIssues(p: AssessmentQuizPolicy): string[] {
  const errors: string[] = [];
  if (
    !within(p.scoreVisibility, p.reviewVisibility) ||
    !within(p.reviewVisibility, p.explanationVisibility)
  )
    errors.push("visibility");
  if (
    p.maxAttempts === null &&
    [p.scoreVisibility, p.reviewVisibility, p.explanationVisibility].includes(
      "after_attempt_limit",
    )
  )
    errors.push("finite");
  if (
    p.maxAttempts !== null &&
    (!Number.isInteger(p.maxAttempts) ||
      p.maxAttempts < 1 ||
      p.maxAttempts > 2147483647)
  )
    errors.push("attempts");
  if (
    !Number.isInteger(p.passBasisPoints) ||
    p.passBasisPoints < 0 ||
    p.passBasisPoints > 10000
  )
    errors.push("threshold");
  if (
    p.timeLimitSeconds !== null &&
    (!Number.isInteger(p.timeLimitSeconds) ||
      p.timeLimitSeconds < 60 ||
      p.timeLimitSeconds > 10800)
  )
    errors.push("duration");
  if (
    [p.opensAt, p.closesAt].some((d) => d && !Number.isFinite(Date.parse(d))) ||
    (p.opensAt && p.closesAt && Date.parse(p.opensAt) >= Date.parse(p.closesAt))
  )
    errors.push("window");
  return errors;
}
export function normalizeVisibility(
  p: AssessmentQuizPolicy,
): AssessmentQuizPolicy {
  const next = { ...p };
  for (const f of [
    "scoreVisibility",
    "reviewVisibility",
    "explanationVisibility",
  ] as const)
    if (next.maxAttempts === null && next[f] === "after_attempt_limit")
      next[f] = "never";
  if (!within(next.scoreVisibility, next.reviewVisibility))
    next.reviewVisibility = next.scoreVisibility;
  if (!within(next.reviewVisibility, next.explanationVisibility))
    next.explanationVisibility = next.reviewVisibility;
  return next;
}
export function defaultPolicy(
  mode: "graded" | "practice" = "graded",
): AssessmentQuizPolicy {
  return {
    version: 1,
    mode,
    required: false,
    maxAttempts: mode === "graded" ? 1 : null,
    timeLimitSeconds: null,
    passBasisPoints: 7000,
    opensAt: null,
    closesAt: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    scoreVisibility: "after_grading",
    reviewVisibility: mode === "graded" ? "manual_release" : "after_grading",
    explanationVisibility:
      mode === "graded" ? "manual_release" : "after_grading",
    aiAnalysisEnabled: false,
  };
}
export function basisPoints(s: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return NaN;
  const [whole, fraction = ""] = s.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function riyadhInput(iso: string | null | undefined) {
  return iso && Number.isFinite(Date.parse(iso))
    ? new Date(Date.parse(iso) + 10800000).toISOString().slice(0, 19)
    : "";
}
export function riyadhInstant(local: string) {
  if (!local) return null;
  const n = Date.parse(local + "+03:00");
  return Number.isFinite(n) ? new Date(n).toISOString() : "invalid";
}
export const bytes = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).length;
export const restricted = (s: string) =>
  !/<\/?[A-Za-z!]|!\[|\]\s*(?:\(|\[|:)|^\s*\[[^\]]+\]:/m.test(s);
export function quizInfoValid(d: AdminQuizDraft) {
  return (
    !!d.content[d.defaultContentLocale] &&
    localesOf(d.content).every((l) => {
      const c = d.content[l]!;
      return (
        !!c.title.trim() &&
        c.title.length <= 255 &&
        restricted(c.title) &&
        c.instructions.length <= 20000 &&
        restricted(c.instructions)
      );
    }) &&
    bytes(d.content) <= 90000
  );
}
export function itemsValid(items: AdminQuizItemInput[]) {
  return (
    items.length <= 100 &&
    new Set(items.map((i) => i.questionId)).size === items.length &&
    items.every(
      (i, n) =>
        uuid.test(i.questionId) &&
        uuid.test(i.questionRevisionId) &&
        i.position === n &&
        Number.isInteger(i.points) &&
        i.points! >= 1 &&
        i.points! <= 1000,
    )
  );
}
export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const next = [...items],
    target = index + delta;
  if (target < 0 || target >= items.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function positioned(items: AdminQuizItemInput[]) {
  return items.map((i, position) => ({ ...i, position }));
}
export type QuizState = {
  ack: AdminQuizDetail;
  info: Pick<AdminQuizDraft, "content" | "defaultContentLocale">;
  policy: AssessmentQuizPolicy;
  items: AdminQuizItemInput[];
  pending: boolean;
  conflict: boolean;
};
export function quizState(q: AdminQuizDetail): QuizState {
  return {
    ack: q,
    info: {
      content: q.draft.content,
      defaultContentLocale: q.draft.defaultContentLocale,
    },
    policy: q.draft.policy,
    items: q.items.map(
      ({ questionId, questionRevisionId, position, points }) => ({
        questionId,
        questionRevisionId,
        position,
        points,
      }),
    ),
    pending: false,
    conflict: false,
  };
}
export function dirtySections(s: QuizState) {
  const a = quizState(s.ack);
  return {
    info: !same(s.info, a.info),
    policy: !same(s.policy, a.policy),
    items: !same(s.items, a.items),
  };
}
export function quizBlocked(s: QuizState) {
  return (
    s.pending ||
    s.conflict ||
    Object.values(dirtySections(s)).some(Boolean) ||
    !quizInfoValid({ ...s.info, policy: s.policy }) ||
    policyIssues(s.policy).length > 0 ||
    !itemsValid(s.items) ||
    !s.items.length
  );
}
/** PATCH replaces the full draft: use acknowledged values outside the section being saved. */
export function saveBody(s: QuizState, section: "info" | "policy" | "items") {
  if (section === "items")
    return { expectedRevision: s.ack.editRevision, items: positioned(s.items) };
  return {
    expectedRevision: s.ack.editRevision,
    draft:
      section === "info"
        ? { ...s.info, policy: s.ack.draft.policy }
        : { ...s.ack.draft, policy: s.policy },
  };
}
export function acknowledge(
  s: QuizState,
  q: AdminQuizDetail,
  section: "info" | "policy" | "items",
): QuizState {
  return {
    ...s,
    ack: q,
    [section]: quizState(q)[section],
    pending: false,
    conflict: false,
  };
}
export function draftDiffers(q: AdminQuizDetail, revision: AdminQuizRevision) {
  return (
    !same(q.draft.content, revision.content) ||
    !same(q.draft.policy, revision.policy) ||
    q.draft.defaultContentLocale !== revision.defaultContentLocale ||
    !same(
      q.items.map(({ questionId, questionRevisionId, position, points }) => ({
        questionId,
        questionRevisionId,
        position,
        points,
      })),
      revision.items.map(
        ({ questionId, questionRevisionId, position, points }) => ({
          questionId,
          questionRevisionId,
          position,
          points,
        }),
      ),
    )
  );
}
export function publicationState(
  q: AdminQuizDetail,
  historyTotal?: number,
): "archived" | "published" | "unpublished" | "first" | "unknown" {
  return q.status === "archived"
    ? "archived"
    : q.currentRevisionId
      ? "published"
      : historyTotal === undefined
        ? "unknown"
        : historyTotal > 0
          ? "unpublished"
          : "first";
}
export function emptyQuestion(
  type: AdminQuestionType,
  l: Locale,
  id = () => crypto.randomUUID(),
): AdminQuestionDraft {
  const ids = [id(), id()];
  const gradingDefinition: AdminQuestionDraft["gradingDefinition"] =
    type === "single_choice"
      ? { type, correctOptionId: ids[0] }
      : type === "multiple_choice"
        ? { type, correctOptionIds: [] }
        : type === "true_false"
          ? { type, correctValue: true }
          : type === "ordering"
            ? { type, correctOrderedItemIds: ids }
            : {
                type,
                normalizer: {
                  version: 1,
                  unicode: "NFC",
                  lineEndings: "LF",
                  trim: false,
                  collapseWhitespace: false,
                  caseFold: false,
                },
                acceptedByLocale: { [l]: [""] },
              };
  return {
    type,
    defaultContentLocale: l,
    content: {
      [l]: {
        prompt: "",
        ...(type === "ordering"
          ? { items: ids.map((id) => ({ id, label: "" })) }
          : type.includes("choice")
            ? { options: ids.map((id) => ({ id, label: "" })) }
            : {}),
      },
    },
    gradingDefinition,
    explanation: {},
    defaultPoints: 1,
    difficulty: "medium",
    primarySkillId: null,
    secondarySkillIds: [],
    cognitiveTags: [],
  };
}
export function addQuestionLocale(
  d: AdminQuestionDraft,
  l: Locale,
): AdminQuestionDraft {
  const template = d.content[d.defaultContentLocale]!;
  return {
    ...d,
    content: {
      ...d.content,
      [l]: {
        prompt: "",
        ...(template.options
          ? { options: template.options.map((o) => ({ id: o.id, label: "" })) }
          : {}),
        ...(template.items
          ? { items: template.items.map((o) => ({ id: o.id, label: "" })) }
          : {}),
      },
    },
    gradingDefinition:
      d.gradingDefinition.type === "short_text"
        ? {
            ...d.gradingDefinition,
            acceptedByLocale: {
              ...d.gradingDefinition.acceptedByLocale,
              [l]: [""],
            },
          }
        : d.gradingDefinition,
  };
}
export function removeQuestionLocale(
  d: AdminQuestionDraft,
  l: Locale,
): AdminQuestionDraft {
  const next = structuredClone(d);
  delete next.content[l];
  delete next.explanation[l];
  if (next.gradingDefinition.type === "short_text")
    delete next.gradingDefinition.acceptedByLocale[l];
  if (next.defaultContentLocale === l)
    next.defaultContentLocale = localesOf(next.content)[0];
  return next;
}
export function normalizedText(
  s: string,
  g: Extract<AdminQuestionDraft["gradingDefinition"], { type: "short_text" }>,
) {
  let v = s.replace(/\r\n?/g, "\n").normalize("NFC");
  if (g.normalizer.collapseWhitespace) v = v.replace(/\s+/gu, " ");
  if (g.normalizer.trim) v = v.trim();
  if (g.normalizer.caseFold) v = v.toLowerCase();
  return v.normalize("NFC");
}
export function questionIssues(d: AdminQuestionDraft): string[] {
  const e: string[] = [],
    ls = localesOf(d.content),
    g = d.gradingDefinition;
  if (!d.content[d.defaultContentLocale] || !ls.length) e.push("locales");
  if (g.type !== d.type) e.push("key");
  const skillIds = [d.primarySkillId, ...d.secondarySkillIds].filter(
    (x): x is string => !!x,
  );
  if (
    skillIds.some((x) => !uuid.test(x)) ||
    new Set(skillIds).size !== skillIds.length ||
    d.secondarySkillIds.length > 20
  )
    e.push("skills");
  if (
    !Number.isInteger(d.defaultPoints) ||
    d.defaultPoints < 1 ||
    d.defaultPoints > 1000
  )
    e.push("points");
  let parity: string | undefined;
  for (const l of ls) {
    const c = d.content[l]!,
      labels = c.options ?? c.items ?? [],
      ids = labels.map((o) => o.id);
    if (
      !c.prompt.trim() ||
      c.prompt.length > 20000 ||
      !restricted(c.prompt) ||
      (c.code && (!c.code.source.length || c.code.source.length > 20000))
    )
      e.push("content");
    if (
      (d.type.includes("choice") || d.type === "ordering") &&
      (labels.length < 2 ||
        labels.length > 20 ||
        new Set(ids).size !== ids.length ||
        labels.some(
          (o) =>
            !uuid.test(o.id) ||
            !o.label.trim() ||
            o.label.length > 20000 ||
            !restricted(o.label),
        ))
    )
      e.push("options");
    const set = JSON.stringify([...ids].sort());
    if (parity !== undefined && parity !== set) e.push("parity");
    parity = set;
    if (g.type === "single_choice" && !ids.includes(g.correctOptionId))
      e.push("key");
    if (
      g.type === "multiple_choice" &&
      (!g.correctOptionIds.length ||
        new Set(g.correctOptionIds).size !== g.correctOptionIds.length ||
        g.correctOptionIds.some((x) => !ids.includes(x)))
    )
      e.push("key");
    if (
      g.type === "ordering" &&
      (g.correctOrderedItemIds.length !== ids.length ||
        JSON.stringify([...g.correctOrderedItemIds].sort()) !== set)
    )
      e.push("key");
    if (g.type === "short_text") {
      const a = g.acceptedByLocale[l] ?? [],
        n = a.map((v) => normalizedText(v, g));
      if (
        !a.length ||
        a.length > 20 ||
        a.some((v) => v.length > 2000) ||
        n.some((v) => !v.length) ||
        new Set(n).size !== n.length
      )
        e.push("variants");
    }
    const ex = d.explanation[l] ?? "";
    if (ex.length > 20000 || !restricted(ex)) e.push("explanation");
  }
  if (
    bytes(d.content) > 90000 ||
    bytes(g) > 45000 ||
    bytes(d.explanation) > 45000
  )
    e.push("size");
  return [...new Set(e)];
}
