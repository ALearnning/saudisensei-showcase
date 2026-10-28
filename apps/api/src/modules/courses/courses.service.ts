import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { LmsStore, type Actor } from "./lms.store.js";

@Injectable()
export class CoursesService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}
  create(actor: Actor, data: { title: string; description: string }) {
    return this.store.transaction(async (tx) => {
      const slug = `${data.title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 120)}-${randomUUID().slice(0, 8)}`;
      const course = await tx.course.create({ data: { ...data, slug, createdBy: actor.user!.id } });
      await this.store.audit(tx, actor, "course.created", "course", course.id, { fields: ["title", "description"] });
      return course;
    });
  }
  async get(id: string) {
    const course = await this.store.db.course.findUnique({
      where: { id }, include: { chapters: { orderBy: { position: "asc" }, include: { lessons: { orderBy: { position: "asc" } } } } },
    });
    if (!course) throw new NotFoundException("RESOURCE_NOT_FOUND");
    return { ...course, chapters: course.chapters.map((chapter) => ({
      ...chapter, editRevision: course.editRevision,
      lessons: chapter.lessons.map((lesson) => ({ ...lesson, editRevision: course.editRevision })),
    })) };
  }
  edit(id: string, actor: Actor, input: { expectedRevision: number; title?: string; description?: string }) {
    const { expectedRevision, ...data } = input;
    return this.store.mutate(id, expectedRevision, actor, "course.edited", async (tx) => ({
      value: await tx.course.update({ where: { id }, data }), entityType: "course", entityId: id,
      metadata: { fields: Object.keys(data) },
    }));
  }
  transition(id: string, actor: Actor, expectedRevision: number, status: "draft" | "published" | "archived") {
    return this.store.mutate(id, expectedRevision, actor, `course.${status}`, async (tx) => {
      if (status === "published") {
        const chapters = await tx.chapter.findMany({ where: { courseId: id, status: "published", archivedAt: null },
          select: { lessons: { where: { status: "published", archivedAt: null }, select: { body: true } } } });
        if (!chapters.some((chapter) => chapter.lessons.some((lesson) => lesson.body.trim())))
          throw new BadRequestException("PUBLISHED_STRUCTURE_REQUIRED");
      }
      const before = await tx.course.findUniqueOrThrow({ where: { id } });
      const value = await tx.course.update({ where: { id }, data: {
        status, archivedAt: status === "archived" ? new Date() : null,
        publishedAt: status === "published" ? before.publishedAt ?? new Date() : before.publishedAt,
      } });
      return { value, entityType: "course", entityId: id, metadata: { before: before.status, after: status } };
    });
  }
}
