import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(255);
const revision = z.number().int().nonnegative();
export const contentStatus = z.enum(["draft", "published", "archived"]);
export function markdownIsRestricted(body: string) {
  const prose = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, "");
  return !/<\/?[a-z][^>]*>|<!--|<\?/i.test(prose) &&
    !/!\[/.test(prose) && !/\]\(\s*(javascript|data|vbscript)\s*:/i.test(prose);
}
const body = z.string().max(100000).refine(markdownIsRestricted);
export const courseCreate = z.object({ title, description: z.string().max(20000).default("") }).strict();
export const courseEdit = z.object({ expectedRevision: revision, title: title.optional(), description: z.string().max(20000).optional() }).strict()
  .refine((x) => x.title !== undefined || x.description !== undefined);
export const revisionInput = z.object({ expectedRevision: revision }).strict();
export const chapterCreate = z.object({ expectedRevision: revision, title }).strict();
export const chapterEdit = z.object({ expectedRevision: revision, title: title.optional(), status: contentStatus.optional() }).strict()
  .refine((x) => x.title !== undefined || x.status !== undefined);
export const lessonCreate = z.object({ expectedRevision: revision, title, body: body.default(""), isRequired: z.boolean().default(true) }).strict();
export const lessonEdit = z.object({ expectedRevision: revision, title: title.optional(), body: body.optional(), isRequired: z.boolean().optional(), status: contentStatus.optional() }).strict()
  .refine((x) => x.title !== undefined || x.body !== undefined || x.isRequired !== undefined || x.status !== undefined);
export const orderInput = z.object({ expectedRevision: revision, orderedIds: z.array(uuid).max(1000) }).strict()
  .refine((x) => new Set(x.orderedIds).size === x.orderedIds.length);
export const enrollInput = z.object({ studentId: uuid, courseId: uuid }).strict();
export const enrollmentEdit = z.object({ status: z.enum(["active", "revoked"]) }).strict();
export const listInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["draft", "published", "archived", "active", "revoked", "expired"]).optional(),
  courseId: uuid.optional(), studentId: uuid.optional(),
}).strict();
export type ListInput = z.infer<typeof listInput>;
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("INVALID_INPUT");
  return result.data;
}
