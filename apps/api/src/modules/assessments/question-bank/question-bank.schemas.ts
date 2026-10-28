import { z } from "zod";
import { markdownIsRestricted, uuid } from "../../courses/lms.schemas.js";
import { gradingDefinitionSchema, localeSchema, questionTypeSchema, validateGradingDefinitionForQuestion } from "../contracts/questions.js";
import type { GradingDefinition } from "../contracts/questions.js";

export const cognitiveTagSchema = z.enum(["concept", "code_tracing", "debugging", "problem_solving", "implementation"]);
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
const revision = z.number().int().min(0).max(2147483646);
// Reuse the LMS Markdown policy, additionally excluding links (including
// reference/encoded links). Code is inert plain text, never Markdown or executed.
const markdown = z.string().max(20000).refine(markdownIsRestricted)
  .refine(s => !/\]\s*(?:\(|\[|:)|^\s*\[[^\]]+\]:/m.test(s), "Links are not supported");
const nonempty = markdown.refine(s => s.trim().length > 0);
const label = z.object({ id: uuid, label: nonempty }).strict();
export const localizedQuestionContentSchema = z.object({
  prompt: nonempty,
  code: z.object({ language: z.literal("java"), source: z.string().min(1).max(20000) }).strict().optional(),
  options: z.array(label).min(2).max(20).optional(),
  items: z.array(label).min(2).max(20).optional(),
}).strict();
type Normalizer = Extract<GradingDefinition, { type: "short_text" }>["normalizer"];
/** v1 uses locale-independent Unicode lowercase when explicitly requested.
 * No compatibility folding, punctuation removal or Arabic transformations. */
export function normalizeShortText(text: string, policy: Normalizer): string {
  let result = text.replace(/\r\n?/g, "\n").normalize("NFC");
  if (policy.collapseWhitespace) result = result.replace(/\s+/gu, " ");
  if (policy.trim) result = result.trim();
  if (policy.caseFold) result = result.toLowerCase();
  return result.normalize("NFC");
}

// Drafts allow missing primary skill only, not incomplete/unsafe answer content.
// Complete validation is repeated at sealing, never trusted from an earlier save.
export const questionDraftSchema = z.object({
  type: questionTypeSchema,
  defaultContentLocale: localeSchema,
  content: z.object({ ar: localizedQuestionContentSchema.optional(), en: localizedQuestionContentSchema.optional() }).strict(),
  gradingDefinition: gradingDefinitionSchema,
  explanation: z.object({ ar: markdown.optional(), en: markdown.optional() }).strict(),
  defaultPoints: z.number().int().min(1).max(1000),
  difficulty: difficultySchema,
  primarySkillId: uuid.nullable(),
  secondarySkillIds: z.array(uuid).max(20),
  cognitiveTags: z.array(cognitiveTagSchema).max(5),
}).strict().superRefine((draft, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!draft.content[draft.defaultContentLocale]) invalid("Default locale must be authored");
  const ids = [draft.primarySkillId, ...draft.secondarySkillIds].filter(x => x !== null);
  if (new Set(ids).size !== ids.length) invalid("Skills must be unique");
  if (new Set(draft.cognitiveTags).size !== draft.cognitiveTags.length) invalid("Tags must be unique");
  let keys: string | undefined;
  for (const locale of ["ar", "en"] as const) {
    const content = draft.content[locale];
    if (!content) {
      if (draft.explanation[locale] !== undefined ||
        (draft.gradingDefinition.type === "short_text" && draft.gradingDefinition.acceptedByLocale[locale])) invalid("Unauthored locale");
      continue;
    }
    try {
      validateGradingDefinitionForQuestion({
        ...content, type: draft.type, locale, attemptQuestionId: "authoring", position: 0, points: draft.defaultPoints,
      }, draft.gradingDefinition);
    } catch { invalid("Invalid presentation or grading definition"); }
    const localeKeys = JSON.stringify((content.options ?? content.items ?? []).map(x => x.id).sort());
    if (keys !== undefined && keys !== localeKeys) invalid("Translation IDs must match");
    keys = localeKeys;
    if (draft.gradingDefinition.type === "short_text") {
      const definition = draft.gradingDefinition;
      const variants = definition.acceptedByLocale[locale] ?? [];
      const normalized = variants.map(v => normalizeShortText(v, definition.normalizer));
      if (normalized.some(v => !v.length) || new Set(normalized).size !== normalized.length) invalid("Normalized variants must be nonempty and unique");
    }
  }
  // Conservative UTF-8 JSON budgets include room for PostgreSQL jsonb spacing
  // and sealed content metadata. Never let a SQL check become a user-facing 500.
  for (const [value, limit] of [[draft.content, 90000], [draft.gradingDefinition, 45000], [draft.explanation, 45000]] as const) {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > limit) invalid("Content byte budget exceeded");
  }
});
export type QuestionDraftInput = z.infer<typeof questionDraftSchema>;
export const questionCreateSchema = z.object({ draft: questionDraftSchema }).strict();
export const questionEditSchema = z.object({ expectedRevision: revision, draft: questionDraftSchema }).strict();
export const questionRevisionInputSchema = z.object({ expectedRevision: revision }).strict();
export const questionPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export const questionListSchema = questionPaginationSchema.extend({
  status: z.enum(["active", "archived"]).optional(), type: questionTypeSchema.optional(),
  primarySkillId: uuid.optional(), cognitiveTag: cognitiveTagSchema.optional(),
  difficulty: difficultySchema.optional(), locale: localeSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
}).strict();
