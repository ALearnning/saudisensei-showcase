"use client";

import { Link, getCatalog, fmt, paths, ErrorState, MutationError, ProgressBar, ReqTag, Skeleton } from "./_stubs";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2,
  ChevronDown, Circle, Focus, LogOut, PanelRight, PanelRightClose, PanelRightOpen, X,
} from "lucide-react";
import type { LmsCourse, LmsLesson, LmsProgress, ApiFailure } from "./_stubs";
import type { Locale } from "./config";
import { getLms } from "./lms";
import { Markdown } from "./_Markdown";

type LessonViewProps = {
  locale: Locale;
  lesson: LmsLesson;
  course: LmsCourse | undefined;
  previous?: LmsLesson;
  next?: LmsLesson;
  progress?: LmsProgress;
  resources: ReactNode;
  outlineLoading: boolean;
  outlineError: ApiFailure | null;
  onRetryOutline: () => void;
  busy: boolean;
  error: ApiFailure | null;
  onComplete: () => void;
};

const words = {
  ar: {
    path: "مسار التعلّم",
    lesson: "الدرس الحالي",
    focus: "تركيز على الدرس",
    showOutline: "إظهار مخطط الدورة",
    hideOutline: "إخفاء مخطط الدورة",
    closeOutline: "إغلاق مخطط الدورة",
    skip: "انتقل إلى محتوى الدرس",
    dashboard: "لوحة المتابعة",
    myCourses: "دوراتي",
    signOut: "تسجيل الخروج",
    codeScroll: "كتلة برمجية؛ استخدم مفاتيح الأسهم للتمرير أفقيًا",
    outlineLabel: "مخطط الدورة والدروس",
    switchLabel: "English",
    switchAria: "التبديل إلى الإنجليزية مع البقاء في الدرس",
    lessonIndex: "الدرس",
    completed: "مكتمل",
    notCompleted: "لم يكتمل بعد",
    courseProgress: "تقدّم الدورة",
    chapterProgress: "دروس الفصل المكتملة",
    previous: "الدرس السابق",
    next: "الدرس التالي",
  },
  en: {
    path: "Learning path",
    lesson: "Current lesson",
    focus: "Lesson focus",
    showOutline: "Show course outline",
    hideOutline: "Hide course outline",
    closeOutline: "Close course outline",
    skip: "Skip to lesson content",
    dashboard: "Dashboard",
    myCourses: "My courses",
    signOut: "Sign out",
    codeScroll: "Code block; use arrow keys to scroll horizontally",
    outlineLabel: "Course and lesson outline",
    switchLabel: "العربية",
    switchAria: "Switch to Arabic and stay on this lesson",
    lessonIndex: "Lesson",
    completed: "Completed",
    notCompleted: "Not completed yet",
    courseProgress: "Course progress",
    chapterProgress: "Chapter lessons completed",
    previous: "Previous lesson",
    next: "Next lesson",
  },
} as const;

function ordered<T extends { position: number }>(items: readonly T[] | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => a.position - b.position);
}

