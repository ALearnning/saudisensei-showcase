import { z } from "zod";

export const localeSchema = z.enum(["ar", "en"]);
export const questionTypeSchema = z.enum(["single_choice", "multiple_choice", "true_false", "short_text", "ordering"]);
const id = z.string().min(1).max(100);
const uniqueIds = (minimum: number) => z.array(id).min(minimum).max(20)
  .refine((ids) => new Set(ids).size === ids.length, "IDs must be unique");
export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single_choice"), optionId: id }).strict(),
  z.object({ type: z.literal("multiple_choice"), optionIds: uniqueIds(1) }).strict(),
  z.object({ type: z.literal("true_false"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("short_text"), text: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("ordering"), orderedItemIds: uniqueIds(2) }).strict(),
]);
export type Answer = z.infer<typeof answerSchema>;
export const savedAnswerSchema = z.object({
  attemptQuestionId: id, answerRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  answer: answerSchema.nullable(),
}).strict();

// Never merge this state with answer state or interpret it as engagement.
export const reviewFlagSchema = z.object({
  attemptQuestionId: id, isFlagged: z.boolean(),
  flagRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

const labelSchema = z.object({ id, label: z.string().min(1).max(20000) }).strict();
const codeSchema = z.object({ language: z.literal("java"), source: z.string().min(1).max(20000) }).strict();
export const studentQuestionSchema = z.object({
  attemptQuestionId: id,
  type: questionTypeSchema,
  locale: localeSchema,
  prompt: z.string().min(1).max(20000),
  code: codeSchema.optional(),
  options: z.array(labelSchema).min(2).max(20).optional(),
  items: z.array(labelSchema).min(2).max(20).optional(),
  position: z.number().int().min(0).max(99),
  points: z.number().int().min(1).max(1000),
}).strict().superRefine((question, ctx) => {
  const choices = question.type === "single_choice" || question.type === "multiple_choice";
  if (choices !== (question.options !== undefined) || (question.type === "ordering") !== (question.items !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Presentation fields must match question type" });
  }
  for (const labels of [question.options, question.items]) {
    if (labels && new Set(labels.map((label) => label.id)).size !== labels.length) {
      ctx.addIssue({ code: "custom", message: "Presentation IDs must be unique" });
    }
  }
});
export type StudentQuestion = z.infer<typeof studentQuestionSchema>;

/** Structural validation, not a grading engine. Null is an explicit clear. */
export function validateAnswerForQuestion(questionInput: StudentQuestion, input: unknown): Answer | null {
  const question = studentQuestionSchema.parse(questionInput);
  const answer = answerSchema.nullable().parse(input);
  if (answer === null) return null;
  if (answer.type !== question.type) throw new Error("ANSWER_TYPE_MISMATCH");
  const options = new Set(question.options?.map((option) => option.id));
  if (answer.type === "single_choice" && !options.has(answer.optionId)) throw new Error("UNKNOWN_OPTION");
  if (answer.type === "multiple_choice" && answer.optionIds.some((option) => !options.has(option))) throw new Error("UNKNOWN_OPTION");
  if (answer.type === "ordering") {
    const items = new Set(question.items?.map((item) => item.id));
    if (answer.orderedItemIds.length !== items.size || answer.orderedItemIds.some((item) => !items.has(item))) {
      throw new Error("ORDERING_REQUIRES_FULL_PERMUTATION");
    }
  }
  return answer;
}

// Server-private: deliberately absent from OpenAPI, SDKs and public facade.
const normalizerSchema = z.object({
  version: z.literal(1), unicode: z.literal("NFC"), lineEndings: z.literal("LF"),
  trim: z.boolean(), collapseWhitespace: z.boolean(), caseFold: z.boolean(),
}).strict();
const acceptedStrings = z.array(z.string().min(1).max(2000)).min(1).max(20);
export const gradingDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single_choice"), correctOptionId: id }).strict(),
  z.object({ type: z.literal("multiple_choice"), correctOptionIds: uniqueIds(1) }).strict(),
  z.object({ type: z.literal("true_false"), correctValue: z.boolean() }).strict(),
  z.object({
    type: z.literal("short_text"), normalizer: normalizerSchema,
    acceptedByLocale: z.object({ ar: acceptedStrings.optional(), en: acceptedStrings.optional() }).strict()
      .refine((value) => value.ar !== undefined || value.en !== undefined, "At least one authored locale is required"),
  }).strict(),
  z.object({ type: z.literal("ordering"), correctOrderedItemIds: uniqueIds(2) }).strict(),
]);
export type GradingDefinition = z.infer<typeof gradingDefinitionSchema>;

/** Validates a sealed selected-locale definition; does not evaluate an answer. */
export function validateGradingDefinitionForQuestion(questionInput: StudentQuestion, input: unknown): GradingDefinition {
  const question = studentQuestionSchema.parse(questionInput);
  const definition = gradingDefinitionSchema.parse(input);
  if (definition.type !== question.type) throw new Error("GRADING_TYPE_MISMATCH");
  if (definition.type === "short_text") {
    if (!definition.acceptedByLocale[question.locale]) throw new Error("MISSING_ACCEPTED_LOCALE");
    return definition;
  }
  const keyAnswer = definition.type === "single_choice"
    ? { type: definition.type, optionId: definition.correctOptionId }
    : definition.type === "multiple_choice"
      ? { type: definition.type, optionIds: definition.correctOptionIds }
      : definition.type === "ordering"
        ? { type: definition.type, orderedItemIds: definition.correctOrderedItemIds }
        : { type: definition.type, value: definition.correctValue };
  validateAnswerForQuestion(question, keyAnswer);
  return definition;
}

/** Explicit nested allowlists: never spread ORM/revision payloads into a DTO. */
export function projectStudentQuestion(source: StudentQuestion): StudentQuestion {
  const result = {
    attemptQuestionId: source.attemptQuestionId, type: source.type, locale: source.locale,
    prompt: source.prompt, position: source.position, points: source.points,
    code: source.code === undefined ? undefined : { language: source.code.language, source: source.code.source },
    options: source.options?.map((option) => ({ id: option.id, label: option.label })),
    items: source.items?.map((item) => ({ id: item.id, label: item.label })),
  };
  return studentQuestionSchema.parse(result);
}
