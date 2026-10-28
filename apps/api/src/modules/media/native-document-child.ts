import { readFile, stat } from "node:fs/promises";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import sharp from "sharp";
// This entry point is launched only by the bounded processing worker.
// Static errors only: parser diagnostics can contain document-controlled data.
const reject = (error: string): never => { throw new Error(error); };
async function inspect() {
  const [path, mime] = process.argv.slice(2);
  const bytes = (await stat(path)).size;
  if (mime === "application/pdf") {
    if (bytes < 8 || bytes > 100 * 1024 * 1024) reject("DOCUMENT_LIMIT");
    const data = await readFile(path);
    if (data.subarray(0, 5).toString() !== "%PDF-" || !data.subarray(-2048).includes(Buffer.from("%%EOF"))) reject("DOCUMENT_INVALID");
    const pdf = await PDFDocument.load(data, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.isEncrypted) reject("DOCUMENT_INVALID");
    const pages = pdf.getPages();
    if (!pages.length || pages.length > 500) reject("DOCUMENT_LIMIT");
    // Passive native PDF only. Inspect decoded object dictionaries (including
    // compressed objects), not a regex over the original bytes.
    const forbidden = new Set(["A", "AF", "JS", "JavaScript", "OpenAction", "AA", "Launch",
      "RichMedia", "RichMediaContent", "EmbeddedFiles", "EmbeddedFile", "Filespec",
      "XFA", "AcroForm", "URI", "GoToR", "GoToE", "SubmitForm", "ImportData", "Rendition", "Sound", "Movie", "3D"]);
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      const visited = new Set<object>();
      const walk = (value: any, depth = 0) => {
        if (!value || typeof value !== "object" || visited.has(value)) return;
        if (depth > 100) reject("DOCUMENT_LIMIT");
        visited.add(value);
        if (value instanceof PDFName && forbidden.has(value.decodeText())) reject("PDF_ACTIVE_CONTENT");
        if (value instanceof PDFDict) for (const [key, child] of value.entries()) {
          if (forbidden.has(key.decodeText())) reject("PDF_ACTIVE_CONTENT");
          walk(child, depth + 1);
        }
        else if (typeof value.asArray === "function") for (const child of value.asArray()) walk(child, depth + 1);
        // Stream dictionaries carry embedded-file and active-content declarations.
        else if (value.dict instanceof PDFDict) walk(value.dict, depth + 1);
      };
      walk(object);
    }
    for (const page of pages) {
      const { width, height } = page.getSize();
      if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) reject("DOCUMENT_LIMIT");
    }
    return { kind: "pdf", contentType: mime, pageCount: pages.length };
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) reject("CONTENT_TYPE_MISMATCH");
  if (bytes < 8 || bytes > 20 * 1024 * 1024) reject("DOCUMENT_LIMIT");
  sharp.cache(false); sharp.concurrency(1);
  const image = sharp(path, { limitInputPixels: 40_000_000, failOn: "warning", animated: true });
  const info = await image.metadata();
  if (`image/${info.format}` !== mime || !info.width || !info.height) reject("CONTENT_TYPE_MISMATCH");
  if ((info.pages ?? 1) !== 1 || info.width * info.height > 40_000_000) reject("DOCUMENT_LIMIT");
  await image.stats(); // Decode all pixels, not merely the declared header.
  return { kind: "image", contentType: mime };
}
inspect().then(result => process.stdout.write(JSON.stringify(result))).catch(error => {
  const code = ["DOCUMENT_LIMIT", "DOCUMENT_INVALID", "PDF_ACTIVE_CONTENT", "CONTENT_TYPE_MISMATCH"].includes(error?.message)
    ? error.message : "DOCUMENT_INVALID";
  process.stdout.write(JSON.stringify({ error: code }));
});
