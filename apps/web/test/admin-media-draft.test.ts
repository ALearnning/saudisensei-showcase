import assert from "node:assert/strict";
import test from "node:test";
import { editDraft, initDraft, isDirty } from "../src/lib/draft";
import { acknowledgeMediaSave, syncMediaDraft } from "../src/components/lms/admin-media/media-draft";
test("own media save becomes clean at the acknowledged revision and permits a consecutive edit", () => {
  const dirty = editDraft(initDraft({ title: "Old" }, 1), { title: "Saved" });
  assert.ok(isDirty(dirty));
  const clean = acknowledgeMediaSave(dirty.values, 2);
  assert.equal(isDirty(clean), false);
  const next = editDraft(clean, { title: "Next" });
  assert.equal(next.revision, 2);
  assert.ok(isDirty(next));
});
test("peer refresh preserves dirty media draft and old base; stale responses cannot undo acknowledgement", () => {
  const dirty = editDraft(initDraft({ title: "Old" }, 1), { title: "Mine" });
  const peer = syncMediaDraft(dirty, { title: "Peer" }, 2);
  assert.equal(peer.values.title, "Mine"); assert.equal(peer.revision, 1);
  const clean = acknowledgeMediaSave({ title: "Saved" }, 3);
  assert.deepEqual(syncMediaDraft(clean, { title: "Stale" }, 2), clean);
});
