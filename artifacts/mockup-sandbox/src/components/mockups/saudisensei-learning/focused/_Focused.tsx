import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Circle, Clock3, FileText, Layers2, ListVideo, PanelLeftClose, PanelLeftOpen, Pause, Play, Volume2, X } from "lucide-react";
import { illustrativeCode, sampleChapters } from "../_data";
import { parseMarkdown, type Inline } from "../_baseline/markdown";
import "./_styles.css";

type Locale = "ar" | "en";
type Mode = "video" | "text";
const course = { ar: "TypeScript من الأساس إلى التطبيق", en: "TypeScript: from foundations to practice" };
const labels = {
  ar: { outline:"محتوى الدورة", close:"إغلاق المخطط", hideOutline:"إخفاء مخطط الدورة", showOutline:"إظهار مخطط الدورة", course:"الدورة", chapter:"الفصل", lesson:"الدرس", focus:"مساحة التعلّم", complete:"تسجيل إكمال الدرس", completed:"اكتمل الدرس", next:"الدرس التالي", previous:"السابق", resources:"الموارد", duration:"١٢ دقيقة", video:"معاينة تعليمية — لا يوجد بث فعلي", play:"تشغيل المعاينة", pause:"إيقاف المعاينة", progress:"التقدّم", required:"مطلوب", now:"الآن", upcoming:"قادم", done:"مكتمل", courseResources:"موارد الدورة", chapterResources:"موارد الفصل", lessonResources:"موارد الدرس", files:"ملفات توضيحية فقط", lang:"English", back:"رجوع", forward:"متابعة", chapterCount:"٣ فصول", courseNav:"الدورة", resourcesHint:"المرفقات متاحة عند الحاجة" },
  en: { outline:"Course outline", close:"Close outline", hideOutline:"Hide course outline", showOutline:"Show course outline", course:"Course", chapter:"Chapter", lesson:"Lesson", focus:"Learning space", complete:"Mark lesson complete", completed:"Lesson completed", next:"Next lesson", previous:"Previous", resources:"Resources", duration:"12 min", video:"Learning visual — no live video", play:"Play preview", pause:"Pause preview", progress:"Course progress", required:"Required", now:"Now", upcoming:"Up next", done:"Complete", courseResources:"Course resources", chapterResources:"Chapter resources", lessonResources:"Lesson resources", files:"Illustrative files only", lang:"العربية", back:"Back", forward:"Continue", chapterCount:"3 chapters", courseNav:"Course", resourcesHint:"Attachments when you need them" }
} as const;
const numberText = (value:number, locale:Locale) => locale === "ar"
  ? String(value).replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)])
  : String(value);
const aux = {
  ar: [["ملاحظات الدرس.pdf","ملف نصي.txt"],["مرجع الفصل.pdf","مخطط الأنواع.png","تمرين إضافي.txt"],["دليل الدورة.pdf","قاموس المصطلحات.txt"]],
  en: [["Lesson notes.pdf","Transcript.txt"],["Chapter reference.pdf","Type map.png","Extra exercise.txt"],["Course guide.pdf","Glossary.txt"]]
};

function InlineText({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((node, index) => {
    if (node.t === "text") return <span key={index}>{node.v}</span>;
    if (node.t === "code") return <code key={index} dir="ltr">{node.v}</code>;
    if (node.t === "strong") return <strong key={index}><InlineText nodes={node.c} /></strong>;
    if (node.t === "em") return <em key={index}><InlineText nodes={node.c} /></em>;
    return <a key={index} href={node.href} target="_blank" rel="noreferrer"><InlineText nodes={node.c} /></a>;
  })}</>;
}

