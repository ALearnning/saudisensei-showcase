import type { CSSProperties } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, Circle, FileText } from "lucide-react";
import { previewCourse } from "./Current";
import "./_refined.css";

type Locale = "ar" | "en";

type RefinedProps = {
  locale?: Locale;
  continueLessonId?: string;
};

const copy = {
  ar: {
    brand: "سعودي سينسي",
    brandCaption: "تعلّم بهدف",
    navLabel: "التنقّل الرئيسي",
    courses: "دوراتي",
    courseNav: "الدورة",
    outlineNav: "المحتوى",
    resourcesNav: "الموارد",
    eyebrow: "مسارك التعليمي",
    courseEyebrow: "محتوى الدورة",
    continue: "تابع التعلّم",
    review: "راجع الدورة",
    progressHeading: "تقدّمك في الدورة",
    requiredLessons: "دروس إلزامية",
    completedOf: (done: number, total: number) => `أكملت ${done} من ${total} دروس إلزامية`,
    outline: "محتوى الدورة",
    chapter: (index: number) => `الفصل ${index}`,
    required: "إلزامي",
    optional: "اختياري",
    completed: "مكتمل",
    current: "الدرس الحالي",
    notComplete: "لم يكتمل بعد",
    lesson: "درس",
    resources: "موارد الدورة",
    noResources: "لا توجد موارد مضافة لهذه الدورة حالياً.",
    resourcesHint: "ستظهر الملفات والمواد المشتركة هنا عند إضافتها.",
    backToTop: "العودة إلى بداية الصفحة",
    skip: "انتقل إلى محتوى الدورة",
    mobileHome: "المسار",
    mobileCourses: "دوراتي",
    courseLabel: "دورة",
  },
  en: {
    brand: "SaudiSensei",
    brandCaption: "LEARN WITH PURPOSE",
    navLabel: "Main navigation",
    courses: "My courses",
    courseNav: "Course",
    outlineNav: "Outline",
    resourcesNav: "Resources",
    eyebrow: "YOUR LEARNING PATH",
    courseEyebrow: "COURSE OVERVIEW",
    continue: "Continue learning",
    review: "Review course",
    progressHeading: "Your course progress",
    requiredLessons: "required lessons",
    completedOf: (done: number, total: number) => `${done} of ${total} required lessons completed`,
    outline: "Course outline",
    chapter: (index: number) => `Chapter ${index}`,
    required: "Required",
    optional: "Optional",
    completed: "Completed",
    current: "Current lesson",
    notComplete: "Not completed",
    lesson: "lesson",
    resources: "Course resources",
    noResources: "There are no resources added to this course yet.",
    resourcesHint: "Shared files and materials will appear here when available.",
    backToTop: "Back to the top of the page",
    skip: "Skip to course content",
    mobileHome: "Path",
    mobileCourses: "My courses",
    courseLabel: "Course",
  },
} as const;

