import assert from "node:assert/strict";
import test from "node:test";
import { mediaFileMetadata, privatePreviewPath } from "../src/lib/admin-media-transfer.js";
test("approved media metadata rejects Office, active formats, mismatched MIME and oversize or unsafe files", () => {
  assert.equal(mediaFileMetadata({ name: "درس.pdf", type: "application/pdf", size: 50 }).kind, "document");
  assert.equal(mediaFileMetadata({ name: "image.webp", type: "", size: 50 }).mimeType, "image/webp");
  for (const name of ["a.docx", "a.pptx", "a.xlsx", "a.html", "a.svg", "a.mkv", "../a.pdf"]) {
    assert.throws(() => mediaFileMetadata({ name, type: "", size: 50 }));
  }
  assert.throws(() => mediaFileMetadata({ name: "a.pdf", type: "text/html", size: 50 }));
  assert.throws(() => mediaFileMetadata({ name: "a.pdf", type: "", size: 0 }));
  assert.throws(() => mediaFileMetadata({ name: "a.pdf", type: "", size: 104857601 }));
});
test("private preview uses exact Admin BFF content path, no public URL or capability in URL", () => {
  const path = "/lms-api/admin/courses/00000000-0000-4000-8000-000000000000/media-library/placements/00000000-0000-4000-8000-000000000001/content";
  assert.equal(privatePreviewPath(path), path);
  for (const bad of [path + "?capability=x", "https://example.org" + path, "//example.org/x", "/lms-api/student/courses/x/content"]) {
    assert.throws(() => privatePreviewPath(bad));
  }
});
