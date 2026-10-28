import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, BookOpen, Check, Layers3, ListChecks, LogOut, PanelRight, Target } from "lucide-react";
import type { LmsCourse, LmsProgress, LmsStudentDashboard, ProtectedPage } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { getLms } from "@/i18n/lms";
import { displayPercent, fmt, paths } from "@/lib/lms-paths";
import type { ApiFailure } from "@/lib/lms-client";
import { ErrorState } from "../ui";

export function dashboardCourseHref(locale: Locale, course: LmsCourse) {
  const p = course.progress;
  return p?.continueLessonId && !p.isCompleted
    ? paths.lesson(locale, course.id, p.continueLessonId)
    : paths.course(locale, course.id);
}

function CourseAction({ course, locale, featured = false }: { course: LmsCourse; locale: Locale; featured?: boolean }) {
  const t = getLms(locale).student;
  const label = course.progress?.isCompleted ? t.review : course.progress?.continueLessonId ? t.continue : t.open;
  return <Link href={dashboardCourseHref(locale, course)} className={`ssv2-action${featured ? " ssv2-action-featured" : ""}`}
    data-testid={`link-continue-${course.id}`} aria-label={`${label}: ${course.title}`}>
    <span>{label}</span><ArrowLeft size={16} aria-hidden="true" />
  </Link>;
}

function Progress({ progress: p, locale, courseTitle, testId }: { progress: LmsProgress; locale: Locale; courseTitle: string; testId?: string }) {
  const percentage = displayPercent(p.percentage, p.isCompleted);
  const label = fmt(getLms(locale).student.progress, { c: p.completedRequired, t: p.totalRequired });
  return <div className="ssv2-progress">
    <div className="ssv2-progress-copy"><span><bdi>{p.completedRequired} / {p.totalRequired}</bdi> {locale === "ar" ? "دروس إلزامية" : "required lessons"}</span><strong><bdi>{percentage}%</bdi></strong></div>
    <div className="ssv2-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percentage} aria-valuetext={label} aria-label={`${courseTitle}: ${label}`} data-testid={testId}>
      <span style={{ "--ssv2-progress-final": percentage / 100, transform: `scaleX(${percentage / 100})` } as CSSProperties} />
    </div>
    {p.totalRequired === 0 && <p className="ssv2-no-required">{getLms(locale).student.noRequired}</p>}
  </div>;
}

function CourseRow({ course, index, locale }: { course: LmsCourse; index: number; locale: Locale }) {
  return <li className="ssv2-course-item" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
    <article className="ssv2-course" data-testid={`card-course-${course.id}`}>
      <span className={`ssv2-course-glyph ssv2-glyph-${(index % 4) + 1}`} aria-hidden="true">
        <span>{String(index + 1).padStart(2, "0")}</span><i /><b /><em />
      </span>
      <div className="ssv2-course-copy">
        <div className="ssv2-course-title">
          <h3 dir="auto"><Link href={paths.course(locale, course.id)} data-testid={`link-course-${course.id}`}>{course.title}</Link></h3>
          {course.progress?.isCompleted && <span className="ssv2-completed"><Check size={13} aria-hidden="true" />{getLms(locale).common.completed}</span>}
        </div>
        {course.description && <p dir="auto">{course.description}</p>}
      </div>
      {course.progress && <Progress progress={course.progress} locale={locale} courseTitle={course.title} testId={`progress-course-${course.id}`} />}
      <CourseAction course={course} locale={locale} />
    </article>
  </li>;
}

function Loading({ locale }: { locale: Locale }) {
  const label = getLms(locale).common.loading;
  return <div className="ssv2-loading" role="status" aria-busy="true" aria-label={label}>
    <span className="ssv2-sr-only">{label}</span>
    <div className="ssv2-loading-stats">{[0, 1, 2].map(i => <div className="ssv2-skeleton ssv2-stat-skeleton" key={i} />)}</div>
    <div className="ssv2-skeleton ssv2-feature-skeleton" />
    {[0, 1, 2].map(i => <div className="ssv2-skeleton ssv2-row-skeleton" key={i} />)}
  </div>;
}

