"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, BookPlus, ChevronLeft, FolderPlus, LayoutList, Send, Undo2, Users } from "lucide-react";
import type { LmsAdminDashboard, LmsChapter, LmsCourse, LmsCoursePage, ProtectedPage } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { lms, useLms, type ApiFailure } from "@/lib/lms-client";
import { fmt, paths } from "@/lib/lms-paths";
import { Badge, ConfirmButton, Empty, ErrorState, MutationError, PageHead, Pager, SearchBox, Skeleton, Toast, useToast } from "./ui";
import { Field, ReorderButtons, send, useMutator } from "./admin-common";
import { useDraft } from "./use-draft";
import { AdminMediaManager } from "./admin-media";

export function AdminDashboard({ locale, identity }: { locale: Locale; identity: ProtectedPage }) {
  const t = getLms(locale);
  const q = useLms<LmsAdminDashboard>("admin/dashboard");
  const d = q.data;
  return (
    <div className="stack">
      <PageHead eyebrow={t.admin.eyebrow} title={t.admin.dashTitle} lead={t.admin.dashLead}
        actions={<Link href={paths.newCourse(locale)} className="btn primary" data-testid="link-create-course"><BookPlus size={16} aria-hidden="true" />{t.admin.create}</Link>} />
      <p className="identity" data-testid="status-authorized-admin"><span className="dot" aria-hidden="true" />{t.admin.identity} · <bdi>{identity.user.email}</bdi></p>
      {q.loading && !d ? <Skeleton rows={2} tall /> : q.error ? <ErrorState error={q.error} locale={locale} onRetry={q.reload} /> : d && (
        <>
          <dl className="stats wide rise">
            <div className="stat"><dt>{t.admin.total}</dt><dd data-testid="text-total-courses">{d.totalCourses}</dd></div>
            <div className="stat"><dt>{t.status.draft}</dt><dd data-testid="text-draft-courses">{d.draftCourses}</dd></div>
            <div className="stat"><dt>{t.status.published}</dt><dd data-testid="text-published-courses">{d.publishedCourses}</dd></div>
            <div className="stat"><dt>{t.status.archived}</dt><dd data-testid="text-archived-courses">{d.archivedCourses}</dd></div>
            <div className="stat accent"><dt>{t.admin.activeEnrollments}</dt><dd data-testid="text-active-enrollments">{d.activeEnrollments}</dd></div>
            <div className="stat accent"><dt>{t.admin.totalStudents}</dt><dd data-testid="text-total-students">{d.totalStudents}</dd></div>
          </dl>
          <div className="quick rise delay">
            <Link href={paths.adminCourses(locale)} className="quick-link" data-testid="link-quick-courses"><LayoutList size={20} aria-hidden="true" /><span>{t.admin.coursesTitle}</span><ChevronLeft size={16} className="flip-ltr" aria-hidden="true" /></Link>
            <Link href={paths.adminStudents(locale)} className="quick-link" data-testid="link-quick-students"><Users size={20} aria-hidden="true" /><span>{t.admin.studentsTitle}</span><ChevronLeft size={16} className="flip-ltr" aria-hidden="true" /></Link>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminCourses({ locale }: { locale: Locale }) {
  const t = getLms(locale);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "20", ...(status ? { status } : {}), ...(search ? { search } : {}) });
  const q = useLms<LmsCoursePage>(`admin/courses?${qs}`);
  const filters = ["", "draft", "published", "archived"];
  return (
    <div className="stack">
      <PageHead eyebrow={t.admin.eyebrow} title={t.admin.coursesTitle} lead={t.admin.coursesLead}
        actions={<Link href={paths.newCourse(locale)} className="btn primary" data-testid="link-create-course"><BookPlus size={16} aria-hidden="true" />{t.admin.create}</Link>} />
      <div className="toolbar">
        <div className="seg" role="group" aria-label={t.common.statusLabel}>
          {filters.map((f) => (
            <button key={f || "all"} type="button" aria-pressed={status === f} className={status === f ? "on" : ""} onClick={() => { setStatus(f); setPage(1); }} data-testid={`filter-status-${f || "all"}`}>
              {f ? (t.status as Record<string, string>)[f] : t.common.all}
            </button>
          ))}
        </div>
        <SearchBox label={t.common.search} placeholder={t.common.searchPh} onSearch={(v) => { setSearch(v); setPage(1); }} />
      </div>
      {q.loading && !q.data ? <Skeleton rows={5} /> : q.error ? <ErrorState error={q.error} locale={locale} onRetry={q.reload} /> : q.data && (
        q.data.items.length === 0
          ? <Empty icon={<LayoutList size={26} />} title={t.admin.noCourses} action={<Link href={paths.newCourse(locale)} className="btn ghost" data-testid="link-empty-create">{t.admin.create}</Link>} />
          : <>
              <div className="table" role="table" aria-label={t.admin.coursesTitle}>
                <div className="tr th" role="row"><span role="columnheader">{t.admin.fTitle}</span><span role="columnheader">{t.common.statusLabel}</span><span role="columnheader">{t.admin.revision}</span><span role="columnheader">{t.common.actions}</span></div>
                {q.data.items.map((c) => (
                  <div className="tr" role="row" key={c.id} data-testid={`row-course-${c.id}`}>
                    <span role="cell" className="cell-main"><Link href={paths.adminCourse(locale, c.id)} dir="auto" data-testid={`link-course-${c.id}`}>{c.title}</Link><small className="mono muted"><bdi>{c.slug}</bdi></small></span>
                    <span role="cell" data-label={t.common.statusLabel}><Badge status={c.status} locale={locale} /></span>
                    <span role="cell" data-label={t.admin.revision} className="mono">{c.editRevision}</span>
                    <span role="cell" className="cell-actions">
                      <Link href={paths.adminCourse(locale, c.id)} className="btn ghost sm" data-testid={`link-edit-course-${c.id}`}>{t.common.edit}</Link>
                      <Link href={paths.courseStudents(locale, c.id)} className="btn ghost sm" data-testid={`link-students-course-${c.id}`}>{t.nav.students}</Link>
                    </span>
                  </div>
                ))}
              </div>
              <Pager page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} locale={locale} />
            </>
      )}
    </div>
  );
}

export function NewCourse({ locale }: { locale: Locale }) {
  const t = getLms(locale);
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  const invalid = title.trim().length === 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setTouched(true);
    if (invalid) return;
    setBusy(true); setErr(null);
    const body: { title: string; description?: string } = { title: title.trim() };
    if (description.trim()) body.description = description.trim();
    const r = await lms<LmsCourse>("admin/courses", { method: "POST", body });
    if (!r.ok) { setBusy(false); setErr(r.error); return; }
    router.push(paths.adminCourse(locale, r.data.id));
  }
  return (
    <div className="stack narrow">
      <PageHead back={{ href: paths.adminCourses(locale), label: t.admin.coursesTitle }} eyebrow={t.admin.eyebrow} title={t.admin.newTitle} lead={t.admin.newLead} />
      <form className="card form rise" onSubmit={submit} noValidate>
        <Field id="course-title" label={t.admin.fTitle} error={touched && invalid ? t.admin.titleRequired : null}>
          <input id="course-title" dir="auto" value={title} maxLength={200} required aria-invalid={touched && invalid} onChange={(e) => setTitle(e.target.value)} data-testid="input-course-title" />
        </Field>
        <Field id="course-description" label={t.admin.fDescription}>
          <textarea id="course-description" dir="auto" rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-course-description" />
        </Field>
        <MutationError error={err} locale={locale} />
        <div className="actions"><button className="btn primary" disabled={busy} data-testid="button-create-course">{busy ? t.common.saving : t.admin.createSubmit}</button>
          <Link href={paths.adminCourses(locale)} className="btn ghost" data-testid="link-cancel">{t.common.cancel}</Link></div>
      </form>
    </div>
  );
}

