import type { LmsCourse, LmsLesson, LmsProgress } from "@workspace/saudisensei-api-client";
import { courseOverviewFixture } from "./course-overview-data";

/** Rendering-only fixtures. Never imported by application routes or seeded. */
export function lessonFixture(locale: "ar" | "en", mode: "text" | "code" | "long" | "completed" | "empty" = "text") {
  const course: LmsCourse = courseOverviewFixture(mode === "long" ? 8 : 2, mode === "long" ? 16 : 3, mode === "long");
  const lesson: LmsLesson = { ...course.chapters![0].lessons[1] };
  const ar = locale === "ar";
  lesson.title = (ar ? "التعامل مع البيانات والأنواع في TypeScript" : "Working with data and types in TypeScript") +
    (mode === "long" ? (" — " + (ar ? "تطبيقات عملية لبناء برامج واضحة وآمنة" : "Practical examples for building readable, safe programs")).repeat(7) : "");
  lesson.body = mode === "empty" ? " " : mode === "code"
    ? "## TypeScript\n\n" + "```typescript\nconst message: string = \"<script>alert('never executed')</script>\";\nconsole.log(message);\n" +
      `const longValue = "${"long-unbroken-value-".repeat(35)}";\n` + "```\n\n" + "استخدم `const` لتعريف قيمة. Use `const` for a constant.\n"
    : `${ar ? "## تعلّم خطوة بخطوة\n\nكل فكرة تبدأ بمثال واضح." : "## Learn step by step\n\nEach idea begins with a clear example."}\n\n` +
      (ar ? "اقرأ المثال ثم جرّبه بنفسك. نحافظ على المحتوى واضحاً ومريحاً للقراءة.\n\n" : "Read the example and try it yourself. Keep your program clear, readable and easy to understand.\n\n").repeat(12) +
      "- First idea\n- فكرة ثانية\n\n1. اقرأ\n2. Apply\n\n### مثال برمجي\n\n```typescript\nconst sum = (a: number, b: number) => a + b;\n```\n\nUse `sum(1, 2)`.";
  lesson.completed = mode === "completed";
  course.chapters![0].lessons[1] = lesson;
  const progress: LmsProgress = { totalRequired: 20, completedRequired: 7, remainingRequired: 13, percentage: 35,
    isCompleted: false, continueLessonId: lesson.id };
  lesson.progress = progress;
  return { lesson, course, progress, previous: course.chapters![0].lessons[0], next: course.chapters![0].lessons[2] };
}
