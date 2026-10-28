import { test } from "node:test";
import assert from "node:assert/strict";
import { editDraft, initDraft, isDirty, resetDraft, settleDraft, syncDraft } from "../src/lib/draft";
import { exceedsBytes } from "../src/lib/bff-policy";

test("dirty draft keeps its text and original revision on background refresh", () => {
  let d = initDraft({ title: "A" }, 3);
  d = editDraft(d, { title: "Mine" });
  const after = syncDraft(d, { title: "Theirs" }, 4);
  assert.equal(after.values.title, "Mine");
  assert.equal(after.revision, 3);
  assert.equal(isDirty(after), true);
});
test("clean draft synchronizes server values and revision", () => {
  const d = syncDraft(initDraft<{ title: string; isRequired: boolean }>({ title: "A", isRequired: true }, 3), { title: "B", isRequired: false }, 5);
  assert.deepEqual(d.values, { title: "B", isRequired: false });
  assert.equal(d.revision, 5);
  assert.equal(isDirty(d), false);
});
test("explicit reset after a 409 discards edits and binds latest revision", () => {
  const d = editDraft(initDraft({ title: "A" }, 3), { title: "Mine" });
  const r = resetDraft({ title: "Theirs" }, 7);
  assert.equal(r.values.title, "Theirs");
  assert.equal(r.revision, 7);
  assert.notEqual(d.revision, r.revision);
});
test("payload limit counts UTF-8 bytes", () => {
  const arabic = "ع".repeat(60_000); // 120000 bytes, 60000 code units
  assert.equal(exceedsBytes(arabic, 100_000), true);
  assert.equal(exceedsBytes("a".repeat(100_000), 100_000), false);
});
test("successive successful saves rebind to each new revision", () => {
  let d = editDraft(initDraft({ title: "A" }, 3), { title: "B" });
  const sent1 = d.revision;
  d = settleDraft(d, true, { title: "B" }, 4);
  assert.equal(sent1, 3);
  assert.equal(isDirty(d), false);
  assert.equal(d.revision, 4);
  d = editDraft(d, { title: "C" });
  assert.equal(d.revision, 4);
  d = settleDraft(d, true, { title: "C" }, 5);
  assert.equal(d.revision, 5);
  assert.equal(syncDraft(d, { title: "C" }, 5).revision, 5);
});
test("failed save keeps typed values and original baseline", () => {
  const d = editDraft(initDraft({ title: "A" }, 3), { title: "Mine" });
  const after = settleDraft(d, false, { title: "Theirs" }, 9);
  assert.equal(after.values.title, "Mine");
  assert.equal(after.revision, 3);
  assert.equal(isDirty(after), true);
});
