import { z } from "zod";

export const visibilitySchema = z.enum(["never", "after_grading", "after_attempt_limit", "manual_release"]);
const instant = z.string().datetime();
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Manual release and exhaustion are independent events, not ordinal enum values.
// A dependent field can share its prerequisite's condition, be withheld, or
// follow after_grading. No other ordering between conditions is guaranteed.
export function visibilityWithin(
  prerequisite: z.infer<typeof visibilitySchema>,
  dependent: z.infer<typeof visibilitySchema>,
): boolean {
  return dependent === "never" || dependent === prerequisite || prerequisite === "after_grading";
}
export const explanationWithinReview = visibilityWithin;

export const quizPolicySchema = z.object({
  version: z.literal(1),
  mode: z.enum(["practice", "graded"]),
  required: z.boolean(),
  passBasisPoints: z.number().int().min(0).max(10000),
  maxAttempts: positiveInteger.nullable(),
  timeLimitSeconds: z.number().int().min(60).max(10800).nullable(),
  opensAt: instant.nullish(),
  closesAt: instant.nullish(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  scoreVisibility: visibilitySchema,
  reviewVisibility: visibilitySchema,
  explanationVisibility: visibilitySchema,
  aiAnalysisEnabled: z.boolean(),
}).strict().superRefine((policy, ctx) => {
  if (policy.opensAt && policy.closesAt && Date.parse(policy.opensAt) >= Date.parse(policy.closesAt)) {
    ctx.addIssue({ code: "custom", path: ["closesAt"], message: "closesAt must be strictly after opensAt" });
  }
  for (const field of ["scoreVisibility", "reviewVisibility", "explanationVisibility"] as const) {
    if (policy.maxAttempts === null && policy[field] === "after_attempt_limit") {
      ctx.addIssue({ code: "custom", path: [field], message: "Attempt-limit visibility requires finite maxAttempts" });
    }
  }
  if (!explanationWithinReview(policy.reviewVisibility, policy.explanationVisibility)) {
    ctx.addIssue({ code: "custom", path: ["explanationVisibility"], message: "Explanation cannot release before review" });
  }
});

export type QuizPolicy = Readonly<z.infer<typeof quizPolicySchema>>;
export type DeadlineReason = "time_limit" | "availability_close" | "both";
export type DeadlineSnapshot = Readonly<{
  startedAt: string;
  opensAt: string | null;
  closesAt: string | null;
  timeLimitSeconds: number | null;
  deadlineAt: string | null;
  deadlineReason: DeadlineReason | null;
}>;

/** Pure snapshot calculation only: no starts, persistence, locks or finalization. */
export function calculateDeadline(policyInput: QuizPolicy, serverStartedAt: string): DeadlineSnapshot {
  const policy = quizPolicySchema.parse(policyInput);
  const startedAt = instant.parse(serverStartedAt);
  const start = Date.parse(startedAt);
  if (policy.opensAt && start < Date.parse(policy.opensAt)) throw new Error("QUIZ_NOT_OPEN");
  if (policy.closesAt && start >= Date.parse(policy.closesAt)) throw new Error("QUIZ_CLOSED");
  const durationEnd = policy.timeLimitSeconds === null ? null : start + policy.timeLimitSeconds * 1000;
  if (durationEnd !== null && (!Number.isSafeInteger(durationEnd) || Math.abs(durationEnd) > 8.64e15)) {
    throw new Error("INVALID_DEADLINE");
  }
  const closure = policy.closesAt ? Date.parse(policy.closesAt) : null;
  const end = durationEnd === null ? closure : closure === null ? durationEnd : Math.min(durationEnd, closure);
  const reason: DeadlineReason | null = end === null ? null
    : durationEnd === closure ? "both"
    : end === closure ? "availability_close" : "time_limit";
  return Object.freeze({
    startedAt: new Date(start).toISOString(),
    opensAt: policy.opensAt ?? null,
    closesAt: policy.closesAt ?? null,
    timeLimitSeconds: policy.timeLimitSeconds,
    deadlineAt: end === null ? null : new Date(end).toISOString(),
    deadlineReason: reason,
  });
}
