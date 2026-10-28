import {useState} from "react";
import {LessonView} from "./_baseline/LessonView";
import type {LmsCourse, LmsLesson} from "./_baseline/_stubs";
import {sampleChapters, illustrativeCode} from "./_data";
import "../saudisensei-dashboard/_group.css";
import "./_baseline/_base.css";
import "./_baseline/_lesson.css";
// Exact current presentation source copied to _baseline. Only transport/router/common
// dependencies are stubbed. This reference is NOT a newly proposed design.
export function CurrentIntegrated() {
  const [done,setDone]=useState(false);
  const chapters=sampleChapters.map((c,ci)=>({id:`chapter-${ci}`,position:ci,title:c.title,lessons:c.lessons.map((l,li)=>({id:`lesson-${ci}-${li}`,courseId:"illustrative-course",chapterId:`chapter-${ci}`,position:li,title:l.title,body:`## دوال واضحة ونتائج متوقعة\n\nنعرّف المدخلات والمخرجات حتى نكتب كودًا يسهل فهمه وتطويره.\n\n\`\`\`typescript\n${illustrativeCode}\n\`\`\``,completed:l.done,isRequired:true}))}));
  const course:LmsCourse={id:"illustrative-course",title:"TypeScript من الأساس إلى التطبيق",chapters};
  const lesson:LmsLesson={...chapters[1].lessons[0],completed:done};
  return <div style={{"--font-body":'"IBM Plex Sans Arabic", sans-serif'} as React.CSSProperties}><LessonView locale="ar" lesson={lesson} course={course} previous={chapters[0].lessons[1]} next={chapters[1].lessons[1]} progress={{percentage:33,completedRequired:2,totalRequired:6,isCompleted:false}} resources={<section className="panel"><h2>موارد الدرس</h2><p>تمثيل معزول للموارد الخاصة؛ لا يتم إصدار أي روابط.</p><details><summary>موارد الفصل (3)</summary><p>ملفات توضيحية فقط</p></details><details><summary>موارد الدورة (2)</summary><p>ملفات توضيحية فقط</p></details></section>} outlineLoading={false} outlineError={null} onRetryOutline={()=>{}} busy={false} error={null} onComplete={()=>setDone(true)} /></div>;
}