export function sortPos<T extends { position: number; status?: string }>(xs: readonly T[] | undefined): T[] {
  return [...(xs ?? [])].sort((a, b) => (a.status === "archived" ? 1 : 0) - (b.status === "archived" ? 1 : 0) || a.position - b.position);
}
export const activeIds = (xs: readonly { id: string; status: string }[]) => xs.filter((x) => x.status !== "archived").map((x) => x.id);

function CourseDetailsForm({ locale, course, readOnly, onSave, busy }: { locale: Locale; course: LmsCourse; readOnly: boolean; busy: boolean; onSave: (b: { title: string; description: string }, baseRevision: number) => void | Promise<void> }) {
  const t = getLms(locale);
  const { draft, values, dirty, edit } = useDraft({ title: course.title, description: course.description ?? "" }, course.editRevision);
  const [touched, setTouched] = useState(false);
  const invalid = values.title.trim() === "";
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!invalid) onSave({ title: values.title.trim(), description: values.description.trim() }, draft.revision); }}>
      <Field id="course-title" label={t.admin.fTitle} error={touched && invalid ? t.admin.titleRequired : null}>
        <input id="course-title" dir="auto" value={values.title} maxLength={200} disabled={readOnly || busy} aria-invalid={touched && invalid} onChange={(e) => edit({ title: e.target.value })} data-testid="input-course-title" />
      </Field>
      <Field id="course-description" label={t.admin.fDescription}>
        <textarea id="course-description" dir="auto" rows={4} maxLength={5000} value={values.description} disabled={readOnly || busy} onChange={(e) => edit({ description: e.target.value })} data-testid="input-course-description" />
      </Field>
      {!readOnly && <div className="actions"><button className="btn primary" disabled={busy || !dirty} data-testid="button-save-course">{busy ? t.common.saving : t.common.save}</button></div>}
    </form>
  );
}

