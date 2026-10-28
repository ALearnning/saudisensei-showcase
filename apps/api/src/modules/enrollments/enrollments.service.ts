import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { LmsStore, type Actor, type Tx } from "../courses/lms.store.js";

export function activeEnrollment(userId: string, courseId?: string) {
  return { userId, ...(courseId ? { courseId } : {}), status: "active" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    course: { status: "published" as const, archivedAt: null } };
}
@Injectable()
export class EnrollmentsService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}
  async accessible(tx: Tx, userId: string, courseId: string, lock = false) {
    if (lock) {
      const course = await this.store.courseLock(tx, courseId, true);
      if (course.status !== "published" || course.archivedAt) throw new NotFoundException("RESOURCE_NOT_FOUND");
    }
    const row = await tx.enrollment.findFirst({ where: activeEnrollment(userId, courseId) });
    if (!row) throw new NotFoundException("RESOURCE_NOT_FOUND");
    if (lock) await tx.$queryRaw`SELECT id FROM enrollments WHERE id=${row.id}::uuid FOR UPDATE`;
    return row;
  }
  private async eligible(tx: Tx, userId: string) {
    const student = await tx.user.findFirst({ where: { id: userId, status: "active", roles: { some: { role: { name: "student" } } } } });
    if (!student) throw new ConflictException("STUDENT_NOT_ELIGIBLE");
  }
  grant(actor: Actor, courseId: string, userId: string) {
    return this.store.transaction(async (tx) => {
      const course = await this.store.courseLock(tx, courseId, true);
      if (course.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
      await this.eligible(tx, userId);
      const previous = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } });
      const active = previous?.status === "active" && (!previous.expiresAt || previous.expiresAt > new Date());
      const value = active ? previous : await tx.enrollment.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, grantedBy: actor.user!.id },
        update: { status: "active", revokedAt: null, expiresAt: null, grantedBy: actor.user!.id },
      });
      await this.store.audit(tx, actor, previous ? "enrollment.reactivated" : "enrollment.granted", "enrollment", value.id, { courseId, studentId: userId, unchanged: Boolean(active) });
      return value;
    });
  }
  async change(actor: Actor, id: string, status: "active" | "revoked") {
    const initial = await this.store.db.enrollment.findUnique({ where: { id } });
    if (!initial) throw new NotFoundException("RESOURCE_NOT_FOUND");
    return this.store.transaction(async (tx) => {
      const course = await this.store.courseLock(tx, initial.courseId, true);
      await tx.$queryRaw`SELECT id FROM enrollments WHERE id=${id}::uuid FOR UPDATE`;
      if (status === "active") {
        if (course.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
        await this.eligible(tx, initial.userId);
      }
      const current = await tx.enrollment.findUniqueOrThrow({ where: { id } });
      const value = await tx.enrollment.update({ where: { id }, data: status === "active"
        ? { status, revokedAt: null, expiresAt: null, grantedBy: actor.user!.id }
        : { status, revokedAt: current.revokedAt ?? new Date() } });
      await this.store.audit(tx, actor, `enrollment.${status}`, "enrollment", id, { before: current.status, after: status });
      return value;
    });
  }
}
