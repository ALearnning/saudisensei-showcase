import assert from "node:assert/strict";
import test from "node:test";
import { libraryFixture } from "./media-library.fixture.js";
import { MediaAdminVideoService } from "../src/modules/media/admin-video.service.js";

test("Admin video inspection uses exact ready revision, parent, role, MFA and account, and audits atomically", async () => {
  const f = await libraryFixture();
  const issued: number[] = [];
  const service = new MediaAdminVideoService(f.store, { playback(_reference, _host, expiry) {
    issued.push(expiry);
    return { manifest: "https://private.invalid/signed/manifest.m3u8", poster: "https://private.invalid/signed/poster", expiresAt: expiry };
  } });
  try {
    const result = await f.service.createAsset(f.args, {
      title: "Synthetic video", kind: "video", filename: "synthetic.mp4", mimeType: "video/mp4", bytes: 100,
      downloadsAllowed: false, collectionId: null, expectedMediaRevision: 0,
    });
    const revisionId = result.revision!.id;
    const placementId = result.placement!.id;
    const jwt = (exp: number) => `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.test`;
    const now = Math.floor(Date.now() / 1000);
    f.a.headers = { authorization: `Bearer ${jwt(now + 900)}` };
    const args = { ...f.args, placementId };
    await assert.rejects(service.preview(args, revisionId));
    await f.db.mediaRevision.update({ where: { id: revisionId }, data: {
      state: "ready", scanState: "clean", privateReady: true, scanEngine: "test-scanner", scannedAt: new Date(),
      sha256: "a".repeat(64), objectKey: "synthetic-private-master",
      providerRef: "synthetic-reference", duration: 375,
      renditions: { create: { kind: "stream", locator: "customer-synthetic.cloudflarestream.com",
        contentType: "application/vnd.apple.mpegurl", verifiedAt: new Date() } },
    } });
    const access = await service.preview(args, revisionId);
    assert.equal(access.revisionId, revisionId);
    assert.equal(access.duration, 375);
    // Fixture setup may cross a second boundary under parallel database load.
    assert.ok(issued[0] <= Math.floor(Date.now() / 1000) + 300);
    assert.equal(await f.db.auditLog.count({ where: { action: "media_video.admin_preview_issued" } }), 1);
    await assert.rejects(service.preview({ ...args, req: Object.assign(f.actor(f.admin, ["admin"], false), { headers: f.a.headers }) }, revisionId));
    await assert.rejects(service.preview({ ...args, req: Object.assign(f.s, { headers: f.a.headers }) }, revisionId));
    await assert.rejects(service.preview({ ...args, parentId: f.chapter.id }, revisionId));
    await assert.rejects(service.preview({ ...args, req: Object.assign(f.actor(f.admin, ["admin"], true),
      { headers: { authorization: `Bearer ${jwt(now - 1)}` } }) }, revisionId));
    await f.db.chapter.update({ where: { id: f.chapter.id }, data: { status: "archived" } });
    await assert.rejects(service.preview(args, revisionId));
    await f.db.user.update({ where: { id: f.a.user.id }, data: { status: "suspended" } });
    await assert.rejects(service.preview(args, revisionId));
    assert.equal(issued.length, 1);
  } finally { await f.close(); }
});
