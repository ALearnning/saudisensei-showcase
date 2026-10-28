import { ArrowDownLeft, ArrowLeft, ArrowUpRight, BookOpen, Check, Layers3, ListChecks, LogOut, PanelRight, Target } from "lucide-react";
import type { CSSProperties } from "react";
import { PreviewTools, usePreview, type Course, type Locale } from "./_shared";
import "./_group.css";
import "./_workspace-refined.css";

function RefinedAction({ course, locale, act, featured = false }: { course: Course; locale: Locale; act: () => void; featured?: boolean }) {
  const label = course.progress.isCompleted
    ? locale === "ar" ? "مراجعة الدورة" : "Review course"
    : course.progress.continueLessonId
      ? locale === "ar" ? "تابع التعلّم" : "Continue learning"
      : locale === "ar" ? "فتح الدورة" : "Open course";
  return (
    <button className={`ssr-action${featured ? " ssr-action-featured" : ""}`} type="button" onClick={act}>
      {label}<ArrowLeft size={16} aria-hidden="true" />
    </button>
  );
}

function RefinedProgress({ course, locale, featured = false }: { course: Course; locale: Locale; featured?: boolean }) {
  const p = course.progress;
  const label = locale === "ar"
    ? `${p.completedRequired} من ${p.totalRequired} دروس إلزامية`
    : `${p.completedRequired} of ${p.totalRequired} required lessons`;
  return (
    <div className={`ssr-progress${featured ? " ssr-progress-featured" : ""}`}>
      <div className="ssr-progress-copy">
        <span><bdi>{p.completedRequired} / {p.totalRequired}</bdi> {locale === "ar" ? "دروس إلزامية" : "required lessons"}</span>
        <strong><bdi>{p.percentage}%</bdi></strong>
      </div>
      <div className="ssr-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentage} aria-label={label}>
        <span style={{ transform: `scaleX(${p.percentage / 100})`, "--ssr-progress-final": p.percentage / 100 } as CSSProperties} />
      </div>
    </div>
  );
}

function RefinedCourseRow({ course, index, locale, act }: { course: Course; index: number; locale: Locale; act: () => void }) {
  return (
    <li className="ssr-course-item" style={{ animationDelay: `${index * 70}ms` }}>
      <article className="ssr-course">
        <div className={`ssr-course-emblem ssr-emblem-${index + 1}`} aria-hidden="true"><bdi>{String(index + 1).padStart(2, "0")}</bdi><i /></div>
        <div className="ssr-course-copy">
          <div className="ssr-course-title">
            <h3 dir="auto">{course.title}</h3>
            {course.progress.isCompleted && <span className="ssr-completed"><Check size={13} aria-hidden="true" />{locale === "ar" ? "مكتملة" : "Completed"}</span>}
          </div>
          <p dir="auto">{course.description}</p>
        </div>
        <RefinedProgress course={course} locale={locale} />
        <RefinedAction course={course} locale={locale} act={act} />
      </article>
    </li>
  );
}

function RefinedLoading({ locale, label }: { locale: Locale; label: string }) {
  return (
    <div className="ssr-loading" aria-busy="true" aria-label={label}>
      <span className="ssr-sr-only">{label}</span>
      <div className="ssr-loading-stats">{[0, 1, 2].map(item => <div className="ssr-skeleton ssr-stat-skeleton" key={item} />)}</div>
      <div className="ssr-skeleton ssr-feature-skeleton" />
      <div className="ssr-loading-heading">{locale === "ar" ? "دوراتك" : "Your courses"}</div>
      {[0, 1, 2].map(item => <div className="ssr-skeleton ssr-row-skeleton" key={item} />)}
    </div>
  );
}

