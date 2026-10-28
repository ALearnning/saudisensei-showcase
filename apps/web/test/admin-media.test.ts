import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCEPT, expiryDelay, matchesRevision, mediaRoot, withTimeout, moveInList, processingPhase, publishPlan, readyReplacements, renewDelay, safeManifestUrl, siblings, titleFromFilename, watchedRevision } from "../src/components/lms/admin-media/helpers";

const rev = (id: string, state: string) => ({ id, filename: "f.pdf", mimeType: "application/pdf", bytes: 1, state, scanState: "clean", duration: null, pageCount: null }) as never;
const item = (o: { pid: string; pos: number; col?: string | null; ps?: string; as?: string; cur?: string | null; staged?: string | null; revs?: never[] }) => ({
  placement: { id: o.pid, assetId: "a" + o.pid, collectionId: o.col ?? null, status: o.ps ?? "draft", position: o.pos },
  asset: { id: "a" + o.pid, kind: "document", title: "T", status: o.as ?? "draft", downloadsAllowed: false, currentRevisionId: o.cur ?? null, stagedRevisionId: o.staged ?? null },
  revision: o.revs?.find((r: { id: string }) => r.id === o.cur) ?? null, revisions: o.revs ?? [],
}) as never;

test("root path encodes parent and omits api prefix", () => assert.equal(mediaRoot("lessons", "a/b"), "admin/lessons/a%2Fb/media-library"));
test("activation offers only the exact staged ready revision, never historical restore", () => {
  const revisions = [rev("old", "ready"), rev("current", "ready"), rev("staged", "ready")];
  assert.deepEqual(readyReplacements(item({ pid: "1", pos: 0, cur: "current", staged: "staged", revs: revisions })), [revisions[2]]);
  assert.deepEqual(readyReplacements(item({ pid: "1", pos: 0, cur: "staged", revs: revisions })), []);
});
test("processing phases map stages without raw fields", () => {
  assert.equal(processingPhase(null), "awaiting");
  assert.equal(processingPhase({ revisionState: "quarantined", scanState: "scanning", job: { state: "running", stage: "scan", attempts: 1, failures: 0, errorCode: null } } as never), "scanning");
  assert.equal(processingPhase({ revisionState: "processing", scanState: "clean", job: { state: "running", stage: "ingest_requested", attempts: 1, failures: 0, errorCode: null } } as never), "transcoding");
  assert.equal(processingPhase({ revisionState: "processing", scanState: "clean", job: { state: "permanently_failed", stage: "document", attempts: 3, failures: 3, errorCode: "X" } } as never), "failed");
  assert.equal(processingPhase({ revisionState: "ready", scanState: "clean", job: null } as never), "ready");
});
test("publish plan sequences asset then placement", () => {
  assert.deepEqual(publishPlan(item({ pid: "1", pos: 0 })), [{ target: "asset", action: "publish" }, { target: "placement", action: "publish" }]);
  assert.deepEqual(publishPlan(item({ pid: "1", pos: 0, as: "published" })), [{ target: "placement", action: "publish" }]);
});
test("siblings exclude archived/removed and sort by position within collection", () => {
  const xs = [item({ pid: "b", pos: 2 }), item({ pid: "a", pos: 1 }), item({ pid: "c", pos: 0, ps: "removed" }), item({ pid: "d", pos: 0, col: "k" })];
  assert.deepEqual(siblings(xs, null).map((i: { placement: { id: string } }) => i.placement.id), ["a", "b"]);
});
test("moveInList swaps and bounds", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.equal(moveInList(["a"], "a", 1), null);
});
test("watched revision prefers an unfinished staged replacement", () => {
  const it = item({ pid: "1", pos: 0, cur: "r1", staged: "r2", revs: [rev("r1", "ready"), rev("r2", "processing")] });
  assert.equal((watchedRevision(it) as { id: string }).id, "r2");
  assert.equal(watchedRevision(item({ pid: "1", pos: 0, cur: "r1", revs: [rev("r1", "ready")] })), null);
});
test("120s grants renew with a 15s/30s lead, not every second", () => {
  const now = 1_000_000; const exp = new Date(now + 120_000).toISOString();
  assert.equal(renewDelay(exp, now, 15_000), 105_000);
  assert.equal(renewDelay(exp, now, 30_000), 90_000);
});
test("short grants renew at half-life; malformed/expired fail closed", () => {
  const now = 1_000_000;
  assert.equal(renewDelay(new Date(now + 10_000).toISOString(), now, 15_000), 5000);
  assert.equal(renewDelay(new Date(now + 1500).toISOString(), now, 15_000), null);
  assert.equal(renewDelay(new Date(now).toISOString(), now, 15_000), null);
  assert.equal(renewDelay("not-a-date", now, 15_000), null);
  assert.equal(renewDelay(undefined, now, 15_000), null);
  assert.equal(expiryDelay(new Date(now - 1).toISOString(), now), null);
  assert.equal(expiryDelay(new Date(now + 500).toISOString(), now), 500);
});
test("withTimeout rejects hung work and aborts", async () => {
  const c = new AbortController();
  await assert.rejects(withTimeout(new Promise(() => undefined), 10, c));
  assert.equal(c.signal.aborted, true);
  assert.equal(await withTimeout(Promise.resolve(3), 50), 3);
});
test("manifest validation rejects non-https, credentials and junk", () => {
  const o = "https://app.example";
  assert.ok(safeManifestUrl("https://video.example/m.m3u8", o));
  assert.equal(safeManifestUrl("http://video.example/m.m3u8", o), null);
  assert.equal(safeManifestUrl("https://u:p@video.example/m.m3u8", o), null);
  assert.equal(safeManifestUrl(42, o), null);
});
test("accept list advertises only helper-supported formats", () => {
  for (const ext of [".pdf", ".txt", ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"]) assert.ok(ACCEPT.split(",").includes(ext));
  for (const bad of [".mkv", ".m4v", ".pptx", ".docx"]) assert.equal(ACCEPT.split(",").includes(bad), false);
});
test("upload retry requires identical filename, bytes and mime", () => {
  const r = { filename: "درس 1.pdf", mimeType: "application/pdf", bytes: 10 };
  assert.equal(matchesRevision({ ...r, kind: "document" }, r), true);
  assert.equal(matchesRevision({ ...r, bytes: 11, kind: "document" }, r), false);
  assert.equal(matchesRevision({ ...r, filename: "other.pdf", kind: "document" }, r), false);
  assert.equal(matchesRevision(null, r), false);
});
test("mixed-direction titles", () => {
  assert.equal(titleFromFilename("ملخص_lesson.txt"), "ملخص lesson");
});