function AddTitleForm({ locale, placeholder, label, onAdd, busy, testId }: { locale: Locale; placeholder: string; label: string; busy: boolean; onAdd: (title: string) => Promise<boolean>; testId: string }) {
  const t = getLms(locale);
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <form className="add-row" noValidate onSubmit={async (e) => { e.preventDefault(); setTouched(true); if (!title.trim()) return; if (await onAdd(title.trim())) { setTitle(""); setTouched(false); } }}>
      <label className="sr-only" htmlFor={`${testId}-input`}>{placeholder}</label>
      <input id={`${testId}-input`} dir="auto" value={title} maxLength={200} placeholder={placeholder} onChange={(e) => setTitle(e.target.value)} aria-invalid={touched && !title.trim()} data-testid={`input-${testId}`} />
      <button className="btn primary" disabled={busy} data-testid={`button-${testId}`}><FolderPlus size={16} aria-hidden="true" />{label}</button>
      {touched && !title.trim() && <small className="field-err" role="alert">{t.admin.titleRequired}</small>}
    </form>
  );
}

export function LifecycleControls({ locale, status, disabled, onChange, kind }: { locale: Locale; status: string; disabled: boolean; kind: string; onChange: (to: "published" | "draft" | "archived") => void | Promise<void> }) {
  const t = getLms(locale).admin;
  if (status === "archived") return null;
  return (
    <div className="actions">
      {status === "draft" && <ConfirmButton locale={locale} label={t.publish} message={t.publishConfirm} onConfirm={() => onChange("published")} className="btn primary" disabled={disabled} testId={`button-publish-${kind}`} icon={<Send size={15} aria-hidden="true" />} />}
      {status === "published" && <ConfirmButton locale={locale} label={t.unpublish} message={t.unpublishConfirm} onConfirm={() => onChange("draft")} disabled={disabled} testId={`button-unpublish-${kind}`} icon={<Undo2 size={15} aria-hidden="true" />} />}
      <ConfirmButton locale={locale} label={t.archive} message={t.archiveConfirm} onConfirm={() => onChange("archived")} className="btn danger" disabled={disabled} testId={`button-archive-${kind}`} icon={<Archive size={15} aria-hidden="true" />} />
    </div>
  );
}

