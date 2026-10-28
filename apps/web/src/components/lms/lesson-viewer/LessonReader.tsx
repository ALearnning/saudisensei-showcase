"use client";

import { useMemo, useState } from "react";
import type { LmsCompletion, LmsCourse, LmsLesson } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { lms, useLms, type ApiFailure } from "@/lib/lms-client";
import { paths } from "@/lib/lms-paths";
import { ErrorState, Skeleton } from "../ui";
import { StudentResources } from "../student-media";
import { LessonView } from "./LessonView";
import "./lesson-viewer.css";

export function LessonReader({ locale, courseId, lessonId }: { locale: Locale; courseId: string; lessonId: string }) {
  const t = getLms(locale);
  const lq = useLms<LmsLesson>(`lessons/${encodeURIComponent(lessonId)}`);
  const cq = useLms<LmsCourse>(`courses/${encodeURIComponent(courseId)}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);

  const flat = useMemo(
    () => [...(cq.data?.chapters ?? [])].sort((a, b) => a.position - b.position)
      .flatMap((chapter) => [...chapter.lessons].sort((a, b) => a.position - b.position)),
    [cq.data],
  );
  const idx = flat.findIndex((lesson) => lesson.id === lessonId);
  const previous = idx > 0 ? flat[idx - 1] : undefined;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : undefined;

  if (lq.loading && !lq.data) return <Skeleton rows={5} />;
  if (lq.error) return <ErrorState error={lq.error} locale={locale} onRetry={lq.reload} back={{ href: paths.course(locale, courseId), label: t.student.backToCourse }} />;
  const lesson = lq.data!;
  if (lesson.courseId && lesson.courseId !== courseId) {
    return <ErrorState error={{ status: 404, code: "NOT_FOUND" }} locale={locale} back={{ href: paths.myCourses(locale), label: t.nav.myCourses }} />;
  }

  async function complete() {
    if (busy || lesson.completed) return;
    setBusy(true);
    setErr(null);
    const response = await lms<LmsCompletion>(`me/lessons/${encodeURIComponent(lessonId)}/completion`, { method: "PUT", body: {} });
    setBusy(false);
    if (!response.ok) {
      setErr(response.error);
      if ([403, 404].includes(response.error.status)) void lq.reload();
      return;
    }
    lq.setData((current) => current ? { ...current, completed: true, progress: response.data.progress } : current);
    cq.setData((current) => current
      ? {
          ...current,
          progress: response.data.progress,
          chapters: current.chapters?.map((chapter) => ({
            ...chapter,
            lessons: chapter.lessons.map((item) => item.id === lessonId ? { ...item, completed: true } : item),
          })),
        }
      : current);
  }

  return (
    <LessonView
      locale={locale}
      lesson={lesson}
      course={cq.data}
      previous={previous}
      next={next}
      progress={lesson.progress ?? cq.data?.progress}
      outlineLoading={cq.loading}
      outlineError={cq.error ?? null}
      onRetryOutline={cq.reload}
      busy={busy}
      error={err}
      onComplete={() => void complete()}
      resources={(content) => <StudentResources
        key={lesson.id}
        locale={locale}
        presentation="lesson"
        content={content}
        sources={[
          { scope: "lessons", parentId: lesson.id },
          { scope: "chapters", parentId: lesson.chapterId },
          { scope: "courses", parentId: courseId },
        ]}
      />}
    />
  );
}
