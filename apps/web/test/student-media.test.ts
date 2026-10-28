import { test } from "node:test";
import assert from "node:assert/strict";
import { arrowStep, canDownload, clampPage, classifyStatus, contentMatches, grantLeft, groupResources, hlsConfig, isValidDownloadGrant, isValidPreviewGrant, placementPath, renewIn, retryDelay, safeFilename, studentContentPath, studentRoot, viewerKind } from "../src/components/lms/student-media/helpers";

const P = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const O = "https://app.example";
const exp = { scope: "lessons" as const, parentId: P, placementId: C };
const ok = `/lms-api/lessons/${P}/media-library/placements/${C}/content`;

test("content path accepts only the exact same-origin Student route", () => {
  assert.equal(studentContentPath(ok, O, exp), ok);
  assert.equal(studentContentPath(`${O}${ok}`, O, exp), ok);
  for (const bad of [
    `${ok}?capability=x`, `${ok}#x`, `https://evil.example${ok}`, `//evil.example${ok}`, `https://u:p@app.example${ok}`,
    `/lms-api/admin/lessons/${P}/media-library/placements/${C}/content`, `/lms-api/lessons/${P}/media-library/placements/${C}/content/x`,
    `/lms-api/lessons/${P}/media-library/placements/${C}/../${C}/content`, `/lms-api/lessons/not-a-uuid/media-library/placements/${C}/content`,
    `/lms-api/lessons/${P}%2F/media-library/placements/${C}/content`, `/lms-api/chapters/${P}/media-library/placements/${C}/content`,
    `/lms-api/lessons/${C}/media-library/placements/${P}/content`, 42, null,
  ]) assert.equal(studentContentPath(bad, O, exp), null, String(bad));
});
test("roots and grant paths require exact UUIDs and known scopes", () => {
  assert.equal(studentRoot("courses", P), `courses/${P}/media-library`);
  assert.equal(studentRoot("courses", "../admin"), null);
  assert.equal(studentRoot("admin" as never, P), null);
  assert.equal(placementPath("chapters", P, C, "playback"), `chapters/${P}/media-library/placements/${C}/playback`);
  assert.equal(placementPath("chapters", P, "x", "access"), null);
});
test("viewer kinds and content match fail closed", () => {
  assert.equal(viewerKind("document", "application/pdf"), "pdf");
  assert.equal(viewerKind("image", "image/webp"), "image");
  assert.equal(viewerKind("attachment", "text/plain; charset=utf-8"), "text");
  assert.equal(viewerKind("video", "video/mp4"), "video");
  assert.equal(viewerKind("image", "image/svg+xml"), "file");
  assert.equal(contentMatches("text", "text/html"), false);
  assert.equal(contentMatches("pdf", "application/pdf"), true);
});
test("status classes", () => {
  assert.equal(classifyStatus(0), "transient"); assert.equal(classifyStatus(503), "transient"); assert.equal(classifyStatus(429), "transient");
  assert.equal(classifyStatus(401), "session"); assert.equal(classifyStatus(403), "denied");
  assert.equal(classifyStatus(404), "unavailable"); assert.equal(classifyStatus(409), "unavailable");
});
test("retries are bounded", () => {
  assert.ok(retryDelay(0)! > 0); assert.ok(retryDelay(2)! > retryDelay(0)!); assert.equal(retryDelay(3), null); assert.equal(retryDelay(-1), null);
});
test("grant lifetime is capped and malformed expiry fails closed", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(grantLeft("2026-01-01T00:02:00Z", now, 120_000), 120_000);
  assert.equal(grantLeft("2026-01-01T01:00:00Z", now, 300_000), 300_000);
  assert.equal(grantLeft("2025-12-31T23:59:59Z", now, 120_000), null);
  assert.equal(grantLeft("nope", now, 120_000), null);
  assert.equal(renewIn(120_000, 20_000), 100_000);
  assert.equal(renewIn(10_000, 20_000), 5_000);
  assert.equal(renewIn(1_500, 20_000), null);
});
test("downloads need policy plus a fresh download-mode grant; preview grants never download", () => {
  assert.equal(canDownload({ asset: { downloadsAllowed: false, kind: "document" } } as never), false);
  assert.equal(canDownload({ asset: { downloadsAllowed: true, kind: "video" } } as never), false);
  assert.equal(canDownload({ asset: { downloadsAllowed: true, kind: "document" } } as never), true);
  assert.equal(isValidDownloadGrant({ mode: "preview", revisionId: "r" }, "r"), false);
  assert.equal(isValidDownloadGrant({ mode: "download", revisionId: "x" }, "r"), false);
  assert.equal(isValidPreviewGrant({ mode: "download", revisionId: "r" }, "r"), false);
});
test("flat grouping hides unpublished/unready items and orders by position", () => {
  const it = (id: string, pos: number, col: string | null, ps = "published", rs = "ready") => ({
    placement: { id, assetId: id, collectionId: col, status: ps, position: pos },
    asset: { id, kind: "document", title: id, downloadsAllowed: false },
    revision: { id: P, filename: "f.pdf", mimeType: "application/pdf", bytes: 1, state: rs, scanState: "clean", duration: null, pageCount: 2 },
  });
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const g = groupResources({
    collections: [
      { id: "c2", title: "B", description: "", status: "published", position: 2 },
      { id: "c1", title: "A", description: "", status: "published", position: 1 },
      { id: "cx", title: "X", description: "", status: "archived", position: 0 },
    ],
    items: [it(id(1), 2, null), it(id(2), 1, null), it(id(3), 1, "c2"), it(id(4), 1, "c1"), it(id(5), 0, "cx"), it(id(6), 0, null, "draft"), it(id(7), 0, null, "published", "processing")],
  } as never);
  assert.deepEqual(g.map((x) => x.collection?.id ?? null), [null, "c1", "c2"]);
  assert.deepEqual(g[0].items.map((x) => x.placement.id), [id(2), id(1)]);
});
test("filenames, pages, arrows and HLS bounds", () => {
  assert.equal(safeFilename("../a/b\u0000.pdf", "t"), "_a_b_.pdf");
  assert.equal(safeFilename("", "ملف عربي"), "ملف عربي");
  assert.equal(clampPage(9, 3), 3); assert.equal(clampPage(0, 3), 1); assert.equal(clampPage(NaN, 3), 1);
  assert.equal(arrowStep("ArrowLeft", true), 1); assert.equal(arrowStep("ArrowLeft", false), -1);
  const c = hlsConfig(312.5);
  assert.equal(c.startPosition, 312.5); assert.equal(c.autoStartLoad, false); assert.equal(c.maxMaxBufferLength, 90);
});

