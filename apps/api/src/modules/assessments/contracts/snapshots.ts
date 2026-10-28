import { z } from "zod";
import type { QuizPolicy, DeadlineSnapshot } from "./policy.js";
import type { GradingDefinition, StudentQuestion, Answer } from "./questions.js";

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type AttemptState = "IN_PROGRESS" | "SUBMITTED" | "AUTO_SUBMITTED" | "GRADED";
export type DerivedAttemptState = "NOT_STARTED" | AttemptState;
export type CognitiveTag = "concept" | "code_tracing" | "debugging" | "problem_solving" | "implementation";
export type SkillSnapshot = DeepReadonly<{
  skillId: string; key: string; slug: string; parentId: string | null;
  translations: { locale: "ar" | "en"; name: string }[];
  ancestorIds: string[];
  role: "primary" | "secondary";
}>;
// A bank revision exists before any quiz attempt: attempt IDs, shuffled
// positions and quiz-specific point overrides cannot be part of its content.
export type QuestionPresentationSnapshot = DeepReadonly<
  Omit<StudentQuestion, "attemptQuestionId" | "position" | "points">
>;
export type QuestionRevisionSnapshot = DeepReadonly<{
  questionId: string; questionRevisionId: string; version: number;
  defaultLocale: "ar" | "en";
  presentations: QuestionPresentationSnapshot[];
  gradingDefinition: GradingDefinition;
  explanations: { ar?: string; en?: string };
  skills: SkillSnapshot[];
  cognitiveTags: CognitiveTag[];
  graderVersion: string;
}>;
export type QuizRevisionSnapshot = DeepReadonly<{
  quizId: string; quizRevisionId: string; courseId: string; version: number;
  policy: QuizPolicy;
  items: { quizRevisionItemId: string; questionRevisionId: string; position: number; points: number }[];
}>;
export type AttemptSnapshot = DeepReadonly<{
  attemptId: string; quizRevisionId: string; userId: string; enrollmentId: string;
  attemptNumber: number; selectedLocale: "ar" | "en"; deadline: DeadlineSnapshot;
  policy: QuizPolicy;
  questions: { attemptQuestionId: string; quizRevisionItemId: string; questionRevisionId: string }[];
}>;
export type FinalAnswerSnapshot = DeepReadonly<{
  attemptQuestionId: string; answer: Answer | null; answerRevision: number;
}>;

export const responseEvidenceStateSchema = z.enum([
  "correct_answered", "incorrect_answered", "unanswered_viewed", "unanswered_unviewed",
]);
// Data vocabulary only. No telemetry collection or classification algorithms.
export const evidenceContextSchema = z.object({
  responseState: responseEvidenceStateSchema,
  hasRecordedView: z.boolean(),
  observationQuality: z.enum(["complete", "partial", "unknown"]),
  finalizationReason: z.enum(["voluntary_submission", "time_limit", "availability_close", "both"]),
}).strict().superRefine((value, ctx) => {
  if ((value.responseState === "unanswered_viewed" && !value.hasRecordedView)
    || (value.responseState === "unanswered_unviewed" && value.hasRecordedView)) {
    ctx.addIssue({ code: "custom", message: "Unanswered evidence state must match recorded view" });
  }
});
export type EvidenceContext = Readonly<z.infer<typeof evidenceContextSchema>>;