function Reading({ locale }: { locale: Locale }) {
  const source = locale === "ar"
    ? `## الفكرة: اجعل نوع النتيجة واضحًا\n\nالدالة الجيدة لا تكتفي بإنجاز المهمة؛ بل توضّح ما تتوقعه وما ستعيده. حين نسمّي المدخلات ونحدّد نوع الناتج، يصبح سلوك الكود أسهل في القراءة والاختبار.\n\nفي TypeScript، نكتب العقد بجوار الدالة بدل أن نتركه للتخمين. هذا يمنح المحرّر فرصة اكتشاف الخطأ قبل تشغيل البرنامج، ويمنح الفريق لغة مشتركة حول السلوك المتوقع.\n\n### دالة صغيرة، عقد واضح\n\nلنفترض أننا نرحّب بمتعلّم ونعرض عدد الدروس التي أكملها. نبدأ بنوع يصف البيانات، ثم نكتب دالة تعيد جملة نصية محدّدة.\n\n\`\`\`typescript\n${illustrativeCode}\n\`\`\`\n\n### ما الذي يجعل هذا النمط مفيدًا؟\n\n- **المدخلات موثّقة**: لا نحتاج إلى فتح الدالة لمعرفة شكل المتعلّم.\n- **الناتج متوقّع**: كل استدعاء يعيد نصًا، لا قيمة مبهمة.\n- **التغيير أكثر أمانًا**: إضافة حقل جديد تكشف المواضع التي تحتاج إلى تحديث.\n\nاقرأ تعريف النوع أولًا، ثم تتبّع \`welcome\` من مدخلها إلى ناتجها. هذه العادة الصغيرة تجعل مراجعة الشيفرة أهدأ وأكثر دقة.`
    : `## The idea: make the result explicit\n\nA good function does more than complete a task. It makes clear what it expects and what it will return. Naming inputs and defining the output makes code easier to read, test, and trust.\n\nWith TypeScript, we place that contract beside the function instead of leaving it to guesswork. The editor can catch a mismatch before the program runs, and a team gains a shared description of expected behavior.\n\n### A small function, a clear contract\n\nImagine greeting a learner and showing how many lessons they have completed. First describe the data, then write a function that always returns a string.\n\n\`\`\`typescript\n${illustrativeCode}\n\`\`\`\n\n### Why this pattern helps\n\n- **Inputs are documented**: the learner shape is visible without opening the function.\n- **The result is predictable**: each call returns text, not an ambiguous value.\n- **Changes are safer**: adding a field reveals the places that need attention.\n\nRead the type first, then follow \`welcome\` from its input to its return value. This small habit makes code review calmer and more precise.`;
  const blocks = parseMarkdown(source);
  return <div className="foc-reading">{blocks.map((block, i) => {
    if (block.t === "h") { const Tag = `h${block.level}` as "h2"|"h3"|"h4"|"h5"; return <Tag key={i}><InlineText nodes={block.c} /></Tag>; }
    if (block.t === "p") return <p key={i}><InlineText nodes={block.c} /></p>;
    if (block.t === "code") return <pre key={i} dir="ltr" aria-label="TypeScript example"><span className="foc-code-label">TYPESCRIPT</span><code>{block.v}</code></pre>;
    const Tag = block.t;
    return <Tag key={i}>{block.items.map((item, j) => <li key={j}><InlineText nodes={item} /></li>)}</Tag>;
  })}</div>;
}

function Outline({ locale, current, completedCurrent, onSelect, mobile = false, onClose, onCollapse, collapseRef }: { locale: Locale; current: number; completedCurrent:boolean; onSelect: (index:number)=>void; mobile?:boolean; onClose?:()=>void; onCollapse?:()=>void; collapseRef?:{current:HTMLButtonElement|null} }) {
  const t = labels[locale];
  const [open, setOpen] = useState<number[]>([1]);
  const lessons = useMemo(() => sampleChapters.flatMap((chapter, ci) => chapter.lessons.map((lesson, li) => ({...lesson, chapter:ci, local:li}))), []);
  const switchLesson = (index:number) => { onSelect(index); onClose?.(); };
  return <div className="foc-outline-inner">
    <div className="foc-outline-head">
      <span className="foc-outline-icon"><ListVideo size={17}/></span>
      <div><small>{locale === "ar" ? "مسار الدورة" : "YOUR LEARNING PATH"}</small><h2>{t.outline}</h2></div>
      {mobile && <button className="foc-icon-button" onClick={onClose} aria-label={t.close}><X size={19}/></button>}
      {!mobile && onCollapse && <button ref={collapseRef} type="button" className="foc-icon-button foc-collapse-outline" onClick={onCollapse} aria-label={t.hideOutline} aria-expanded="true"><PanelLeftClose size={18}/></button>}
    </div>
    <div className="foc-course-mini"><span className="foc-course-mark">TS</span><div><small>{t.course}</small><strong dir="auto">{course[locale]}</strong></div></div>
    <div className="foc-course-progress"><div><span>{t.progress}</span><bdi>٣٣٪</bdi></div><span className="foc-track"><i/></span><small>{locale === "ar" ? "درسان من ٦" : "2 of 6 lessons"}</small></div>
    <div className="foc-chapter-count">{t.chapterCount}</div>
    <ol className="foc-chapters">{sampleChapters.map((chapter, ci) => {
      const expanded = open.includes(ci);
      return <li key={ci} className={`foc-chapter${expanded ? " is-open" : ""}`}>
        <button className="foc-chapter-toggle" aria-expanded={expanded} onClick={()=>setOpen(expanded ? open.filter(x=>x!==ci) : [...open,ci])}>
          <span className="foc-chapter-number">{String(ci+1).padStart(2,"0")}</span><span className="foc-chapter-title" dir="auto">{locale==="ar"?chapter.title:chapter.en}</span><ChevronDown size={16}/>
        </button>
        {expanded && <ol className="foc-lessons">{chapter.lessons.map((lesson, li) => {
          const index = lessons.findIndex(item=>item.chapter===ci && item.local===li);
          const isCurrent = index === current;
          const done = index < 2 || (index === current && completedCurrent) || lesson.done;
          return <li key={lesson.title}><button className={`foc-lesson${isCurrent?" is-current":""}`} onClick={()=>switchLesson(index)} aria-current={isCurrent?"page":undefined}>
            <span className={`foc-status${done?" is-done":""}`}>{done?<Check size={12}/>:isCurrent?<span/>:<Circle size={13}/>}</span>
            <span className="foc-lesson-name" dir="auto">{locale==="ar"?lesson.title:lesson.en}</span>
            {isCurrent&&<span className="foc-current-tag">{t.now}</span>}
          </button></li>;
        })}</ol>}
      </li>;
    })}</ol>
    <div className="foc-outline-foot"><span className="foc-legend"><i className="is-done"/>{locale==="ar"?"مكتمل":"Complete"}</span><span className="foc-legend"><i className="is-next"/>{locale==="ar"?"قادم":"Upcoming"}</span></div>
  </div>;
}

