import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { libraryFixture } from "./media-library.fixture.js";
import { MediaStudentVideoService } from "../src/modules/media/student-video.service.js";

test("Student video uses published current parent-scoped media, clips expiry, and preserves learning history", async () => {
  const f = await libraryFixture();
  const issued: number[] = [];
  const service = new MediaStudentVideoService(f.store, { playback(_reference, _host, expiry) {
    issued.push(expiry);
    return { manifest: "https://private.invalid/signed/manifest.m3u8", poster: "https://private.invalid/poster", expiresAt: expiry };
  } });
  try {
    const now = Math.floor(Date.now() / 1000);
    const jwt = (exp: number) => `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.test`;
    const req = Object.assign(f.s, { headers: { authorization: `Bearer ${jwt(now + 900)}` } });
    const created = await f.service.createAsset(f.args, { title: "Synthetic private video", kind: "video",
      filename: "synthetic.mp4", mimeType: "video/mp4", bytes: 100, downloadsAllowed: false,
      collectionId: null, expectedMediaRevision: await f.revision() });
    const assetId = created.asset!.id, revisionId = created.revision!.id, placementId = created.placement!.id;
    const args = { ...f.studentArgs, req, placementId };
    await assert.rejects(service.playback(args, revisionId));
    // Synthetic evidence in an isolated disposable test schema only.
    await f.db.mediaRevision.update({ where: { id: revisionId }, data: { providerRef: "synthetic-reference", duration: 375,
      renditions: { create: { kind: "stream", locator: "customer-synthetic.cloudflarestream.com",
        contentType: "application/vnd.apple.mpegurl", verifiedAt: new Date() } } } });
    await f.publish(assetId, revisionId, placementId);
    const before = await f.db.course.findUniqueOrThrow({ where: { id: f.course.id } });
    const completion = await f.db.lessonCompletion.findUniqueOrThrow({ where: { id: f.completion.id } });
    const grant = await service.playback(args, revisionId);
    assert.equal(grant.revisionId, revisionId);
    assert.equal(grant.duration, 375);
    assert.ok(issued[0] <= Math.floor(Date.now() / 1000) + 300);
    assert.equal(await f.db.auditLog.count({ where: { action: "media_video.playback_issued" } }), 1);
    assert.ok(!JSON.stringify((await f.db.auditLog.findFirstOrThrow({ where: { action: "media_video.playback_issued" } })).metadata).includes("private.invalid"));
    await f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { expiresAt: new Date((now + 80) * 1000) } });
    await service.playback(args, revisionId);
    assert.equal(issued.at(-1), now + 80);
    req.headers.authorization = `Bearer ${jwt(now + 30)}`;
    await service.playback(args, revisionId);
    assert.equal(issued.at(-1), now + 30);
    req.headers.authorization = `Bearer ${jwt(now + 900)}`;
    await assert.rejects(service.playback({ ...args, placementId: randomUUID() }, revisionId));
    await assert.rejects(service.playback({ ...args, parentId: f.chapter.id }, revisionId));
    await assert.rejects(service.playback(args, randomUUID()));
    const staged = await f.service.stage(f.args, assetId, { expectedMediaRevision: await f.revision(),
      filename: "next.mp4", mimeType: "video/mp4", bytes: 100 });
    await assert.rejects(service.playback(args, staged.revision!.id));
    const deny = async (change: () => Promise<unknown>, restore: () => Promise<unknown>) => {
      const count = issued.length;
      await change(); await assert.rejects(service.playback(args, revisionId)); await restore();
      assert.equal(issued.length, count);
    };
    await deny(() => f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { status: "revoked" } }),
      () => f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { status: "active" } }));
    await deny(() => f.db.enrollment.update({ where: { id: f.enrollment.id },
      data: { enrolledAt: new Date((now - 60) * 1000), expiresAt: new Date(now * 1000 - 1000) } }),
      () => f.db.enrollment.update({ where: { id: f.enrollment.id }, data: { enrolledAt: f.enrollment.enrolledAt, expiresAt: null } }));
    await deny(() => f.db.user.update({ where: { id: f.student.id }, data: { status: "suspended" } }),
      () => f.db.user.update({ where: { id: f.student.id }, data: { status: "active" } }));
    for (const model of [f.db.course, f.db.chapter, f.db.lesson] as const) {
      const id = model === f.db.course ? f.course.id : model === f.db.chapter ? f.chapter.id : f.lesson.id;
      for (const status of ["draft", "archived"] as const) {
        // Explicit model branches keep generated Prisma call signatures narrow.
        const set = (v: "draft" | "published" | "archived") => model === f.db.course
          ? f.db.course.update({ where: { id }, data: { status: v } })
          : model === f.db.chapter ? f.db.chapter.update({ where: { id }, data: { status: v } })
          : f.db.lesson.update({ where: { id }, data: { status: v } });
        await deny(() => set(status), () => set("published"));
      }
    }
    for (const status of ["draft", "archived", "removed"] as const) {
      await deny(() => f.db.mediaPlacement.update({ where: { id: placementId }, data: { status } }),
        () => f.db.mediaPlacement.update({ where: { id: placementId }, data: { status: "published" } }));
    }
    await deny(() => f.db.contentMediaAsset.update({ where: { id: assetId }, data: { status: "draft" } }),
      () => f.db.contentMediaAsset.update({ where: { id: assetId }, data: { status: "published" } }));
    // Committed evidence is immutable; even the test database cannot mutate it.
    await assert.rejects(f.db.mediaRevision.update({ where: { id: revisionId }, data: { privateReady: false } }));
    req.headers.authorization = `Bearer ${jwt(now - 1)}`;
    await assert.rejects(service.playback(args, revisionId));
    req.headers.authorization = `Bearer ${jwt(now + 900)}`;
    await assert.rejects(service.playback({ ...args, req: Object.assign(f.a, { headers: req.headers }) }, revisionId));
    const other = await f.db.course.create({ data: { title: "Other synthetic course", slug: randomUUID(),
      status: "published", createdBy: f.admin.id } });
    await f.db.enrollment.create({ data: { courseId: other.id, userId: f.student.id, grantedBy: f.admin.id } });
    await assert.rejects(service.playback({ ...args, scope: "courses", parentId: other.id }, revisionId));
    const group = await f.service.createCollection(f.args, { expectedMediaRevision: await f.revision(), title: "Synthetic collection", description: "" });
    await f.service.move(f.args, placementId, { expectedMediaRevision: await f.revision(), collectionId: group.collection!.id });
    await assert.rejects(service.playback(args, revisionId)); // collection still draft
    await f.service.collectionLifecycle(f.args, group.collection!.id, { expectedMediaRevision: await f.revision(), action: "publish" });
    const audit = f.store.audit;
    f.store.audit = async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE"); };
    await assert.rejects(service.playback(args, revisionId));
    f.store.audit = audit;
    await f.db.mediaCollection.update({ where: { id: group.collection!.id }, data: { status: "archived" } });
    await assert.rejects(service.playback(args, revisionId));
    assert.equal((await f.db.course.findUniqueOrThrow({ where: { id: f.course.id } })).editRevision, before.editRevision);
    assert.deepEqual(await f.db.lessonCompletion.findUniqueOrThrow({ where: { id: f.completion.id } }), completion);
  } finally { await f.close(); }
});
