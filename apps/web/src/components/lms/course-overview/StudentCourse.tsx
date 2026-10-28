"use client";
import type { LmsCourse, LmsProgress } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { useLms } from "@/lib/lms-client";
import { paths } from "@/lib/lms-paths";
import { ErrorState, Skeleton } from "../ui";
import { StudentResources } from "../student-media";
import { CourseOverviewView } from "./CourseOverviewView";
import "../dashboard/dashboard.css";
import "./course-overview.css";

export function StudentCourse({ locale, courseId }: { locale: Locale; courseId: string }) {
  const t = getLms(locale);
  const q = useLms<LmsCourse>(`courses/${encodeURIComponent(courseId)}`);
  const pr = useLms<LmsProgress>(`me/courses/${encodeURIComponent(courseId)}/progress`);
  if (q.loading && !q.data) return <Skeleton rows={4} />;
  if (q.error) return <ErrorState error={q.error} locale={locale} onRetry={q.reload} back={{ href: paths.myCourses(locale), label: t.nav.myCourses }} />;
  const course = q.data!;
  const progress = pr.data ?? course.progress;
  return <CourseOverviewView locale={locale} course={course} progress={progress}
    resources={<StudentResources key={course.id} locale={locale} sources={[{ scope: "courses", parentId: course.id }]} />} />;
}
