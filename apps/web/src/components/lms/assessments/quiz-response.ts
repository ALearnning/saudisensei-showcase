import type { AdminQuizDetail } from "@workspace/saudisensei-api-client";
import { uuid, visibility } from "./model";

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "string" && uuid.test(v);
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const locale = (v: unknown): v is "ar" | "en" => v === "ar" || v === "en";

// A successful HTTP status is not a usable acknowledgement. Validate the
// existing detail contract before it can replace any local authoring state.
// The server advances each section write exactly once; a recovery read can
// legitimately return either the old state or a later committed revision.
export function isQuizDetailResponse(
  value: unknown,
  current: AdminQuizDetail,
  savedRevision?: number,
): value is AdminQuizDetail {
  if (!object(value)) return false;
  for (const key of [
    "id",
    "courseId",
    "parentType",
    "parentId",
    "chapterId",
    "lessonId",
  ] as const)
    if (value[key] !== current[key]) return false;
  if (
    (value.status !== "draft" &&
      value.status !== "published" &&
      value.status !== "archived") ||
    !integer(value.editRevision, current.editRevision) ||
    (savedRevision !== undefined && value.editRevision !== savedRevision) ||
    !(value.currentRevisionId === null || id(value.currentRevisionId)) ||
    !date(value.createdAt)
  )
    return false;
  const draft = value.draft;
  if (
    !object(draft) ||
    !locale(draft.defaultContentLocale) ||
    !object(draft.content) ||
    !object(draft.content[draft.defaultContentLocale])
  )
    return false;
  for (const language of ["ar", "en"] as const) {
    const content = draft.content[language];
    if (
      content !== undefined &&
      (!object(content) ||
        typeof content.title !== "string" ||
        typeof content.instructions !== "string")
    )
      return false;
  }
  const policy = draft.policy;
  if (
    !object(policy) ||
    policy.version !== 1 ||
    (policy.mode !== "practice" && policy.mode !== "graded") ||
    !integer(policy.passBasisPoints, 0, 10000) ||
    !(policy.maxAttempts === null || integer(policy.maxAttempts, 1)) ||
    !(
      policy.timeLimitSeconds === null ||
      integer(policy.timeLimitSeconds, 60, 10800)
    ) ||
    ![
      "required",
      "shuffleQuestions",
      "shuffleOptions",
      "aiAnalysisEnabled",
    ].every((key) => typeof policy[key] === "boolean") ||
    !["scoreVisibility", "reviewVisibility", "explanationVisibility"].every(
      (key) => visibility.some((v) => v === policy[key]),
    ) ||
    !["opensAt", "closesAt"].every(
      (key) => policy[key] == null || date(policy[key]),
    )
  )
    return false;
  return (
    Array.isArray(value.items) &&
    value.items.length <= 100 &&
    value.items.every(
      (item) =>
        object(item) &&
        id(item.id) &&
        id(item.questionId) &&
        id(item.questionRevisionId) &&
        integer(item.position, 0, 99) &&
        integer(item.points, 1, 1000),
    )
  );
}
