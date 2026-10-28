import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { LmsStore, type Actor, type Tx } from "./lms.store.js";

type Change = { expectedRevision: number; title?: string; body?: string; isRequired?: boolean; status?: "draft" | "published" | "archived" };
@Injectable()
export class StructureService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}
  async chapter(id: string) {
    const chapter = await this.store.db.chapter.findUnique({ where: { id },
      include: { course: { select: { editRevision: true } }, lessons: { orderBy: { position: "asc" } } } });
    if (!chapter) throw new NotFoundException("RESOURCE_NOT_FOUND");
    const { course, ...value } = chapter;
    return { ...value, editRevision: course.editRevision,
      lessons: value.lessons.map((lesson) => ({ ...lesson, editRevision: course.editRevision })) };
  }
  async lesson(id: string) {
    const lesson = await this.store.db.lesson.findUnique({ where: { id }, include: { chapter: { include: { course: { select: { editRevision: true } } } } } });
    if (!lesson) throw new NotFoundException("RESOURCE_NOT_FOUND");
    const { chapter, ...value } = lesson;
    return { ...value, editRevision: chapter.course.editRevision };
  }
  createChapter(courseId: string, actor: Actor, input: { expectedRevision: number; title: string }) {
    return this.store.mutate(courseId, input.expectedRevision, actor, "chapter.created", async (tx) => {
      const max = await tx.chapter.aggregate({ where: { courseId }, _max: { position: true } });
      const value = await tx.chapter.create({ data: { courseId, title: input.title, position: (max._max.position ?? -1) + 1 } });
      return { value: { ...value, lessons: [] }, entityType: "chapter", entityId: value.id };
    });
  }
  async editChapter(id: string, actor: Actor, input: Change) {
    const initial = await this.chapter(id);
    const { expectedRevision, ...data } = input;
    return this.store.mutate(initial.courseId, expectedRevision, actor, "chapter.edited", async (tx) => {
      const current = await tx.chapter.findUniqueOrThrow({ where: { id } });
      if (current.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
      if (data.status === "published") {
        const lessons = await tx.lesson.findMany({ where: { chapterId: id, status: "published", archivedAt: null }, select: { body: true } });
        if (!lessons.some((lesson) => lesson.body.trim())) throw new BadRequestException("PUBLISHED_STRUCTURE_REQUIRED");
      }
      const value = await tx.chapter.update({ where: { id }, data: {
        title: data.title, status: data.status, archivedAt: data.status === "archived" ? new Date() : undefined,
      }, include: { lessons: { orderBy: { position: "asc" } } } });
      return { value, entityType: "chapter", entityId: id, metadata: { fields: Object.keys(data), before: current.status, after: value.status } };
    });
  }
  async createLesson(chapterId: string, actor: Actor, input: { expectedRevision: number; title: string; body: string; isRequired: boolean }) {
    const initial = await this.chapter(chapterId);
    return this.store.mutate(initial.courseId, input.expectedRevision, actor, "lesson.created", async (tx) => {
      const chapter = await tx.chapter.findUniqueOrThrow({ where: { id: chapterId } });
      if (chapter.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
      const max = await tx.lesson.aggregate({ where: { chapterId }, _max: { position: true } });
      const value = await tx.lesson.create({ data: {
        chapterId, courseId: chapter.courseId, title: input.title, body: input.body, isRequired: input.isRequired,
        position: (max._max.position ?? -1) + 1,
      } });
      return { value, entityType: "lesson", entityId: value.id };
    });
  }
  async editLesson(id: string, actor: Actor, input: Change) {
    const initial = await this.lesson(id);
    const { expectedRevision, ...data } = input;
    return this.store.mutate(initial.courseId, expectedRevision, actor, "lesson.edited", async (tx) => {
      const current = await tx.lesson.findUniqueOrThrow({ where: { id }, include: { chapter: true } });
      if (current.status === "archived" || current.chapter.status === "archived") throw new ConflictException("ARCHIVED_READ_ONLY");
      if ((data.status ?? current.status) === "published" && !(data.body ?? current.body).trim())
        throw new BadRequestException("LESSON_BODY_REQUIRED");
      const value = await tx.lesson.update({ where: { id }, data: { ...data, archivedAt: data.status === "archived" ? new Date() : undefined } });
      return { value, entityType: "lesson", entityId: id, metadata: { fields: Object.keys(data), before: current.status, after: value.status } };
    });
  }
  async reorder(kind: "chapter" | "lesson", parentId: string, actor: Actor, input: { expectedRevision: number; orderedIds: string[] }) {
    const courseId = kind === "chapter" ? parentId : (await this.chapter(parentId)).courseId;
    return this.store.mutate(courseId, input.expectedRevision, actor, `${kind}.reordered`, async (tx) => {
      if (kind === "lesson" && (await tx.chapter.findUniqueOrThrow({ where: { id: parentId } })).status === "archived")
        throw new ConflictException("ARCHIVED_READ_ONLY");
      const rows = kind === "chapter"
        ? await tx.chapter.findMany({ where: { courseId }, orderBy: { position: "asc" } })
        : await tx.lesson.findMany({ where: { chapterId: parentId }, orderBy: { position: "asc" } });
      const active = rows.filter((row) => row.status !== "archived");
      if (input.orderedIds.length !== active.length || new Set(input.orderedIds).size !== active.length ||
          input.orderedIds.some((id) => !active.some((row) => row.id === id))) throw new BadRequestException("INVALID_ORDER");
      const ids = input.orderedIds;
      const positions = active.map((row) => row.position);
      const temporary = Math.max(0, ...rows.map((row) => row.position)) + rows.length + 1;
      const update = (id: string, position: number) => kind === "chapter"
        ? tx.chapter.update({ where: { id }, data: { position } })
        : tx.lesson.update({ where: { id }, data: { position } });
      for (let i = 0; i < ids.length; i++) await update(ids[i]!, temporary + i);
      // Archived rows retain every field, including their positions/timestamps.
      // Move active siblings only into the existing active position slots.
      for (let i = 0; i < ids.length; i++) await update(ids[i]!, positions[i]!);
      const value = kind === "chapter"
        ? await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: { chapters: { orderBy: { position: "asc" }, include: { lessons: { orderBy: { position: "asc" } } } } } })
        : await tx.chapter.findUniqueOrThrow({ where: { id: parentId }, include: { lessons: { orderBy: { position: "asc" } } } });
      let index = 0;
      const after = rows.map((row) => row.status === "archived" ? row.id : ids[index++]!);
      return { value, entityType: kind === "chapter" ? "course" : "chapter", entityId: parentId, metadata: { before: rows.map((r) => r.id), after } };
    });
  }
}
