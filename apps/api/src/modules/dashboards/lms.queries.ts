import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@workspace/saudisensei-database";
import { LmsStore } from "../courses/lms.store.js";
import type { ListInput } from "../courses/lms.schemas.js";
import { ProgressService } from "../progress/progress.service.js";
import { activeEnrollment } from "../enrollments/enrollments.service.js";

const summary = { id: true, displayName: true, email: true, status: true } as const;
const pageData = (q: ListInput) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
const envelope = <T>(items: T[], total: number, q: ListInput) => ({ items, total, page: q.page, pageSize: q.pageSize });
@Injectable()
export class LmsQueries {
  constructor(@Inject(LmsStore) private readonly store: LmsStore, @Inject(ProgressService) private readonly progress: ProgressService) {}
  adminCourses(q: ListInput) {
    return this.store.transaction(async (tx) => {
      const where: Prisma.CourseWhereInput = {
        ...(q.status && ["draft", "published", "archived"].includes(q.status) ? { status: q.status as "draft" | "published" | "archived" } : {}),
        ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }] } : {}),
      };
      const [items, total] = await Promise.all([
        tx.course.findMany({ where, ...pageData(q), orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
        tx.course.count({ where }),
      ]);
      return envelope(items, total, q);
    }, true);
  }
  students(q: ListInput) {
    return this.store.transaction(async (tx) => {
      const where: Prisma.UserWhereInput = { roles: { some: { role: { name: "student" } } },
        ...(q.search ? { OR: [{ displayName: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] } : {}) };
      const [items, total] = await Promise.all([
        tx.user.findMany({ where, select: summary, ...pageData(q), orderBy: [{ displayName: "asc" }, { id: "asc" }] }), tx.user.count({ where }),
      ]);
      return envelope(items, total, q);
    }, true);
  }
  async student(id: string) {
    const student = await this.store.db.user.findFirst({ where: { id, roles: { some: { role: { name: "student" } } } }, select: summary });
    if (!student) throw new NotFoundException("RESOURCE_NOT_FOUND");
    return student;
  }
  enrollments(q: ListInput, userId?: string) {
    return this.store.transaction(async (tx) => {
      const where: Prisma.EnrollmentWhereInput = userId ? activeEnrollment(userId) : {
        ...(q.courseId ? { courseId: q.courseId } : {}), ...(q.studentId ? { userId: q.studentId } : {}),
        ...(q.status && ["active", "revoked", "expired"].includes(q.status) ? { status: q.status as "active" | "revoked" | "expired" } : {}),
      };
      const [items, total] = await Promise.all([
        tx.enrollment.findMany({ where, ...pageData(q), include: { course: true, student: { select: summary } },
          orderBy: [{ enrolledAt: "desc" }, { id: "asc" }] }), tx.enrollment.count({ where }),
      ]);
      const progress = await this.progress.batch(tx, items);
      return envelope(items.map((item) => ({ ...item, progress: progress.get(item.id)! })), total, q);
    }, true);
  }
  myCourses(userId: string, q: ListInput) {
    return this.store.transaction(async (tx) => {
      const where: Prisma.EnrollmentWhereInput = { ...activeEnrollment(userId),
        course: { status: "published", archivedAt: null, ...(q.search ? { title: { contains: q.search, mode: "insensitive" } } : {}) } };
      const [enrollments, total] = await Promise.all([
        tx.enrollment.findMany({ where, ...pageData(q), include: { course: true }, orderBy: [{ enrolledAt: "desc" }, { id: "asc" }] }),
        tx.enrollment.count({ where }),
      ]);
      const progress = await this.progress.batch(tx, enrollments);
      return envelope(enrollments.map((e) => ({ ...e.course, enrollmentId: e.id, progress: progress.get(e.id)! })), total, q);
    }, true);
  }
  studentDashboard(userId: string) {
    return this.store.transaction(async (tx) => {
      const enrollments = await tx.enrollment.findMany({ where: activeEnrollment(userId), include: { course: true }, orderBy: [{ enrolledAt: "desc" }, { id: "asc" }] });
      const progress = await this.progress.batch(tx, enrollments);
      const all = enrollments.map((e) => ({ ...e.course, enrollmentId: e.id, progress: progress.get(e.id)! }));
      return { courses: all.slice(0, 12), totalCourses: all.length,
        completedRequired: all.reduce((total, c) => total + c.progress.completedRequired, 0),
        remainingRequired: all.reduce((total, c) => total + c.progress.remainingRequired, 0) };
    }, true);
  }
  adminDashboard() {
    return this.store.transaction(async (tx) => {
      const counts = await tx.course.groupBy({ by: ["status"], _count: { _all: true } });
      const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
      const [activeEnrollments, totalStudents] = await Promise.all([
        tx.enrollment.count({ where: { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
        tx.user.count({ where: { roles: { some: { role: { name: "student" } } } } }),
      ]);
      return { totalCourses: counts.reduce((n, c) => n + c._count._all, 0),
        draftCourses: count("draft"), publishedCourses: count("published"), archivedCourses: count("archived"), activeEnrollments, totalStudents };
    }, true);
  }
}