export function CourseEditor({ locale, courseId }: { locale: Locale; courseId: string }) {
  const t = getLms(locale);
  const q = useLms<LmsCourse>(`admin/courses/${encodeURIComponent(courseId)}`);
  const [toast, setToast] = useToast();
  const [reset, setReset] = useState(0);
  const m = useMutator(() => q.reload(), setToast);
  if (q.loading && !q.data) return <Skeleton rows={5} />;
  if (q.error) return <ErrorState error={q.error} locale={locale} onRetry={q.reload} back={{ href: paths.adminCourses(locale), label: t.admin.coursesTitle }} />;
  const c = q.data!;
  const readOnly = c.status === "archived";
  const rev = c.editRevision;
  const chapters = sortPos(c.chapters);
  const ids = activeIds(chapters);
  const base = `admin/courses/${encodeURIComponent(c.id)}`;
  const refresh = async () => { m.setError(null); await q.reload(); setReset((n) => n + 1); };
  return (
    <div className="stack">
      <PageHead back={{ href: paths.adminCourses(locale), label: t.admin.coursesTitle }} eyebrow={t.admin.details} title={c.title}
        actions={<><Badge status={c.status} locale={locale} /><Link href={paths.courseStudents(locale, c.id)} className="btn ghost" data-testid="link-manage-students"><Users size={16} aria-hidden="true" />{t.admin.manageStudents}</Link></>} />
      {readOnly && <div className="notice warn" data-testid="status-readonly"><Archive size={18} aria-hidden="true" /><p>{t.admin.archivedNotice}</p></div>}
      <MutationError error={m.error} locale={locale} onRefresh={refresh} />
      <div className="split">
        <section className="panel rise">
          <h2 className="panel-title">{t.admin.details}</h2>
          <CourseDetailsForm key={`${c.id}-${reset}`} locale={locale} course={c} readOnly={readOnly} busy={m.busy}
            onSave={async (b, baseRevision) => { if ((await m.run(send("PATCH", base, { ...b, expectedRevision: baseRevision }), t.common.saved)) !== null) setReset((n) => n + 1); }} />
          <dl className="meta"><div><dt>{t.admin.revision}</dt><dd className="mono" data-testid="text-revision">{rev}</dd></div><div><dt>slug</dt><dd className="mono"><bdi>{c.slug}</bdi></dd></div></dl>
        </section>
        <section className="panel rise delay">
          <h2 className="panel-title">{t.admin.lifecycle}</h2>
          <p className="muted small">{t.errors.publishRule}</p>
          <LifecycleControls locale={locale} status={c.status} kind="course" disabled={m.busy}
            onChange={async (to) => { await m.run(send("POST", `${base}/${to === "published" ? "publish" : to === "draft" ? "unpublish" : "archive"}`, { expectedRevision: rev }), t.common.updated); }} />
        </section>
      </div>
      <section className="panel rise">
        <div className="panel-head"><h2 className="panel-title">{t.admin.chapters}</h2></div>
        {chapters.length === 0 ? <Empty icon={<LayoutList size={24} />} title={t.admin.noChapters} /> : (
          <ol className="tree">
            {chapters.map((ch: LmsChapter) => {
              const chRO = readOnly || ch.status === "archived";
              return (
                <li key={ch.id} className={`tree-row${ch.status === "archived" ? " is-archived" : ""}`} data-testid={`row-chapter-${ch.id}`}>
                  <ReorderButtons ids={ids} id={ch.id} label={ch.title} locale={locale} disabled={chRO || m.busy}
                    onMove={(next) => void m.run(send("PUT", `${base}/chapter-order`, { orderedIds: next, expectedRevision: rev }), t.admin.orderSaved)} />
                  <div className="tree-main">
                    <Link href={paths.adminChapter(locale, c.id, ch.id)} dir="auto" data-testid={`link-chapter-${ch.id}`}>{ch.title}</Link>
                    <span className="muted small">{fmt(t.admin.lessonCount, { n: ch.lessons.length })}</span>
                    <ul className="mini-lessons">
                      {sortPos(ch.lessons).map((l) => (
                        <li key={l.id}><Link href={paths.adminLesson(locale, c.id, ch.id, l.id)} dir="auto" data-testid={`link-lesson-${l.id}`}>{l.title}</Link><Badge status={l.status} locale={locale} /></li>
                      ))}
                    </ul>
                  </div>
                  <Badge status={ch.status} locale={locale} />
                </li>
              );
            })}
          </ol>
        )}
        {!readOnly && <AddTitleForm locale={locale} busy={m.busy} placeholder={t.admin.chapterPh} label={t.admin.addChapter} testId="add-chapter"
          onAdd={async (title) => (await m.run(send("POST", `${base}/chapters`, { title, expectedRevision: rev }), t.common.saved)) !== null} />}
      </section>
      <AdminMediaManager locale={locale} scope="courses" parentId={c.id} readOnly={readOnly} />
      <Toast text={toast} />
    </div>
  );
}
