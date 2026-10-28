import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowLeft, BookOpen, Check, Search } from "lucide-react";
import type { LmsCourse, LmsCoursePage } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { displayPercent, fmt, paths } from "@/lib/lms-paths";
import type { ApiFailure } from "@/lib/lms-client";
import { ErrorState, Pager, SearchBox, Skeleton } from "../ui";
import { MyCoursesWorkspace } from "./MyCoursesWorkspace";

/** Preserve Continue/Review/Open routing, including courses without progress. */
export function myCourseHref(locale: Locale, course: LmsCourse) {
  return course.progress?.continueLessonId && !course.progress.isCompleted
    ? paths.lesson(locale, course.id, course.progress.continueLessonId) : paths.course(locale, course.id);
}

function CourseItem({ locale, course, index, compact }: { locale: Locale; course: LmsCourse; index: number; compact: boolean }) {
  const { student: t, common } = getLms(locale);
  const p = course.progress;
  const percent = p ? displayPercent(p.percentage, p.isCompleted) : 0;
  const action = p?.isCompleted ? t.review : p?.continueLessonId ? t.continue : t.open;
  const label = p ? fmt(t.progress, { c: p.completedRequired, t: p.totalRequired }) : "";
  return <article className={`mc-course${compact ? " mc-course-compact" : ""}`}
    style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }} data-testid={`card-course-${course.id}`}>
    <span className={`mc-mark mc-mark-${index % 4 + 1}`} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><i /><b /></span>
    <div className="mc-course-copy">
      <div className="mc-title-line">
        <h3 dir="auto"><Link className="mc-course-title" href={paths.course(locale, course.id)} data-testid={`link-course-${course.id}`}>{course.title}</Link></h3>
        {p?.isCompleted && <span className="mc-completed"><Check size={13} aria-hidden="true" />{common.completed}</span>}
      </div>
      {course.description && <p dir="auto">{course.description}</p>}
    </div>
    {p && <div className="mc-progress-wrap" data-testid={`progress-course-${course.id}`}>
      <div className="mc-progress-copy"><span>{label}</span><strong><bdi>{percent}%</bdi></strong></div>
      {p.totalRequired > 0 ? <div className={`mc-track${p.isCompleted ? " is-done" : ""}`} role="progressbar"
        aria-label={`${course.title}: ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ "--mc-value": `${percent}%` } as CSSProperties} />
      </div> : <p className="mc-no-required">{t.noRequired}</p>}
    </div>}
    <Link className="mc-action" href={myCourseHref(locale, course)} data-testid={`link-continue-${course.id}`} aria-label={`${action}: ${course.title}`}>
      <span>{action}</span><ArrowLeft size={16} aria-hidden="true" />
    </Link>
  </article>;
}

export type MyCoursesViewProps = {
  locale: Locale; data?: LmsCoursePage; loading: boolean; error?: ApiFailure; search: string;
  onSearch: (value: string) => void; onPage: (page: number) => void; onRetry: () => void;
};

export function MyCoursesView({ locale, data, loading, error, search, onSearch, onPage, onRetry }: MyCoursesViewProps) {
  const ar = locale === "ar";
  const t = getLms(locale);
  const compact = (data?.total ?? 0) > 3;
  const empty = !loading && !error && data?.total === 0 && !search;
  return <MyCoursesWorkspace locale={locale}>
    <header className="mc-page-head">
      <span className="mc-eyebrow"><i aria-hidden="true" />{ar ? "مسارك التعليمي" : "YOUR LEARNING PATH"}</span>
      <h1>{t.student.myCoursesTitle}</h1><p>{ar ? "دوراتك وتقدّمك، في مكان واحد." : "Your courses and progress, in one place."}</p>
    </header>
    {!empty && <div className="mc-toolbar">
      <SearchBox label={ar ? "بحث في دوراتك" : "Search your courses"} placeholder={ar ? "ابحث في دوراتك" : "Search your courses"} onSearch={onSearch} />
      {data && <span className="mc-total" role="status" data-testid="text-course-count"><bdi>{data.total}</bdi> {search ? ar ? "نتائج" : "results" : ar ? data.total === 1 ? "دورة مسجّلة" : "دورات مسجّلة" : data.total === 1 ? "enrolled course" : "enrolled courses"}</span>}
    </div>}
    <div aria-busy={loading}>
      {loading && !data ? <Skeleton rows={3} tall /> : error ? <ErrorState locale={locale} error={error} onRetry={onRetry} /> : data && (
        empty ? <section className="mc-empty" aria-labelledby="mc-empty-title" data-testid="status-no-courses">
          <div className="mc-empty-art" aria-hidden="true"><BookOpen size={27} /><span /><i /></div>
          <span className="mc-eyebrow">{ar ? "بداية المسار" : "THE START OF YOUR PATH"}</span>
          <h2 id="mc-empty-title">{ar ? "لم تنضم إلى أي دورة بعد" : "No courses yet"}</h2>
          <p>{t.student.emptyBody}</p>
          <div className="mc-admin-note"><span aria-hidden="true">س</span>{ar ? "ستظهر الدورات بعد أن يسجّلك المشرف." : "Courses appear here after an admin enrolls you."}</div>
          <p className="mc-empty-foot">{ar ? "لا تحتاج إلى إعداد شيء الآن. سيظهر مسارك هنا بعد التسجيل." : "There is nothing to set up right now. Your learning path will appear here after enrollment."}</p>
          <Link className="mc-subtle-link" href={paths.student(locale)}>{t.nav.dashboard}<ArrowLeft size={15} aria-hidden="true" /></Link>
        </section> : data.items.length === 0 ? <section className="mc-no-results" role="status" data-testid="status-no-results">
          <Search size={22} aria-hidden="true" /><h2>{t.student.noResults}</h2>
          <p>{ar ? "جرّب البحث بكلمات مختلفة." : "Try a different search term."}</p>
        </section> : <section aria-labelledby="mc-list-title" className="mc-course-section">
          <div className="mc-section-heading"><div><span className="mc-eyebrow">{ar ? "مساراتك" : "YOUR PATHS"}</span><h2 id="mc-list-title">{ar ? "كل الدورات" : "All courses"}</h2></div>
            {compact && <span className="mc-page-summary"><bdi>{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)}</bdi> {ar ? "من" : "of"} <bdi>{data.total}</bdi></span>}
          </div>
          {compact && <p className="mc-required-note"><Check size={16} aria-hidden="true" />{ar ? "التقدّم محسوب من الدروس الإلزامية." : "Progress is based on required lessons."}</p>}
          <div className={compact ? "mc-course-list" : "mc-course-grid"}>
            {data.items.map((course, i) => <CourseItem key={course.id} course={course} locale={locale} compact={compact} index={i + (data.page - 1) * data.pageSize} />)}
          </div>
        </section>
      )}
      {!error && !!data && data.total > data.pageSize && <div className="mc-pagination"><Pager locale={locale} page={data.page} pageSize={data.pageSize} total={data.total} onPage={onPage} /></div>}
    </div>
  </MyCoursesWorkspace>;
}
