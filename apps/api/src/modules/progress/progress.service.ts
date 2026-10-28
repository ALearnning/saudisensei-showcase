import { Inject, Injectable } from "@nestjs/common";
import { LmsStore, type Tx } from "../courses/lms.store.js";

export type Progress = {
  totalRequired: number; completedRequired: number; remainingRequired: number;
  percentage: number; isCompleted: boolean; continueLessonId: string | null;
};
export type OrderedLesson = { id: string; isRequired: boolean };
export function calculateProgress(lessons: OrderedLesson[], completed: Set<string>): Progress {
  const required = lessons.filter((lesson) => lesson.isRequired);
  const done = required.filter((lesson) => completed.has(lesson.id)).length;
  return {
    totalRequired: required.length, completedRequired: done, remainingRequired: required.length - done,
    percentage: required.length ? Math.floor(done * 10000 / required.length) / 100 : 0,
    isCompleted: required.length > 0 && done === required.length,
    continueLessonId: required.find((lesson) => !completed.has(lesson.id))?.id ?? lessons[0]?.id ?? null,
  };
}
@Injectable()
export class ProgressService {
  constructor(@Inject(LmsStore) private readonly store: LmsStore) {}
  async batch(tx: Tx, enrollments: { id: string; courseId: string }[]) {
    if (!enrollments.length) return new Map<string, Progress>();
    const lessons = await tx.lesson.findMany({ where: {
      courseId: { in: [...new Set(enrollments.map((e) => e.courseId))] },
      status: "published", archivedAt: null, chapter: { status: "published", archivedAt: null },
    }, select: { id: true, courseId: true, isRequired: true },
      orderBy: [{ chapter: { position: "asc" } }, { position: "asc" }, { id: "asc" }] });
    const completions = await tx.lessonCompletion.findMany({ where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
      select: { enrollmentId: true, lessonId: true } });
    const byCourse = new Map<string, OrderedLesson[]>();
    const byEnrollment = new Map<string, Set<string>>();
    for (const lesson of lessons) {
      const group = byCourse.get(lesson.courseId) ?? [];
      group.push(lesson); byCourse.set(lesson.courseId, group);
    }
    for (const completion of completions) {
      const group = byEnrollment.get(completion.enrollmentId) ?? new Set<string>();
      group.add(completion.lessonId); byEnrollment.set(completion.enrollmentId, group);
    }
    return new Map(enrollments.map((e) => [e.id, calculateProgress(byCourse.get(e.courseId) ?? [], byEnrollment.get(e.id) ?? new Set())]));
  }
}
