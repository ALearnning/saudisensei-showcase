import { ArrowLeft, BookOpen, Check, CheckCircle2, ChevronLeft, GraduationCap, LayoutDashboard, Layers, LogOut, Target } from "lucide-react";
import { usePreview, PreviewTools } from "./_shared";
import "./_group.css";
import "./Focus.css";

function ProgressLine({ percentage, label }: { percentage: number; label: string }) {
  return (
    <div className="focus-progress">
      <div className="focus-progress-copy">
        <span>{label}</span>
        <strong><bdi>{percentage}%</bdi></strong>
      </div>
      <div className="focus-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-label={label}>
        <span className="focus-fill" style={{ transform: `scaleX(${percentage / 100})` }} />
      </div>
    </div>
  );
}

export function Focus() {
  const preview = usePreview();
  const { locale, t, state, data, act } = preview;
  const rtl = locale === "ar";
  const focusCourse = data.courses.find(course => !course.progress.isCompleted && course.progress.continueLessonId);
  const actionLabel = (completed: boolean, hasContinue: boolean) => completed ? t.review : hasContinue ? t.continue : t.open;
  const curriculumNote = rtl
    ? "يُحتسب التقدّم من الدروس الإلزامية المنشورة حالياً فقط."
    : "Progress counts only required lessons that are currently published.";

  return (
    <div className="ss-focus" lang={locale} dir={rtl ? "rtl" : "ltr"}>
      <PreviewTools preview={preview} />
      <div className="focus-shell">
        <header className="focus-header">
          <button className="focus-brand" onClick={act} aria-label={t.brand}>
            <span className="focus-mark" aria-hidden="true">س</span>
            <span className="focus-brand-type"><strong>{t.brand}</strong><small>LEARN WITH CLARITY</small></span>
          </button>
          <nav className="focus-nav" aria-label={t.navigation}>
            <a href="#" className="focus-nav-active" aria-current="page" onClick={event => event.preventDefault()}><LayoutDashboard size={17} aria-hidden="true" />{t.dashboard}</a>
            <a href="#" onClick={event => { event.preventDefault(); act(); }}><BookOpen size={17} aria-hidden="true" />{t.myCourses}</a>
          </nav>
          <div className="focus-header-actions">
            <button className="focus-locale" onClick={() => preview.setLocale(rtl ? "en" : "ar")}>{rtl ? "English" : "العربية"}</button>
            <button className="focus-logout" onClick={act} aria-label={t.logout}><LogOut size={16} aria-hidden="true" /><span>{t.logout}</span></button>
          </div>
        </header>

        <main className="focus-main">
          <section className="focus-intro">
            <div className="focus-intro-copy">
              <span className="focus-kicker"><span className="focus-kicker-dot" />{rtl ? "مساحة الطالب" : "STUDENT SPACE"}</span>
              <h1>{rtl ? <>{t.greeting} <em>{t.name}</em></> : <>{t.greeting} <em>{t.name}</em></>}</h1>
              <p>{rtl ? "خطوة واحدة واضحة، ثم التي تليها." : "One clear next step. Then the next."}</p>
            </div>
            <div className="focus-intro-mark" aria-hidden="true"><span>01</span><i /></div>
          </section>

          {state === "loading" ? (
            <section className="focus-loading" aria-busy="true" aria-label={t.loading}>
              <span className="focus-sr-only">{t.loading}</span>
              <div className="focus-skeleton focus-skeleton-feature" />
              <div className="focus-skeleton focus-skeleton-stats" />
              <div className="focus-skeleton focus-skeleton-list" />
            </section>
          ) : state === "empty" ? (
            <>
              <section className="focus-empty" aria-labelledby="focus-empty-title">
                <div className="focus-empty-art" aria-hidden="true"><GraduationCap size={34} strokeWidth={1.5} /></div>
                <div>
                  <span className="focus-kicker">{rtl ? "بداية المسار" : "YOUR LEARNING SPACE"}</span>
                  <h2 id="focus-empty-title">{t.emptyTitle}</h2>
                  <p>{t.emptyBody}</p>
                </div>
              </section>
              <dl className="focus-counts" aria-label={rtl ? "ملخص التعلّم" : "Learning summary"}>
                <div className="focus-count focus-count-courses"><span className="focus-count-icon"><Layers size={18} /></span><dt>{t.courses}</dt><dd><bdi>{data.totalCourses}</bdi></dd></div>
                <div className="focus-count"><span className="focus-count-icon"><Check size={18} /></span><dt>{t.done}</dt><dd><bdi>{data.completedRequired}</bdi></dd></div>
                <div className="focus-count"><span className="focus-count-icon"><Target size={18} /></span><dt>{t.remaining}</dt><dd><bdi>{data.remainingRequired}</bdi></dd></div>
              </dl>
            </>
          ) : (
            <>
              {focusCourse ? (
                <section className="focus-spotlight" aria-labelledby="focus-course-title">
                  <div className="focus-art" aria-hidden="true">
                    <div className="focus-art-orbit focus-orbit-one" />
                    <div className="focus-art-orbit focus-orbit-two" />
                    <div className="focus-art-sun" />
                    <div className="focus-art-line focus-line-one" />
                    <div className="focus-art-line focus-line-two" />
                    <span className="focus-art-index">A / 01</span>
                    <span className="focus-art-word">{rtl ? "تعلّم" : "LEARN"}</span>
                  </div>
                  <div className="focus-spotlight-body">
                    <div className="focus-spotlight-meta">
                      <span className="focus-kicker"><span className="focus-kicker-dot" />{rtl ? "خطوتك التالية" : "UP NEXT"}</span>
                      <span className="focus-course-index" dir="ltr"><bdi>01 / {String(data.courses.length).padStart(2, "0")}</bdi></span>
                    </div>
                    <h2 id="focus-course-title" dir="auto">{focusCourse.title}</h2>
                    <p className="focus-course-description" dir="auto">{focusCourse.description}</p>
                    <ProgressLine
                      percentage={focusCourse.progress.percentage}
                      label={rtl
                        ? `${focusCourse.progress.completedRequired} من ${focusCourse.progress.totalRequired} ${t.required}`
                        : `${focusCourse.progress.completedRequired} of ${focusCourse.progress.totalRequired} ${t.required}`}
                    />
                    <button className="focus-primary" onClick={act}>
                      <span>{actionLabel(focusCourse.progress.isCompleted, !!focusCourse.progress.continueLessonId)}</span>
                      <ArrowLeft className="focus-arrow" size={18} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              ) : (
                <section className="focus-no-next">
                  <CheckCircle2 size={21} aria-hidden="true" />
                  <p>{rtl ? "لا توجد دورة غير مكتملة للمتابعة حالياً." : "There is no incomplete course to continue right now."}</p>
                </section>
              )}

              <dl className="focus-counts" aria-label={rtl ? "ملخص التعلّم" : "Learning summary"}>
                <div className="focus-count focus-count-courses"><span className="focus-count-icon"><Layers size={18} /></span><dt>{t.courses}</dt><dd><bdi>{data.totalCourses}</bdi></dd></div>
                <div className="focus-count"><span className="focus-count-icon"><Check size={18} /></span><dt>{t.done}</dt><dd><bdi>{data.completedRequired}</bdi></dd></div>
                <div className="focus-count"><span className="focus-count-icon"><Target size={18} /></span><dt>{t.remaining}</dt><dd><bdi>{data.remainingRequired}</bdi></dd></div>
              </dl>

              <section className="focus-courses-section" aria-labelledby="focus-courses-title">
                <div className="focus-section-heading">
                  <div><span className="focus-kicker">{rtl ? "مسارك" : "YOUR LEARNING"}</span><h2 id="focus-courses-title">{t.myCourses}</h2></div>
                  <span className="focus-course-total"><bdi>{data.courses.length}</bdi> {rtl ? "دورات" : "courses"}</span>
                </div>
                <div className="focus-course-list">
                  {data.courses.map((course, index) => (
                    <article className={`focus-course-row${course.id === focusCourse?.id ? " is-focus" : ""}`} key={course.id}>
                      <span className="focus-row-number"><bdi>{String(index + 1).padStart(2, "0")}</bdi></span>
                      <div className="focus-row-copy">
                        <div className="focus-row-title-line">
                          <h3 dir="auto">{course.title}</h3>
                          {course.progress.isCompleted && <span className="focus-complete"><CheckCircle2 size={14} aria-hidden="true" />{t.completed}</span>}
                        </div>
                        <p dir="auto">{course.description}</p>
                      </div>
                      <div className="focus-row-progress">
                        <ProgressLine
                          percentage={course.progress.percentage}
                          label={rtl
                            ? `${course.progress.completedRequired} من ${course.progress.totalRequired} ${t.required}`
                            : `${course.progress.completedRequired} of ${course.progress.totalRequired} ${t.required}`}
                        />
                      </div>
                      <button className="focus-row-action" onClick={act} aria-label={`${actionLabel(course.progress.isCompleted, !!course.progress.continueLessonId)}: ${course.title}`}>
                        <ChevronLeft size={18} aria-hidden="true" />
                      </button>
                    </article>
                  ))}
                </div>
              </section>
              <p className="focus-curriculum-note"><span aria-hidden="true">i</span>{curriculumNote}</p>
            </>
          )}
        </main>
        <footer className="focus-footer"><span>{rtl ? "سعودي سنسي" : "SaudiSensei"}</span><span>{curriculumNote}</span></footer>
      </div>
    </div>
  );
}
