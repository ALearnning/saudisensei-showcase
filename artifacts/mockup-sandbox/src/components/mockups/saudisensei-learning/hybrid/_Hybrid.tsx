import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, FileText, PanelLeftClose, Play, Pause, X } from "lucide-react";
import { sampleChapters, illustrativeCode } from "../_data";
import { parseMarkdown, type Block, type Inline } from "../_baseline/markdown";
import "./_styles.css";

type Mode = "video" | "text";
type Locale = "ar" | "en";

const lessonBody = `## الفكرة ليست في كتابة كود أكثر

الدالة الجيدة تُجيب عن سؤال واحد بوضوح. في TypeScript نبدأ بتحديد ما نحتاجه، ثم نكتب التنفيذ؛ فتظهر الأخطاء مبكرًا، ويصبح قصدنا مقروءًا حتى قبل تشغيل البرنامج.

### ابدأ بالعقد، ثم اكتب السلوك

تصف الواجهة شكل البيانات التي تقبلها الدالة، ويصف نوع الإرجاع النتيجة التي تَعِد بها. هذا العقد الصغير يساعدك أنت وفريقك على استخدام الدالة بثقة.

- اجعل المدخلات صريحة ومحددة.
- اكتب نوع النتيجة المتوقع.
- أعد قيمة مفيدة بدل تغيير البيانات في الخفاء.

### مثال: رسالة ترحيب آمنة

لاحظ كيف يجعل النوع شكل المتعلّم واضحًا، وكيف تضمن الدالة أن النتيجة نصّ دائمًا.

\`\`\`typescript
${illustrativeCode}
\`\`\`

بهذا الأسلوب يصبح التغيير أسهل: إذا أضفت خاصية مطلوبة إلى \`Learner\`، سيشير المحرّر إلى المواضع التي تحتاج إلى تحديث. الوضوح هنا ليس ترفًا؛ إنه طريقة عملية لتقليل المفاجآت.`;
const lessonBodyEnglish = `## The point is not to write more code

A good function answers one question clearly. In TypeScript, we begin by describing what we need, then write the implementation. Errors surface earlier, and our intent stays readable before the program even runs.

### Start with the contract, then the behaviour

An interface describes the shape of data a function accepts. Its return type describes the result it promises. This small contract helps you and your team use the function with confidence.

- Make inputs explicit and specific.
- Describe the expected result.
- Return a useful value instead of changing data silently.

### Example: a safer welcome message

Notice how the type makes the learner's shape clear, and how the function guarantees a string result.

\`\`\`typescript
${illustrativeCode}
\`\`\`

Now change becomes easier: if you add a required property to \`Learner\`, your editor points to the places that need updating. Clarity is not decoration; it is a practical way to reduce surprises.`;

