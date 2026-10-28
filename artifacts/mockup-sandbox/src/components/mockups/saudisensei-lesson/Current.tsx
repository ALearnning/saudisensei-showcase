import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import "../saudisensei-course/_current.css";
import "./_current.css";

// Extracted LessonReader / Outline rendering from the approved pre-redesign source.
// Only Next links, API state, Markdown content and private resource transport are stubbed.
const course = { title: "أساسيات البرمجة باستخدام TypeScript", chapters: [
  { id: "chapter-one", position: 0, title: "البداية: المتغيرات والأنواع", lessons: [
    { id: "one", position: 0, title: "مقدمة في البرمجة", completed: true, isRequired: true },
    { id: "two", position: 1, title: "التعامل مع المتغيرات والأنواع", completed: false, isRequired: true },
    { id: "three", position: 2, title: "تطبيق عملي", completed: false, isRequired: false },
  ] },
] };
const lesson = course.chapters[0].lessons[1];
const sortByPos = <T extends { position: number },>(xs: T[]) => [...xs].sort((a,b) => a.position-b.position);
export function Current() {
  const flat = sortByPos(course.chapters).flatMap(c => sortByPos(c.lessons));
  const idx = flat.findIndex(l => l.id === lesson.id);
  const prev = flat[idx-1], next = flat[idx+1];
  return <div className="ss-course-current ss-lesson-current" dir="rtl" lang="ar">
    <p className="preview-note">مرجع معزول من عارض الدرس السابق · بيانات توضيحية فقط</p>
    <div className="reader">
      <aside className="reader-side" aria-label="محتوى الدورة">
        <a href="#course" className="crumb" data-testid="link-back-course"><ArrowLeft size={15} aria-hidden="true" /><bdi>{course.title}</bdi></a>
        <div className="progress"><div className="progress-row"><strong className="progress-num"><bdi>50%</bdi></strong><span className="progress-label">أكملت 1 من 2 دروس إلزامية</span></div>
          <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={50} aria-label="أكملت 1 من 2 دروس إلزامية"><span className="fill" style={{ transform: "scaleX(0.5)" }} /></div></div>
        <ol className="outline">{sortByPos(course.chapters).map((ch,ci) => <li key={ch.id} className="ol-chapter">
          <div className="ol-ch-title"><span className="ol-num">{ci+1}</span><span dir="auto">{ch.title}</span></div>
          <ol>{sortByPos(ch.lessons).map(l => <li key={l.id}>
            <a href={`#${l.id}`} className={`ol-lesson${l.id===lesson.id?" current":""}`} aria-current={l.id===lesson.id?"page":undefined}>
              {l.completed?<CheckCircle2 size={17} className="ok" aria-label="مكتمل" />:<Circle size={17} className="todo" aria-hidden="true" />}
              <span dir="auto" className="ol-text">{l.title}</span><span className={`tag ${l.isRequired?"req":"optional"}`}>{l.isRequired?"إلزامي":"اختياري"}</span>
            </a>
          </li>)}</ol>
        </li>)}</ol>
      </aside>
      <article className="reader-main card rise">
        <div className="reader-meta"><span className="tag req">إلزامي</span><span className="muted small">الدرس {idx+1} / {flat.length}</span></div>
        <h1 dir="auto" data-testid="text-lesson-title">{lesson.title}</h1>
        <div className="prose" data-testid="text-lesson-body"><h2 dir="auto">قيمة واضحة ونوع محدد</h2><p dir="auto">تعرّف على المتغيرات وكيفية تعريف الأنواع في TypeScript.</p><pre dir="ltr"><code>{'const message: string = "Hello";\nconsole.log(message);'}</code></pre></div>
        <section className="panel"><h2 className="panel-title">موارد الدرس</h2><p>مرجع منطقة الموارد الخاصة؛ لا يتم إصدار روابط أو تشغيل وسائط هنا.</p></section>
        <div className="reader-actions"><button className="btn primary"><CheckCircle2 size={17} aria-hidden="true" />إكمال الدرس</button></div>
        <nav className="lesson-nav" aria-label="محتوى الدورة">
          {prev?<a href={`#${prev.id}`} className="ln prev"><small>الدرس السابق</small><span dir="auto">{prev.title}</span></a>:<span />}
          {next?<a href={`#${next.id}`} className="ln next"><small>الدرس التالي</small><span dir="auto">{next.title}</span></a>:<span />}
        </nav>
      </article>
    </div>
  </div>;
}