/** Standalone illustrative course overview, with data kept intentionally local. */
export function Refined({ locale = "ar", continueLessonId = "lesson-two" }: RefinedProps) {
  const ar = locale === "ar";
  const t = copy[locale];
  const chapters = [...previewCourse.chapters]
    .sort((a, b) => a.position - b.position)
    .map((chapter) => ({
      ...chapter,
      lessons: [...chapter.lessons].sort((a, b) => a.position - b.position),
    }));
  const lessons = chapters.flatMap((chapter) => chapter.lessons);
  const requiredLessons = lessons.filter((lesson) => lesson.isRequired);
  const completedRequired = requiredLessons.filter((lesson) => lesson.completed).length;
  const totalRequired = requiredLessons.length;
  const percentage = totalRequired ? Math.round((completedRequired / totalRequired) * 100) : 0;
  const continueLesson = lessons.find((lesson) => lesson.id === continueLessonId);
  const continueHref = continueLesson ? `#${continueLesson.id}` : "#course-outline";
  const continueLabel = completedRequired === totalRequired && totalRequired > 0 ? t.review : t.continue;

  return (
    <div className={`ss-course-refined${ar ? " is-ar" : " is-en"}`} lang={locale} dir={ar ? "rtl" : "ltr"}>
      <a className="sscr-skip" href="#course-content">{t.skip}</a>

      <div className="sscr-layout">
        <aside className="sscr-rail" aria-label={t.navLabel}>
          <a className="sscr-brand" href="#course-content" aria-label={t.brand}>
            <span className="sscr-brand-mark" aria-hidden="true">س</span>
            <span className="sscr-brand-name">
              <strong>{t.brand}</strong>
              <small lang="en">{t.brandCaption}</small>
            </span>
          </a>
          <div className="sscr-rail-rule" />
          <span className="sscr-rail-caption">{t.courseLabel}</span>
          <nav className="sscr-nav" aria-label={t.navLabel}>
            <a className="sscr-nav-item" href="#course-content"><BookOpen size={18} aria-hidden="true" /><span>{t.courseNav}</span></a>
            <a className="sscr-nav-item is-current" href="#course-outline" aria-current="location"><span className="sscr-nav-marker" aria-hidden="true" /><span>{t.outlineNav}</span></a>
            <a className="sscr-nav-item" href="#course-resources"><FileText size={18} aria-hidden="true" /><span>{t.resourcesNav}</span></a>
          </nav>
          <div className="sscr-rail-note"><span aria-hidden="true">س</span><p>{ar ? "خطوة واضحة، ثم التي تليها." : "One clear step, then the next."}</p></div>
        </aside>

        <div className="sscr-main-column">
          <header className="sscr-mobile-header">
            <a className="sscr-brand" href="#course-content" aria-label={t.brand}>
              <span className="sscr-brand-mark" aria-hidden="true">س</span>
              <span className="sscr-brand-name"><strong>{t.brand}</strong></span>
            </a>
            <span className="sscr-header-context">{t.courses}</span>
          </header>
          <div className="sscr-topbar">
            <nav className="sscr-breadcrumb" aria-label={ar ? "مسار التنقّل" : "Breadcrumb"}>
              <a href="#course-content">{t.courses}</a><span aria-hidden="true">/</span><strong>{t.courseEyebrow}</strong>
            </nav>
          </div>

          <main className="sscr-content" id="course-content" tabIndex={-1}>
            <header className="sscr-course-head" id="course-top">
              <div className="sscr-heading-copy">
                <span className="sscr-eyebrow"><i aria-hidden="true" />{t.eyebrow}</span>
                <span className="sscr-course-kicker">{t.courseEyebrow}</span>
                <h1 dir="auto">{previewCourse.title}</h1>
                <p className="sscr-description" dir="auto">{previewCourse.description}</p>
              </div>
              <a className="sscr-continue" href={continueHref} aria-label={continueLesson ? `${continueLabel}: ${continueLesson.title}` : continueLabel}>
                <span>{continueLabel}</span><ArrowLeft size={17} aria-hidden="true" />
              </a>
            </header>

            <section className="sscr-progress-section" aria-labelledby="sscr-progress-title">
              <div className="sscr-progress-intro">
                <div>
                  <span className="sscr-section-overline">{t.progressHeading}</span>
                  <h2 id="sscr-progress-title">{t.completedOf(completedRequired, totalRequired)}</h2>
                </div>
                <strong className="sscr-percent"><bdi>{percentage}%</bdi></strong>
              </div>
              <div
                className="sscr-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                aria-valuetext={t.completedOf(completedRequired, totalRequired)}
                aria-label={`${previewCourse.title}: ${t.completedOf(completedRequired, totalRequired)}`}
              >
                <span style={{ "--sscr-progress": percentage / 100 } as CSSProperties} />
              </div>
              <p className="sscr-progress-foot"><span aria-hidden="true" />{ar ? "يُحتسب التقدّم من الدروس الإلزامية فقط" : "Progress reflects required lessons only"}</p>
            </section>

            <section className="sscr-outline-section" id="course-outline" aria-labelledby="sscr-outline-title">
              <div className="sscr-section-heading">
                <div><span className="sscr-eyebrow"><i aria-hidden="true" />{ar ? "خارطة الدورة" : "THE COURSE MAP"}</span><h2 id="sscr-outline-title">{t.outline}</h2></div>
                <span className="sscr-lesson-count"><bdi>{lessons.length}</bdi> {t.lesson}</span>
              </div>
              <ol className="sscr-chapters">
                {chapters.map((chapter, chapterIndex) => (
                  <li className="sscr-chapter" key={chapter.id}>
                    <div className="sscr-chapter-heading">
                      <span className="sscr-chapter-index"><bdi>{String(chapterIndex + 1).padStart(2, "0")}</bdi></span>
                      <h3 dir="auto">{chapter.title}</h3>
                      <span className="sscr-chapter-rule" aria-hidden="true" />
                    </div>
                    <ol className="sscr-lessons">
                      {chapter.lessons.map((lesson) => {
                        const isCurrent = lesson.id === continueLessonId;
                        const stateLabel = lesson.completed ? t.completed : isCurrent ? t.current : t.notComplete;
                        return (
                          <li className={`sscr-lesson${lesson.completed ? " is-complete" : ""}${isCurrent ? " is-current" : ""}`} id={lesson.id} key={lesson.id}>
                            <a
                              className="sscr-lesson-link"
                              href={`#${lesson.id}`}
                              aria-current={isCurrent ? "page" : undefined}
                              aria-label={`${lesson.title} — ${stateLabel} — ${lesson.isRequired ? t.required : t.optional}`}
                            >
                              <span className="sscr-status-icon" aria-hidden="true">
                                {lesson.completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                              </span>
                              <span className="sscr-lesson-copy">
                                <span className="sscr-lesson-title" dir="auto">{lesson.title}</span>
                                <span className="sscr-status-text">{stateLabel}</span>
                              </span>
                              <span className={`sscr-tag ${lesson.isRequired ? "is-required" : "is-optional"}`}>{lesson.isRequired ? t.required : t.optional}</span>
                              {isCurrent && <span className="sscr-current-mark" aria-hidden="true" />}
                            </a>
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                ))}
              </ol>
            </section>

            <section className="sscr-resources" id="course-resources" aria-labelledby="sscr-resources-title">
              <div className="sscr-resources-icon" aria-hidden="true"><FileText size={18} /></div>
              <div className="sscr-resources-copy">
                <h2 id="sscr-resources-title">{t.resources}</h2>
                <p>{t.noResources}</p>
                <small>{t.resourcesHint}</small>
              </div>
            </section>

            <footer className="sscr-footer"><span>{t.brand}</span><i aria-hidden="true">·</i><span>{ar ? "تعلّم بثقة" : "Learn with confidence"}</span><a href="#course-top">{t.backToTop}</a></footer>
          </main>
        </div>
      </div>

      <nav className="sscr-mobile-nav" aria-label={t.navLabel}>
        <a href="#course-content"><BookOpen size={18} aria-hidden="true" /><span>{t.mobileHome}</span></a>
        <a className="is-current" href="#course-outline" aria-current="location"><span className="sscr-mobile-nav-dot" aria-hidden="true" /><span>{t.mobileCourses}</span></a>
      </nav>
    </div>
  );
}
