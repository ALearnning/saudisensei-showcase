import { useState, type CSSProperties } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, BookOpen, Check, Layers3, ListChecks, LogOut, PanelRight, Target } from "lucide-react";
import { PreviewTools, usePreview, dashboard as sampleDashboard, type Course, type Locale } from "./_shared";
import "./_group.css";
import "./_workspace-v2.css";

type Scenario = "default" | "one" | "many" | "stress" | "stress-one" | "stress-many";

const longArabicTitle = "أساسيات تصميم واجهات المستخدم وتجارب التعلّم الرقمية المتقدمة";
const longEnglishTitle = "Designing Accessible Interfaces for Modern Web Applications";
const longArabicName = "عبدالرحمن بن فيصل بن عبدالله الفلاني";
const longEnglishName = "Alexandria Morgan Learner";
const longEmail = "student.with.a.deliberately.long.display.name.for.responsive.layout.testing@example.invalid";

function initialScenario(): Scenario {
  const params = new URLSearchParams(window.location.search);
  const stress = params.get("stress") === "long";
  const count = params.get("count");
  if (stress && count === "1") return "stress-one";
  if (stress && count === "many") return "stress-many";
  if (stress) return "stress";
  if (count === "1") return "one";
  if (count === "many") return "many";
  return "default";
}

function getScenarioData(scenario: Scenario, empty: boolean) {
  const stress = scenario.startsWith("stress");
  let baseCourses: Course[] = sampleDashboard.courses.map((course, index) => {
    if (!stress) return course;
    if (index === 0) return { ...course, title: longArabicTitle };
    if (index === 1) return { ...course, title: longEnglishTitle };
    return course;
  });
  if (scenario.endsWith("-one") || scenario === "one") baseCourses = baseCourses.slice(0, 1);
  if (scenario.endsWith("-many") || scenario === "many") {
    baseCourses = Array.from({ length: 12 }, (_, index) => {
      const course = baseCourses[index % baseCourses.length];
      return { ...course, id: `illustrative-${index + 1}-${course.id}` };
    });
  }
  const courses = empty ? [] : baseCourses;
  const completedRequired = courses.reduce((sum, course) => sum + course.progress.completedRequired, 0);
  const remainingRequired = courses.reduce((sum, course) => sum + course.progress.totalRequired - course.progress.completedRequired, 0);
  return { courses, totalCourses: courses.length, completedRequired, remainingRequired, stress };
}

function V2Action({ course, locale, act, featured = false }: { course: Course; locale: Locale; act: () => void; featured?: boolean }) {
  const label = course.progress.isCompleted
    ? locale === "ar" ? "مراجعة الدورة" : "Review course"
    : course.progress.continueLessonId
      ? locale === "ar" ? "تابع التعلّم" : "Continue learning"
      : locale === "ar" ? "فتح الدورة" : "Open course";
  return (
    <button className={`ssv2-action${featured ? " ssv2-action-featured" : ""}`} type="button" onClick={act} aria-label={`${label}: ${course.title}`}>
      <span>{label}</span><ArrowLeft size={16} aria-hidden="true" />
    </button>
  );
}

function V2Progress({ course, locale, featured = false }: { course: Course; locale: Locale; featured?: boolean }) {
  const p = course.progress;
  const label = locale === "ar"
    ? `${p.completedRequired} من ${p.totalRequired} دروس إلزامية`
    : `${p.completedRequired} of ${p.totalRequired} required lessons`;
  return (
    <div className={`ssv2-progress${featured ? " ssv2-progress-featured" : ""}`}>
      <div className="ssv2-progress-copy">
        <span><bdi>{p.completedRequired} / {p.totalRequired}</bdi> {locale === "ar" ? "دروس إلزامية" : "required lessons"}</span>
        <strong><bdi>{p.percentage}%</bdi></strong>
      </div>
      <div className="ssv2-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentage} aria-label={label}>
        <span style={{ transform: `scaleX(${p.percentage / 100})`, "--ssv2-progress-final": p.percentage / 100 } as CSSProperties} />
      </div>
    </div>
  );
}

