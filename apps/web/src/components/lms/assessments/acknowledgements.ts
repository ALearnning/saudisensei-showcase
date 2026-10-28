import type {
  AdminQuestionDetail,
  AdminQuestionDraft,
  AdminSkillView,
  AdminSkillDetail,
  AdminQuizDetail,
  AdminQuizReviewRelease,
} from "@workspace/saudisensei-api-client";
import { uuid, questionTypes, questionIssues, type Scope } from "./model";
import { isQuizDetailResponse } from "./quiz-response";

export const invalidAcknowledgement = {
  status: 502,
  code: "INVALID_RESPONSE",
} as const;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
const text = (v: unknown): v is string => typeof v === "string";
const number = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const locale = (v: unknown): v is "ar" | "en" => v === "ar" || v === "en";
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(text);
const localized = (v: unknown, check: (value: unknown) => boolean) =>
  object(v) && ["ar", "en"].every((l) => v[l] === undefined || check(v[l]));
const labels = (v: unknown) =>
  v === undefined ||
  (Array.isArray(v) && v.every((o) => object(o) && id(o.id) && text(o.label)));

// Validate fields the editor will adopt, not just the HTTP status. These guards
// neither compute grades nor replace server-side eligibility/policy decisions.
export function isQuestionDraft(v: unknown): v is AdminQuestionDraft {
  if (
    !object(v) ||
    !questionTypes.some((t) => t === v.type) ||
    !locale(v.defaultContentLocale) ||
    !object(v.content) ||
    !object(v.content[v.defaultContentLocale]) ||
    !localized(
      v.content,
      (c) =>
        object(c) &&
        text(c.prompt) &&
        labels(c.options) &&
        labels(c.items) &&
        (c.code === undefined ||
          (object(c.code) &&
            c.code.language === "java" &&
            text(c.code.source))),
    ) ||
    !localized(v.explanation, text) ||
    !number(v.defaultPoints, 1) ||
    v.defaultPoints > 1000 ||
    !["easy", "medium", "hard"].some((d) => d === v.difficulty) ||
    !(v.primarySkillId === null || id(v.primarySkillId)) ||
    !Array.isArray(v.secondarySkillIds) ||
    !v.secondarySkillIds.every(id) ||
    !strings(v.cognitiveTags) ||
    v.cognitiveTags.length > 5 ||
    !v.cognitiveTags.every((tag) =>
      [
        "concept",
        "code_tracing",
        "debugging",
        "problem_solving",
        "implementation",
      ].includes(tag),
    ) ||
    !object(v.gradingDefinition) ||
    v.gradingDefinition.type !== v.type
  )
    return false;
  const g = v.gradingDefinition;
  const validKey = (() => {
    switch (g.type) {
      case "single_choice":
        return text(g.correctOptionId);
      case "multiple_choice":
        return strings(g.correctOptionIds);
      case "true_false":
        return typeof g.correctValue === "boolean";
      case "ordering":
        return strings(g.correctOrderedItemIds);
      case "short_text":
        return (
          object(g.normalizer) &&
          g.normalizer.version === 1 &&
          g.normalizer.unicode === "NFC" &&
          g.normalizer.lineEndings === "LF" &&
          ["trim", "collapseWhitespace", "caseFold"].every(
            (k) =>
              typeof (g.normalizer as Record<string, unknown>)[k] === "boolean",
          ) &&
          localized(g.acceptedByLocale, strings)
        );
      default:
        return false;
    }
  })();
  return (
    validKey && questionIssues(v as unknown as AdminQuestionDraft).length === 0
  );
}
export function isQuestionDetail(
  v: unknown,
  current?: AdminQuestionDetail,
  saved = false,
): v is AdminQuestionDetail {
  return (
    object(v) &&
    id(v.id) &&
    (!current || v.id === current.id) &&
    number(v.editRevision, current?.editRevision ?? 0) &&
    (!saved || v.editRevision === (current ? current.editRevision + 1 : 0)) &&
    (v.status === "active" || v.status === "archived") &&
    (v.currentRevisionId === null || id(v.currentRevisionId)) &&
    date(v.createdAt) &&
    isQuestionDraft(v.draft)
  );
}
export function isSkillView(
  v: unknown,
  current?: AdminSkillView,
  saved = false,
): v is AdminSkillView {
  return (
    object(v) &&
    id(v.id) &&
    (!current || v.id === current.id) &&
    number(v.editRevision, current?.editRevision ?? 0) &&
    (!saved || v.editRevision === (current ? current.editRevision + 1 : 0)) &&
    (v.status === "active" || v.status === "archived") &&
    text(v.slug) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug) &&
    v.slug.length <= 160 &&
    (v.parentId === null || id(v.parentId)) &&
    date(v.createdAt) &&
    object(v.translations) &&
    (v.translations.ar !== undefined || v.translations.en !== undefined) &&
    localized(
      v.translations,
      (t) =>
        object(t) &&
        text(t.label) &&
        !!t.label.trim() &&
        t.label.length <= 255 &&
        text(t.description) &&
        t.description.length <= 2000,
    )
  );
}
export function isSkillDetail(
  v: unknown,
  current: AdminSkillDetail,
): v is AdminSkillDetail {
  return (
    isSkillView(v, current) &&
    "ancestors" in v &&
    Array.isArray(v.ancestors) &&
    v.ancestors.length <= 7 &&
    v.ancestors.every((a) => isSkillView(a))
  );
}
export function isCreatedQuiz(
  v: unknown,
  scope: Scope,
  parent: string,
): v is AdminQuizDetail {
  if (
    !object(v) ||
    !id(v.id) ||
    !id(v.courseId) ||
    v.parentType !== scope.slice(0, -1) ||
    v.parentId !== parent ||
    !(v.chapterId === null || id(v.chapterId)) ||
    !(v.lessonId === null || id(v.lessonId)) ||
    (scope === "courses" &&
      (v.courseId !== parent || v.chapterId !== null || v.lessonId !== null)) ||
    (scope === "chapters" && (v.chapterId !== parent || v.lessonId !== null)) ||
    (scope === "lessons" && v.lessonId !== parent) ||
    v.status !== "draft" ||
    v.currentRevisionId !== null ||
    !Array.isArray(v.items) ||
    v.items.length !== 0
  )
    return false;
  // Identity has been checked above; delegate consumed draft/item shape to E-1
  // without changing its approved save/recovery implementation.
  return isQuizDetailResponse(
    v,
    { ...v, editRevision: 0 } as AdminQuizDetail,
    0,
  );
}
// Seal/publish only adopt these receipt fields; immutable content remains behind
// the existing explicit revision reads. Do not cast an unchecked full revision.
type RevisionReceipt = { id: string; number: number; createdAt: string };
const revisionReceipt = (v: unknown): v is RevisionReceipt =>
  object(v) && id(v.id) && number(v.number, 1) && date(v.createdAt);
