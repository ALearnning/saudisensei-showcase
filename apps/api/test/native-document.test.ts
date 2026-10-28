import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";
import { inspectNativeDocument, PDF_MAX_BYTES, IMAGE_MAX_BYTES } from "../src/modules/media/native-document.js";
import { verifyMagic, validatePlaintext } from "../src/modules/media/processing-source.js";
import { validateFormat } from "../src/modules/media/library.schemas.js";
const signal = () => new AbortController().signal;
test("native PDF, image and plaintext inspection uses genuine local parsers with bounded inputs", async t => {
  const dir = await mkdtemp(join(tmpdir(), "saudisensei-native-test-"));
  const file = join(dir, "fixture");
  const inspect = async (bytes: Uint8Array, mime: string) => {
    await writeFile(file, bytes); return inspectNativeDocument(file, mime, signal());
  };
  const pdf = async (count: number) => { const doc = await PDFDocument.create(); for (let i = 0; i < count; i++) doc.addPage(); return doc.save(); };
  try {
    await t.test("valid one-page PDF records reliable page count without conversion", async () => {
      assert.deepEqual(await inspect(await pdf(1), "application/pdf"), { kind: "pdf", contentType: "application/pdf", pageCount: 1 });
    });
    await t.test("multi-page PDF and maximum 500 pages are accepted", async () => {
      assert.equal((await inspect(await pdf(3), "application/pdf")).pageCount, 3);
      assert.equal((await inspect(await pdf(500), "application/pdf")).pageCount, 500);
    });
    await t.test("501 pages and oversized PDF/image sources fail closed", async () => {
      await assert.rejects(inspect(await pdf(501), "application/pdf"), /DOCUMENT_LIMIT/);
      for (const [size, mime] of [[PDF_MAX_BYTES + 1, "application/pdf"], [IMAGE_MAX_BYTES + 1, "image/png"]] as const) {
        await writeFile(file, "synthetic"); await truncate(file, size);
        await assert.rejects(inspectNativeDocument(file, mime, signal()), /DOCUMENT_LIMIT/);
      }
    });
    await t.test("genuine JPEG, PNG and WebP decode fully and stay native private formats", async () => {
      for (const format of ["jpeg", "png", "webp"] as const) {
        const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).toFormat(format).toBuffer();
        verifyMagic(`image/${format}`, bytes);
        assert.deepEqual(await inspect(bytes, `image/${format}`), { kind: "image", contentType: `image/${format}` });
      }
    });
    await t.test("actual image type mismatch, truncated payload and malformed PDF are rejected", async () => {
      const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).png().toBuffer();
      await assert.rejects(inspect(png, "image/jpeg"), /CONTENT_TYPE_MISMATCH/);
      await assert.rejects(inspect(png.subarray(0, 40), "image/png"), /DOCUMENT_INVALID/);
      await assert.rejects(inspect(Buffer.from("%PDF-1.7\nmalformed\n%%EOF"), "application/pdf"), /DOCUMENT_INVALID/);
      assert.throws(() => verifyMagic("application/pdf", png));
    });
    await t.test("oversized pixel dimensions cannot bypass compressed-file size limits", async () => {
      const bytes = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "white" } }).png().toBuffer();
      await assert.rejects(inspect(bytes, "image/png"));
    });
    await t.test("active actions, including compressed object dictionaries, cannot become safe PDF previews", async () => {
      const doc = await PDFDocument.create(); doc.addPage();
      doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj({ S: PDFName.of("JavaScript"), JS: PDFString.of("synthetic") }));
      await assert.rejects(inspect(await doc.save({ useObjectStreams: true }), "application/pdf"), /PDF_ACTIVE_CONTENT/);
    });
    await t.test("plaintext remains UTF-8 text, not interpreted HTML; malformed UTF-8/NUL fails closed", async () => {
      await writeFile(file, "<script>synthetic</script>\nنص"); await validatePlaintext(file, signal());
      await writeFile(file, Buffer.from([0xc3, 0x28])); await assert.rejects(validatePlaintext(file, signal()));
      await writeFile(file, "text\0invalid"); await assert.rejects(validatePlaintext(file, signal()));
    });
    await t.test("metadata file-size limits and extension/type allowlist remain enforced", () => {
      for (const [kind, mimeType, filename, bytes] of [
        ["document", "application/pdf", "test.pdf", PDF_MAX_BYTES + 1],
        ["image", "image/png", "test.png", IMAGE_MAX_BYTES + 1],
        ["image", "image/svg+xml", "test.svg", 50],
        ["image", "image/png", "test.jpg", 50],
      ] as const) assert.throws(() => validateFormat(kind, { filename, mimeType, bytes }, false));
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