function CourseGlyph({ index }: { index: number }) {
  return (
    <span className={`ssv2-course-glyph ssv2-glyph-${(index % 4) + 1}`} aria-hidden="true">
      <span>{String(index + 1).padStart(2, "0")}</span><i /><b /><em />
    </span>
  );
}

function V2CourseRow({ course, index, locale, act }: { course: Course; index: number; locale: Locale; act: () => void }) {
  return (
    <li className="ssv2-course-item" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <article className="ssv2-course">
        <CourseGlyph index={index} />
        <div className="ssv2-course-copy">
          <div className="ssv2-course-title">
            <h3 dir="auto">{course.title}</h3>
            {course.progress.isCompleted && <span className="ssv2-completed"><Check size={13} aria-hidden="true" />{locale === "ar" ? "مكتملة" : "Completed"}</span>}
          </div>
          <p dir="auto">{course.description}</p>
        </div>
        <V2Progress course={course} locale={locale} />
        <V2Action course={course} locale={locale} act={act} />
      </article>
    </li>
  );
}

function V2Loading({ locale, label }: { locale: Locale; label: string }) {
  return (
    <div className="ssv2-loading" aria-busy="true" aria-label={label}>
      <span className="ssv2-sr-only">{label}</span>
      <div className="ssv2-loading-stats">{[0, 1, 2].map(item => <div className="ssv2-skeleton ssv2-stat-skeleton" key={item} />)}</div>
      <div className="ssv2-skeleton ssv2-feature-skeleton" />
      <div className="ssv2-loading-heading">{locale === "ar" ? "دوراتك" : "Your courses"}</div>
      {[0, 1, 2].map(item => <div className="ssv2-skeleton ssv2-row-skeleton" key={item} />)}
    </div>
  );
}

function ScenarioTools({ scenario, onChange, locale }: { scenario: Scenario; onChange: (scenario: Scenario) => void; locale: Locale }) {
  const label = locale === "ar" ? "بيانات توضيحية" : "Illustrative data";
  return (
    <div className="ssv2-scenario-tools">
      <span>{locale === "ar" ? "حالات معاينة محلية" : "Local preview scenarios"}</span>
      <label>
        <span className="ssv2-sr-only">{label}</span>
        <select value={scenario} onChange={event => onChange(event.target.value as Scenario)} aria-label={label}>
          <option value="default">{locale === "ar" ? "٣ دورات" : "3 courses"}</option>
          <option value="one">{locale === "ar" ? "دورة واحدة" : "1 course"}</option>
          <option value="many">{locale === "ar" ? "١٢ دورة" : "12 courses"}</option>
          <option value="stress">{locale === "ar" ? "أسماء طويلة" : "Long labels"}</option>
          <option value="stress-one">{locale === "ar" ? "أسماء + ١" : "Long + 1"}</option>
          <option value="stress-many">{locale === "ar" ? "أسماء + ١٢" : "Long + 12"}</option>
        </select>
      </label>
    </div>
  );
}

