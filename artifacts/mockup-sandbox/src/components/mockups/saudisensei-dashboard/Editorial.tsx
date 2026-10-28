import { ArrowUpLeft, BookOpen, Check, Compass, LayoutDashboard, LogOut, MoveUpLeft } from "lucide-react";
import { PreviewTools, usePreview, type Course, type Locale } from "./_shared";
import "./_group.css";
import "./_editorial.css";

function Progress({ course, locale }: { course: Course; locale: Locale }) {
  const p = course.progress;
  const label = locale === "ar"
    ? `${p.completedRequired} من ${p.totalRequired} دروس إلزامية`
    : `${p.completedRequired} of ${p.totalRequired} required lessons`;
  return (
    <div className="ed-progress">
      <div className="ed-progress-copy">
        <span>{label}</span>
        <bdi>{p.percentage}%</bdi>
      </div>
      <div className="ed-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentage} aria-label={label}>
        <span style={{ transform: `scaleX(${p.percentage / 100})` }} />
      </div>
    </div>
  );
}

export function Editorial() {
  const preview = usePreview();
  const { locale, t, data, state, act } = preview;
  const ar = locale === "ar";
  const firstEligible = data.courses.find(course => !course.progress.isCompleted && !!course.progress.continueLessonId);
  const stats = [
    { label: t.courses, value: data.totalCourses },
    { label: t.done, value: data.completedRequired },
    { label: t.remaining, value: data.remainingRequired },
  ];

  return (
    <div className="ss-editorial" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <PreviewTools preview={preview} />
      <div className="ed-shell">
        <header className="ed-header">
          <button className="ed-brand" type="button" onClick={act} aria-label={t.brand}>
            <span className="ed-brand-mark" aria-hidden="true">س</span>
            <span className="ed-brand-name"><strong>{t.brand}</strong><small>LEARN WITH CONFIDENCE</small></span>
          </button>
          <div className="ed-header-actions">
            <button className="ed-language" type="button" onClick={() => preview.setLocale(ar ? "en" : "ar")}>{ar ? "English" : "العربية"}</button>
            <span className="ed-avatar" aria-hidden="true">م</span>
          </div>
        </header>

        <nav className="ed-nav" aria-label={t.navigation}>
          <span className="ed-nav-kicker">{ar ? "مساحة الطالب" : "STUDENT SPACE"}</span>
          <button className="ed-nav-item is-active" type="button" aria-current="page"><LayoutDashboard size={17} />{t.dashboard}</button>
          <button className="ed-nav-item" type="button" onClick={act}><BookOpen size={17} />{t.myCourses}</button>
          <button className="ed-nav-logout" type="button" onClick={act}><LogOut size={16} /><span>{t.logout}</span></button>
        </nav>

        <main className="ed-main">
          <section className="ed-intro">
            <div className="ed-intro-copy">
              <span className="ed-overline">{ar ? "مساحة الطالب" : "STUDENT SPACE"}</span>
              <h1>{t.greeting} <em>{t.name}</em></h1>
              <p>{t.lead}</p>
            </div>
            <div className="ed-curriculum-note">
              <span className="ed-note-rule" aria-hidden="true" />
              <p><strong>{ar ? "منهجك الحالي" : "CURRENT REQUIRED CURRICULUM"}</strong>{t.progressNote}</p>
            </div>
          </section>

          {state === "loading" ? (
            <section className="ed-loading" aria-busy="true" aria-label={t.loading}>
              <div className="ed-loading-label"><span className="ed-loading-dot" />{t.loading}</div>
              <div className="ed-skeleton-row"><div className="ed-skeleton ed-skeleton-stat" /><div className="ed-skeleton ed-skeleton-stat" /><div className="ed-skeleton ed-skeleton-stat" /></div>
              <div className="ed-skeleton-heading" />
              <div className="ed-skeleton-courses"><div className="ed-skeleton ed-skeleton-course" /><div className="ed-skeleton ed-skeleton-course" /><div className="ed-skeleton ed-skeleton-course" /></div>
            </section>
          ) : (
            <>
              <dl className="ed-stats" aria-label={ar ? "ملخص التعلّم" : "Learning summary"}>
                {stats.map((stat, index) => (
                  <div className={`ed-stat ed-stat-${index + 1}`} key={stat.label}>
                    <dt>{stat.label}</dt>
                    <dd><bdi>{stat.value}</bdi></dd>
                  </div>
                ))}
              </dl>

              <section className="ed-courses" aria-labelledby="ed-courses-title">
                <div className="ed-section-heading">
                  <div><span className="ed-overline">{ar ? "مساراتك التعليمية" : "THE COURSES YOU’RE ENROLLED IN"}</span><h2 id="ed-courses-title">{t.myCourses}</h2></div>
                  {data.courses.length > 0 && <span className="ed-course-total"><bdi>{data.courses.length.toString().padStart(2, "0")}</bdi><span>{ar ? "دورات" : "COURSES"}</span></span>}
                </div>
                {data.courses.length === 0 ? (
                  <div className="ed-empty">
                    <div className="ed-empty-symbol"><Compass size={27} strokeWidth={1.4} /></div>
                    <div><span className="ed-overline">{ar ? "مساحة جديدة تنتظرك" : "A PLACE TO BEGIN"}</span><h3>{t.emptyTitle}</h3><p>{t.emptyBody}</p></div>
                  </div>
                ) : (
                  <div className="ed-course-collection">
                    {data.courses.map((course, i) => (
                      <article className={`ed-course-card ed-course-card-${i + 1}`} key={course.id}>
                        <div className="ed-card-art" aria-hidden="true"><span>{String(i + 1).padStart(2, "0")}</span><i /><b /></div>
                        <div className="ed-card-body">
                          <div className="ed-card-meta">
                            <span>{ar ? "دورة مسجّلة" : "ENROLLED COURSE"}</span>
                            {course.progress.isCompleted && <span className="ed-complete"><Check size={13} />{t.completed}</span>}
                          </div>
                          <h3 dir="auto">{course.title}</h3>
                          <p dir="auto">{course.description}</p>
                          <Progress course={course} locale={locale} />
                          <button className="ed-card-action" type="button" onClick={act}>
                            {course.progress.isCompleted ? t.review : course.progress.continueLessonId ? t.continue : t.open}
                            <ArrowUpLeft size={17} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              {firstEligible && (
                <section className="ed-continue-strip" aria-label={ar ? "متابعة التعلّم" : "Continue learning"}>
                  <div className="ed-continue-label"><span className="ed-continue-mark" aria-hidden="true" /><span>{ar ? "خطوتك التالية" : "PICK UP WHERE YOU LEFT OFF"}</span></div>
                  <strong dir="auto">{firstEligible.title}</strong>
                  <button type="button" onClick={act}>{t.continue}{ar ? <ArrowUpLeft size={17} aria-hidden="true" /> : <MoveUpLeft size={17} aria-hidden="true" />}</button>
                </section>
              )}
            </>
          )}
        </main>
        <footer className="ed-footer"><span>{ar ? "سعودي سنسي" : "SAUDISENSEI"}</span><span>{ar ? "تعلّم بثقة" : "LEARN WITH CONFIDENCE"}</span></footer>
      </div>
    </div>
  );
}