const copy = {
  ar: {
    course: "TypeScript من الأساس إلى التطبيق",
    chapter: "من الفكرة إلى تطبيق عملي",
    lesson: "كتابة دوال آمنة باستخدام TypeScript",
    unit: "الدرس ٣ من ٦",
    outline: "مخطط الدورة",
    close: "إغلاق المخطط",
    resources: "الموارد",
    mark: "إنهاء الدرس",
    done: "أُنجز هذا الدرس",
    doneNote: "تم تسجيل تقدّمك. تابع عندما تكون مستعدًا.",
    next: "الدرس التالي",
    nextTitle: "الأنواع المركّبة وحالات الاستخدام",
    previous: "السابق",
    continue: "انتقل إلى الدرس التالي",
    videoPrototype: "مشهد تعليمي توضيحي · لا يوجد بث فعلي",
    videoTitle: "الدالة تبدأ من عقدٍ واضح",
    videoSub: "سمِّ المدخلات، حدّد النتيجة، ثم اكتب السلوك بثقة.",
    play: "تشغيل المعاينة",
    pause: "إيقاف المعاينة",
    chapterCount: "الفصول",
    of: "من",
    lessonCount: "دروس",
    current: "أنت هنا",
    completed: "مكتمل",
    upcoming: "قادم",
    resLesson: "موارد الدرس",
    resChapter: "موارد الفصل",
    resCourse: "موارد الدورة",
    language: "English",
    reading: "قراءة مركّزة",
    seconds: "٠١:٢٨",
    total: "٠٤:١٢",
    readTime: "قراءة · ٦ دقائق",
    sectionEnd: "نهاية المقطع",
    lessonActions: "إجراءات الدرس",
    lessonNavigation: "التنقل بين الدروس",
    previousTitle: "بناء مكوّنات بواجهات واضحة",
  },
  en: {
    course: "TypeScript from foundations to practice",
    chapter: "From idea to working practice",
    lesson: "Writing safer functions with TypeScript",
    unit: "Lesson 3 of 6",
    outline: "Course outline",
    close: "Close outline",
    resources: "Resources",
    mark: "Mark lesson complete",
    done: "Lesson completed",
    doneNote: "Your progress is recorded. Continue when you are ready.",
    next: "Next lesson",
    nextTitle: "Union types and real use cases",
    previous: "Previous",
    continue: "Continue to next lesson",
    videoPrototype: "Illustrative teaching scene · no live video",
    videoTitle: "A function begins with a clear contract",
    videoSub: "Name inputs, define the outcome, then write with confidence.",
    play: "Play preview",
    pause: "Pause preview",
    chapterCount: "Chapters",
    of: "of",
    lessonCount: "lessons",
    current: "You are here",
    completed: "Complete",
    upcoming: "Up next",
    resLesson: "Lesson resources",
    resChapter: "Chapter resources",
    resCourse: "Course resources",
    language: "العربية",
    reading: "Focused reading",
    seconds: "01:28",
    total: "04:12",
    readTime: "Reading · 6 min",
    sectionEnd: "End of section",
    lessonActions: "Lesson actions",
    lessonNavigation: "Lesson navigation",
    previousTitle: "Building components with clear interfaces",
  },
} as const;

function InlineContent({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((node, index) => {
    if (node.t === "text") return <span key={index}>{node.v}</span>;
    if (node.t === "code") return <code key={index} dir="ltr">{node.v}</code>;
    if (node.t === "strong") return <strong key={index}><InlineContent nodes={node.c} /></strong>;
    if (node.t === "em") return <em key={index}><InlineContent nodes={node.c} /></em>;
    return <a key={index} href={node.href} target="_blank" rel="noreferrer"><InlineContent nodes={node.c} /></a>;
  })}</>;
}

function Reading({ blocks }: { blocks: Block[] }) {
  return <div className="il-reading-body">{blocks.map((block, index) => {
    if (block.t === "h") {
      const Tag = `h${block.level}` as "h2" | "h3" | "h4" | "h5";
      return <Tag key={index} dir="auto"><InlineContent nodes={block.c} /></Tag>;
    }
    if (block.t === "p") return <p key={index} dir="auto"><InlineContent nodes={block.c} /></p>;
    if (block.t === "code") return <pre key={index} dir="ltr" data-language={block.lang}><code>{block.v}</code></pre>;
    const List = block.t;
    return <List key={index} dir="auto">{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent nodes={item} /></li>)}</List>;
  })}</div>;
}