import { canRecoverSource, grantDeadline, untilDeadline } from "../src/components/lms/student-media/helpers";
test("deadline is fixed at validation; later async work cannot extend it", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  const d = grantDeadline("2026-01-01T00:02:00Z", t0, 120_000)!;
  assert.equal(untilDeadline(d, t0 + 30_000), 90_000);
  assert.equal(untilDeadline(d, t0 + 120_000), null);
  assert.equal(grantDeadline("2026-01-01T09:00:00Z", t0, 300_000), t0 + 300_000);
  assert.equal(grantDeadline("bad", t0, 120_000), null);
});
test("source recovery is bounded to three consecutive cycles", () => {
  assert.equal(canRecoverSource(0), true); assert.equal(canRecoverSource(2), true); assert.equal(canRecoverSource(3), false);
});

import { textPage, textPageStarts, MAX_TEXT_CHARS } from "../src/components/lms/student-media/helpers";
test("text pagination covers every character without truncation", () => {
  const t = "ab😀cdefg".repeat(5);
  const s = textPageStarts(t, 4);
  assert.equal(s.map((_, i) => textPage(t, s, i)).join(""), t);
  for (const x of s) { const c = t.charCodeAt(x); assert.ok(!(c >= 0xdc00 && c <= 0xdfff)); }
  assert.deepEqual(textPageStarts("", 4), [0]); assert.equal(textPage("hi", [0], 7), "hi");
  const big = "x".repeat(MAX_TEXT_CHARS * 2 + 5);
  const bs = textPageStarts(big); assert.equal(bs.length, 3); assert.equal(textPage(big, bs, 2).length, 5);
});
