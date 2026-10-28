// Extracted from apps/web/src/components/lms/student.tsx (ContinueLink,
// CourseCard, StudentDashboard), Shell.tsx and AreaNav.tsx.
// Only boundaries changed: Next routing, protected identity and useLms are
// replaced by an explicitly labeled local preview adapter.
import { ArrowLeft, BookOpen, CheckCircle2, GraduationCap, Layers, LayoutDashboard, ListChecks, LogOut, Target } from "lucide-react";
import { usePreview, PreviewTools, type Locale, type Course, type Progress } from "./_shared";
import "./_group.css";
import "./_current.css";

function ContinueLink({ locale, course, progress, act }: { locale: Locale; course: Course; progress?: Progress; act: () => void }) {
  const t = locale === "ar" ? {review:"مراجعة الدورة",continue:"تابع التعلّم",open:"فتح الدورة"} : {review:"Review course",continue:"Continue learning",open:"Open course"};
  const label = progress?.isCompleted ? t.review : progress?.continueLessonId ? t.continue : t.open;
  return <button onClick={act} className="btn primary">{label}<ArrowLeft size={16} className="flip-ltr" aria-hidden="true" /></button>;
}
function ProgressBar({ percentage, label }: { percentage:number; label:string }) {
  return <div className="progress"><div className="progress-row"><strong className="progress-num"><bdi>{percentage}%</bdi></strong><span className="progress-label">{label}</span></div>
    <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-label={label}><span className={`fill${percentage===100?" done":""}`} style={{transform:`scaleX(${percentage/100})`}} /></div></div>;
}
function CourseCard({ locale, course, i, act }: {locale:Locale;course:Course;i:number;act:()=>void}) {
  const p=course.progress;
  return <article className="course-card rise" style={{animationDelay:`${i*60}ms`}}>
    <div className="cc-top"><span className="cc-index" aria-hidden="true">{String(i+1).padStart(2,"0")}</span>
      {p.isCompleted && <span className="badge b-published"><CheckCircle2 size={13} aria-hidden="true" />{locale==="ar"?"مكتملة":"Completed"}</span>}</div>
    <h3 dir="auto"><a href="#" onClick={e=>{e.preventDefault();act();}}>{course.title}</a></h3>
    {course.description && <p className="cc-desc" dir="auto">{course.description}</p>}
    <ProgressBar percentage={p.percentage} label={locale==="ar"?`${p.completedRequired} من ${p.totalRequired} دروس إلزامية`:`${p.completedRequired} of ${p.totalRequired} required lessons`} />
    <div className="cc-foot"><ContinueLink locale={locale} course={course} progress={p} act={act} /></div>
  </article>;
}
export function Current() {
  const preview=usePreview(), {locale,t,data,act,state}=preview;
  return <div className="ss-current" lang={locale} dir={locale==="ar"?"rtl":"ltr"}>
    <PreviewTools preview={preview} />
    <div className="shell">
      <header className="topbar"><a href="#" onClick={e=>e.preventDefault()} className="brand"><span className="mark">س</span><span className="brand-text"><strong>{t.brand}</strong><small>SaudiSensei</small></span></a><button className="lang" onClick={()=>preview.setLocale(locale==="ar"?"en":"ar")}>{locale==="ar"?"English":"العربية"}</button></header>
      <nav className="areanav" aria-label={t.navigation}><span className="area-tag">{locale==="ar"?"مساحة الطالب":"Student space"}</span><ul><li><a className="on" href="#" aria-current="page" onClick={e=>e.preventDefault()}><LayoutDashboard size={16}/>{t.dashboard}</a></li><li><a href="#" onClick={e=>{e.preventDefault();act();}}><BookOpen size={16}/>{t.myCourses}</a></li></ul><button className="nav-out" onClick={act}><LogOut size={15}/>{t.logout}</button></nav>
      <main className="main"><div className="stack">
        <header className="page-head rise"><div className="page-head-row"><div><span className="eyebrow">{locale==="ar"?"مساحة الطالب":"Student space"}</span><h1 dir="auto">{locale==="ar"?"أهلاً، متعلّم":"Welcome, Learner"}</h1><p className="lead">{locale==="ar"?"تابع من حيث توقفت. يُحسب التقدّم من الدروس الإلزامية المنشورة حالياً.":"Pick up where you left off. Progress counts the required lessons published right now."}</p></div></div></header>
        <p className="identity"><span className="dot" aria-hidden="true" />{t.verified} · <bdi>student@example.invalid</bdi></p>
        {state==="loading"?<div className="sk-wrap" aria-busy="true" aria-label={t.loading}>{[0,1,2].map(i=><div className="skeleton tall" key={i}/>)}</div>:<>
          <dl className="stats rise"><div className="stat"><Layers size={18}/><dt>{t.courses}</dt><dd>{data.totalCourses}</dd></div><div className="stat"><ListChecks size={18}/><dt>{t.done}</dt><dd>{data.completedRequired}</dd></div><div className="stat"><Target size={18}/><dt>{t.remaining}</dt><dd>{data.remainingRequired}</dd></div></dl>
          {data.courses.length===0?<div className="empty"><span className="empty-mark" aria-hidden="true"><GraduationCap size={26}/></span><strong>{t.emptyTitle}</strong><p>{t.emptyBody}</p></div>:<div className="course-grid">{data.courses.map((c,i)=><CourseCard key={c.id} locale={locale} course={c} i={i} act={act}/>)}</div>}
        </>}
      </div></main>
      <footer className="footer">{locale==="ar"?"سعودي سنسي · تعلّم بثقة":"SaudiSensei · Learn with confidence"}</footer>
    </div>
  </div>;
}
