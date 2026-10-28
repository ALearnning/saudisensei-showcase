import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { missing } from "./library.context.js";
const claims = z.object({
  actor: z.string().uuid(), placement: z.string().uuid(), revision: z.string().uuid(),
  rendition: z.string().uuid().nullable(), scope: z.enum(["courses", "chapters", "lessons"]),
  parent: z.string().uuid(), admin: z.boolean(), mode: z.enum(["preview", "download"]),
  expires: z.number().int().positive(),
}).strict();
export type RenditionClaims = z.infer<typeof claims>;
/** No persistent credentials or identities in URLs. Process-local encrypted
 * tickets expire in <=120s; API restart invalidates them and requires renewal.
 */
export class RenditionCapabilities {
  private readonly key = randomBytes(32);
  seal(input: RenditionClaims) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(claims.parse(input))), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }
  open(token: string, now: number): RenditionClaims {
    try {
      if (!/^[A-Za-z0-9_-]{40,2048}$/.test(token)) throw 0;
      const bytes = Buffer.from(token, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const value = claims.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
      if (value.expires <= now || value.expires > now + 120000) throw 0;
      return value;
    } catch { throw missing(); }
  }
}
