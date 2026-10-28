import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { libraryFixture } from "./media-library.fixture.js";
import * as s from "../src/modules/media/library.schemas.js";
import { MediaLibraryService } from "../src/modules/media/library.service.js";

test("media foundation strict input, safe defaults and allowlisted metadata", () => {
  const base = { expectedMediaRevision: 0, title: "synthetic", kind: "document", filename: "a.txt", mimeType: "text/plain", bytes: 12 };
  const parsed = s.parse(s.assetInput, base);
  assert.equal(parsed.downloadsAllowed, false);
  assert.equal(parsed.collectionId, null);
  for (const extra of [{ scanState: "clean" }, { state: "ready" }, { objectKey: "other/path" }, { providerRef: "public" }, { nestedCollectionId: "x" }]) {
    assert.throws(() => s.parse(s.assetInput, { ...base, ...extra }), BadRequestException);
  }
  for (const filename of ["../a.txt", "a\\b.txt", "a\n.txt"]) assert.throws(() => s.parse(s.assetInput, { ...base, filename }), BadRequestException);
  assert.throws(() => s.validateFormat("document", { filename: "a.exe", mimeType: "text/plain", bytes: 12 }, false), BadRequestException);
  assert.throws(() => s.validateFormat("image", { filename: "a.svg", mimeType: "image/svg+xml", bytes: 12 }, false), BadRequestException);
  assert.throws(() => s.validateFormat("video", { filename: "a.mp4", mimeType: "video/mp4", bytes: 12 }, true), BadRequestException);
  assert.throws(() => s.parse(s.orderInput, { expectedMediaRevision: 0, ids: ["invalid"] }), BadRequestException);
});

