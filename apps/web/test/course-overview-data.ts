import type { LmsCourse, LmsProgress } from "@workspace/saudisensei-api-client";

/** Isolated rendering inputs only. Never imported by the application or seeded. */
export function courseOverviewFixture(chapters = 3, lessons = 5, long = false): LmsCourse {
  const course: LmsCourse = {
    id: "fixture-course", slug: "fixture-course", status: "published", editRevision: 7,
    title: long ? "أساسيات تصميم تجارب التعلّم الرقمية Accessible Learning Interfaces ".repeat(5) : "تصميم تجارب التعلّم",
    description: long ? "وصف الدورة: أهداف واضحة ومسار تعلّم منظم. A clear learning path. ".repeat(8) : "وصف الدورة Course description",
    chapters: Array.from({ length: chapters }, (_, ci) => ({
      id: `chapter-${ci}`, courseId: "fixture-course", status: "published", position: ci,
      title: long ? `${ci + 1}. ${"من الفكرة إلى التطبيق Creating Accessible Interfaces ".repeat(4)}` : `الفصل ${ci + 1}`,
      lessons: Array.from({ length: lessons }, (_, li) => ({
        id: `lesson-${ci}-${li}`, courseId: "fixture-course", chapterId: `chapter-${ci}`, position: li,
        title: long ? `${ci + 1}.${li + 1} ${li % 2 ? "Designing accessible interfaces for a changing world ".repeat(4) : "تنظيم المحتوى وبناء مسار واضح لتجارب التعلّم الرقمية ".repeat(4)}` : `الدرس ${ci + 1}.${li + 1}`,
        status: "published", isRequired: li % 3 !== 2, completed: li === 0,
      })),
    })),
  };
  const required = course.chapters!.flatMap(ch => ch.lessons).filter(l => l.isRequired);
  const completed = required.filter(l => l.completed).length;
  course.progress = {
    totalRequired: required.length, completedRequired: completed, remainingRequired: required.length - completed,
    percentage: required.length ? completed / required.length * 100 : 0,
    isCompleted: required.length > 0 && required.length === completed,
    continueLessonId: required.find(l => !l.completed)?.id ?? null,
  };
  return course;
}

export const overviewProgress: LmsProgress = {
  totalRequired: 20, completedRequired: 7, remainingRequired: 13,
  percentage: 35, isCompleted: false, continueLessonId: "lesson-0-1",
};
