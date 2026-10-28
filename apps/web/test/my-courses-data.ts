import type { LmsCoursePage } from "@workspace/saudisensei-api-client";
import { courseOverviewFixture, overviewProgress } from "./course-overview-data";

/** Isolated test data only. Never imported by application components. */
export function myCoursesFixture(count: number, long = false): LmsCoursePage {
  return {
    page: 1, pageSize: 12, total: count,
    items: Array.from({ length: Math.min(count, 12) }, (_, i) => ({
      ...courseOverviewFixture(1, 2),
      id: `fixture-course-${i}`,
      title: long ? `${i + 1} — ${"مسار تعلّم متقدم طويل جداً Advanced learning path with an exceptionally long course title ".repeat(3)}` : `مسار التعلّم Learning path ${i + 1}`,
      description: "وصف الدورة التعليمية — A useful course description.",
      progress: { ...overviewProgress, isCompleted: i % 3 === 0, percentage: i % 3 === 0 ? 100 : 40,
        completedRequired: i % 3 === 0 ? 5 : 2, totalRequired: 5, continueLessonId: i % 3 === 0 ? null : "fixture-lesson" },
    })),
  };
}
