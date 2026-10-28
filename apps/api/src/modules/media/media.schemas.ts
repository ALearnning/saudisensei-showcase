import { z } from "zod";
import { BadRequestException } from "@nestjs/common";
export const mediaId = z.string().uuid();
// Deliberately bounded development TXT pilot; broader Phase 1C formats remain deferred.
export const MAX_PILOT_BYTES = 6 * 1024 * 1024;
export const uploadInput = z.object({
  title: z.string().trim().min(1).max(255),
  mimeType: z.literal("text/plain"),
  bytes: z.number().int().positive().max(MAX_PILOT_BYTES),
  method: z.enum(["single", "multipart"]).default("single"),
  downloadsAllowed: z.boolean().default(true),
}).strict();
export const partInput = z.object({ partNumber: z.number().int().min(1).max(2) }).strict();
export const completeInput = z.object({
  parts: z.array(z.object({
    partNumber: z.number().int().min(1).max(2),
    etag: z.string().regex(/^"[a-fA-F0-9-]{1,100}"$/),
  }).strict()).max(2).optional(),
}).strict();
export const accessInput = z.object({ mode: z.enum(["preview", "download"]) }).strict();
export const emptyInput = z.object({}).strict();
export function parseMedia<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("VALIDATION_FAILED");
  return result.data;
}
