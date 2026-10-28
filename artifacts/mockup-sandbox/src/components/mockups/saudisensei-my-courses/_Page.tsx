import { useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { courses as starterCourses, type Course, type Locale } from "../saudisensei-dashboard/_shared";
import { manyCourses, localizedTitle } from "./_data";
import "./_styles.css";

type Preset = "1" | "3" | "16" | "0";
type Props = { initialCount: Preset; compact?: boolean };

const words = {
  ar: {
    preview: "معاينة تصميم · بيانات توضيحية",
    previewTools: "أدوات معاينة التصميم",
    language: "English",
    brand: "سعودي سنسي",
    navLabel: "التنقل الرئيسي",
    dashboard: "لوحة المتابعة",
    myCourses: "دوراتي",
    workspace: "مساحة الطالب",
    eyebrow: "مسارك التعليمي",
    title: "دوراتي",
    lead: "دوراتك وتقدّمك، في مكان واحد.",
    search: "بحث في دوراتك",
    searchPlaceholder: "ابحث في دوراتك",
    enrolled: "دورة مسجّلة",
    enrolledPlural: "دورات مسجّلة",
    required: "دروس إلزامية",
    complete: "مكتملة",
    continue: "تابع التعلّم",
    open: "فتح الدورة",
    review: "مراجعة الدورة",
    completed: "مكتملة",
    noRequired: "لا توجد دروس إلزامية",
    noResults: "لا توجد نتائج مطابقة",
    noResultsBody: "جرّب البحث بكلمات مختلفة.",
    emptyTitle: "لم تنضم إلى أي دورة بعد",
    emptyBody: "ستظهر دوراتك هنا عندما يسجّلك المشرف في دورة.",
    emptyNote: "لا تحتاج إلى إعداد شيء الآن. سيظهر مسارك هنا بعد التسجيل.",
    prev: "السابق",
    next: "التالي",
    page: "صفحة",
    of: "من",
    localControls: "حالات المعاينة المحلية",
    fixture: "عدد الدورات",
    one: "دورة واحدة",
    three: "٣ دورات",
    sixteen: "١٦ دورة",
    zero: "بدون دورات",
    long: "عناوين طويلة",
    clear: "مسح البحث",
    actionFeedback: "معاينة فقط — لن يتم فتح الدورة أو تغيير بيانات التعلّم.",
    dashboardFeedback: "معاينة فقط — زر لوحة المتابعة لا ينتقل إلى صفحة أخرى.",
    adminNote: "ستظهر الدورات بعد أن يسجّلك المشرف.",
    listHeading: "كل الدورات",
    result: "نتيجة",
    results: "نتائج",
  },
  en: {
    preview: "Design preview · illustrative data",
    previewTools: "Design preview controls",
    language: "العربية",
    brand: "SaudiSensei",
    navLabel: "Main navigation",
    dashboard: "Dashboard",
    myCourses: "My courses",
    workspace: "Student workspace",
    eyebrow: "YOUR LEARNING PATH",
    title: "My courses",
    lead: "Your courses and progress, in one place.",
    search: "Search your courses",
    searchPlaceholder: "Search your courses",
    enrolled: "enrolled course",
    enrolledPlural: "enrolled courses",
    required: "required lessons",
    complete: "Completed",
    continue: "Continue learning",
    open: "Open course",
    review: "Review course",
    completed: "Completed",
    noRequired: "No required lessons",
    noResults: "No matching courses",
    noResultsBody: "Try a different search term.",
    emptyTitle: "No courses yet",
    emptyBody: "Your courses will appear here when an admin enrolls you in a course.",
    emptyNote: "There is nothing to set up right now. Your learning path will appear here after enrollment.",
    prev: "Previous",
    next: "Next",
    page: "Page",
    of: "of",
    localControls: "Local preview scenarios",
    fixture: "Course count",
    one: "1 course",
    three: "3 courses",
    sixteen: "16 courses",
    zero: "No courses",
    long: "Long titles",
    clear: "Clear search",
    actionFeedback: "Preview only — the course will not open and learning data will not change.",
    dashboardFeedback: "Preview only — Dashboard does not navigate away.",
    adminNote: "Courses appear here after an admin enrolls you.",
    listHeading: "All courses",
    result: "result",
    results: "results",
  },
} as const;

function getInitialLocale(): Locale {
  return new URLSearchParams(window.location.search).get("lang") === "en" ? "en" : "ar";
}

function getInitialLong() {
  return new URLSearchParams(window.location.search).get("titles") === "long";
}

function makeFixture(count: Preset, long: boolean, locale: Locale): Course[] {
  const source = count === "16" ? manyCourses : starterCourses;
  const selected = count === "0" ? [] : count === "1" ? source.slice(0, 1) : count === "16" ? source : starterCourses;
  return selected.map((course, index) => ({
    ...course,
    title: localizedTitle(course, locale, index, long),
  }));
}

function CourseMark({ index, completed }: { index: number; completed: boolean }) {
  return <span className={`mc-mark mc-mark-${(index % 4) + 1}${completed ? " is-done" : ""}`} aria-hidden="true">
    <span>{String(index + 1).padStart(2, "0")}</span><i /><b />
  </span>;
}

function Action({ course, locale, onAct }: { course: Course; locale: Locale; onAct: (label: string) => void }) {
  const t = words[locale];
  const label = course.progress?.isCompleted ? t.review : course.progress?.continueLessonId ? t.continue : t.open;
  return <button type="button" className="mc-action" onClick={() => onAct(label)} aria-label={`${label}: ${course.title}`}>
    <span>{label}</span><ArrowLeft size={16} aria-hidden="true" />
  </button>;
}

function Progress({ course, locale }: { course: Course; locale: Locale }) {
  const p = course.progress;
  if (!p) return null;
  const label = locale === "ar"
    ? `${p.completedRequired} من ${p.totalRequired} ${words.ar.required}`
    : `${p.completedRequired} of ${p.totalRequired} ${words.en.required}`;
  return <div className="mc-progress">
    <div className="mc-progress-copy"><span><bdi>{p.completedRequired} / {p.totalRequired}</bdi> {words[locale].required}</span><strong><bdi>{p.percentage}%</bdi></strong></div>
    {p.totalRequired > 0
      ? <div className="mc-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percentage}>
          <span style={{ "--mc-value": `${p.percentage}%` } as CSSProperties} />
        </div>
      : <p className="mc-no-required">{words[locale].noRequired}</p>}
  </div>;
}

function CourseCard({ course, index, locale, compact, onAct }: { course: Course; index: number; locale: Locale; compact: boolean; onAct: (label: string) => void }) {
  const completed = Boolean(course.progress?.isCompleted);
  return <article className={`mc-course${compact ? " mc-course-compact" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
    <CourseMark index={index} completed={completed} />
    <div className="mc-course-copy">
      <div className="mc-title-line">
        <h3 dir="auto"><button type="button" className="mc-course-title" onClick={() => onAct(words[locale].open)} aria-label={`${words[locale].open}: ${course.title}`}>{course.title}</button></h3>
        {completed && <span className="mc-completed"><Check size={13} aria-hidden="true" />{words[locale].completed}</span>}
      </div>
      {course.description && <p dir="auto">{course.description}</p>}
      <div className="mc-progress-wrap"><Progress course={course} locale={locale} /></div>
    </div>
    <Action course={course} locale={locale} onAct={onAct} />
  </article>;
}

export function MyCoursesPage({ initialCount, compact = false }: Props) {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);
  const [count, setCount] = useState<Preset>(initialCount);
  const [long, setLong] = useState(getInitialLong);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const t = words[locale];
  const allCourses = useMemo(() => makeFixture(count, long, locale), [count, long, locale]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? allCourses.filter(course => `${course.title} ${course.description}`.toLocaleLowerCase().includes(needle)) : allCourses;
  }, [allCourses, query]);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const visibleCourses = matches.slice((page - 1) * pageSize, page * pageSize);
  const isArabic = locale === "ar";
  const hasMany = count === "16";

  function changeCount(next: Preset) {
    setCount(next);
    setPage(1);
    setQuery("");
  }

  return <div className={`ss-my-courses${compact ? " mc-mobile-frame" : ""}`} lang={locale} dir={isArabic ? "rtl" : "ltr"}>
    <div className="mc-preview-bar" aria-label={t.previewTools}>
      <span className="mc-preview-caption">{t.preview}</span>
      <div className="mc-preview-controls">
        <span className="mc-preview-label">{t.localControls}</span>
        <label className="mc-preview-select">
          <span className="mc-sr-only">{t.fixture}</span>
          <select value={count} onChange={event => changeCount(event.target.value as Preset)}>
            <option value="1">{t.one}</option><option value="3">{t.three}</option><option value="16">{t.sixteen}</option><option value="0">{t.zero}</option>
          </select>
        </label>
        <label className="mc-long-toggle"><input type="checkbox" checked={long} onChange={event => setLong(event.target.checked)} /><span>{t.long}</span></label>
        <button className="mc-language" type="button" onClick={() => setLocale(isArabic ? "en" : "ar")}>{t.language}</button>
      </div>
    </div>

    <div className="mc-layout">
      <aside className="mc-rail">
        <button className="mc-brand" type="button" onClick={() => setNotice(t.dashboardFeedback)} aria-label={t.brand}>
          <span className="mc-brand-mark" aria-hidden="true">س</span>
          <span className="mc-brand-name"><strong>{t.brand}</strong><small>LEARN WITH PURPOSE</small></span>
        </button>
        <div className="mc-rail-rule" />
        <span className="mc-rail-caption">{t.workspace}</span>
        <nav className="mc-nav" aria-label={t.navLabel}>
          <button className="mc-nav-item" type="button" onClick={() => setNotice(t.dashboardFeedback)}><BookOpen size={18} aria-hidden="true" /><span>{t.dashboard}</span></button>
          <button className="mc-nav-item is-current" type="button" aria-current="page"><BookOpen size={18} aria-hidden="true" /><span>{t.myCourses}</span><i /></button>
        </nav>
        <div className="mc-rail-footer"><span aria-hidden="true">س</span>{isArabic ? "تعلّمك، على طريقتك" : "Learning, your way"}</div>
      </aside>

      <div className="mc-main-column">
        <header className="mc-topbar">
          <div className="mc-breadcrumb"><span>{t.workspace}</span><span aria-hidden="true">/</span><strong>{t.myCourses}</strong></div>
          <button className="mc-language" type="button" onClick={() => setLocale(isArabic ? "en" : "ar")}>{t.language}</button>
        </header>
        <main className="mc-content">
          <header className="mc-page-head">
            <span className="mc-eyebrow"><i />{t.eyebrow}</span>
            <h1>{t.title}</h1>
            <p>{t.lead}</p>
          </header>

          {count === "0" ? <section className="mc-empty" aria-labelledby="mc-empty-title">
            <div className="mc-empty-art" aria-hidden="true"><BookOpen size={27} /><span /><i /></div>
            <span className="mc-eyebrow">{isArabic ? "بداية المسار" : "THE START OF YOUR PATH"}</span>
            <h2 id="mc-empty-title">{t.emptyTitle}</h2>
            <p>{t.emptyBody}</p>
            <div className="mc-admin-note"><span aria-hidden="true">س</span>{t.adminNote}</div>
            <p className="mc-empty-foot">{t.emptyNote}</p>
            <button className="mc-subtle-link" type="button" onClick={() => setNotice(t.dashboardFeedback)}>{t.dashboard}<ArrowLeft size={15} aria-hidden="true" /></button>
          </section> : <>
            <div className="mc-toolbar">
              <label className="mc-search">
                <Search size={17} aria-hidden="true" />
                <span className="mc-sr-only">{t.search}</span>
                <input type="search" value={query} placeholder={t.searchPlaceholder} onChange={event => { setQuery(event.target.value); setPage(1); }} />
                {query && <button type="button" className="mc-clear" onClick={() => { setQuery(""); setPage(1); }} aria-label={t.clear}><X size={15} /></button>}
              </label>
              <span className="mc-total"><bdi>{matches.length}</bdi> {matches.length === 1 ? t.enrolled : t.enrolledPlural}</span>
            </div>
            {matches.length === 0 ? <section className="mc-no-results" role="status">
              <span className="mc-no-results-mark"><Search size={20} aria-hidden="true" /></span><h2>{t.noResults}</h2><p>{t.noResultsBody}</p>
            </section> : <section className={`mc-course-section${hasMany ? " is-dense" : ""}`} aria-labelledby="mc-list-title">
              <div className="mc-section-heading"><div><span className="mc-eyebrow">{isArabic ? "مساراتك" : "YOUR PATHS"}</span><h2 id="mc-list-title">{t.listHeading}</h2></div>
                {hasMany && <span className="mc-page-summary"><bdi>{Math.min((page - 1) * pageSize + 1, matches.length)}–{Math.min(page * pageSize, matches.length)}</bdi> {t.of} <bdi>{matches.length}</bdi> {t.results}</span>}
              </div>
              {hasMany && <p className="mc-required-note"><Check size={16} aria-hidden="true" /><span>{isArabic ? "التقدّم محسوب من الدروس الإلزامية." : "Progress is based on required lessons."}</span></p>}
              <div className={hasMany ? "mc-course-list" : "mc-course-grid"}>
                {visibleCourses.map((course, index) => <CourseCard key={course.id} course={course} index={index + (page - 1) * pageSize} locale={locale} compact={hasMany} onAct={label => setNotice(`${label} — ${t.actionFeedback}`)} />)}
              </div>
              {pageCount > 1 && <nav className="mc-pager" aria-label={isArabic ? "صفحات الدورات" : "Course pages"}>
                <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}><ChevronRight size={17} aria-hidden="true" /><span>{t.prev}</span></button>
                <span>{t.page} <bdi>{page}</bdi> {t.of} <bdi>{pageCount}</bdi></span>
                <button type="button" onClick={() => setPage(page + 1)} disabled={page >= pageCount}><span>{t.next}</span><ChevronLeft size={17} aria-hidden="true" /></button>
              </nav>}
            </section>}
          </>}
          <footer className="mc-footer"><strong>{t.brand}</strong><span aria-hidden="true">·</span><span>{isArabic ? "تعلّم بثقة" : "Learn with confidence"}</span></footer>
        </main>
      </div>
    </div>

    <nav className="mc-mobile-nav" aria-label={t.navLabel}>
      <button type="button" onClick={() => setNotice(t.dashboardFeedback)}><BookOpen size={18} aria-hidden="true" /><span>{t.dashboard}</span></button>
      <button type="button" className="is-current" aria-current="page"><BookOpen size={18} aria-hidden="true" /><span>{t.myCourses}</span></button>
    </nav>
    {notice && <div className="mc-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label={isArabic ? "إغلاق" : "Dismiss"}><X size={15} /></button></div>}
  </div>;
}

