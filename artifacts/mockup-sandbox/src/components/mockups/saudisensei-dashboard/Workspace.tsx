import { ArrowDownLeft, ArrowLeft, ArrowUpRight, BookOpen, Check, CircleHelp, Layers3, ListChecks, LogOut, PanelRight, Target } from "lucide-react";
import { PreviewTools, usePreview, type Course, type Locale } from "./_shared";
import "./_group.css";
import "./_workspace.css";

function CourseAction({ course, locale, act }: { course: Course; locale: Locale; act: () => void }) {
  const label = course.progress.isCompleted
    ? locale === "ar" ? "مراجعة الدورة" : "Review course"
    : course.progress.continueLessonId
      ? locale === "ar" ? "تابع التعلّم" : "Continue learning"
      : locale === "ar" ? "فتح الدورة" : "Open course";
  return <button className="ws-action" type="button" onClick={act}>{label}<ArrowLeft size={15} aria-hidden="true" /></button>;
}

function ProgressMeter({ course, locale }: { course: Course; locale: Locale }) {
  const p = course.progress;
  const label = locale === "ar"
    ? `${p.completedRequired} من ${p.totalRequired} دروس إلزامية`
    : `${p.completedRequired} of ${p.totalRequired} required lessons`;
  return (
    <div className="ws-progress">
      <div className="ws-progress-copy">
        <strong><bdi>{p.percentage}%</bdi></strong>
        <span><bdi>{p.completedRequired} / {p.totalRequired}</bdi> {locale === "ar" ? "دروس إلزامية" : "required lessons"}</span>
      </div>
      <div className="ws-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentage} aria-label={label}>
        <span className="ws-fill" style={{ transform: `scaleX(${p.percentage / 100})` }} />
      </div>
    </div>
  );
}

function CourseRow({ course, index, locale, act }: { course: Course; index: number; locale: Locale; act: () => void }) {
  return (
    <article className="ws-course" style={{ animationDelay: `${index * 65}ms` }}>
      <div className={`ws-course-mark ws-mark-${index + 1}`} aria-hidden="true">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <i />
      </div>
      <div className="ws-course-copy">
        <div className="ws-course-heading">
          <h3 dir="auto">{course.title}</h3>
          {course.progress.isCompleted && <span className="ws-complete"><Check size={12} aria-hidden="true" />{locale === "ar" ? "مكتملة" : "Completed"}</span>}
        </div>
        {course.description && <p dir="auto">{course.description}</p>}
      </div>
      <ProgressMeter course={course} locale={locale} />
      <CourseAction course={course} locale={locale} act={act} />
    </article>
  );
}

function LoadingWorkspace({ locale, label }: { locale: Locale; label: string }) {
  return (
    <div className="ws-loading" aria-busy="true" aria-label={label}>
      <span className="ws-sr-only">{label}</span>
      <div className="ws-loading-stats">{[0, 1, 2].map(item => <div className="ws-skeleton ws-stat-skeleton" key={item} />)}</div>
      <div className="ws-skeleton ws-feature-skeleton" />
      <div className="ws-loading-label">{locale === "ar" ? "دوراتك" : "Your courses"}</div>
      {[0, 1, 2].map(item => <div className="ws-skeleton ws-row-skeleton" key={item} />)}
    </div>
  );
}