export function FocusedLesson({ mode }: { mode: Mode }) {
  const [locale, setLocale] = useState<Locale>("ar");
  const [current, setCurrent] = useState(2);
  const [completed, setCompleted] = useState(false);
  const [outlineVisible, setOutlineVisible] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const collapseOutlineRef = useRef<HTMLButtonElement>(null);
  const restoreOutlineRef = useRef<HTMLButtonElement>(null);
  const t = labels[locale];
  const allLessons = useMemo(()=>sampleChapters.flatMap((chapter, ci)=>chapter.lessons.map((lesson,li)=>({...lesson, chapter:ci, local:li}))),[]);
  const lesson = allLessons[current];
  const chapter = sampleChapters[lesson.chapter];
  const chapterIndex = lesson.chapter;
  const chapterTitle = chapter[locale==="ar"?"title":"en"];
  const positionLabel = `${locale==="ar"?"الدرس":"Lesson"} ${numberText(current+1,locale)} ${locale==="ar"?"من":"of"} ${numberText(allLessons.length,locale)}`;
  const next = allLessons[current+1];
  const previous = allLessons[current-1];
  useEffect(()=>{
    if (!outlineOpen) return;
    drawerRef.current?.focus();
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event:KeyboardEvent) => {
      if(event.key==="Escape"){setOutlineOpen(false);window.requestAnimationFrame(()=>triggerRef.current?.focus());}
      if(event.key==="Tab" && drawerRef.current){
        const items=Array.from(drawerRef.current.querySelectorAll<HTMLElement>("button"));
        const first=items[0], last=items[items.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener("keydown",keydown);
    return ()=>{document.body.style.overflow=prior;document.removeEventListener("keydown",keydown);};
  },[outlineOpen]);
  function choose(index:number){
    const safeIndex=Math.max(0,Math.min(allLessons.length-1,index));
    setCurrent(safeIndex);
    setCompleted(safeIndex<2 || allLessons[safeIndex].done);
    setPlaying(false);
  }
  function collapseOutline(){setOutlineVisible(false);window.requestAnimationFrame(()=>restoreOutlineRef.current?.focus());}
  function expandOutline(){setOutlineVisible(true);window.requestAnimationFrame(()=>collapseOutlineRef.current?.focus());}
  return <div className="foc-app" lang={locale} dir={locale==="ar"?"rtl":"ltr"}>
    <a className="foc-skip" href="#foc-content">{locale==="ar"?"انتقل إلى محتوى الدرس":"Skip to lesson content"}</a>
    <header className="foc-topbar">
      <div className="foc-brand"><span className="foc-brand-mark">س</span><span><strong>سعودي سنسي</strong><small>LEARN WITH PURPOSE</small></span></div>
      <div className="foc-crumb"><span>{locale==="ar"?"دوراتي":"My courses"}</span><i>/</i><strong dir="auto">{course[locale]}</strong><i>/</i><span dir="auto">{chapter[locale==="ar"?"title":"en"]}</span></div>
      <div className="foc-top-actions"><button className="foc-language" onClick={()=>setLocale(locale==="ar"?"en":"ar")}><span>{locale==="ar"?"EN":"ع"}</span>{t.lang}</button></div>
    </header>
    <div className={`foc-workspace${outlineVisible?"":" is-outline-hidden"}`}>
      <aside className="foc-sidebar" aria-label={t.outline}>{outlineVisible
        ? <Outline locale={locale} current={current} completedCurrent={completed} onSelect={choose} onCollapse={collapseOutline} collapseRef={collapseOutlineRef}/>
        : <button ref={restoreOutlineRef} type="button" className="foc-outline-restore" onClick={expandOutline} aria-label={t.showOutline} aria-expanded="false"><PanelLeftOpen size={18}/><span className="foc-visually-hidden">{t.showOutline}</span></button>}</aside>
      <main className="foc-main" id="foc-content" tabIndex={-1}>
        <div className="foc-mobile-orient">
          <button ref={triggerRef} className="foc-outline-trigger" onClick={()=>setOutlineOpen(true)} aria-expanded={outlineOpen}><BookOpen size={17}/><span>{t.outline}</span><span className="foc-lesson-count">{positionLabel}</span></button>
          <span className="foc-mobile-chapter" dir="auto">{chapterTitle}</span>
        </div>
        <div className="foc-main-inner">
          <div className="foc-context-line"><span className="foc-context-index"><bdi>{numberText(current+1,locale).padStart(2,locale==="ar"?"٠":"0")}</bdi><i/></span><span>{locale==="ar"?`الفصل ${numberText(chapterIndex+1,locale)}`:`CHAPTER ${String(chapterIndex+1).padStart(2,"0")}`}</span><span className="foc-context-divider">·</span><span>{locale==="ar"?"درس أساسي":"CORE LESSON"}</span><span className="foc-context-spacer"/><span className={`foc-state${completed?" is-complete":""}`}>{completed?<Check size={13}/>:<Circle size={11}/>} {completed?t.completed:t.required}</span></div>
          <h1 className="foc-title" dir="auto">{locale==="ar"?lesson.title:lesson.en}</h1>
          <div className="foc-meta"><span><Clock3 size={14}/>{t.duration}</span><span className="foc-meta-dot"/><span>{mode==="video"?(locale==="ar"?"شرح مرئي":"VIDEO LESSON"):(locale==="ar"?"قراءة تطبيقية":"GUIDED READING")}</span><span className="foc-mobile-position">{positionLabel}</span></div>
          {mode==="video" ? <section className="foc-video" aria-label={t.video}>
            <div className="foc-video-scene">
              <div className="foc-scene-grid"/>
              <div className="foc-scene-top"><span className="foc-scene-brand"><i/> SAUDISENSEI <b>·</b> TYPE NOTES</span><span className="foc-scene-number">{numberText(current+1,locale)} <i/> {numberText(allLessons.length,locale)}</span></div>
              <div className="foc-scene-content" dir={locale==="ar"?"rtl":"ltr"}>
                <span className="foc-scene-eyebrow">{locale==="ar"?"فكرة اليوم · الأنواع الواضحة":"TODAY'S IDEA · CLEAR TYPES"}</span>
                <h2>{locale==="ar"?"الدالة الجيدة\nتُعلن عقدها":"A good function\nmakes its contract clear"}</h2>
                <p>{locale==="ar"?"مدخلات محددة. نتيجة يمكن الوثوق بها.":"Specific inputs. A result you can trust."}</p>
                <div className="foc-scene-code" dir="ltr"><span>function</span> welcome(learner: <em>Learner</em>): <b>string</b></div>
              </div>
              <span className="foc-scene-orbit foc-orbit-one"/><span className="foc-scene-orbit foc-orbit-two"/>
              <div className="foc-video-controls">
                <button className="foc-play" onClick={()=>setPlaying(!playing)} aria-label={playing?t.pause:t.play}>{playing?<Pause size={17} fill="currentColor"/>:<Play size={17} fill="currentColor"/>}</button>
                <span className="foc-video-time"><bdi>{playing?"00:18":"00:00"}</bdi><i/><bdi>12:04</bdi></span><span className="foc-prototype-label">{t.video}</span><Volume2 size={17} aria-hidden="true"/>
              </div>
            </div>
          </section> : <section className="foc-text-stage" aria-label={lesson.title}><div className="foc-text-ribbon"><span><FileText size={15}/>{locale==="ar"?"قراءة الدرس":"LESSON READING"}</span><span><Clock3 size={14}/>{t.duration}</span></div><Reading locale={locale}/></section>}
          <details className="foc-resources">
            <summary><span className="foc-resource-icon"><Layers2 size={16}/></span><span className="foc-resource-copy"><strong>{t.resources}</strong><small>{t.resourcesHint}</small></span><span className="foc-resource-count"><bdi>٧</bdi> {locale==="ar"?"ملفات":"files"}</span><ChevronDown className="foc-resource-chevron" size={17}/></summary>
            <div className="foc-resource-list">
              {aux[locale].map((files,index)=><details key={index} className="foc-resource-group">
                <summary><span>{index===0?t.lessonResources:index===1?t.chapterResources:t.courseResources}</span><bdi>({files.length})</bdi><ChevronDown size={15}/></summary>
                <ul>{files.map(file=><li key={file}><FileText size={14}/><span>{file}</span><small>{t.files}</small></li>)}</ul>
              </details>)}
            </div>
          </details>
          <div className={`foc-completion${completed?" is-done":""}`} aria-live="polite">
            <div className="foc-completion-main"><span className="foc-checkmark">{completed?<CheckCircle2 size={21}/>:<span className="foc-empty-check"/>}</span><div><strong>{completed?t.completed:(locale==="ar"?"هل أنهيت هذا الدرس؟":"Finished with this lesson?")}</strong><small>{completed?(locale==="ar"?"تم حفظ إنجازك. اختر متى تتابع.":"Progress saved. Continue when you’re ready."):(locale==="ar"?"أنت من يحدد متى يكتمل الدرس.":"You decide when this lesson is complete.")}</small></div></div>
            {!completed&&<button className="foc-complete-button" onClick={()=>setCompleted(true)}><CheckCircle2 size={17}/>{t.complete}</button>}
            {completed&&next&&<button className="foc-next-reveal" onClick={()=>choose(current+1)}><span><small>{t.next}</small><strong dir="auto">{locale==="ar"?next.title:next.en}</strong></span><ArrowLeft size={19}/></button>}
          </div>
          <nav className="foc-navigation" aria-label={locale==="ar"?"التنقّل بين الدروس":"Lesson navigation"}>
            <button className="foc-nav-link is-previous" disabled={!previous} onClick={()=>previous&&choose(current-1)}><span className="foc-nav-arrow"><ArrowRight size={18}/></span><span><small>{t.previous}</small><strong dir="auto">{previous?(locale==="ar"?previous.title:previous.en):locale==="ar"?"بداية الدورة":"Course start"}</strong></span></button>
            <div className="foc-nav-center"><span><bdi>{numberText(current+1,locale).padStart(2,locale==="ar"?"٠":"0")}</bdi><i/> <bdi>{numberText(allLessons.length,locale).padStart(2,locale==="ar"?"٠":"0")}</bdi></span><div className="foc-mini-progress"><i style={{width:`${((current+1)/allLessons.length)*100}%`}}/></div></div>
            <button className="foc-nav-link is-next" disabled={!next} onClick={()=>next&&choose(current+1)}><span><small>{t.next}</small><strong dir="auto">{next?(locale==="ar"?next.title:next.en):locale==="ar"?"نهاية الدورة":"Course end"}</strong></span><span className="foc-nav-arrow"><ArrowLeft size={18}/></span></button>
          </nav>
        </div>
      </main>
    </div>
    {outlineOpen&&<div className="foc-drawer-layer" onMouseDown={event=>{if(event.target===event.currentTarget){setOutlineOpen(false);window.requestAnimationFrame(()=>triggerRef.current?.focus());}}}>
      <div className="foc-drawer" role="dialog" aria-modal="true" aria-label={t.outline} tabIndex={-1} ref={drawerRef}><Outline locale={locale} current={current} completedCurrent={completed} onSelect={choose} mobile onClose={()=>{setOutlineOpen(false);window.requestAnimationFrame(()=>triggerRef.current?.focus());}}/></div>
    </div>}
  </div>;
}
