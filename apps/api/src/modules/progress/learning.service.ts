import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { LmsStore, type Tx } from "../courses/lms.store.js";
import { EnrollmentsService } from "../enrollments/enrollments.service.js";
import { ProgressService } from "./progress.service.js";

@Injectable()
export class LearningService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(EnrollmentsService) private readonly enrollments: EnrollmentsService,
    @Inject(ProgressService) private readonly progress: ProgressService) {}
  course(userId: string, courseId: string) {
    return this.store.transaction(async (tx) => {
      const enrollment = await this.enrollments.accessible(tx, userId, courseId);
      const course = await tx.course.findUniqueOrThrow({ where: { id: courseId }, include: {
        chapters: { where: { status: "published", archivedAt: null }, orderBy: { position: "asc" },
          include: { lessons: { where: { status: "published", archivedAt: null }, orderBy: { position: "asc" },
            select: { id: true, courseId: true, chapterId: true, title: true, status: true, isRequired: true, position: true,
              completions: { where: { enrollmentId: enrollment.id }, select: { id: true } } } } } },
      } });
      const progress = (await this.progress.batch(tx, [enrollment])).get(enrollment.id)!;
      return { ...course, enrollmentId: enrollment.id, progress,
        chapters: course.chapters.map((chapter) => ({ ...chapter,
          lessons: chapter.lessons.map(({ completions, ...lesson }) => ({ ...lesson, completed: completions.length > 0 })) })) };
    }, true);
  }
  async accessibleLesson(tx: Tx, userId: string, lessonId: string, lock: boolean) {
    const initial = await tx.lesson.findUnique({ where: { id: lessonId }, select: { courseId: true } });
    if (!initial) throw new NotFoundException("RESOURCE_NOT_FOUND");
    const enrollment = await this.enrollments.accessible(tx, userId, initial.courseId, lock);
    const lesson = await tx.lesson.findFirst({ where: {
      id: lessonId, courseId: initial.courseId, status: "published", archivedAt: null,
      chapter: { status: "published", archivedAt: null },
    } });
    if (!lesson) throw new NotFoundException("RESOURCE_NOT_FOUND");
    return { enrollment, lesson };
  }
  lesson(userId: string, lessonId: string) {
    return this.store.transaction(async (tx) => {
      const { enrollment, lesson } = await this.accessibleLesson(tx, userId, lessonId, false);
      const completion = await tx.lessonCompletion.findUnique({ where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } } });
      return { ...lesson, completed: Boolean(completion), progress: (await this.progress.batch(tx, [enrollment])).get(enrollment.id)! };
    }, true);
  }
  complete(userId: string, lessonId: string) {
    return this.store.transaction(async (tx) => {
      const { enrollment, lesson } = await this.accessibleLesson(tx, userId, lessonId, true);
      const completion = await tx.lessonCompletion.upsert({
        where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } },
        create: { enrollmentId: enrollment.id, lessonId, courseId: lesson.courseId }, update: {},
      });
      return { lessonId, completedAt: completion.completedAt, progress: (await this.progress.batch(tx, [enrollment])).get(enrollment.id)! };
    });
  }
  getProgress(userId: string, courseId: string) {
    return this.store.transaction(async (tx) => {
      const enrollment = await this.enrollments.accessible(tx, userId, courseId);
      return (await this.progress.batch(tx, [enrollment])).get(enrollment.id)!;
    }, true);
  }
}