test("media foundation isolated database acceptance", async t => {
  const f = await libraryFixture();
  const { db, service, args, studentArgs, revision, create, ready, publish } = f;
  try {
    await t.test("fresh Admin MFA, local role and account checks; Student mutation denied", async () => {
      const body = s.parse(s.assetInput, { expectedMediaRevision: 0, title: "test", kind: "document", filename: "a.txt", mimeType: "text/plain", bytes: 12 });
      await assert.rejects(service.createAsset(studentArgs, body), ForbiddenException);
      await assert.rejects(service.createAsset({ ...args, req: f.actor(f.admin, ["admin"], false) }, body), ForbiddenException);
      await db.user.update({ where: { id: f.admin.id }, data: { status: "suspended" } });
      await assert.rejects(service.createAsset(args, body), ForbiddenException);
      await db.user.update({ where: { id: f.admin.id }, data: { status: "active" } });
      assert.equal(await revision(), 0);
      assert.equal(await db.contentMediaAsset.count(), 0);
      assert.equal(await db.auditLog.count(), 0);
    });
    const resource = await create();
    const assetId = resource.asset!.id, placementId = resource.placement!.id, initialId = resource.revision!.id;
    await t.test("pending/unscanned resources cannot activate, publish or appear to Students", async () => {
      await assert.rejects(service.activate(args, assetId, { expectedMediaRevision: await revision(), revisionId: initialId }), ConflictException);
      await assert.rejects(service.assetLifecycle(args, assetId, { expectedMediaRevision: await revision(), action: "publish" }), ConflictException);
      assert.equal((await service.list(studentArgs, false)).items.length, 0);
    });
    await publish(assetId, initialId, placementId);
    await t.test("published Student listing excludes locators, identity and staged metadata", async () => {
      const list = await service.list(studentArgs, false);
      assert.equal(list.items.length, 1);
      const text = JSON.stringify(list);
      assert.equal(/objectKey|previewKey|providerRef|createdBy|sha256|scanEngine|stagedRevisionId|mediaEditRevision|revisions/.test(text), false);
    });
    let stagedId = "";
    await t.test("processing and failed replacements preserve the working published revision", async () => {
      const staged = await service.stage(args, assetId, { expectedMediaRevision: await revision(), filename: "replacement.txt", mimeType: "text/plain", bytes: 32 });
      stagedId = staged.revision!.id;
      assert.equal((await service.list(studentArgs, false)).items[0].revision!.id, initialId);
      await db.mediaRevision.update({ where: { id: stagedId }, data: { state: "processing" } });
      await assert.rejects(service.activate(args, assetId, { expectedMediaRevision: await revision(), revisionId: stagedId }), ConflictException);
      await db.mediaRevision.update({ where: { id: stagedId }, data: { state: "failed" } });
      await assert.rejects(service.activate(args, assetId, { expectedMediaRevision: await revision(), revisionId: stagedId }), ConflictException);
      assert.equal((await service.list(studentArgs, false)).items[0].revision!.id, initialId);
      assert.equal((await db.contentMediaAsset.findUniqueOrThrow({ where: { id: assetId } })).status, "published");
    });
    await t.test("immutable metadata, sealed ready revisions and same-asset pointers enforced by PostgreSQL", async () => {
      await assert.rejects(db.mediaRevision.update({ where: { id: stagedId }, data: { filename: "changed.txt" } }));
      await assert.rejects(db.mediaRevision.update({ where: { id: initialId }, data: { objectKey: "changed" } }));
      await assert.rejects(db.mediaRevision.delete({ where: { id: initialId } }));
      const other = await create("other");
      await assert.rejects(db.contentMediaAsset.update({ where: { id: assetId }, data: { stagedRevisionId: other.revision!.id } }));
    });
    await t.test("ready replacement activates explicitly without unpublishing or destroying old content", async () => {
      await ready(stagedId);
      await service.activate(args, assetId, { expectedMediaRevision: await revision(), revisionId: stagedId });
      assert.equal((await service.list(studentArgs, false)).items.find(i => i.asset.id === assetId)!.revision!.id, stagedId);
      assert.equal(await db.mediaRevision.count({ where: { id: initialId } }), 1);
    });
    await t.test("cross-course attachment and cross-parent collection membership denied", async () => {
      const otherCourse = await db.course.create({ data: { title: "other synthetic", slug: "other-foundation", createdBy: f.admin.id } });
      const foreign = { ...args, scope: "courses" as const, parentId: otherCourse.id };
      await assert.rejects(service.attach(foreign, { expectedMediaRevision: 0, assetId, collectionId: null }), NotFoundException);
      const collection = await service.createCollection({ ...args, scope: "chapters", parentId: f.chapter.id },
        { expectedMediaRevision: await revision(), title: "chapter group", description: "" });
      await assert.rejects(service.move(args, placementId, { expectedMediaRevision: await revision(), collectionId: collection.collection!.id }), NotFoundException);
      await assert.rejects(db.mediaPlacement.update({ where: { id: placementId }, data: { collectionId: collection.collection!.id } }));
      await assert.rejects(db.mediaPlacement.update({ where: { id: placementId }, data: { courseId: otherCourse.id } }));
    });
    await t.test("course, chapter and lesson scopes have separate listings with shared media concurrency", async () => {
      const courseArgs = { ...args, scope: "courses" as const, parentId: f.course.id };
      const chapterArgs = { ...args, scope: "chapters" as const, parentId: f.chapter.id };
      await create("course resource", courseArgs);
      await create("chapter resource", chapterArgs);
      assert.equal((await service.list(courseArgs, true)).items.length, 1);
      assert.equal((await service.list(chapterArgs, true)).items.length, 1);
      assert.equal((await service.list(args, true)).mediaEditRevision, await revision());
    });
    await t.test("flat collections hide unpublished groups and support same-parent movement", async () => {
      const collection = await service.createCollection(args, { expectedMediaRevision: await revision(), title: "group", description: "flat" });
      await service.move(args, placementId, { expectedMediaRevision: await revision(), collectionId: collection.collection!.id });
      assert.equal((await service.list(studentArgs, false)).items.some(i => i.asset.id === assetId), false);
      await service.collectionLifecycle(args, collection.collection!.id, { expectedMediaRevision: await revision(), action: "publish" });
      assert.equal((await service.list(studentArgs, false)).items.some(i => i.asset.id === assetId), true);
      await service.updateCollection(args, collection.collection!.id, { expectedMediaRevision: await revision(), title: "renamed" });
      await service.reorder(args, { expectedMediaRevision: await revision(), ids: [collection.collection!.id], collectionId: null }, true);
      await service.collectionLifecycle(args, collection.collection!.id, { expectedMediaRevision: await revision(), action: "archive" });
      await assert.rejects(service.updateAsset(args, assetId, { expectedMediaRevision: await revision(), title: "blocked" }), ConflictException);
      await assert.rejects(service.collectionLifecycle(args, collection.collection!.id, { expectedMediaRevision: await revision(), action: "publish" }), ConflictException);
    });
    await t.test("ordering requires exact parent/group permutation and never updates archived resources", async () => {
      const first = await create("ordered one"), second = await create("ordered two");
      const list = (await service.list(args, true)).items.filter(i => i.placement.collectionId === null && "status" in i.asset && i.asset.status === "draft");
      const ids = list.map(i => i.placement.id).reverse();
      await service.reorder(args, { expectedMediaRevision: await revision(), ids, collectionId: null });
      assert.equal((await db.mediaPlacement.findUniqueOrThrow({ where: { id: ids[0] } })).position, 0);
      await assert.rejects(service.reorder(args, { expectedMediaRevision: await revision(), ids: [first.placement!.id], collectionId: null }), BadRequestException);
      await service.placementLifecycle(args, second.placement!.id, { expectedMediaRevision: await revision(), action: "archive" });
      await assert.rejects(service.move(args, second.placement!.id, { expectedMediaRevision: await revision(), collectionId: null }), ConflictException);
    });
    await t.test("concurrent edits allow one writer and reject the stale writer", async () => {
      const editable = await create("concurrency target"), expected = await revision();
      const results = await Promise.allSettled([
        service.updateAsset(args, editable.asset!.id, { expectedMediaRevision: expected, title: "one" }),
        service.updateAsset(args, editable.asset!.id, { expectedMediaRevision: expected, title: "two" }),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected" && r.reason instanceof ConflictException).length, 1);
      assert.equal(await revision(), expected + 1);
    });
    await t.test("mutation, independent revision and audit roll back atomically on audit failure", async () => {
      const beforeAssets = await db.contentMediaAsset.count(), before = await revision(), beforeAudits = await db.auditLog.count();
      const broken = new MediaLibraryService(Object.assign(Object.create(f.store), { audit: async () => { throw new Error("SYNTHETIC_AUDIT_FAILURE"); } }));
      await assert.rejects(broken.createCollection(args, { expectedMediaRevision: before, title: "rollback", description: "" }));
      assert.equal(await revision(), before);
      assert.equal(await db.mediaCollection.count({ where: { title: "rollback" } }), 0);
      assert.equal(await db.contentMediaAsset.count(), beforeAssets);
      assert.equal(await db.auditLog.count(), beforeAudits);
      assert.equal((await db.auditLog.findMany()).some(a => /objectKey|https:|providerRef|previewKey|scanEngine/.test(JSON.stringify(a.metadata))), false);
    });
    await t.test("archived course/chapter/lesson ancestry is read-only without altering old learning rules", async () => {
      for (const parent of ["lesson", "chapter", "course"] as const) {
        const model = parent === "lesson" ? db.lesson : parent === "chapter" ? db.chapter : db.course;
        const id = f[parent].id;
        // Each model shares the required update shape.
        await (model.update as Function)({ where: { id }, data: { status: "archived" } });
        await assert.rejects(create(), ConflictException);
        await assert.rejects(service.list(studentArgs, false), NotFoundException);
        await (model.update as Function)({ where: { id }, data: { status: "published" } });
      }
    });
    await t.test("fresh enrollment/account/content checks block Student listings", async () => {
      await db.enrollment.update({ where: { id: f.enrollment.id }, data: { status: "revoked" } });
      await assert.rejects(service.list(studentArgs, false), NotFoundException);
      await db.enrollment.update({ where: { id: f.enrollment.id }, data: { status: "active", expiresAt: new Date(Date.now() - 1000) } });
      await assert.rejects(service.list(studentArgs, false), NotFoundException);
      await db.enrollment.update({ where: { id: f.enrollment.id }, data: { expiresAt: null } });
      await db.user.update({ where: { id: f.student.id }, data: { status: "suspended" } });
      await assert.rejects(service.list(studentArgs, false), ForbiddenException);
      await db.user.update({ where: { id: f.student.id }, data: { status: "active" } });
      await db.lesson.update({ where: { id: f.lesson.id }, data: { status: "draft" } });
      await assert.rejects(service.list(studentArgs, false), NotFoundException);
      await db.lesson.update({ where: { id: f.lesson.id }, data: { status: "published" } });
    });
    await t.test("unpublish/republish, logical removal, retained metadata and history isolation", async () => {
      const removable = await create("lifecycle"), id = removable.asset!.id;
      await publish(id, removable.revision!.id, removable.placement!.id);
      await service.assetLifecycle(args, id, { expectedMediaRevision: await revision(), action: "unpublish" });
      assert.equal((await service.list(studentArgs, false)).items.some(i => i.asset.id === id), false);
      await service.assetLifecycle(args, id, { expectedMediaRevision: await revision(), action: "publish" });
      await service.assetLifecycle(args, id, { expectedMediaRevision: await revision(), action: "remove" });
      assert.equal((await service.list(studentArgs, false)).items.some(i => i.asset.id === id), false);
      assert.equal(await db.mediaRevision.count({ where: { assetId: id } }), 1);
      await assert.rejects(service.updateAsset(args, id, { expectedMediaRevision: await revision(), title: "restore" }), ConflictException);
      assert.deepEqual(await db.lessonCompletion.findUniqueOrThrow({ where: { id: f.completion.id } }), f.completion);
      const restoredEnrollment = await db.enrollment.findUniqueOrThrow({ where: { id: f.enrollment.id } });
      assert.equal(restoredEnrollment.status, f.enrollment.status);
      assert.equal(restoredEnrollment.expiresAt, f.enrollment.expiresAt);
      assert.equal(restoredEnrollment.id, f.enrollment.id);
      assert.equal((await db.course.findUniqueOrThrow({ where: { id: f.course.id } })).editRevision, f.course.editRevision);
      assert.equal(await db.lessonCompletion.count(), 1);
      assert.equal(await db.lesson.count({ where: { isRequired: true, status: "published", chapter: { status: "published" } } }), 1);
    });
  } finally { await f.close(); }
});
