import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { parse, uuid } from "../courses/lms.schemas.js";
import { EnrollmentsService } from "../enrollments/enrollments.service.js";

export type AssessmentParent = {
  scope: "courses" | "chapters" | "lessons";
  parentId: string;
  /** Optional expected owning course, supplied from a server-loaded quiz. */
  expectedCourseId?: string;
};
export type AssessmentParentContext = {
  courseId: string; parentType: AssessmentParent["scope"]; parentId: string;
  chapterId: string | null; lessonId: string | null;
};
export interface AssessmentAccessPort {
  admin(tx: Tx, request: AuthenticatedRequest, parent: AssessmentParent, mutation?: boolean): Promise<AssessmentParentContext>;
  student(tx: Tx, request: AuthenticatedRequest, parent: AssessmentParent, lockEnrollment?: boolean):
    Promise<AssessmentParentContext & { enrollmentId: string; userId: string }>;
}

const unavailable = () => new NotFoundException("QUIZ_UNAVAILABLE");

/**
 * Internal parent-authorization seam, not an HTTP endpoint or attempt engine.
 * Call inside LmsStore.transaction; global IdentityGuard/RolesGuard still own
 * authentication and signed MFA verification when future controllers are added.
 * Current local account/role checks protect against stale caller context.
 */
@Injectable()
export class AssessmentAccessService implements AssessmentAccessPort {
  constructor(
    @Inject(LmsStore) private readonly store: LmsStore,
    @Inject(EnrollmentsService) private readonly enrollments: EnrollmentsService,
  ) {}

  private async context(tx: Tx, req: AuthenticatedRequest, parent: AssessmentParent,
    role: "admin" | "student", mutation: boolean) {
    if (!["courses", "chapters", "lessons"].includes(parent.scope)) throw new BadRequestException("INVALID_INPUT");
    const id = parse(uuid, parent.parentId);
    if (parent.expectedCourseId !== undefined) parse(uuid, parent.expectedCourseId);
    const initial = parent.scope === "courses" ? await tx.course.findUnique({ where: { id } })
      : parent.scope === "chapters" ? await tx.chapter.findUnique({ where: { id } })
        : await tx.lesson.findUnique({ where: { id } });
    if (!initial) throw unavailable();
    const courseId = "courseId" in initial ? initial.courseId : initial.id;
    if (parent.expectedCourseId !== undefined && parent.expectedCourseId !== courseId) throw unavailable();
    const course = await this.store.courseLock(tx, courseId, !mutation);
    const user = req.user && await tx.user.findUnique({
      where: { id: req.user.id }, include: { roles: { include: { role: true } } },
    });
    if (!user || user.status !== "active") throw new ForbiddenException("ACCOUNT_INACTIVE");
    if (!user.roles.some(r => r.role.name === role)) throw new ForbiddenException("ROLE_REQUIRED");
    if (role === "admin" && req.mfaVerified !== true) throw new ForbiddenException("ADMIN_MFA_REQUIRED");

    const lesson = parent.scope === "lessons" ? await tx.lesson.findUnique({ where: { id } }) : null;
    const chapter = parent.scope === "chapters" || lesson
      ? await tx.chapter.findUnique({ where: { id: lesson?.chapterId ?? id } }) : null;
    if ((parent.scope === "lessons" && (!lesson || lesson.courseId !== courseId)) ||
      (parent.scope !== "courses" && (!chapter || chapter.courseId !== courseId))) throw unavailable();
    const ancestors = [course, ...(chapter ? [chapter] : []), ...(lesson ? [lesson] : [])];
    if (role === "admin" && mutation && ancestors.some(p => p.status === "archived" || p.archivedAt)) {
      throw new ConflictException("ARCHIVED_READ_ONLY");
    }
    if (role === "student" && (ancestors.some(p => p.status !== "published" || p.archivedAt) ||
      (lesson && !lesson.body.trim()))) throw unavailable();
    return {
      courseId, parentType: parent.scope, parentId: id, chapterId: chapter?.id ?? null, lessonId: lesson?.id ?? null,
    };
  }

  admin(tx: Tx, request: AuthenticatedRequest, parent: AssessmentParent, mutation = false) {
    return this.context(tx, request, parent, "admin", mutation);
  }

  async student(tx: Tx, request: AuthenticatedRequest, parent: AssessmentParent, lockEnrollment = false) {
    const ctx = await this.context(tx, request, parent, "student", false);
    // Reuse the existing active/unexpired enrollment policy, including its lock
    // order, instead of implementing a second enrollment expiration policy.
    const enrollment = await this.enrollments.accessible(tx, request.user.id, ctx.courseId, lockEnrollment);
    return { ...ctx, enrollmentId: enrollment.id, userId: request.user.id };
  }
}
