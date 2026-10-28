import { createHash } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ProcessingError } from "./processing.ports.js";
export async function spoolSource(source: Readable, path: string, bytes: number, signal: AbortSignal) {
  const hash = createHash("sha256"); let total = 0; let header = Buffer.alloc(0);
  await pipeline(source, new Transform({ transform(chunk: Buffer, _encoding, done) {
    total += chunk.byteLength;
    if (total > bytes || total > 2147483648) return done(new ProcessingError("SOURCE_INVALID", false));
    hash.update(chunk);
    if (header.length < 512) header = Buffer.concat([header, chunk.subarray(0, 512 - header.length)]);
    done(null, chunk);
  } }), createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
  if (total !== bytes) throw new ProcessingError("SOURCE_INVALID", false);
  return { sha256: hash.digest("hex"), header };
}
export function verifyMagic(mime: string, header: Buffer) {
  const starts = (hex: string) => header.subarray(0, hex.length / 2).toString("hex") === hex;
  const zip = starts("504b0304"), ole = starts("d0cf11e0a1b11ae1");
  const valid = mime === "text/plain" || (
    mime === "application/pdf" ? header.subarray(0, 5).toString() === "%PDF-" :
    mime === "image/jpeg" ? starts("ffd8ff") :
    mime === "image/png" ? starts("89504e470d0a1a0a") :
    mime === "image/webp" ? header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP" :
    ["video/mp4", "video/quicktime"].includes(mime) ? header.subarray(4, 8).toString() === "ftyp" :
    mime === "video/webm" ? starts("1a45dfa3") :
    mime === "application/msword" || mime === "application/vnd.ms-powerpoint" ? ole :
    ["application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.oasis.opendocument.text"].includes(mime) ? zip : false
  );
  if (!valid) throw new ProcessingError("CONTENT_TYPE_MISMATCH", false);
}
export async function validatePlaintext(path: string, signal: AbortSignal) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 65536, signal })) {
      if (decoder.decode(chunk, { stream: true }).includes("\0")) throw 0;
    }
    decoder.decode();
  } catch { throw new ProcessingError("TEXT_INVALID", false); }
}
