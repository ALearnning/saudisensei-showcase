import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import type { Scope } from "./library.schemas.js";
export const missing = () => new NotFoundException("MEDIA_UNAVAILABLE");
export async function libraryContext(store: LmsStore, tx: Tx, req: AuthenticatedRequest,
  scope: Scope, parentId: string, admin: boolean, mutation = false) {
  const first = scope === "courses" ? await tx.course.findUnique({ where: { id: parentId } })
    : scope === "chapters" ? await tx.chapter.findUnique({ where: { id: parentId } })
    : await tx.lesson.findUnique({ where: { id: parentId } });
  if (!first) throw missing();
  const courseId = "courseId" in first ? first.courseId : first.id;
  const course = await store.courseLock(tx, courseId);
  const user = await tx.user.findUnique({ where: { id: req.user.id }, include: { roles: { include: { role: true } } } });
  if (!user || user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
  if (!user.roles.some(r => r.role.name === (admin ? "admin" : "student")) ||
      (admin && !req.mfaVerified)) throw new ForbiddenException("MEDIA_FORBIDDEN");
  const lesson = scope === "lessons" ? await tx.lesson.findUnique({ where: { id: parentId } }) : null;
  const chapter = scope === "chapters" || lesson
    ? await tx.chapter.findUnique({ where: { id: lesson?.chapterId ?? parentId } }) : null;
  if ((scope === "lessons" && (!lesson || lesson.courseId !== courseId)) ||
      (scope !== "courses" && (!chapter || chapter.courseId !== courseId))) throw missing();
  const statuses = [course.status, ...(chapter ? [chapter.status] : []), ...(lesson ? [lesson.status] : [])];
  if (admin && mutation && statuses.includes("archived")) throw new ConflictException("ARCHIVED_READ_ONLY");
  if (!admin) {
    if (statuses.some(v => v !== "published") || (lesson && !lesson.body.trim())) throw missing();
    const enrollment = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } });
    if (!enrollment || enrollment.status !== "active" || (enrollment.expiresAt && enrollment.expiresAt <= new Date())) throw missing();
  }
  return { courseId, parentType: scope, parentId, chapterId: chapter?.id ?? null, lessonId: lesson?.id ?? null };
}
export type LibraryContext = Awaited<ReturnType<typeof libraryContext>>;
export function editable(status: string) {
  if (status === "archived" || status === "removed") throw new ConflictException("ARCHIVED_READ_ONLY");
}