function CourseOutline({ locale, course, currentId }: { locale: Locale; course: LmsCourse; currentId: string }) {
  const t = getLms(locale);
  const s = words[locale];
  const chapters = ordered(course.chapters);
  if (!chapters.length) return <p className="sslv-empty muted">{t.student.noChapters}</p>;
  return (
    <ol className="sslv-outline">
      {chapters.map((chapter, chapterIndex) => (
        <li className="sslv-chapter" key={chapter.id}>
          <div className="sslv-chapter-title">
            <span className="sslv-chapter-index" aria-hidden="true">{String(chapterIndex + 1).padStart(2, "0")}</span>
            <span dir="auto">{chapter.title}</span>
          </div>
          <ol className="sslv-lesson-list">
            {ordered(chapter.lessons).map((item) => (
              <li key={item.id}>
                <Link
                  href={paths.lesson(locale, course.id, item.id)}
                  className={`sslv-outline-link${item.id === currentId ? " is-current" : ""}`}
                  aria-current={item.id === currentId ? "page" : undefined}
                  data-testid={`link-lesson-${item.id}`}
                >
                  <span className={`sslv-outline-status${item.completed ? " is-complete" : ""}`} aria-hidden="true">
                    {item.completed ? <CheckCircle2 size={17} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
                  </span>
                  <span className="sslv-outline-copy" dir="auto">{item.title}</span>
                  <span className="sslv-sr-only">{item.completed ? t.common.completed : s.notCompleted}</span>
                  <ReqTag required={item.isRequired} locale={locale} />
                </Link>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function LessonDestination({ locale, courseId, lesson, direction }: {
  locale: Locale;
  courseId: string;
  lesson?: LmsLesson;
  direction: "previous" | "next";
}) {
  const s = words[locale];
  const isNext = direction === "next";
  if (!lesson) return <span className={`sslv-destination is-empty ${isNext ? "is-next" : "is-previous"}`} aria-hidden="true" />;
  const Arrow = isNext === (locale === "ar") ? ArrowLeft : ArrowRight;
  return (
    <Link
      href={paths.lesson(locale, courseId, lesson.id)}
      className={`sslv-destination ${isNext ? "is-next" : "is-previous"}`}
      data-testid={isNext ? "link-next-lesson" : "link-prev-lesson"}
    >
      <span className="sslv-destination-icon" aria-hidden="true"><Arrow size={18} /></span>
      <span className="sslv-destination-copy">
        <small>{isNext ? s.next : s.previous}</small>
        <span dir="auto">{lesson.title}</span>
      </span>
    </Link>
  );
}

export function LessonView({
  locale, lesson, course, previous, next, progress, resources, outlineLoading,
  outlineError, onRetryOutline, busy, error, onComplete,
}: LessonViewProps) {
  const ar = locale === "ar";
  const t = getLms(locale);
  const s = words[locale];
  const catalog = getCatalog(locale);
  const chapter = course?.chapters?.find((item) => item.id === lesson.chapterId);
  const chapterCompleted = chapter?.lessons.filter((item) => item.completed).length ?? 0;
  const chapterTotal = chapter?.lessons.length ?? 0;
  const flatLessons = useMemo(
    () => ordered(course?.chapters).flatMap((item) => ordered(item.lessons)),
    [course],
  );
  const position = flatLessons.findIndex((item) => item.id === lesson.id);
  const [outlineExpanded, setOutlineExpanded] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [completionPulse, setCompletionPulse] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerOpenRef = useRef(drawerOpen);
  const routeKeyRef = useRef(`${locale}:${course?.id ?? lesson.courseId}:${lesson.id}`);
  const completionStateRef = useRef({ lessonId: lesson.id, completed: !!lesson.completed });

  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);

  useEffect(() => {
    const key = `${locale}:${course?.id ?? lesson.courseId}:${lesson.id}`;
    if (routeKeyRef.current === key) return;
    routeKeyRef.current = key;
    if (drawerOpenRef.current) {
      setDrawerOpen(false);
      window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
    }
  }, [locale, course?.id, lesson.courseId, lesson.id]);

  useEffect(() => {
    if (!drawerOpen) return;
    const shell = document.querySelector<HTMLElement>(".shell");
    const previousInert = shell?.inert ?? false;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    if (shell) shell.inert = true;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    drawerRef.current?.focus();
    window.requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" }));
    const restoreFocus = () => {
      window.requestAnimationFrame(() => {
        if (window.matchMedia("(min-width: 821px)").matches) {
          const target = outlineExpanded
            ? viewerRef.current?.querySelector<HTMLElement>(".sslv-sidebar .sslv-desktop-collapse")
            : viewerRef.current?.querySelector<HTMLElement>(".sslv-focus-button");
          (target ?? viewerRef.current?.querySelector<HTMLElement>("#lesson-content"))?.focus();
        } else {
          drawerTriggerRef.current?.focus();
        }
      });
    };
    const closeOnDesktop = () => {
      if (!window.matchMedia("(min-width: 821px)").matches) return;
      setDrawerOpen(false);
      setOutlineExpanded(true);
      restoreFocus();
    };
    const desktopQuery = window.matchMedia("(min-width: 821px)");
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        restoreFocus();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusables = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawerRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnDesktop);
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnDesktop);
      desktopQuery.removeEventListener("change", closeOnDesktop);
      if (shell) shell.inert = previousInert;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [drawerOpen, outlineExpanded]);

  useEffect(() => {
    const codeBlocks = viewerRef.current?.querySelectorAll<HTMLElement>(".sslv-reading pre");
    codeBlocks?.forEach((block) => {
      block.tabIndex = 0;
      block.setAttribute("role", "region");
      block.setAttribute("aria-label", s.codeScroll);
    });
  }, [lesson.id, lesson.body, s.codeScroll]);

  useEffect(() => {
    const prior = completionStateRef.current;
    completionStateRef.current = { lessonId: lesson.id, completed: !!lesson.completed };
    if (prior.lessonId !== lesson.id || prior.completed || !lesson.completed) return;
    setCompletionPulse(true);
    const timer = window.setTimeout(() => setCompletionPulse(false), 520);
    return () => window.clearTimeout(timer);
  }, [lesson.id, lesson.completed]);

  function closeDrawer() {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(min-width: 821px)").matches) {
        const target = outlineExpanded
          ? viewerRef.current?.querySelector<HTMLElement>(".sslv-sidebar .sslv-desktop-collapse")
          : viewerRef.current?.querySelector<HTMLElement>(".sslv-focus-button");
        (target ?? viewerRef.current?.querySelector<HTMLElement>("#lesson-content"))?.focus();
      } else {
        drawerTriggerRef.current?.focus();
      }
    });
  }

  const outline = outlineError
    ? <ErrorState error={outlineError} locale={locale} onRetry={onRetryOutline} />
    : course
      ? <CourseOutline locale={locale} course={course} currentId={lesson.id} />
      : outlineLoading
      ? <Skeleton rows={3} />
        : null;

  const outlineContent = (
    <>
      <div className="sslv-outline-heading">
        <span className="sslv-outline-mark" aria-hidden="true"><BookOpen size={17} /></span>
        <div><span className="sslv-kicker">{s.focus}</span><h2>{t.student.outline}</h2></div>
        <button
          type="button"
          className="sslv-icon-button sslv-desktop-collapse"
          aria-label={outlineExpanded ? s.hideOutline : s.showOutline}
          aria-expanded={outlineExpanded}
          onClick={() => {
            const willExpand = !outlineExpanded;
            setOutlineExpanded(willExpand);
            window.requestAnimationFrame(() => {
              const selector = willExpand ? ".sslv-sidebar .sslv-desktop-collapse" : ".sslv-focus-button";
              viewerRef.current?.querySelector<HTMLElement>(selector)?.focus();
            });
          }}
          data-testid="button-toggle-lesson-outline"
        >
          {outlineExpanded ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}
        </button>
        <button type="button" className="sslv-icon-button sslv-drawer-close" onClick={closeDrawer} aria-label={s.closeOutline} data-testid="button-close-lesson-outline">
          <X size={19} aria-hidden="true" />
        </button>
      </div>
      {outlineExpanded && <div className="sslv-outline-content">{outline}</div>}
    </>
  );

  return (
    <div className="ss-lesson-viewer" lang={locale} dir={ar ? "rtl" : "ltr"} ref={viewerRef}>
      <a className="sslv-skip" href="#lesson-content">{s.skip}</a>
      <header className="sslv-workspace-header">
        <Link className="sslv-brand" href={paths.student(locale)} aria-label={catalog.brand} data-testid="link-home">
          <span className="sslv-brand-mark" aria-hidden="true">س</span>
          <span className="sslv-brand-name"><strong>{catalog.brand}</strong><small lang="en">LEARN WITH PURPOSE</small></span>
        </Link>
        <nav className="sslv-global-nav" aria-label={t.nav.main}>
          <Link href={paths.student(locale)} aria-label={s.dashboard} data-testid="nav-dashboard"><PanelRight size={17} aria-hidden="true" /><span>{s.dashboard}</span></Link>
          <Link href={paths.myCourses(locale)} aria-label={s.myCourses} data-testid="nav-courses"><BookOpen size={17} aria-hidden="true" /><span>{s.myCourses}</span></Link>
        </nav>
        <div className="sslv-header-actions">
          <Link
            className="ssv2-language sslv-language"
            href={paths.lesson(ar ? "en" : "ar", course?.id ?? lesson.courseId, lesson.id)}
            hrefLang={ar ? "en" : "ar"}
            lang={ar ? "en" : "ar"}
            aria-label={s.switchAria}
            data-testid="link-language-switch-lesson"
          >
            <span aria-hidden="true">{ar ? "EN" : "ع"}</span>{s.switchLabel}
          </Link>
          <a href="#preview" onClick={event => event.preventDefault()} className="sslv-logout" aria-label={s.signOut} data-testid="link-nav-logout">
            <LogOut size={17} aria-hidden="true" /><span>{s.signOut}</span>
          </a>
        </div>
      </header>
      <div className={`sslv-layout${outlineExpanded ? "" : " is-focused"}`}>
        <aside className={`sslv-sidebar${outlineExpanded ? "" : " is-collapsed"}`} aria-label={s.outlineLabel}>
          {outlineContent}
        </aside>

        {drawerOpen && typeof document !== "undefined" && createPortal(
          <div className="sslv-drawer-layer" dir={ar ? "rtl" : "ltr"}>
            <button className="sslv-backdrop" type="button" onClick={closeDrawer} aria-label={s.closeOutline} tabIndex={-1} />
            <div
              className="sslv-drawer"
              id="lesson-outline-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={s.outlineLabel}
              tabIndex={-1}
              ref={drawerRef}
              data-testid="dialog-lesson-outline"
            >
              {outlineContent}
            </div>
          </div>,
          document.body,
        )}

        <section className="sslv-main" id="lesson-content" tabIndex={-1} aria-labelledby="text-lesson-title">
          <div className="sslv-toolbar">
            <button
              type="button"
              className={`sslv-focus-button${outlineExpanded ? " is-hidden" : ""}`}
              onClick={() => {
                setOutlineExpanded(true);
                window.requestAnimationFrame(() => viewerRef.current?.querySelector<HTMLElement>(".sslv-sidebar .sslv-desktop-collapse")?.focus());
              }}
              aria-label={s.showOutline}
              aria-expanded={outlineExpanded}
              data-testid="button-show-lesson-outline"
            >
              <PanelRightOpen size={17} aria-hidden="true" /><span>{t.student.outline}</span>
            </button>
            <button
              ref={drawerTriggerRef}
              type="button"
              className="sslv-outline-trigger"
              onClick={() => { setOutlineExpanded(true); setDrawerOpen(true); }}
              aria-expanded={drawerOpen}
              aria-controls={drawerOpen ? "lesson-outline-drawer" : undefined}
              data-testid="button-open-lesson-outline"
            >
              <BookOpen size={17} aria-hidden="true" /><span>{t.student.outline}</span><ChevronDown size={15} aria-hidden="true" />
            </button>
          </div>

          <header className="sslv-lesson-heading">
            <nav className="sslv-path" aria-label={s.path}>
              <Link href={paths.course(locale, course?.id ?? lesson.courseId)} data-testid="link-back-course">
                <ArrowDownLeft size={14} aria-hidden="true" /><span dir="auto">{course?.title ?? t.student.backToCourse}</span>
              </Link>
              {chapter && <><span className="sslv-path-divider" aria-hidden="true">/</span><span dir="auto" className="sslv-path-chapter">{chapter.title}</span></>}
              <span className="sslv-path-divider" aria-hidden="true">/</span>
              <span className="sslv-path-current">{s.lesson}</span>
            </nav>
            <div className="sslv-title-row">
              <div className="sslv-title-copy">
                <div className="sslv-meta">
                  <ReqTag required={lesson.isRequired} locale={locale} />
                  {position >= 0 && <span className="sslv-position">{s.lessonIndex} <bdi>{position + 1} / {flatLessons.length}</bdi></span>}
                  {chapterTotal > 0 && <span className="sslv-chapter-progress">{s.chapterProgress}: <bdi>{chapterCompleted} / {chapterTotal}</bdi></span>}
                  <span className={`sslv-completion-note${lesson.completed ? " is-complete" : ""}`} role="status" data-testid="status-lesson-progress">
                    {lesson.completed ? <Check size={14} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
                    {lesson.completed ? s.completed : s.notCompleted}
                  </span>
                </div>
                <h1 id="text-lesson-title" dir="auto" data-testid="text-lesson-title">{lesson.title}</h1>
              </div>
              <span className="sslv-title-seal" aria-hidden="true"><Focus size={23} /></span>
            </div>
          </header>

          {progress && <section className="sslv-progress" aria-label={s.courseProgress}>
            <div className="sslv-progress-label">{s.courseProgress}</div>
            <ProgressBar
              percentage={progress.percentage}
              isCompleted={progress.isCompleted}
              label={fmt(t.student.progress, { c: progress.completedRequired, t: progress.totalRequired })}
              testId="progress-reader"
            />
          </section>}

          <article className="sslv-reading" aria-label={lesson.title}>
            {lesson.body && lesson.body.trim()
              ? <Markdown source={lesson.body} />
              : <p className="sslv-empty-lesson muted">{t.student.emptyLesson}</p>}
          </article>

          {resources && <div className="sslv-resources">{resources}</div>}

          <section className={`sslv-completion${completionPulse ? " is-pulsing" : ""}`} aria-label={lesson.completed ? t.student.completedState : t.student.complete}>
            <MutationError error={error} locale={locale} />
            <div className="sslv-completion-row">
              <div className="sslv-completion-copy">
                <span className={`sslv-completion-symbol${lesson.completed ? " is-complete" : ""}`} aria-hidden="true">
                  <CheckCircle2 size={20} />
                </span>
                <div>
                  <strong>{lesson.completed ? t.student.completedState : t.student.complete}</strong>
                  <p>{lesson.completed ? (ar ? "تم تسجيل إنجازك لهذا الدرس." : "Your progress for this lesson has been recorded.") : (ar ? "عندما تنتهي، سجّل إكمال الدرس يدوياً." : "When you are ready, record this lesson as complete.")}</p>
                </div>
              </div>
              {lesson.completed
                ? <span className="sslv-done-chip" data-testid="status-lesson-completed"><CheckCircle2 size={17} aria-hidden="true" />{t.student.completedState}</span>
                : <button type="button" className="sslv-complete-button" onClick={onComplete} disabled={busy} data-testid="button-complete-lesson">
                    <CheckCircle2 size={18} aria-hidden="true" />{busy ? t.student.completing : t.student.complete}
                  </button>}
            </div>
          </section>

          <nav className="sslv-navigation" aria-label={t.student.outline}>
            <LessonDestination locale={locale} courseId={course?.id ?? lesson.courseId} lesson={previous} direction="previous" />
            <LessonDestination locale={locale} courseId={course?.id ?? lesson.courseId} lesson={next} direction="next" />
          </nav>
        </section>
      </div>
    </div>
  );
}