export function WorkspaceRefined() {
  const preview = usePreview();
  const { locale, t, data, act, state } = preview;
  const isArabic = locale === "ar";
  const nextCourse = data.courses.find(course => !course.progress.isCompleted && Boolean(course.progress.continueLessonId));

  return (
    <div className="ss-workspace-refined" lang={locale} dir={isArabic ? "rtl" : "ltr"}>
      <PreviewTools preview={preview} />
      <div className="ssr-layout">
        <aside className="ssr-rail">
          <button className="ssr-brand" type="button" onClick={act} aria-label={t.brand}>
            <span className="ssr-brand-mark" aria-hidden="true">س</span>
            <span className="ssr-brand-name"><strong>{t.brand}</strong><small>LEARN WITH PURPOSE</small></span>
          </button>
          <div className="ssr-rail-rule" />
          <span className="ssr-rail-caption">{isArabic ? "مساحة الطالب" : "STUDENT SPACE"}</span>
          <nav className="ssr-nav" aria-label={t.navigation}>
            <button className="ssr-nav-item is-current" type="button" aria-current="page" onClick={act}>
              <PanelRight size={18} aria-hidden="true" /><span>{t.dashboard}</span><i className="ssr-nav-indicator" />
            </button>
            <button className="ssr-nav-item" type="button" onClick={act}>
              <BookOpen size={18} aria-hidden="true" /><span>{t.myCourses}</span><ArrowUpRight className="ssr-nav-arrow" size={14} aria-hidden="true" />
            </button>
          </nav>
          <div className="ssr-rail-bottom">
            <p><span aria-hidden="true">س</span>{isArabic ? "تعلّمك، على طريقتك" : "Learning, your way"}</p>
            <button className="ssr-logout" type="button" onClick={act}><LogOut size={16} aria-hidden="true" /><span>{t.logout}</span></button>
          </div>
        </aside>

        <div className="ssr-main-column">
          <header className="ssr-topbar">
            <div className="ssr-breadcrumb"><span>{isArabic ? "مساحة الطالب" : "Student space"}</span><span aria-hidden="true">/</span><strong>{t.dashboard}</strong></div>
            <div className="ssr-top-actions">
              <button className="ssr-language" type="button" onClick={() => preview.setLocale(isArabic ? "en" : "ar")}>
                <span aria-hidden="true">{isArabic ? "EN" : "ع"}</span>{isArabic ? "English" : "العربية"}
              </button>
              <button className="ssr-mobile-logout" type="button" onClick={act} aria-label={t.logout}><LogOut size={17} aria-hidden="true" /></button>
            </div>
          </header>

          <main className="ssr-content">
            <section className="ssr-welcome ssr-enter" aria-labelledby="ssr-welcome-title">
              <div>
                <span className="ssr-eyebrow"><i />{isArabic ? "مسارك التعليمي" : "YOUR LEARNING SPACE"}</span>
                <h1 id="ssr-welcome-title" dir="auto">{t.greeting} <em>{t.name}</em></h1>
                <p>{isArabic ? "كل دورة لها مسار واضح. تقدّمك هنا، خطوة بخطوة." : "Every course has a clear path. See your progress, step by step."}</p>
              </div>
              <div className="ssr-welcome-seal" aria-hidden="true"><span>س</span><i /><b /></div>
            </section>

            {state === "loading" ? (
              <RefinedLoading locale={locale} label={t.loading} />
            ) : (
              <>
                <dl className="ssr-metrics ssr-enter" aria-label={isArabic ? "ملخص التعلّم" : "Learning summary"}>
                  <div className="ssr-metric ssr-metric-courses"><dt><Layers3 size={16} aria-hidden="true" />{t.courses}</dt><dd><bdi>{data.totalCourses}</bdi></dd><span aria-hidden="true">01</span></div>
                  <div className="ssr-metric ssr-metric-done"><dt><Check size={16} aria-hidden="true" />{t.done}</dt><dd><bdi>{data.completedRequired}</bdi></dd><span aria-hidden="true">02</span></div>
                  <div className="ssr-metric ssr-metric-left"><dt><Target size={16} aria-hidden="true" />{t.remaining}</dt><dd><bdi>{data.remainingRequired}</bdi></dd><span aria-hidden="true">03</span></div>
                </dl>

                {data.courses.length === 0 ? (
                  <section className="ssr-empty ssr-enter" aria-labelledby="ssr-empty-title">
                    <div className="ssr-empty-mark" aria-hidden="true"><BookOpen size={23} /></div>
                    <span className="ssr-eyebrow">{isArabic ? "بداية المسار" : "THE START OF YOUR PATH"}</span>
                    <h2 id="ssr-empty-title">{t.emptyTitle}</h2><p>{t.emptyBody}</p>
                  </section>
                ) : (
                  <>
                    <section className="ssr-next ssr-enter" aria-labelledby="ssr-next-title">
                      <div className="ssr-next-copy">
                        <span className="ssr-next-kicker"><ArrowDownLeft size={14} aria-hidden="true" />{isArabic ? "نقطة المتابعة" : "PICK UP YOUR PATH"}</span>
                        <h2 id="ssr-next-title">{isArabic ? "تابع من حيث وصلت" : "Continue where you left off"}</h2>
                        {nextCourse ? (
                          <>
                            <h3 dir="auto">{nextCourse.title}</h3>
                            <p dir="auto">{nextCourse.description}</p>
                            <RefinedProgress course={nextCourse} locale={locale} featured />
                            <RefinedAction course={nextCourse} locale={locale} act={act} featured />
                          </>
                        ) : <p className="ssr-no-next">{isArabic ? "لا توجد دورة قيد التقدّم حالياً." : "There is no course in progress right now."}</p>}
                      </div>
                      <div className="ssr-next-art" aria-hidden="true">
                        <div className="ssr-art-grid" /><div className="ssr-art-arc ssr-art-arc-one" /><div className="ssr-art-arc ssr-art-arc-two" />
                        <div className="ssr-art-core"><span>م</span></div>
                        <span className="ssr-art-caption"><bdi>01</bdi><i />{isArabic ? "مسارك يتشكّل" : "YOUR PATH, IN MOTION"}</span>
                      </div>
                    </section>

                    <section className="ssr-course-section ssr-enter" aria-labelledby="ssr-courses-title">
                      <div className="ssr-section-heading">
                        <div><span className="ssr-eyebrow">{isArabic ? "مساراتك" : "YOUR PATHS"}</span><h2 id="ssr-courses-title">{t.myCourses}</h2></div>
                        <span className="ssr-course-total"><bdi>{data.totalCourses}</bdi> {isArabic ? "دورات" : "courses"}</span>
                      </div>
                      <p className="ssr-required-note"><ListChecks size={16} aria-hidden="true" /><span>{t.progressNote}</span></p>
                      <ul className="ssr-course-list">
                        {data.courses.map((course, index) => <RefinedCourseRow key={course.id} course={course} index={index} locale={locale} act={act} />)}
                      </ul>
                    </section>
                  </>
                )}
              </>
            )}
            <footer className="ssr-footer"><span>{isArabic ? "سعودي سنسي" : "SaudiSensei"}</span><i aria-hidden="true">·</i><span>{isArabic ? "تعلّم بثقة" : "Learn with confidence"}</span></footer>
          </main>
        </div>
      </div>
    </div>
  );
}