export function WorkspaceV2() {
  const preview = usePreview();
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const { locale, t, state, act } = preview;
  const isArabic = locale === "ar";
  const data = getScenarioData(scenario, state === "empty");
  const nextCourse = data.courses.find(course => !course.progress.isCompleted && Boolean(course.progress.continueLessonId));
  const displayName = data.stress ? (isArabic ? longArabicName : longEnglishName) : t.name;

  return (
    <div className="ss-workspace-v2" lang={locale} dir={isArabic ? "rtl" : "ltr"}>
      <PreviewTools preview={preview} />
      <ScenarioTools scenario={scenario} onChange={setScenario} locale={locale} />
      <div className="ssv2-layout">
        <aside className="ssv2-rail">
          <button className="ssv2-brand" type="button" onClick={act} aria-label={t.brand}>
            <span className="ssv2-brand-mark" aria-hidden="true">س</span>
            <span className="ssv2-brand-name"><strong>{t.brand}</strong><small>LEARN WITH PURPOSE</small></span>
          </button>
          <div className="ssv2-mobile-header-actions">
            <button className="ssv2-language" type="button" onClick={() => preview.setLocale(isArabic ? "en" : "ar")}>
              <span aria-hidden="true">{isArabic ? "EN" : "ع"}</span>{isArabic ? "English" : "العربية"}
            </button>
            <button className="ssv2-mobile-logout" type="button" onClick={act} aria-label={t.logout}><LogOut size={17} aria-hidden="true" /></button>
          </div>
          <div className="ssv2-rail-rule" />
          <span className="ssv2-rail-caption">{isArabic ? "مساحة الطالب" : "STUDENT SPACE"}</span>
          <nav className="ssv2-nav" aria-label={t.navigation}>
            <button className="ssv2-nav-item is-current" type="button" aria-current="page" onClick={act}>
              <PanelRight size={18} aria-hidden="true" /><span>{t.dashboard}</span><i className="ssv2-nav-indicator" />
            </button>
            <button className="ssv2-nav-item" type="button" onClick={act}>
              <BookOpen size={18} aria-hidden="true" /><span>{t.myCourses}</span><ArrowUpRight className="ssv2-nav-arrow" size={14} aria-hidden="true" />
            </button>
          </nav>
          <div className="ssv2-rail-bottom">
            <p><span aria-hidden="true">س</span>{isArabic ? "تعلّمك، على طريقتك" : "Learning, your way"}</p>
            <button className="ssv2-logout" type="button" onClick={act}><LogOut size={16} aria-hidden="true" /><span>{t.logout}</span></button>
          </div>
        </aside>

        <div className="ssv2-main-column">
          <header className="ssv2-topbar">
            <div className="ssv2-breadcrumb"><span>{isArabic ? "مساحة الطالب" : "Student space"}</span><span aria-hidden="true">/</span><strong>{t.dashboard}</strong></div>
            <div className="ssv2-top-actions">
              <button className="ssv2-language" type="button" onClick={() => preview.setLocale(isArabic ? "en" : "ar")}>
                <span aria-hidden="true">{isArabic ? "EN" : "ع"}</span>{isArabic ? "English" : "العربية"}
              </button>
            </div>
          </header>

          <main className="ssv2-content">
            <section className="ssv2-welcome ssv2-enter" aria-labelledby="ssv2-welcome-title">
              <div className="ssv2-welcome-copy">
                <span className="ssv2-eyebrow"><i />{isArabic ? "مسارك التعليمي" : "YOUR LEARNING SPACE"}</span>
                <h1 id="ssv2-welcome-title" dir="auto">{t.greeting} <em>{displayName}</em></h1>
                <p>{isArabic ? "كل دورة لها مسار واضح. تقدّمك هنا، خطوة بخطوة." : "Every course has a clear path. See your progress, step by step."}</p>
                {data.stress && <bdi className="ssv2-email" dir="ltr">{longEmail}</bdi>}
              </div>
              <div className="ssv2-welcome-seal" aria-hidden="true"><span>س</span><i /><b /></div>
            </section>

            {state === "loading" ? (
              <V2Loading locale={locale} label={t.loading} />
            ) : (
              <>
                <dl className="ssv2-metrics ssv2-enter" aria-label={isArabic ? "ملخص التعلّم" : "Learning summary"}>
                  <div className="ssv2-metric ssv2-metric-courses"><dt><Layers3 size={17} aria-hidden="true" />{t.courses}</dt><dd><bdi>{data.totalCourses}</bdi></dd><i aria-hidden="true" /></div>
                  <div className="ssv2-metric ssv2-metric-done"><dt><Check size={17} aria-hidden="true" />{t.done}</dt><dd><bdi>{data.completedRequired}</bdi></dd><i aria-hidden="true" /></div>
                  <div className="ssv2-metric ssv2-metric-left"><dt><Target size={17} aria-hidden="true" />{t.remaining}</dt><dd><bdi>{data.remainingRequired}</bdi></dd><i aria-hidden="true" /></div>
                </dl>

                {data.courses.length === 0 ? (
                  <section className="ssv2-empty ssv2-enter" aria-labelledby="ssv2-empty-title">
                    <div className="ssv2-empty-mark" aria-hidden="true"><BookOpen size={24} /></div>
                    <span className="ssv2-eyebrow">{isArabic ? "بداية المسار" : "THE START OF YOUR PATH"}</span>
                    <h2 id="ssv2-empty-title">{t.emptyTitle}</h2><p>{t.emptyBody}</p>
                  </section>
                ) : (
                  <>
                    <section className="ssv2-next ssv2-enter" aria-labelledby="ssv2-next-title">
                      <div className="ssv2-next-copy">
                        <span className="ssv2-next-kicker"><ArrowDownLeft size={15} aria-hidden="true" />{isArabic ? "نقطة المتابعة" : "PICK UP YOUR PATH"}</span>
                        <h2 id="ssv2-next-title">{isArabic ? "تابع من حيث وصلت" : "Continue where you left off"}</h2>
                        {nextCourse ? (
                          <>
                            <h3 dir="auto">{nextCourse.title}</h3>
                            <p dir="auto">{nextCourse.description}</p>
                            <div className="ssv2-next-controls">
                              <V2Progress course={nextCourse} locale={locale} featured />
                              <V2Action course={nextCourse} locale={locale} act={act} featured />
                            </div>
                          </>
                        ) : <p className="ssv2-no-next">{isArabic ? "لا توجد دورة قيد التقدّم حالياً." : "There is no course in progress right now."}</p>}
                      </div>
                      <div className="ssv2-path-art" aria-hidden="true">
                        <div className="ssv2-path-frame">
                          <span className="ssv2-syntax-mark">{`{ }`}</span>
                          <i className="ssv2-path-line ssv2-path-line-one" /><i className="ssv2-path-line ssv2-path-line-two" />
                          <b className="ssv2-path-step ssv2-path-step-one" /><b className="ssv2-path-step ssv2-path-step-two" /><b className="ssv2-path-step ssv2-path-step-three" />
                          <span className="ssv2-path-node ssv2-node-one" /><span className="ssv2-path-node ssv2-node-two" /><span className="ssv2-path-node ssv2-node-three" />
                        </div>
                        <span className="ssv2-art-caption">{isArabic ? "خطوة، ثم إتقان" : "STEP BY STEP, TO MASTERY"}</span>
                      </div>
                    </section>

                    <section className="ssv2-course-section ssv2-enter" aria-labelledby="ssv2-courses-title">
                      <div className="ssv2-section-heading">
                        <div><span className="ssv2-eyebrow">{isArabic ? "مساراتك" : "YOUR PATHS"}</span><h2 id="ssv2-courses-title">{t.myCourses}</h2></div>
                        <span className="ssv2-course-total">
                          {isArabic && data.totalCourses === 1 ? "دورة واحدة"
                            : isArabic && data.totalCourses === 2 ? "دورتان"
                            : <><bdi>{data.totalCourses}</bdi> {isArabic ? (data.totalCourses % 100 >= 3 && data.totalCourses % 100 <= 10 ? "دورات" : "دورة") : (data.totalCourses === 1 ? "course" : "courses")}</>}
                        </span>
                      </div>
                      <p className="ssv2-required-note"><ListChecks size={17} aria-hidden="true" /><span>{t.progressNote}</span></p>
                      <ul className="ssv2-course-list">
                        {data.courses.map((course, index) => <V2CourseRow key={course.id} course={course} index={index} locale={locale} act={act} />)}
                      </ul>
                    </section>
                  </>
                )}
              </>
            )}
            <footer className="ssv2-footer"><span>{isArabic ? "سعودي سنسي" : "SaudiSensei"}</span><i aria-hidden="true">·</i><span>{isArabic ? "تعلّم بثقة" : "Learn with confidence"}</span></footer>
          </main>
        </div>
      </div>

      <nav className="ssv2-mobile-nav" aria-label={t.navigation}>
        <button className="ssv2-mobile-nav-item is-current" type="button" aria-current="page" onClick={act}><PanelRight size={18} aria-hidden="true" /><span>{t.dashboard}</span></button>
        <button className="ssv2-mobile-nav-item" type="button" onClick={act}><BookOpen size={18} aria-hidden="true" /><span>{t.myCourses}</span></button>
      </nav>
    </div>
  );
}
