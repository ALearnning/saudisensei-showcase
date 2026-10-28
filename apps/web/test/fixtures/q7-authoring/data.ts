import type {
  AdminQuizDetail,
  AdminQuizRevision,
  AdminQuizSafePreview,
} from "@workspace/saudisensei-api-client";
import { defaultPolicy } from "../../../src/components/lms/assessments/model";

// Synthetic identities and content only. No application data or credentials.
export const ids = {
  course: "11111111-1111-4111-8111-111111111111",
  quiz: "22222222-2222-4222-8222-222222222222",
  question: "33333333-3333-4333-8333-333333333333",
  questionRevision: "44444444-4444-4444-8444-444444444444",
  revision: "55555555-5555-4555-8555-555555555555",
  skill: "66666666-6666-4666-8666-666666666666",
  option: "77777777-7777-4777-8777-777777777777",
  secondOption: "88888888-8888-4888-8888-888888888888",
};
export const timestamp = "2026-10-24T10:00:00.000Z";
export const base = `admin/courses/${ids.course}/quizzes/${ids.quiz}`;
export function quiz(): AdminQuizDetail {
  return {
    id: ids.quiz,
    courseId: ids.course,
    parentType: "course",
    parentId: ids.course,
    status: "published",
    editRevision: 4,
    currentRevisionId: ids.revision,
    createdAt: timestamp,
    chapterId: null,
    lessonId: null,
    draft: {
      defaultContentLocale: "en",
      content: {
        en: {
          title: "Q7 synthetic quiz",
          instructions: "Review the saved draft.",
        },
        ar: {
          title: "اختبار تجريبي طويل للتحقق من تأليف التقييمات",
          instructions: "راجع المسودة المحفوظة.",
        },
      },
      policy: {
        ...defaultPolicy(),
        timeLimitSeconds: 125,
        aiAnalysisEnabled: true,
      },
    },
    items: [
      {
        id: ids.option,
        questionId: ids.question,
        questionRevisionId: ids.questionRevision,
        position: 0,
        points: 2,
      },
    ],
  };
}
export function revision(q = quiz()): AdminQuizRevision {
  return {
    id: ids.revision,
    quizId: q.id,
    courseId: q.courseId,
    number: 1,
    createdAt: timestamp,
    defaultContentLocale: q.draft.defaultContentLocale,
    content: structuredClone(q.draft.content),
    policy: structuredClone(q.draft.policy),
    items: structuredClone(q.items),
    totalPoints: 2,
    reviewRelease: null,
    schemaVersion: 1,
    graderVersion: "deterministic-v1",
  };
}
export function preview(
  q = quiz(),
  locale: "ar" | "en" = "en",
): AdminQuizSafePreview {
  return {
    quizId: q.id,
    editRevision: q.editRevision,
    requestedLocale: locale,
    locale,
    title: q.draft.content[locale]!.title,
    instructions: q.draft.content[locale]!.instructions,
    policy: q.draft.policy,
    totalPoints: q.items.reduce((n, i) => n + i.points, 0),
    questions: q.items.map((i) => ({
      ...i,
      type: "single_choice",
      locale,
      prompt:
        locale === "ar"
          ? "أي خيار يطابق الوصف؟"
          : "Which option matches the description?",
      code: { language: "java", source: "System.out.println(2 + 2);" },
      options: [
        { id: ids.option, label: "First option" },
        { id: ids.secondOption, label: "Second option" },
      ],
    })),
  };
}
