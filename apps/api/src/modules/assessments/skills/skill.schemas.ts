import { z } from "zod";
import { markdownIsRestricted, uuid } from "../../courses/lms.schemas.js";

const safeText = (max: number) => z.string().max(max).refine(markdownIsRestricted);
const translation = z.object({
  label: safeText(255).refine(s => s.trim().length > 0),
  description: safeText(2000).default(""),
}).strict();
export const skillTranslations = z.object({ ar: translation.optional(), en: translation.optional() }).strict()
  .refine(t => t.ar !== undefined || t.en !== undefined);
const slug = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const skillCreate = z.object({
  slug, parentId: uuid.nullish(), translations: skillTranslations,
}).strict();
export const skillEdit = z.object({
  expectedRevision: z.number().int().nonnegative(), slug: slug.optional(),
  translations: skillTranslations.optional(),
}).strict().refine(input => input.slug !== undefined || input.translations !== undefined);
export const skillMove = z.object({
  expectedRevision: z.number().int().nonnegative(), parentId: uuid.nullable(),
}).strict();
export const skillList = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["active", "archived"]).optional(),
  search: z.string().trim().max(120).optional(),
  parentId: z.union([uuid, z.literal("root")]).optional(),
}).strict();
export type SkillTranslations = z.output<typeof skillTranslations>;
export type SkillCreate = z.output<typeof skillCreate>;
export type SkillEdit = z.output<typeof skillEdit>;
export type SkillMove = z.output<typeof skillMove>;
export type SkillList = z.output<typeof skillList>;
