import { z } from "zod";
import { markdownIsRestricted, uuid } from "../../courses/lms.schemas.js";
import { quizPolicySchema, visibilityWithin } from "../contracts/policy.js";

export const quizScopeSchema = z.enum(["courses", "chapters", "lessons"]);
const revision = z.number().int().min(0).max(2147483646);
const markdown = z.string().max(20000).refine(markdownIsRestricted)
  .refine(s => !/\]\s*(?:\(|\[|:)|^\s*\[[^\]]+\]:/m.test(s), "Links are not supported");
export const quizLocalizedContentSchema = z.object({
  title: z.string().trim().min(1).max(255).refine(markdownIsRestricted),
  instructions: markdown,
}).strict();
// Defaults are applied only to omitted fields; explicit false/null remain meaningful.
export const quizPolicyInputSchema = z.object({
  version: z.literal(1).default(1),
  mode: z.enum(["practice", "graded"]),
  required: z.boolean().optional(), passBasisPoints: z.number().int().min(0).max(10000).optional(),
  maxAttempts: z.number().int().min(1).max(2147483647).nullable().optional(),
  timeLimitSeconds: z.number().int().min(60).max(10800).nullable().optional(),
  opensAt: z.string().datetime().nullable().optional(), closesAt: z.string().datetime().nullable().optional(),
  shuffleQuestions: z.boolean().optional(), shuffleOptions: z.boolean().optional(),
  scoreVisibility: z.enum(["never", "after_grading", "after_attempt_limit", "manual_release"]).optional(),
  reviewVisibility: z.enum(["never", "after_grading", "after_attempt_limit", "manual_release"]).optional(),
  explanationVisibility: z.enum(["never", "after_grading", "after_attempt_limit", "manual_release"]).optional(),
  aiAnalysisEnabled: z.boolean().optional(),
}).strict().transform(p => ({
  required: false, passBasisPoints: 7000, maxAttempts: p.mode === "practice" ? null : 1,
  timeLimitSeconds: null, opensAt: null, closesAt: null, shuffleQuestions: false, shuffleOptions: false,
  scoreVisibility: "after_grading" as const,
  reviewVisibility: p.mode === "practice" ? "after_grading" as const : "manual_release" as const,
  explanationVisibility: p.mode === "practice" ? "after_grading" as const : "manual_release" as const,
  aiAnalysisEnabled: false, ...p,
})).pipe(quizPolicySchema).superRefine((policy, ctx) => {
  // Authoring/publication only: historical revisions retain their original
  // policies and are gated by the result/review service on every read.
  if (!visibilityWithin(policy.scoreVisibility, policy.reviewVisibility)) {
    ctx.addIssue({ code: "custom", path: ["reviewVisibility"], message: "Review cannot release before score" });
  }
});
export const quizDraftSchema = z.object({
  defaultContentLocale: z.enum(["ar", "en"]),
  content: z.object({ ar: quizLocalizedContentSchema.optional(), en: quizLocalizedContentSchema.optional() }).strict(),
  policy: quizPolicyInputSchema,
}).strict().superRefine((d, ctx) => {
  if (!d.content[d.defaultContentLocale]) ctx.addIssue({ code: "custom", message: "Default locale must be authored" });
  if (Buffer.byteLength(JSON.stringify(d.content)) > 90000) ctx.addIssue({ code: "custom", message: "Content byte budget exceeded" });
});
export const quizCreateSchema = z.object({ draft: quizDraftSchema }).strict();
export const quizEditSchema = z.object({ expectedRevision: revision, draft: quizDraftSchema }).strict();
export const quizMutationSchema = z.object({ expectedRevision: revision }).strict();
export const quizItemSchema = z.object({
  questionId: uuid, questionRevisionId: uuid, position: z.number().int().min(0).max(99),
  points: z.number().int().min(1).max(1000).optional(),
}).strict();
export const quizItemsSchema = z.object({
  expectedRevision: revision, items: z.array(quizItemSchema).max(100),
}).strict().superRefine(({ items }, ctx) => {
  if (new Set(items.map(i => i.questionId)).size !== items.length ||
    new Set(items.map(i => i.position)).size !== items.length ||
    items.some((_, index) => !items.some(i => i.position === index))) {
    ctx.addIssue({ code: "custom", message: "Unique question lineages and contiguous zero-based positions required" });
  }
});
export const quizPreviewSchema = z.object({ expectedRevision: revision, locale: z.enum(["ar", "en"]) }).strict();
export const quizReleaseSchema = z.object({ clientMutationId: uuid }).strict();
export const quizPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const quizListSchema = quizPaginationSchema.extend({
  status: z.enum(["draft", "published", "archived"]).optional(),
  mode: z.enum(["practice", "graded"]).optional(),
  required: z.enum(["true", "false"]).optional(), locale: z.enum(["ar", "en"]).optional(),
}).strict();
export type QuizDraftInput = z.output<typeof quizDraftSchema>;
export type QuizItemInput = z.infer<typeof quizItemSchema>;