export function Workspace() {
  const preview = usePreview();
  const { locale, t, data, act, state } = preview;
  const isArabic = locale === "ar";
  const nextCourse = data.courses.find(course => !course.progress.isCompleted && Boolean(course.progress.continueLessonId));

  return (
    <div className="ss-workspace" lang={locale} dir={isArabic ? "rtl" : "ltr"}>
      <PreviewTools preview={preview} />
      <div className="ws-layout">
        <aside className="ws-rail">
          <button className="ws-brand" type="button" onClick={act} aria-label={t.brand}>
            <span className="ws-brand-mark">س</span>
            <span className="ws-brand-name"><strong>{t.brand}</strong><small>LEARN WITH PURPOSE</small></span>
          </button>
          <div className="ws-rail-divider" />
          <span className="ws-rail-caption">{isArabic ? "مساحة الطالب" : "STUDENT SPACE"}</span>
          <nav className="ws-nav" aria-label={t.navigation}>
            <button className="ws-nav-item ws-nav-current" type="button" aria-current="page" onClick={act}>
              <PanelRight size={18} aria-hidden="true" /><span>{t.dashboard}</span><span className="ws-nav-indicator" />
            </button>
            <button className="ws-nav-item" type="button" onClick={act}>
              <BookOpen size={18} aria-hidden="true" /><span>{t.myCourses}</span><ArrowUpRight className="ws-nav-arrow" size={14} aria-hidden="true" />
            </button>
          </nav>
          <div className="ws-rail-bottom">
            <span className="ws-rail-note"><CircleHelp size={15} aria-hidden="true" />{isArabic ? "تعلّمك، على طريقتك" : "Learning, your way"}</span>
            <button className="ws-logout" type="button" onClick={act}><LogOut size={16} aria-hidden="true" /><span>{t.logout}</span></button>
          </div>
        </aside>

        <div className="ws-main-column">
          <header className="ws-topbar">
            <div className="ws-breadcrumb"><span>{isArabic ? "مساحة الطالب" : "Student space"}</span><span className="ws-breadcrumb-slash">/</span><strong>{t.dashboard}</strong></div>
            <div className="ws-topbar-actions">
            <button className="ws-language" type="button" onClick={() => preview.setLocale(isArabic ? "en" : "ar")}>
              <span className="ws-language-glyph" aria-hidden="true">{isArabic ? "EN" : "ع"}</span>{isArabic ? "English" : "العربية"}
            </button>
            <button className="ws-mobile-logout" type="button" onClick={act} aria-label={t.logout}>
              <LogOut size={17} aria-hidden="true" />
            </button>
            </div>
          </header>

          <main className="ws-content">
            <section className="ws-welcome ws-enter">
              <div>
                <span className="ws-kicker"><span />{isArabic ? "مسارك التعليمي" : "YOUR LEARNING SPACE"}</span>
                <h1 dir="auto">{t.greeting} <em>{t.name}</em></h1>
                <p>{isArabic ? "كل دورة لها مسار واضح. تقدّمك هنا، خطوة بخطوة." : "Every course has a clear path. See your progress, step by step."}</p>
              </div>
              <div className="ws-welcome-orbit" aria-hidden="true"><span>س</span><i /><b /></div>
            </section>

            {state === "loading" ? (
              <LoadingWorkspace locale={locale} label={t.loading} />
            ) : (
              <>
                <dl className="ws-metrics ws-enter" aria-label={isArabic ? "ملخص التعلّم" : "Learning summary"}>
                  <div className="ws-metric ws-metric-courses"><dt><Layers3 size={16} aria-hidden="true" />{t.courses}</dt><dd><bdi>{data.totalCourses}</bdi></dd><span className="ws-metric-index">01</span></div>
                  <div className="ws-metric ws-metric-done"><dt><Check size={16} aria-hidden="true" />{t.done}</dt><dd><bdi>{data.completedRequired}</bdi></dd><span className="ws-metric-index">02</span></div>
                  <div className="ws-metric ws-metric-left"><dt><Target size={16} aria-hidden="true" />{t.remaining}</dt><dd><bdi>{data.remainingRequired}</bdi></dd><span className="ws-metric-index">03</span></div>
                </dl>

                {data.courses.length === 0 ? (
                  <section className="ws-empty ws-enter">
                    <div className="ws-empty-icon"><BookOpen size={23} aria-hidden="true" /></div>
                    <span className="ws-kicker">{isArabic ? "بداية المسار" : "THE START OF YOUR PATH"}</span>
                    <h2>{t.emptyTitle}</h2>
                    <p>{t.emptyBody}</p>
                  </section>
                ) : (
                  <>
                    <section className="ws-next ws-enter" aria-labelledby="ws-next-title">
                      <div className="ws-next-copy">
                        <span className="ws-next-label"><ArrowDownLeft size={14} aria-hidden="true" />{isArabic ? "نقطة المتابعة" : "PICK UP YOUR PATH"}</span>
                        <h2 id="ws-next-title">{isArabic ? "تابع من حيث وصلت" : "Continue where you left off"}</h2>
                        {nextCourse ? (
                          <>
                            <h3 dir="auto">{nextCourse.title}</h3>
                            <p dir="auto">{nextCourse.description}</p>
                            <div className="ws-next-meta"><span><bdi>{nextCourse.progress.completedRequired} / {nextCourse.progress.totalRequired}</bdi> {isArabic ? "دروس إلزامية" : "required lessons"}</span><strong><bdi>{nextCourse.progress.percentage}%</bdi></strong></div>
                            <div className="ws-next-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nextCourse.progress.percentage} aria-label={isArabic ? `${nextCourse.progress.completedRequired} من ${nextCourse.progress.totalRequired} دروس إلزامية` : `${nextCourse.progress.completedRequired} of ${nextCourse.progress.totalRequired} required lessons`}>
                              <span style={{ transform: `scaleX(${nextCourse.progress.percentage / 100})` }} />
                            </div>
                            <CourseAction course={nextCourse} locale={locale} act={act} />
                          </>
                        ) : (
                          <p className="ws-next-none">{isArabic ? "لا توجد دورة قيد التقدّم حالياً." : "There is no course in progress right now."}</p>
                        )}
                      </div>
                      <div className="ws-next-art" aria-hidden="true">
                        <div className="ws-art-ring ws-ring-one" /><div className="ws-art-ring ws-ring-two" />
                        <span className="ws-art-letter">م</span><span className="ws-art-index"><bdi>01</bdi><i /></span>
                      </div>
                    </section>

                    <section className="ws-course-section ws-enter" aria-labelledby="ws-courses-heading">
                      <div className="ws-section-heading">
                        <div><span className="ws-kicker">{isArabic ? "مساراتك" : "YOUR PATHS"}</span><h2 id="ws-courses-heading">{t.myCourses}</h2></div>
                        <span className="ws-course-total"><bdi>{data.totalCourses}</bdi> {isArabic ? "دورات" : "courses"}</span>
                      </div>
                      <p className="ws-required-note"><ListChecks size={16} aria-hidden="true" /><span>{t.progressNote}</span></p>
                      <div className="ws-course-list">
                        {data.courses.map((course, index) => <CourseRow key={course.id} course={course} index={index} locale={locale} act={act} />)}
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
            <footer className="ws-footer"><span>{isArabic ? "سعودي سنسي" : "SaudiSensei"}</span><span className="ws-footer-mark" aria-hidden="true">·</span><span>{isArabic ? "تعلّم بثقة" : "Learn with confidence"}</span></footer>
          </main>
        </div>
      </div>
    </div>
  );
}
