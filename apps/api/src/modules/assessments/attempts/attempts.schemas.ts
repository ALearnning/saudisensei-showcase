import { z } from "zod";
import { uuid } from "../../courses/lms.schemas.js";
import { answerSchema } from "../contracts/questions.js";

export const scopeSchema = z.enum(["courses", "chapters", "lessons"]);
export const startSchema = z.object({
  clientMutationId: uuid, requestedContentLocale: z.enum(["ar", "en"]),
}).strict();
/** Stable, bounded start response. Fetch GET resume for the current authorized view. */
export const startReceiptSchema = z.object({ attemptId: uuid }).strict();
export type StartReceipt = z.infer<typeof startReceiptSchema>;
export const changeSchema = z.object({
  attemptQuestionId: uuid, expectedAnswerRevision: z.number().int().min(0).max(2147483646),
  answer: answerSchema.nullable(),
}).strict();
const changes = (minimum = 0) => z.array(changeSchema).min(minimum).max(10).refine(v => new Set(v.map(c => c.attemptQuestionId)).size === v.length);
export const saveSchema = z.object({ clientMutationId: uuid, changes: changes(1) }).strict();
export const submitSchema = z.object({ clientMutationId: uuid, changes: changes().default([]) }).strict();
export const flagSchema = z.object({
  clientMutationId: uuid, expectedFlagRevision: z.number().int().min(0).max(2147483646), isFlagged: z.boolean(),
}).strict();
export const listSchema = z.object({
  locale: z.enum(["ar", "en"]).default("ar"),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  cursor: uuid.optional(),
}).strict();
export type Change = z.infer<typeof changeSchema>;
