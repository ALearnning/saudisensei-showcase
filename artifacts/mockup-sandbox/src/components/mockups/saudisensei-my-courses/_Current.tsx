// Extracted from apps/web/src/components/lms/student.tsx.
// Original CourseCard/MyCourses JSX retained. Only framework/API boundaries
// are replaced with local synthetic data for design exploration.
import { useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, CheckCircle2 } from "lucide-react";
import { courses, type Course as LmsCourse, type Progress as LmsProgress, type Locale } from "../saudisensei-dashboard/_shared";
import "../saudisensei-dashboard/_group.css";
import "../saudisensei-dashboard/_current.css";

type LmsCoursePage = { items: LmsCourse[]; page: number; pageSize: number; total: number };
const paths = { course: (_locale: Locale, id: string) => `#course-${id}`, lesson: (_locale: Locale, course: string, lesson: string) => `#lesson-${course}-${lesson}` };
function Link({ href, children, ...props }: { href: string; children: ReactNode; className?: string; dir?: string }) { return <a href={href} {...props} onClick={e => e.preventDefault()}>{children}</a>; }
function getLms(locale: Locale) {
  return locale === "ar" ? {
    student: { eyebrow: "مساحة الطالب", myCoursesTitle: "دوراتي", myCoursesLead: "دوراتك وتقدّمك، في مكان واحد.", noResults: "لا توجد نتائج", emptyTitle: "لم تنضم إلى أي دورة بعد", emptyBody: "ستظهر دوراتك هنا عندما يسجّلك المشرف.", review: "مراجعة الدورة", continue: "تابع التعلّم", open: "فتح الدورة", progress: "{c} من {t} دروس إلزامية", noRequired: "لا توجد دروس إلزامية" },
    common: { completed: "مكتملة", search: "بحث", searchPh: "ابحث في دوراتك" }
  } : {
    student: { eyebrow: "Student workspace", myCoursesTitle: "My Courses", myCoursesLead: "Your courses and progress in one place.", noResults: "No matching courses", emptyTitle: "No courses yet", emptyBody: "Your courses will appear here when an admin enrolls you.", review: "Review course", continue: "Continue learning", open: "Open course", progress: "{c} of {t} required lessons", noRequired: "No required lessons" },
    common: { completed: "Completed", search: "Search", searchPh: "Search your courses" }
  };
}
function fmt(value: string, vars: Record<string, number>) { return value.replace(/\{(\w+)\}/g, (_, key) => String(vars[key])); }
function useLms<T>(query: string) {
  const params = new URLSearchParams(query.split("?")[1]);
  const page = Number(params.get("page") || 1);
  const search = (params.get("search") || "").toLowerCase();
  const filtered = courses.filter(c => `${c.title} ${c.description}`.toLowerCase().includes(search));
  return { data: { items: filtered.slice((page - 1) * 12, page * 12), total: filtered.length, page, pageSize: 12 } as T, loading: false, error: null, reload: () => {} };
}
function PageHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) { return <header className="page-head"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="lead">{lead}</p></header>; }
function SearchBox({ label, placeholder, onSearch }: { label: string; placeholder: string; onSearch: (v: string) => void }) { return <input className="input" type="search" aria-label={label} placeholder={placeholder} onChange={e => onSearch(e.target.value)} />; }
function Empty({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) { return <div className="empty">{icon}<h2>{title}</h2><p>{body}</p></div>; }
function Skeleton(_props: { rows: number; tall: boolean }) { return <div aria-busy="true" />; }
function ErrorState(_props: { error: unknown; locale: Locale; onRetry: () => void }) { return null; }
function Pager({ page, pageSize, total, onPage, locale }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; locale: Locale }) { return total > pageSize ? <button onClick={() => onPage(page + 1)}>{locale === "ar" ? "التالي" : "Next"}</button> : null; }
function ProgressBar({ percentage, isCompleted, label, testId }: { percentage: number; isCompleted: boolean; label: string; testId: string }) { return <div className="progress" data-testid={testId}><div className="progress-row"><span className="progress-label">{label}</span><strong className="progress-num">{percentage}%</strong></div><div className="track" role="progressbar" aria-label={label} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><span className={`fill${isCompleted ? " complete" : ""}`} style={{ width: `${percentage}%` }} /></div></div>; }

function ContinueLink({ locale, course, progress }: { locale: Locale; course: LmsCourse; progress?: LmsProgress }) {
  const t = getLms(locale).student;
  const href = progress?.continueLessonId && !progress.isCompleted ? paths.lesson(locale, course.id, progress.continueLessonId) : paths.course(locale, course.id);
  const label = progress?.isCompleted ? t.review : progress?.continueLessonId ? t.continue : t.open;
  return (
    <Link href={href} className="btn primary" data-testid={`link-continue-${course.id}`}>
      {label}<ArrowLeft size={16} className="flip-ltr" aria-hidden="true" />
    </Link>
  );
}
function CourseCard({ locale, course, i }: { locale: Locale; course: LmsCourse; i: number }) {
  const t = getLms(locale).student;
  const p = course.progress;
  return (
    <article className="course-card rise" style={{ animationDelay: `${i * 60}ms` }} data-testid={`card-course-${course.id}`}>
      <div className="cc-top">
        <span className="cc-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
        {p?.isCompleted && <span className="badge b-published"><CheckCircle2 size={13} aria-hidden="true" />{getLms(locale).common.completed}</span>}
      </div>
      <h3 dir="auto"><Link href={paths.course(locale, course.id)} data-testid={`link-course-${course.id}`}>{course.title}</Link></h3>
      {course.description && <p className="cc-desc" dir="auto">{course.description}</p>}
      {p && <ProgressBar percentage={p.percentage} isCompleted={p.isCompleted} label={fmt(t.progress, { c: p.completedRequired, t: p.totalRequired })} testId={`progress-course-${course.id}`} />}
      {p && p.totalRequired === 0 && <p className="muted small">{t.noRequired}</p>}
      <div className="cc-foot"><ContinueLink locale={locale} course={course} progress={p} /></div>
    </article>
  );
}

export function MyCourses({ locale = "ar" }: { locale?: Locale }) {
  const t = getLms(locale);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const qs = new URLSearchParams({ page: String(page), pageSize: "12", ...(search ? { search } : {}) });
  const q = useLms<LmsCoursePage>(`courses?${qs}`);
  return (
    <div className="ss-current" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="shell"><main className="main"><div className="stack">
      <PageHead eyebrow={t.student.eyebrow} title={t.student.myCoursesTitle} lead={t.student.myCoursesLead} />
      <div className="toolbar"><SearchBox label={t.common.search} placeholder={t.common.searchPh} onSearch={(v) => { setSearch(v); setPage(1); }} /></div>
      {q.loading && !q.data ? <Skeleton rows={3} tall /> : q.error ? <ErrorState error={q.error} locale={locale} onRetry={q.reload} /> : q.data && (
        q.data.items.length === 0
          ? <Empty icon={<BookOpen size={26} />} title={search ? t.student.noResults : t.student.emptyTitle} body={search ? undefined : t.student.emptyBody} />
          : <>
              <div className="course-grid">{q.data.items.map((c, i) => <CourseCard key={c.id} locale={locale} course={c} i={i} />)}</div>
              <Pager page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} locale={locale} />
            </>
      )}
    </div></main></div>
    </div>
  );
}
