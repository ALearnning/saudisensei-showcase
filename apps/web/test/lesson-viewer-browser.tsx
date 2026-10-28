import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { LessonView } from "../src/components/lms/lesson-viewer/LessonView";
import { lessonFixture } from "./lesson-viewer-data";
import "../src/app/globals.css";
import "../src/components/lms/student-media/student-media.css";
import "../src/components/lms/lesson-viewer/lesson-viewer.css";

const query = new URLSearchParams(location.search);
const locale = query.get("locale") === "en" ? "en" : "ar";
const mode = (query.get("mode") ?? "text") as Parameters<typeof lessonFixture>[1];
const resourceCount = Math.max(0, Math.min(25, Number(query.get("resources") ?? 0)));
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
function Fixture() {
  const data = lessonFixture(locale, mode);
  const [done, setDone] = useState(!!data.lesson.completed);
  const [busy, setBusy] = useState(false);
  return createElement(LessonView, {
    ...data, locale, lesson: { ...data.lesson, completed: done }, busy,
    outlineLoading: false, outlineError: null, onRetryOutline: () => {}, error: null,
    onComplete: () => {
      setBusy(true);
      window.setTimeout(() => { setDone(true); setBusy(false); }, 100);
    },
    resources: resourceCount ? <section className="sm-root" data-testid="isolated-resource-slot">
      <h2>{locale === "ar" ? "موارد توضيحية معزولة" : "Isolated resource layout fixtures"}</h2>
      <section className="sm-scope"><button className="sm-scope-head" aria-expanded="true">Lesson resources ({resourceCount})</button>
        <ol className="sm-list">{Array.from({ length: resourceCount }, (_, i) => <li key={i} className="sm-item"><div className="sm-row">
          <span className="sm-idx">{i+1}</span><span className="sm-icon">TXT</span>
          <div className="sm-info"><span className="sm-title">ملف مرجعي Reference resource {i+1} {"طويل ".repeat(i % 3 === 0 ? 15 : 1)}</span><span className="sm-meta">PDF / Image / TXT / Video — layout only</span></div>
          <div className="sm-actions"><button className="btn sm primary" type="button">Open</button></div>
        </div></li>)}</ol>
      </section>
    </section> : null,
  });
}
createRoot(document.getElementById("fixture-root")!).render(createElement(Fixture));