function Resources({ t, isArabic }: { t: typeof copy.ar | typeof copy.en; isArabic: boolean }) {
  const files = isArabic
    ? [["ملخص الدرس · PDF", "تمرين الأنواع · TXT"], ["مخطط الفصل · PDF", "أنماط الدوال · TXT", "ملاحظات تطبيقية · PDF"], ["مرجع TypeScript · PDF", "قاموس المفاهيم · TXT"]]
    : [["Lesson summary · PDF", "Types exercise · TXT"], ["Chapter map · PDF", "Function patterns · TXT", "Practice notes · PDF"], ["TypeScript reference · PDF", "Concept glossary · TXT"]];
  return (
    <details className="il-resources">
      <summary><FileText size={17} aria-hidden="true" /><span>{t.resources}</span><span className="il-resource-total">{isArabic ? "٧ ملفات" : "7 files"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="il-resource-list">
        {[["lesson", t.resLesson, isArabic ? "٢" : "2"], ["chapter", t.resChapter, isArabic ? "٣" : "3"], ["course", t.resCourse, isArabic ? "٢" : "2"]].map(([key, title, count], groupIndex) => (
          <details className="il-resource-group" key={key as string}>
            <summary><span>{title as string}</span><span className="il-resource-count">{count as string}</span><ChevronDown size={15} aria-hidden="true" /></summary>
            <ul>{files[groupIndex].map(file => <li key={file}><FileText size={14} aria-hidden="true" /><span>{file}</span></li>)}</ul>
          </details>
        ))}
      </div>
    </details>
  );
}

function Outline({ t, currentIndex, close, isArabic, onSelect, isCompleted, docked = false }: { t: typeof copy.ar | typeof copy.en; currentIndex: number; close: () => void; isArabic: boolean; onSelect: (index: number) => void; isCompleted: (index: number) => boolean; docked?: boolean }) {
  const [openChapters, setOpenChapters] = useState<number[]>([0, 1, 2]);
  const completedCount = sampleChapters.flatMap(chapter => chapter.lessons).filter((_, index) => isCompleted(index)).length;
  const lessonCount = sampleChapters.reduce((total, chapter) => total + chapter.lessons.length, 0);
  const currentChapterIndex = sampleChapters.findIndex((chapter, index) => {
    const start = sampleChapters.slice(0, index).reduce((sum, item) => sum + item.lessons.length, 0);
    return currentIndex >= start && currentIndex < start + chapter.lessons.length;
  });
  useEffect(() => {
    if (currentChapterIndex >= 0) setOpenChapters(current => current.includes(currentChapterIndex) ? current : [...current, currentChapterIndex]);
  }, [currentChapterIndex]);
  return (
    <section className={`il-outline-dialog${docked ? " is-docked" : ""}`} role={docked ? "region" : "dialog"} aria-modal={docked ? undefined : true} aria-labelledby={docked ? "il-outline-title-docked" : "il-outline-title-sheet"} dir={isArabic ? "rtl" : "ltr"}>
        <header className="il-outline-head">
          <div><span className="il-eyebrow">{isArabic ? "مسار التعلّم" : "YOUR LEARNING PATH"}</span><h2 id={docked ? "il-outline-title-docked" : "il-outline-title-sheet"}>{t.outline}</h2><p>{t.course}</p></div>
          <button className="il-icon-btn" type="button" onClick={close} aria-label={t.close}>{docked ? <PanelLeftClose size={18} /> : <X size={19} />}</button>
        </header>
        <div className="il-outline-progress"><span>{isArabic ? `${completedCount} من ${lessonCount} دروس مكتملة` : `${completedCount} of ${lessonCount} lessons complete`}</span><div><i style={{ width: `${lessonCount ? completedCount / lessonCount * 100 : 0}%` }} /></div></div>
        <div className="il-outline-scroll">
          {sampleChapters.map((chapter, chapterIndex) => {
            const expanded = openChapters.includes(chapterIndex);
            const offset = sampleChapters.slice(0, chapterIndex).reduce((sum, item) => sum + item.lessons.length, 0);
            return <section className="il-chapter" key={chapter.title}>
              <button className="il-chapter-toggle" type="button" aria-expanded={expanded} onClick={() => setOpenChapters(current => expanded ? current.filter(item => item !== chapterIndex) : [...current, chapterIndex])}>
                <span className="il-chapter-num">{String(chapterIndex + 1).padStart(2, "0")}</span><span className="il-chapter-copy"><strong>{isArabic ? chapter.title : chapter.en}</strong><small>{chapter.lessons.length} {t.lessonCount}</small></span><ChevronDown size={17} className={expanded ? "is-open" : ""} />
              </button>
              {expanded && <ol className="il-lesson-list">{chapter.lessons.map((lesson, lessonIndex) => {
                const flatIndex = offset + lessonIndex;
                const isCurrent = flatIndex === currentIndex;
                const isDone = isCompleted(flatIndex);
                return <li key={lesson.title}><button type="button" className={`il-outline-lesson${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "page" : undefined} onClick={() => { onSelect(flatIndex); if (!docked) close(); }}>
                  <span className={`il-status${isDone ? " is-done" : ""}`}>{isDone ? <Check size={13} /> : isCurrent ? <i /> : <Circle size={11} />}</span><span>{isArabic ? lesson.title : lesson.en}</span><small>{isCurrent ? t.current : isDone ? t.completed : t.upcoming}</small>
                </button></li>;
              })}</ol>}
            </section>;
          })}
        </div>
        <footer className="il-outline-foot"><BookOpen size={16} /><span>{isArabic ? `الموقع الحالي: الفصل ${currentChapterIndex + 1} · الدرس ${currentIndex - sampleChapters.slice(0, currentChapterIndex).reduce((sum, item) => sum + item.lessons.length, 0) + 1}` : `Current position: Chapter ${currentChapterIndex + 1} · Lesson ${currentIndex - sampleChapters.slice(0, currentChapterIndex).reduce((sum, item) => sum + item.lessons.length, 0) + 1}`}</span></footer>
      </section>
  );
}

function TeachingSlide({ playing, onToggle, t, isArabic }: { playing: boolean; onToggle: () => void; t: typeof copy.ar | typeof copy.en; isArabic: boolean }) {
  return (
    <div className="il-player" aria-label={t.videoPrototype}>
      <div className="il-slide-grid" aria-hidden="true" />
      <div className="il-slide-top"><span className="il-slide-mark">س</span><span>TypeScript / 03</span><span className="il-slide-caption">{t.videoPrototype}</span></div>
      <div className="il-slide-main" dir={isArabic ? "rtl" : "ltr"}>
        <span className="il-slide-kicker">{isArabic ? "الفكرة الأولى" : "THE FIRST IDEA"} <i /></span>
        <h2>{t.videoTitle}</h2>
        <p>{t.videoSub}</p>
        <div className="il-contract" dir="ltr">
          <span className="il-contract-line"><b>function</b> <strong>welcome</strong>(learner: <em>Learner</em>)</span>
          <span className="il-contract-line il-contract-result"><i>:</i> <b>string</b></span>
          <span className="il-contract-rule" />
          <span className="il-contract-note"><span>input</span> <span>→</span> <span>output</span></span>
        </div>
      </div>
      <span className="il-slide-ornament il-ornament-one" aria-hidden="true" />
      <span className="il-slide-ornament il-ornament-two" aria-hidden="true" />
      <div className="il-player-controls" dir="ltr">
        <button type="button" onClick={onToggle} className="il-play" aria-label={playing ? t.pause : t.play}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <span className="il-play-time">{t.seconds}</span><div className="il-player-track"><i /></div><span className="il-play-time">{t.total}</span><span className="il-proto-tag">VISUAL PROTOTYPE</span>
      </div>
    </div>
  );
}

export function HybridLesson({ mode, initialOutline = false }: { mode: Mode; initialOutline?: boolean }) {
  const [locale, setLocale] = useState<Locale>("ar");
  const [outlineOpen, setOutlineOpen] = useState(initialOutline);
  const [currentIndex, setCurrentIndex] = useState(2);
  const [completedLessons, setCompletedLessons] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(sampleChapters.flatMap(chapter => chapter.lessons).map((lesson, index) => [index, lesson.done])),
  );
  const [playing, setPlaying] = useState(false);
  const outlineTrigger = useRef<HTMLButtonElement>(null);
  const t = copy[locale];
  const isArabic = locale === "ar";
  const blocks = useMemo(() => parseMarkdown(isArabic ? lessonBody : lessonBodyEnglish), [isArabic]);
  const allLessons = useMemo(() => sampleChapters.flatMap(chapter => chapter.lessons.map(lesson => ({ ...lesson, chapter }))), []);
  const currentLesson = allLessons[currentIndex];
  const previousLesson = allLessons[currentIndex - 1];
  const nextLesson = allLessons[currentIndex + 1];
  const currentTitle = isArabic ? currentLesson.title : currentLesson.en;
  const currentChapter = isArabic ? currentLesson.chapter.title : currentLesson.chapter.en;
  const previousTitle = previousLesson ? (isArabic ? previousLesson.title : previousLesson.en) : "";
  const nextTitle = nextLesson ? (isArabic ? nextLesson.title : nextLesson.en) : "";
  const completed = Boolean(completedLessons[currentIndex]);

  useEffect(() => {
    if (!outlineOpen) return;
    const mobile = window.matchMedia("(max-width: 700px)").matches;
    if (!mobile) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOutlineOpen(false);
        requestAnimationFrame(() => outlineTrigger.current?.focus());
      }
      if (event.key === "Tab") {
        const dialog = document.querySelector<HTMLElement>(".il-outline-dialog:not(.is-docked)");
        const elements = Array.from(dialog?.querySelectorAll<HTMLElement>("button") ?? []);
        if (elements.length && event.shiftKey && document.activeElement === elements[0]) {
          event.preventDefault(); elements[elements.length - 1].focus();
        } else if (elements.length && !event.shiftKey && document.activeElement === elements[elements.length - 1]) {
          event.preventDefault(); elements[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
      document.querySelector<HTMLElement>(".il-outline-dialog:not(.is-docked) .il-icon-btn")?.focus();
    return () => { document.body.style.overflow = prior; document.removeEventListener("keydown", onKey); };
  }, [outlineOpen]);

  const IconArrow = isArabic ? ArrowLeft : ArrowRight;
  const PrevArrow = isArabic ? ChevronRight : ChevronLeft;
  function goToLesson(index: number) {
    if (index < 0 || index >= allLessons.length) return;
    setCurrentIndex(index);
  }
  return (
    <main className={`il-app${mode === "text" ? " is-text" : " is-video"}`} lang={locale} dir={isArabic ? "rtl" : "ltr"}>
      <header className="il-topbar">
        <div className="il-brand" aria-label={isArabic ? "سعودي سنسي" : "SaudiSensei"}><span className="il-brand-mark">س</span><span className="il-brand-name">سعودي سنسي</span></div>
        <div className="il-orientation">
          <span className="il-course-name">{t.course}</span><span className="il-orient-sep">/</span><span className="il-chapter-name">{currentChapter}</span>
          <span className="il-current-pill"><i />{isArabic ? `الدرس ${currentIndex + 1} من ${allLessons.length}` : `Lesson ${currentIndex + 1} of ${allLessons.length}`}</span>
        </div>
        <div className="il-top-actions">
          <button type="button" className="il-language" onClick={() => setLocale(isArabic ? "en" : "ar")} aria-label={isArabic ? "Switch to English" : "التبديل إلى العربية"}>{isArabic ? "EN" : "ع"}</button>
          <button ref={outlineTrigger} type="button" className="il-outline-trigger" onClick={() => setOutlineOpen(value => !value)} aria-haspopup="dialog" aria-expanded={outlineOpen} aria-label={outlineOpen ? t.close : t.outline}><BookOpen size={17} /><span>{outlineOpen ? t.close : t.outline}</span></button>
        </div>
      </header>

      <div className={`il-workspace${outlineOpen ? " has-outline" : ""}`}>
      <div className="il-main">
        <div className="il-lesson-intro">
          <div className="il-intro-meta"><span>{mode === "video" ? (isArabic ? "فيديو تعليمي" : "VIDEO LESSON") : t.reading}</span><i /> <span>{currentChapter}</span></div>
          <h1>{currentTitle}</h1>
          <div className="il-intro-mobile"><span>{currentChapter}</span><span>·</span><span>{isArabic ? `الدرس ${currentIndex + 1} من ${allLessons.length}` : `Lesson ${currentIndex + 1} of ${allLessons.length}`}</span></div>
        </div>
        {mode === "video" ? <TeachingSlide playing={playing} onToggle={() => setPlaying(value => !value)} t={t} isArabic={isArabic} /> :
          <article className="il-reading-surface" aria-label={currentTitle}>
            <div className="il-reading-rule"><span>{String(currentIndex + 1).padStart(2, "0")}</span><i /><span>{t.readTime}</span></div>
            <Reading blocks={blocks} />
            <div className="il-reading-end"><span>{t.sectionEnd}</span><i /></div>
          </article>}

        <section className="il-after-content" aria-label={t.lessonActions}>
          <Resources t={t} isArabic={isArabic} />
          <div className={`il-finish${completed ? " is-complete" : ""}`} aria-live="polite">
            {!completed ? <div className="il-finish-row">
              <div className="il-finish-copy"><span className="il-finish-icon"><Circle size={17} /></span><div><strong>{isArabic ? "خذ لحظة لتثبيت الفكرة" : "Take a moment to settle the idea"}</strong><small>{isArabic ? "سجّل إنجاز هذا الدرس عندما تنتهي." : "Record this lesson when you are finished."}</small></div></div>
              <button className="il-complete-btn" type="button" onClick={() => setCompletedLessons(previous => ({ ...previous, [currentIndex]: true }))}><CheckCircle2 size={17} /><span>{t.mark}</span></button>
            </div> : <div className="il-finish-success">
              <div className="il-finish-copy"><span className="il-finish-icon"><CheckCircle2 size={19} /></span><div><strong>{t.done}</strong><small>{t.doneNote}</small></div></div>
              <button className="il-next-reveal" type="button" onClick={() => nextLesson && goToLesson(currentIndex + 1)} disabled={!nextLesson}>
                <span className="il-next-label">{t.continue}</span><strong>{nextTitle || t.nextTitle}</strong><IconArrow size={18} />
              </button>
            </div>}
          </div>
          <nav className="il-lesson-nav" aria-label={t.lessonNavigation}>
            {previousLesson ? <button className="il-prev-link" type="button" onClick={() => goToLesson(currentIndex - 1)}><span className="il-nav-arrow"><PrevArrow size={17} /></span><span><small>{t.previous}</small><strong>{previousTitle}</strong></span></button> : <span />}
            {!completed && <span className="il-nav-position">{isArabic ? `٠${currentIndex + 1}` : String(currentIndex + 1).padStart(2, "0")} <i /> {isArabic ? "٠٦" : "06"}</span>}
            {completed && <span className="il-nav-position is-done"><Check size={14} />{t.done}</span>}
            {!completed && nextLesson && <button className="il-next-inline" type="button" onClick={() => goToLesson(currentIndex + 1)}><span><small>{t.next}</small><strong>{nextTitle}</strong></span><IconArrow size={17} /></button>}
          </nav>
        </section>
      </div>
      {outlineOpen && <aside className="il-docked-outline" aria-label={t.outline}><Outline t={t} currentIndex={currentIndex} isArabic={isArabic} isCompleted={index => Boolean(completedLessons[index])} onSelect={goToLesson} close={() => { setOutlineOpen(false); requestAnimationFrame(() => outlineTrigger.current?.focus()); }} docked /></aside>}
      </div>
      {outlineOpen && <div className="il-layer" onMouseDown={event => { if (event.target === event.currentTarget) { setOutlineOpen(false); requestAnimationFrame(() => outlineTrigger.current?.focus()); } }}><Outline t={t} currentIndex={currentIndex} isArabic={isArabic} isCompleted={index => Boolean(completedLessons[index])} onSelect={index => { goToLesson(index); setOutlineOpen(false); requestAnimationFrame(() => outlineTrigger.current?.focus()); }} close={() => { setOutlineOpen(false); requestAnimationFrame(() => outlineTrigger.current?.focus()); }} /></div>}
      <div className="il-safe-bottom" aria-hidden="true" />
    </main>
  );
}
