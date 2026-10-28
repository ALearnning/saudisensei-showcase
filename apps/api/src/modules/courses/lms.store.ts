import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@workspace/saudisensei-database";
import type { AuthenticatedRequest } from "../authorization/authenticated-request.js";

export const LMS_DATABASE = Symbol("LMS_DATABASE");
export type Tx = Prisma.TransactionClient;
export type Actor = Pick<AuthenticatedRequest, "user" | "requestId">;

@Injectable()
export class LmsStore {
  constructor(@Inject(LMS_DATABASE) readonly db: PrismaClient) {}

  async transaction<T>(work: (tx: Tx) => Promise<T>, readOnly = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: readOnly ? Prisma.TransactionIsolationLevel.RepeatableRead : Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000, timeout: 15000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2034" && attempt < 2) continue;
          if (error.code === "P2002" || error.code === "P2034") throw new ConflictException("RESOURCE_CHANGED");
          if (error.code === "P2025") throw new NotFoundException("RESOURCE_NOT_FOUND");
        }
        throw error;
      }
    }
  }
  async courseLock(tx: Tx, id: string, shared = false) {
    // Parameterized PostgreSQL locks; always course before enrollment/descendant.
    const rows = shared
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM courses WHERE id=${id}::uuid FOR SHARE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM courses WHERE id=${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("RESOURCE_NOT_FOUND");
    return tx.course.findUniqueOrThrow({ where: { id } });
  }
  async audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject = {}) {
    await tx.auditLog.create({ data: {
      actorUserId: actor.user!.id, requestId: actor.requestId,
      action, entityType, entityId, metadata,
    } });
  }
  async mutate<T extends object>(
    id: string, expectedRevision: number, actor: Actor, action: string,
    work: (tx: Tx) => Promise<{ value: T; entityType: string; entityId: string; metadata?: Prisma.InputJsonObject }>,
  ) {
    return this.transaction(async (tx) => {
      const course = await this.courseLock(tx, id);
      if (course.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
      if (course.editRevision !== expectedRevision) throw new ConflictException("COURSE_CHANGED");
      const result = await work(tx);
      const updated = await tx.course.update({ where: { id }, data: { editRevision: { increment: 1 } } });
      await this.audit(tx, actor, action, result.entityType, result.entityId, result.metadata);
      return { ...result.value, editRevision: updated.editRevision };
    });
  }
}
