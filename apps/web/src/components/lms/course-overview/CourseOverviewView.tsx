import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import type { LmsCourse, LmsProgress } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { displayPercent, fmt, paths } from "@/lib/lms-paths";
import { CourseWorkspace } from "./CourseWorkspace";

/** Exact pre-redesign continue/review/open destinations; no new gating. */
export function courseContinueHref(locale: Locale, course: LmsCourse, progress?: LmsProgress) {
  return progress?.continueLessonId && !progress.isCompleted
    ? paths.lesson(locale, course.id, progress.continueLessonId)
    : paths.course(locale, course.id);
}

/** Presentation only. Progress and lesson completion remain server-owned. */
export function CourseOverviewView({ locale, course, progress, resources }: {
  locale: Locale; course: LmsCourse; progress?: LmsProgress; resources?: ReactNode;
}) {
  const ar = locale === "ar";
  const { student: t, common } = getLms(locale);
  const chapters = [...(course.chapters ?? [])].sort((a, b) => a.position - b.position);
  const lessons = chapters.flatMap(ch => [...ch.lessons].sort((a, b) => a.position - b.position));
  const currentId = progress && !progress.isCompleted ? progress.continueLessonId : null;
  const next = lessons.find(l => l.id === currentId);
  const percentage = progress ? displayPercent(progress.percentage, progress.isCompleted) : 0;
  const progressLabel = progress ? fmt(t.progress, { c: progress.completedRequired, t: progress.totalRequired }) : "";
  const action = progress?.isCompleted ? t.review : progress?.continueLessonId ? t.continue : t.open;

  return <CourseWorkspace locale={locale} courseId={course.id}>
    <header className="ssco-course-head ssv2-enter">
      <div className="ssco-heading-copy">
        <span className="ssv2-eyebrow"><i aria-hidden="true" />{ar ? "مسارك التعليمي" : "YOUR LEARNING PATH"}</span>
        <h1 dir="auto" data-testid="text-course-title">{course.title}</h1>
        {course.description && <p className="ssco-description" dir="auto">{course.description}</p>}
      </div>
      <div className="ssco-continue-block">
        {next && <p className="ssco-next-title"><span>{ar ? "الخطوة التالية" : "UP NEXT"}</span><bdi>{next.title}</bdi></p>}
        <Link href={courseContinueHref(locale, course, progress)} className="ssco-continue"
          data-testid={`link-continue-${course.id}`} aria-label={`${action}: ${next?.title ?? course.title}`}>
          <span>{action}</span><ArrowLeft size={17} aria-hidden="true" />
        </Link>
      </div>
    </header>

    {progress && <section className="ssco-progress-section ssv2-enter" aria-labelledby="course-progress-title">
      <div className="ssco-progress-intro"><div>
        <span className="ssco-overline">{ar ? "تقدّمك في الدورة" : "Your course progress"}</span>
        <h2 id="course-progress-title">{progressLabel}</h2>
      </div><strong className="ssco-percent"><bdi>{percentage}%</bdi></strong></div>
      <div className="ssco-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percentage} aria-valuetext={progressLabel} aria-label={`${course.title}: ${progressLabel}`} data-testid="progress-course">
        <span style={{ "--ssco-progress": percentage / 100 } as CSSProperties} />
      </div>
      {progress.totalRequired === 0 ? <p className="ssco-progress-foot">{t.noRequired}</p>
        : <p className="ssco-progress-foot"><span aria-hidden="true" />{ar ? "يُحتسب التقدّم من الدروس الإلزامية فقط" : "Progress reflects required lessons only"}</p>}
      {progress.isCompleted && <p className="ssco-done" data-testid="status-course-completed"><CheckCircle2 size={16} aria-hidden="true" />{t.courseDone}</p>}
    </section>}

    <section className="ssco-outline-section ssv2-enter" aria-labelledby="course-outline-title">
      <div className="ssco-section-heading"><div><span className="ssv2-eyebrow"><i aria-hidden="true" />{ar ? "خارطة الدورة" : "THE COURSE MAP"}</span><h2 id="course-outline-title">{t.outline}</h2></div></div>
      {!chapters.length ? <p className="ssco-empty">{t.noChapters}</p> : <ol className="ssco-chapters">
        {chapters.map((chapter, ci) => <li className="ssco-chapter" key={chapter.id} data-testid={`course-chapter-${chapter.id}`}>
          <div className="ssco-chapter-heading"><span className="ssco-chapter-index" aria-hidden="true"><bdi>{String(ci + 1).padStart(2, "0")}</bdi></span>
            <h3 dir="auto">{chapter.title}</h3><span className="ssco-chapter-rule" aria-hidden="true" /></div>
          {!chapter.lessons.length ? <p className="ssco-empty">{ar ? "لا توجد دروس متاحة في هذا الفصل حالياً." : "There are no lessons available in this chapter yet."}</p> : <ol className="ssco-lessons">
            {[...chapter.lessons].sort((a, b) => a.position - b.position).map(lesson => {
              const current = lesson.id === currentId;
              const state = lesson.completed ? "completed" : current ? "current" : "remaining";
              const stateLabel = lesson.completed ? common.completed : current
                ? ar ? "الدرس التالي للمتابعة" : "Next lesson to continue"
                : ar ? "لم يكتمل بعد" : "Not completed";
              return <li className={`ssco-lesson${lesson.completed ? " is-complete" : ""}${current ? " is-current" : ""}`}
                key={lesson.id} data-state={state}>
                <Link className="ssco-lesson-link" href={paths.lesson(locale, course.id, lesson.id)} data-testid={`link-lesson-${lesson.id}`}
                  aria-label={`${lesson.title} — ${stateLabel} — ${lesson.isRequired ? common.required : common.optional}`}>
                  <span className="ssco-status-icon" aria-hidden="true">{lesson.completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}</span>
                  <span className="ssco-lesson-copy"><span className="ssco-lesson-title" dir="auto">{lesson.title}</span><span className="ssco-status-text">{stateLabel}</span></span>
                  <span className={`ssco-tag ${lesson.isRequired ? "is-required" : "is-optional"}`}>{lesson.isRequired ? common.required : common.optional}</span>
                  {current && <span className="ssco-current-mark" aria-hidden="true" />}
                </Link>
              </li>;
            })}
          </ol>}
        </li>)}
      </ol>}
    </section>
    <div className="ssco-resources">{resources}</div>
  </CourseWorkspace>;
}
