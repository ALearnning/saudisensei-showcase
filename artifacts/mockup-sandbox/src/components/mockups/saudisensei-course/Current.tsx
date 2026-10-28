import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import "./_current.css";

// Extracted from StudentCourse / Outline / ContinueLink in the real student.tsx.
// API, Next Link and resources are stubbed only in this isolated reference.
export const previewCourse = {
  id: "preview-course", title: "أساسيات تصميم تجارب التعلّم الرقمية",
  description: "من الفكرة إلى تجربة واضحة: تعلّم كيف تصمم واجهات مفهومة وسهلة الاستخدام.",
  chapters: [
    { id: "chapter-one", position: 0, title: "البداية: فهم تجربة المستخدم", lessons: [
      { id: "lesson-one", position: 0, title: "مقدمة في تصميم تجارب التعلّم", completed: true, isRequired: true },
      { id: "lesson-two", position: 1, title: "فهم احتياجات المتعلّم وبناء مسار واضح", completed: false, isRequired: true },
      { id: "lesson-three", position: 2, title: "قراءات إضافية وأمثلة تطبيقية", completed: false, isRequired: false },
    ] },
    { id: "chapter-two", position: 1, title: "من الفكرة إلى التطبيق", lessons: [
      { id: "lesson-four", position: 0, title: "تنظيم المحتوى وبناء هيكل الصفحة", completed: false, isRequired: true },
      { id: "lesson-five", position: 1, title: "اختبار التجربة وتحسينها", completed: false, isRequired: true },
    ] },
  ],
};
export function Current() {
  const course = previewCourse;
  return <div className="ss-course-current" dir="rtl" lang="ar"><p className="preview-note">مرجع معزول من الصفحة الحالية · بيانات توضيحية فقط</p>
    <div className="stack">
      <header className="page-head rise">
        <a href="#courses" className="crumb">دوراتي</a>
        <div className="page-head-row"><div><span className="eyebrow">محتوى الدورة</span><h1 dir="auto">{course.title}</h1>
          <p className="lead"><span dir="auto">{course.description}</span></p></div>
          <div className="actions"><a className="btn primary" href="#lesson-two">تابع التعلّم<ArrowLeft size={16} /></a></div>
        </div>
      </header>
      <section className="panel rise">
        <div className="progress"><div className="progress-row"><strong className="progress-num"><bdi>25%</bdi></strong><span className="progress-label">أكملت 1 من 4 دروس إلزامية</span></div>
          <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={25} aria-label="أكملت 1 من 4 دروس إلزامية"><span className="fill" style={{ transform: "scaleX(0.25)" }} /></div>
        </div>
      </section>
      <section className="panel rise delay"><h2 className="panel-title">محتوى الدورة</h2>
        <ol className="outline">{[...course.chapters].sort((a,b)=>a.position-b.position).map((ch,ci)=><li key={ch.id} className="ol-chapter">
          <div className="ol-ch-title"><span className="ol-num">{ci+1}</span><span dir="auto">{ch.title}</span></div>
          <ol>{[...ch.lessons].sort((a,b)=>a.position-b.position).map(l=><li key={l.id}><a href={`#${l.id}`} className="ol-lesson">
            {l.completed?<CheckCircle2 size={17} className="ok" aria-label="مكتمل" />:<Circle size={17} className="todo" aria-hidden="true" />}
            <span dir="auto" className="ol-text">{l.title}</span><span className={`tag ${l.isRequired?"req":"optional"}`}>{l.isRequired?"إلزامي":"اختياري"}</span>
          </a></li>)}</ol>
        </li>)}</ol>
      </section>
      <section className="panel"><h2 className="panel-title">موارد الدورة</h2><p>منطقة عارض الموارد الحالي؛ لا تُصدر روابط خاصة في هذا المرجع.</p></section>
    </div>
  </div>;
}