export function isSealedQuestion(
  v: unknown,
  current: AdminQuestionDetail,
): v is {
  editRevision: number;
  revision: RevisionReceipt & { questionId: string };
} {
  return (
    object(v) &&
    v.editRevision === current.editRevision + 1 &&
    revisionReceipt(v.revision) &&
    "questionId" in v.revision &&
    v.revision.questionId === current.id
  );
}
export function isPublishedQuiz(
  v: unknown,
  current: AdminQuizDetail,
): v is {
  editRevision: number;
  revision: RevisionReceipt & { quizId: string; courseId: string };
} {
  return (
    object(v) &&
    v.editRevision === current.editRevision + 1 &&
    revisionReceipt(v.revision) &&
    "quizId" in v.revision &&
    v.revision.quizId === current.id &&
    "courseId" in v.revision &&
    v.revision.courseId === current.courseId
  );
}
export function isReleaseReceipt(
  v: unknown,
  revision: string,
): v is AdminQuizReviewRelease {
  return (
    object(v) &&
    v.quizRevisionId === revision &&
    id(v.quizRevisionId) &&
    date(v.releasedAt)
  );
}
export function isReleaseStatus(
  v: unknown,
  revision: string,
): v is { id: string; reviewRelease: AdminQuizReviewRelease | null } {
  return (
    object(v) &&
    v.id === revision &&
    (v.reviewRelease === null || isReleaseReceipt(v.reviewRelease, revision))
  );
}