/** Presentational boundary: only server-provided identity and dashboard response. */
export function DashboardView({ locale, identity, data, loading, error, onRetry }: {
  locale: Locale; identity: ProtectedPage; data?: LmsStudentDashboard; loading: boolean;
  error?: ApiFailure; onRetry: () => void;
}) {
  const { student: t, nav } = getLms(locale);
  const catalog = getCatalog(locale);
  const ar = locale === "ar";
  // Same API order; no "most recent" or watch-based progress is invented here.
  const nextCourse = data?.courses.find(c => c.progress && !c.progress.isCompleted && !!c.progress.continueLessonId);
  const logoutHref = `/auth/logout?returnTo=/${locale}/login`;
  const language = (mobile: boolean) => <Link className="ssv2-language" href={paths.student(ar ? "en" : "ar")}
    hrefLang={ar ? "en" : "ar"} lang={ar ? "en" : "ar"} aria-label={catalog.switchAria}
    data-testid={mobile ? "link-language-switch-mobile" : "link-language-switch"}>
    <span aria-hidden="true">{ar ? "EN" : "ع"}</span>{catalog.switchLabel}
  </Link>;
  return <div className="ss-workspace-v2" lang={locale} dir={ar ? "rtl" : "ltr"}>
    <a className="ssv2-skip" href="#dashboard-content">{ar ? "انتقل إلى المحتوى" : "Skip to content"}</a>
    <div className="ssv2-layout">
      <aside className="ssv2-rail" aria-label={nav.student}>
        <Link className="ssv2-brand" href={paths.student(locale)} aria-label={catalog.brand} data-testid="link-home">
          <span className="ssv2-brand-mark" aria-hidden="true">س</span><span className="ssv2-brand-name"><strong>{catalog.brand}</strong><small lang="en">LEARN WITH PURPOSE</small></span>
        </Link>
        <div className="ssv2-mobile-header-actions">{language(true)}
          <a className="ssv2-mobile-logout" href={logoutHref} aria-label={nav.signOut} data-testid="link-nav-logout-mobile"><LogOut size={17} aria-hidden="true" /></a>
        </div>
        <div className="ssv2-rail-rule" /><span className="ssv2-rail-caption">{nav.student}</span>
        <nav className="ssv2-nav" aria-label={nav.main}>
          <Link href={paths.student(locale)} className="ssv2-nav-item is-current" aria-current="page" data-testid="nav-dashboard"><PanelRight size={18} aria-hidden="true" /><span>{nav.dashboard}</span><i className="ssv2-nav-indicator" /></Link>
          <Link href={paths.myCourses(locale)} className="ssv2-nav-item" data-testid="nav-courses"><BookOpen size={18} aria-hidden="true" /><span>{nav.myCourses}</span><ArrowUpRight className="ssv2-nav-arrow" size={14} aria-hidden="true" /></Link>
        </nav>
        <div className="ssv2-rail-bottom"><p><span aria-hidden="true">س</span>{ar ? "تعلّمك، على طريقتك" : "Learning, your way"}</p>
          <a href={logoutHref} className="ssv2-logout" data-testid="link-nav-logout"><LogOut size={16} aria-hidden="true" /><span>{nav.signOut}</span></a>
        </div>
      </aside>
      <div className="ssv2-main-column">
        <header className="ssv2-topbar"><div className="ssv2-breadcrumb"><span>{nav.student}</span><span aria-hidden="true">/</span><strong>{nav.dashboard}</strong></div>{language(false)}</header>
        <div className="ssv2-content" id="dashboard-content" tabIndex={-1}>
          <section className="ssv2-welcome ssv2-enter" aria-labelledby="dashboard-title">
            <div className="ssv2-welcome-copy"><span className="ssv2-eyebrow"><i aria-hidden="true" />{ar ? "مسارك التعليمي" : "YOUR LEARNING SPACE"}</span>
              <h1 id="dashboard-title">{ar ? "أهلاً، " : "Welcome, "}<em><bdi>{identity.user.displayName}</bdi></em></h1>
              <p>{ar ? "كل دورة لها مسار واضح. تقدّمك هنا، خطوة بخطوة." : "Every course has a clear path. See your progress, step by step."}</p>
              <p className="ssv2-identity" data-testid="status-authorized-student"><span className="ssv2-sr-only">{t.identity}: </span><bdi className="ssv2-email" dir="ltr">{identity.user.email}</bdi></p>
            </div><div className="ssv2-welcome-seal" aria-hidden="true"><span>س</span><i /><b /></div>
          </section>
          {loading && !data ? <Loading locale={locale} /> : error ? <div className="ssv2-error"><ErrorState error={error} locale={locale} onRetry={onRetry} /></div> : data && <>
            <dl className="ssv2-metrics ssv2-enter" aria-label={ar ? "ملخص التعلّم" : "Learning summary"}>
              <div className="ssv2-metric"><dt><Layers3 size={17} aria-hidden="true" />{t.statCourses}</dt><dd data-testid="text-total-courses"><bdi>{data.totalCourses}</bdi></dd><i aria-hidden="true" /></div>
              <div className="ssv2-metric"><dt><Check size={17} aria-hidden="true" />{t.statDone}</dt><dd data-testid="text-completed-required"><bdi>{data.completedRequired}</bdi></dd><i aria-hidden="true" /></div>
              <div className="ssv2-metric"><dt><Target size={17} aria-hidden="true" />{t.statRemaining}</dt><dd data-testid="text-remaining-required"><bdi>{data.remainingRequired}</bdi></dd><i aria-hidden="true" /></div>
            </dl>
            {!data.courses.length ? <section className="ssv2-empty ssv2-enter" aria-labelledby="dashboard-empty-title">
              <div className="ssv2-empty-mark" aria-hidden="true"><BookOpen size={24} /></div>
              <span className="ssv2-eyebrow">{ar ? "بداية المسار" : "THE START OF YOUR PATH"}</span><h2 id="dashboard-empty-title">{t.emptyTitle}</h2><p>{t.emptyBody}</p>
            </section> : <>
              <section className="ssv2-next ssv2-enter" aria-labelledby="dashboard-next-title"><div className="ssv2-next-copy">
                <span className="ssv2-next-kicker"><ArrowDownLeft size={15} aria-hidden="true" />{ar ? "نقطة المتابعة" : "PICK UP YOUR PATH"}</span>
                <h2 id="dashboard-next-title">{ar ? "تابع من حيث وصلت" : "Continue where you left off"}</h2>
                {nextCourse ? <><h3 dir="auto">{nextCourse.title}</h3>{nextCourse.description && <p dir="auto">{nextCourse.description}</p>}
                  <div className="ssv2-next-controls"><Progress progress={nextCourse.progress!} locale={locale} courseTitle={nextCourse.title} /><CourseAction course={nextCourse} locale={locale} featured /></div>
                </> : <p className="ssv2-no-next">{ar ? "لا توجد دورة قيد التقدّم حالياً." : "There is no course in progress right now."}</p>}
              </div><div className="ssv2-path-art" aria-hidden="true"><div className="ssv2-path-frame">
                <span className="ssv2-syntax-mark">{`{ }`}</span><i className="ssv2-path-line ssv2-path-line-one" /><i className="ssv2-path-line ssv2-path-line-two" />
                <b className="ssv2-path-step ssv2-path-step-one" /><b className="ssv2-path-step ssv2-path-step-two" /><b className="ssv2-path-step ssv2-path-step-three" />
                <span className="ssv2-path-node ssv2-node-one" /><span className="ssv2-path-node ssv2-node-two" /><span className="ssv2-path-node ssv2-node-three" />
              </div><span className="ssv2-art-caption">{ar ? "خطوة، ثم إتقان" : "STEP BY STEP, TO MASTERY"}</span></div></section>
              <section className="ssv2-course-section ssv2-enter" aria-labelledby="dashboard-courses-title">
                <div className="ssv2-section-heading"><div><span className="ssv2-eyebrow">{ar ? "مساراتك" : "YOUR PATHS"}</span><h2 id="dashboard-courses-title">{nav.myCourses}</h2></div>
                  <span className="ssv2-course-total">{ar && data.totalCourses === 1 ? "دورة واحدة" : ar && data.totalCourses === 2 ? "دورتان" : <><bdi>{data.totalCourses}</bdi> {ar ? (data.totalCourses % 100 >= 3 && data.totalCourses % 100 <= 10 ? "دورات" : "دورة") : (data.totalCourses === 1 ? "course" : "courses")}</>}</span>
                </div>
                <p className="ssv2-required-note"><ListChecks size={17} aria-hidden="true" /><span>{t.dashLead}</span></p>
                <ul className="ssv2-course-list">{data.courses.map((course, index) => <CourseRow key={course.id} course={course} index={index} locale={locale} />)}</ul>
              </section>
            </>}
          </>}
          <footer className="ssv2-footer"><span>{catalog.brand}</span><i aria-hidden="true">·</i><span>{ar ? "تعلّم بثقة" : "Learn with confidence"}</span></footer>
        </div>
      </div>
    </div>
    <nav className="ssv2-mobile-nav" aria-label={nav.main}>
      <Link href={paths.student(locale)} className="ssv2-mobile-nav-item is-current" aria-current="page" data-testid="nav-dashboard-mobile"><PanelRight size={18} aria-hidden="true" /><span>{nav.dashboard}</span></Link>
      <Link href={paths.myCourses(locale)} className="ssv2-mobile-nav-item" data-testid="nav-courses-mobile"><BookOpen size={18} aria-hidden="true" /><span>{nav.myCourses}</span></Link>
    </nav>
  </div>;
}
