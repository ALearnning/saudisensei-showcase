import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export const scope = z.enum(["courses", "chapters", "lessons"]);
export type Scope = z.infer<typeof scope>;
export const id = z.string().uuid();
const revision = { expectedMediaRevision: z.number().int().min(0).max(2147483646) };
const title = z.string().trim().min(1).max(255);
const file = {
  filename: z.string().min(1).max(255).refine(v => !/[\\/\u0000-\u001f\u007f]/.test(v)),
  mimeType: z.string().min(1).max(100),
  bytes: z.number().int().min(1).max(2147483648),
};
export const assetInput = z.object({ ...revision, ...file, title,
  kind: z.enum(["video", "document", "image", "attachment"]),
  downloadsAllowed: z.boolean().default(false), collectionId: id.nullable().default(null),
}).strict();
export const revisionInput = z.object({ ...revision, ...file }).strict();
export const assetUpdate = z.object({ ...revision, title: title.optional(), downloadsAllowed: z.boolean().optional() }).strict();
export const collectionInput = z.object({ ...revision, title, description: z.string().max(1000).default("") }).strict();
export const collectionUpdate = z.object({ ...revision, title: title.optional(), description: z.string().max(1000).optional() }).strict();
export const attachInput = z.object({ ...revision, assetId: id, collectionId: id.nullable().default(null) }).strict();
export const placementUpdate = z.object({ ...revision, collectionId: id.nullable() }).strict();
export const activateInput = z.object({ ...revision, revisionId: id }).strict();
export const lifecycleInput = z.object({ ...revision, action: z.enum(["publish", "unpublish", "archive", "remove"]) }).strict();
export const orderInput = z.object({ ...revision, ids: z.array(id).max(500).refine(v => new Set(v).size === v.length), collectionId: id.nullable().default(null) }).strict();
export const collectionOrderInput = z.object({ ...revision, ids: z.array(id).max(500).refine(v => new Set(v).size === v.length) }).strict();
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException("INVALID_MEDIA_INPUT");
  return result.data;
}
export type FileInput = z.infer<typeof revisionInput>;
export function validateFormat(kind: string, file: Pick<FileInput, "filename" | "mimeType" | "bytes">, downloadsAllowed: boolean) {
  const formats: Record<string, Record<string, string[]>> = {
    video: { "video/mp4": ["mp4"], "video/quicktime": ["mov"], "video/webm": ["webm"] },
    image: { "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"] },
    document: {
      "application/pdf": ["pdf"], "text/plain": ["txt"], "application/msword": ["doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
      "application/vnd.oasis.opendocument.text": ["odt"], "application/vnd.ms-powerpoint": ["ppt"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
    },
    attachment: { "application/zip": ["zip"] },
  };
  const limits: Record<string, number> = { video: 2147483648, document: 100 * 1024 * 1024, image: 20 * 1024 * 1024, attachment: 250 * 1024 * 1024 };
  const extension = file.filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (!formats[kind]?.[file.mimeType]?.includes(extension) || file.bytes > limits[kind] ||
      (kind === "video" && downloadsAllowed)) throw new BadRequestException("UNSUPPORTED_MEDIA_METADATA");
}
