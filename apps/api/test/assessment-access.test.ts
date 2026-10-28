import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { HttpException, NotFoundException } from "@nestjs/common";
import { AssessmentAccessService, type AssessmentParent } from "../src/modules/assessments/assessment-access.service.js";
import { AssessmentsModule } from "../src/modules/assessments/assessments.module.js";
import { REQUIRED_ROLES } from "../src/modules/authorization/access.decorators.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";
import { EnrollmentsService } from "../src/modules/enrollments/enrollments.service.js";
import { LmsStore, type Tx } from "../src/modules/courses/lms.store.js";

function fixture() {
  const course = { id: randomUUID(), status: "published", archivedAt: null as Date | null };
  const chapter = { id: randomUUID(), courseId: course.id, status: "published", archivedAt: null as Date | null };
  const lesson = { id: randomUUID(), chapterId: chapter.id, courseId: course.id, status: "published",
    archivedAt: null as Date | null, body: "# Approved Markdown" };
  const user = { id: randomUUID(), status: "active", roles: [{ role: { name: "student" } }] };
  const req = { user: { id: user.id }, mfaVerified: false } as AuthenticatedRequest;
  const parent: AssessmentParent = { scope: "lessons", parentId: lesson.id, expectedCourseId: course.id };
  const observed: unknown[][] = [];
  let enrolled = true;
  const tx = {
    course: { findUnique: async () => course },
    chapter: { findUnique: async () => chapter },
    lesson: { findUnique: async () => lesson },
    user: { findUnique: async () => user },
  } as unknown as Tx;
  const store = { courseLock: async (...args: unknown[]) => { observed.push(["courseLock", ...args.slice(1)]); return course; } } as unknown as LmsStore;
  const enrollments = { accessible: async (...args: unknown[]) => {
    observed.push(["accessible", ...args.slice(1)]);
    if (!enrolled) throw new NotFoundException("RESOURCE_NOT_FOUND");
    return { id: "fixture-enrollment" };
  } } as unknown as EnrollmentsService;
  return { course, chapter, lesson, user, req, parent, tx, store, enrollments,
    access: new AssessmentAccessService(store, enrollments), observed, revoke: () => { enrolled = false; } };
}
const rejectsCode = (fn: () => Promise<unknown>, status: number, message: string) =>
  assert.rejects(fn, (e: unknown) => e instanceof HttpException && e.getStatus() === status && e.message === message);

test("assessment parent access reuses existing enrollment policy and lock order without a writer", async () => {
  const f = fixture();
  const ctx = await f.access.student(f.tx, f.req, f.parent, true);
  assert.equal(ctx.courseId, f.course.id);
  assert.equal(ctx.lessonId, f.lesson.id);
  assert.equal(ctx.enrollmentId, "fixture-enrollment");
  assert.deepEqual(f.observed, [
    ["courseLock", f.course.id, true], ["accessible", f.user.id, f.course.id, true],
  ]);
});

test("assessment authoring seam denies Student even with a claimed MFA flag", async () => {
  const f = fixture(); f.req.mfaVerified = true;
  await rejectsCode(() => f.access.admin(f.tx, f.req, f.parent, true), 403, "ROLE_REQUIRED");
});

test("assessment Admin requires genuine upstream-verified MFA context and active local role", async () => {
  const f = fixture(); f.user.roles = [{ role: { name: "admin" } }];
  await rejectsCode(() => f.access.admin(f.tx, f.req, f.parent, true), 403, "ADMIN_MFA_REQUIRED");
  f.req.mfaVerified = true;
  assert.equal((await f.access.admin(f.tx, f.req, f.parent, true)).courseId, f.course.id);
  f.user.roles = [];
  await rejectsCode(() => f.access.admin(f.tx, f.req, f.parent), 403, "ROLE_REQUIRED");
});

test("local inactive account is denied despite stale authenticated caller", async () => {
  const f = fixture(); f.user.status = "suspended";
  await rejectsCode(() => f.access.student(f.tx, f.req, f.parent), 403, "ACCOUNT_INACTIVE");
});

test("cross-course parent is non-enumerating", async () => {
  const f = fixture(); f.parent.expectedCourseId = randomUUID();
  await rejectsCode(() => f.access.student(f.tx, f.req, f.parent), 404, "QUIZ_UNAVAILABLE");
});

test("all Student ancestors must remain published and non-archived", async () => {
  for (const which of ["course", "chapter", "lesson"] as const) {
    const f = fixture(); f[which].status = "draft";
    await rejectsCode(() => f.access.student(f.tx, f.req, f.parent), 404, "QUIZ_UNAVAILABLE");
    f[which].status = "published"; f[which].archivedAt = new Date();
    await rejectsCode(() => f.access.student(f.tx, f.req, f.parent), 404, "QUIZ_UNAVAILABLE");
  }
});

test("archived parents are Admin read-only", async () => {
  for (const which of ["course", "chapter", "lesson"] as const) {
    const f = fixture(); f.user.roles = [{ role: { name: "admin" } }]; f.req.mfaVerified = true;
    f[which].status = "archived";
    await rejectsCode(() => f.access.admin(f.tx, f.req, f.parent, true), 409, "ARCHIVED_READ_ONLY");
    assert.equal((await f.access.admin(f.tx, f.req, f.parent)).courseId, f.course.id);
  }
});

test("revoked or expired enrollment policy failure propagates without fallback", async () => {
  const f = fixture(); f.revoke();
  await rejectsCode(() => f.access.student(f.tx, f.req, f.parent), 404, "RESOURCE_NOT_FOUND");
});

test("lesson publication still requires nonempty Markdown; assessment does not replace it", async () => {
  const f = fixture(); f.lesson.body = " \n ";
  await rejectsCode(() => f.access.student(f.tx, f.req, f.parent), 404, "QUIZ_UNAVAILABLE");
});

test("course and chapter parents resolve without pretending to be lesson assessments", async () => {
  const f = fixture();
  const course = await f.access.student(f.tx, f.req, { scope: "courses", parentId: f.course.id });
  assert.equal(course.chapterId, null); assert.equal(course.lessonId, null);
  const chapter = await f.access.student(f.tx, f.req, { scope: "chapters", parentId: f.chapter.id });
  assert.equal(chapter.chapterId, f.chapter.id); assert.equal(chapter.lessonId, null);
});

test("parent scope/identifiers fail closed", async () => {
  const f = fixture();
  await rejectsCode(() => f.access.student(f.tx, f.req, { scope: "arbitrary" as "courses", parentId: f.course.id }), 400, "INVALID_INPUT");
  await rejectsCode(() => f.access.student(f.tx, f.req, { scope: "courses", parentId: "not-an-id" }), 400, "INVALID_INPUT");
});

test("AssessmentsModule preserves Admin authoring and explicitly identifies Student attempt controllers", async () => {
  const f = fixture();
  for (const controller of Reflect.getMetadata("controllers", AssessmentsModule) ?? []) {
    const student = ["AttemptsController", "StudentQuizzesController", "AssessmentResultsController"].includes(controller.name);
    assert.deepEqual(Reflect.getMetadata(REQUIRED_ROLES, controller), [student ? "student" : "admin"]);
  }
  const module = await Test.createTestingModule({ imports: [AssessmentsModule] })
    .overrideProvider(LmsStore).useValue(f.store)
    .overrideProvider(EnrollmentsService).useValue(f.enrollments)
    .compile();
  assert.ok(module.get(AssessmentAccessService));
  await module.close();
});
