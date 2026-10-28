"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, FilePlus2, FileText } from "lucide-react";
import type { LmsCourse, LmsLesson } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { lms, useLms, type ApiFailure } from "@/lib/lms-client";
import { paths } from "@/lib/lms-paths";
import { Badge, Empty, ErrorState, MutationError, PageHead, ReqTag, Skeleton, Toast, useToast } from "./ui";
import { BodyEditor, Field, ReorderButtons, send, useMutator } from "./admin-common";
import { useDraft } from "./use-draft";
import { LifecycleControls, activeIds, sortPos } from "./admin-courses";
import { AdminLessonMedia } from "./media";
import { AdminMediaManager } from "./admin-media";

function ReadOnlyNotice({ locale }: { locale: Locale }) {
  return <div className="notice warn" data-testid="status-readonly"><Archive size={18} aria-hidden="true" /><p>{getLms(locale).common.readOnly}</p></div>;
}

function TitleForm({ locale, initial, revision, readOnly, busy, onSave, id }: { locale: Locale; initial: string; revision: number; readOnly: boolean; busy: boolean; onSave: (title: string, baseRevision: number) => void | Promise<void>; id: string }) {
  const t = getLms(locale);
  const { draft, values, dirty, edit } = useDraft({ title: initial }, revision);
  const [touched, setTouched] = useState(false);
  const invalid = !values.title.trim();
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!invalid) onSave(values.title.trim(), draft.revision); }}>
      <Field id={id} label={t.admin.fTitle} error={touched && invalid ? t.admin.titleRequired : null}>
        <input id={id} dir="auto" value={values.title} maxLength={200} disabled={readOnly || busy} aria-invalid={touched && invalid} onChange={(e) => edit({ title: e.target.value })} data-testid={`input-${id}`} />
      </Field>
      {!readOnly && <div className="actions"><button className="btn primary" disabled={busy || !dirty} data-testid={`button-save-${id}`}>{busy ? t.common.saving : t.common.save}</button></div>}
    </form>
  );
}

export function ChapterEditor({ locale, courseId, chapterId }: { locale: Locale; courseId: string; chapterId: string }) {
  const t = getLms(locale);
  const q = useLms<LmsCourse>(`admin/courses/${encodeURIComponent(courseId)}`);
  const [toast, setToast] = useToast();
  const [reset, setReset] = useState(0);
  const m = useMutator(() => q.reload(), setToast);
  if (q.loading && !q.data) return <Skeleton rows={5} />;
  if (q.error) return <ErrorState error={q.error} locale={locale} onRetry={q.reload} back={{ href: paths.adminCourses(locale), label: t.admin.coursesTitle }} />;
  const c = q.data!;
  const ch = c.chapters?.find((x) => x.id === chapterId);
  if (!ch) return <ErrorState error={{ status: 404, code: "NOT_FOUND" }} locale={locale} back={{ href: paths.adminCourse(locale, courseId), label: c.title }} />;
  const readOnly = c.status === "archived" || ch.status === "archived";
  const rev = c.editRevision;
  const lessons = sortPos(ch.lessons);
  const ids = activeIds(lessons);
  const base = `admin/chapters/${encodeURIComponent(ch.id)}`;
  const refresh = async () => { m.setError(null); await q.reload(); setReset((n) => n + 1); };
  return (
    <div className="stack">
      <PageHead back={{ href: paths.adminCourse(locale, c.id), label: c.title }} eyebrow={t.admin.chapterTitle} title={ch.title}
        actions={<><Badge status={ch.status} locale={locale} />{!readOnly && <Link href={paths.newLesson(locale, c.id, ch.id)} className="btn primary" data-testid="link-add-lesson"><FilePlus2 size={16} aria-hidden="true" />{t.admin.addLesson}</Link>}</>} />
      {readOnly && <ReadOnlyNotice locale={locale} />}
      <MutationError error={m.error} locale={locale} onRefresh={refresh} />
      <div className="split">
        <section className="panel rise">
          <h2 className="panel-title">{t.admin.chapter}</h2>
          <TitleForm key={`${ch.id}-${reset}`} id="chapter-title" locale={locale} initial={ch.title} revision={rev} readOnly={readOnly} busy={m.busy}
            onSave={async (title, baseRevision) => { if ((await m.run(send("PATCH", base, { title, expectedRevision: baseRevision }), t.common.saved)) !== null) setReset((n) => n + 1); }} />
        </section>
        <section className="panel rise delay">
          <h2 className="panel-title">{t.admin.lifecycle}</h2>
          {!readOnly && <LifecycleControls locale={locale} status={ch.status} kind="chapter" disabled={m.busy}
            onChange={async (to) => { await m.run(send("PATCH", base, { status: to, expectedRevision: rev }), t.common.updated); }} />}
        </section>
      </div>
      <section className="panel rise">
        <h2 className="panel-title">{t.admin.lessons}</h2>
        {lessons.length === 0 ? <Empty icon={<FileText size={24} />} title={t.admin.noLessons}
          action={!readOnly ? <Link href={paths.newLesson(locale, c.id, ch.id)} className="btn ghost" data-testid="link-empty-add-lesson">{t.admin.addLesson}</Link> : undefined} /> : (
          <ol className="tree">
            {lessons.map((l) => (
              <li key={l.id} className={`tree-row${l.status === "archived" ? " is-archived" : ""}`} data-testid={`row-lesson-${l.id}`}>
                <ReorderButtons ids={ids} id={l.id} label={l.title} locale={locale} disabled={readOnly || l.status === "archived" || m.busy}
                  onMove={(next) => void m.run(send("PUT", `${base}/lesson-order`, { orderedIds: next, expectedRevision: rev }), t.admin.orderSaved)} />
                <div className="tree-main"><Link href={paths.adminLesson(locale, c.id, ch.id, l.id)} dir="auto" data-testid={`link-lesson-${l.id}`}>{l.title}</Link></div>
                <ReqTag required={l.isRequired} locale={locale} />
                <Badge status={l.status} locale={locale} />
              </li>
            ))}
          </ol>
        )}
      </section>
      <AdminMediaManager locale={locale} scope="chapters" parentId={ch.id} readOnly={readOnly} />
      <Toast text={toast} />
    </div>
  );
}

type LessonDraft = { title: string; body: string; isRequired: boolean };

function LessonForm({ locale, initial, revision, readOnly, busy, submitLabel, requireDirty, onSubmit }: { locale: Locale; initial: LessonDraft; revision: number; readOnly: boolean; busy: boolean; submitLabel: string; requireDirty: boolean; onSubmit: (d: LessonDraft, baseRevision: number) => void | Promise<void> }) {
  const t = getLms(locale);
  const { draft, values: d, dirty, edit } = useDraft(initial, revision);
  const [touched, setTouched] = useState(false);
  const invalid = !d.title.trim();
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!invalid) onSubmit({ ...d, title: d.title.trim() }, draft.revision); }}>
      <Field id="lesson-title" label={t.admin.fTitle} error={touched && invalid ? t.admin.titleRequired : null}>
        <input id="lesson-title" dir="auto" value={d.title} maxLength={200} disabled={readOnly || busy} aria-invalid={touched && invalid} onChange={(e) => edit({ title: e.target.value })} data-testid="input-lesson-title" />
      </Field>
      <Field id="lesson-body" label={t.admin.fBody} help={t.admin.fBodyHelp}>
        <BodyEditor value={d.body} onChange={(body) => edit({ body })} disabled={readOnly || busy} locale={locale} />
      </Field>
      <label className="checkline">
        <input type="checkbox" checked={d.isRequired} disabled={readOnly || busy} onChange={(e) => edit({ isRequired: e.target.checked })} data-testid="checkbox-lesson-required" />
        <span>{t.admin.fRequired}</span>
      </label>
      {!readOnly && <div className="actions"><button className="btn primary" disabled={busy || (requireDirty && !dirty)} data-testid="button-save-lesson">{busy ? t.common.saving : submitLabel}</button></div>}
    </form>
  );
}

export function NewLesson({ locale, courseId, chapterId }: { locale: Locale; courseId: string; chapterId: string }) {
  const t = getLms(locale);
  const router = useRouter();
  const q = useLms<LmsCourse>(`admin/courses/${encodeURIComponent(courseId)}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiFailure | null>(null);
  if (q.loading && !q.data) return <Skeleton rows={4} />;
  if (q.error) return <ErrorState error={q.error} locale={locale} onRetry={q.reload} />;
  const c = q.data!;
  const ch = c.chapters?.find((x) => x.id === chapterId);
  if (!ch) return <ErrorState error={{ status: 404, code: "NOT_FOUND" }} locale={locale} back={{ href: paths.adminCourse(locale, courseId), label: c.title }} />;
  const readOnly = c.status === "archived" || ch.status === "archived";
  return (
    <div className="stack narrow-wide">
      <PageHead back={{ href: paths.adminChapter(locale, c.id, ch.id), label: ch.title }} eyebrow={t.admin.newLessonTitle} title={t.admin.newLessonTitle} lead={t.admin.draftHint} />
      {readOnly && <ReadOnlyNotice locale={locale} />}
      <MutationError error={err} locale={locale} onRefresh={() => { setErr(null); void q.reload(); }} />
      <section className="panel rise">
        <LessonForm locale={locale} initial={{ title: "", body: "", isRequired: true }} revision={c.editRevision} requireDirty={false} readOnly={readOnly} busy={busy} submitLabel={t.admin.saveLesson}
          onSubmit={async (d, baseRevision) => {
            setBusy(true); setErr(null);
            const body: Record<string, unknown> = { title: d.title, isRequired: d.isRequired, expectedRevision: baseRevision };
            if (d.body.trim()) body.body = d.body;
            const r = await lms<LmsLesson>(`admin/chapters/${encodeURIComponent(ch.id)}/lessons`, { method: "POST", body });
            if (!r.ok) { setBusy(false); setErr(r.error); return; }
            router.push(paths.adminLesson(locale, c.id, ch.id, r.data.id));
          }} />
      </section>
    </div>
  );
}

export function LessonEditor({ locale, courseId, chapterId, lessonId }: { locale: Locale; courseId: string; chapterId: string; lessonId: string }) {
  const t = getLms(locale);
  const lq = useLms<LmsLesson>(`admin/lessons/${encodeURIComponent(lessonId)}`);
  const cq = useLms<LmsCourse>(`admin/courses/${encodeURIComponent(courseId)}`);
  const [toast, setToast] = useToast();
  const [reset, setReset] = useState(0);
  const m = useMutator(async () => { await Promise.all([lq.reload(), cq.reload()]); }, setToast);
  if ((lq.loading && !lq.data) || (cq.loading && !cq.data)) return <Skeleton rows={5} />;
  const error = lq.error ?? cq.error;
  if (error) return <ErrorState error={error} locale={locale} onRetry={() => { void lq.reload(); void cq.reload(); }} back={{ href: paths.adminCourse(locale, courseId), label: t.admin.details }} />;
  const l = lq.data!;
  const c = cq.data!;
  const ch = c.chapters?.find((x) => x.id === chapterId);
  if (!ch || l.chapterId !== chapterId) return <ErrorState error={{ status: 404, code: "NOT_FOUND" }} locale={locale} back={{ href: paths.adminCourse(locale, courseId), label: c.title }} />;
  const readOnly = c.status === "archived" || ch.status === "archived" || l.status === "archived";
  const rev = Math.max(c.editRevision, l.editRevision ?? 0);
  const base = `admin/lessons/${encodeURIComponent(l.id)}`;
  const refresh = async () => { m.setError(null); await Promise.all([lq.reload(), cq.reload()]); setReset((n) => n + 1); };
  return (
    <div className="stack narrow-wide">
      <PageHead back={{ href: paths.adminChapter(locale, c.id, ch.id), label: ch.title }} eyebrow={t.admin.lessonTitle} title={l.title}
        actions={<><ReqTag required={l.isRequired} locale={locale} /><Badge status={l.status} locale={locale} /></>} />
      {readOnly && <ReadOnlyNotice locale={locale} />}
      <AdminLessonMedia locale={locale} lessonId={l.id} readOnly={readOnly} />
      <MutationError error={m.error} locale={locale} onRefresh={refresh} />
      {!readOnly && (
        <section className="panel rise">
          <h2 className="panel-title">{t.admin.lifecycle}</h2>
          <LifecycleControls locale={locale} status={l.status} kind="lesson" disabled={m.busy}
            onChange={async (to) => { await m.run(send("PATCH", base, { status: to, expectedRevision: rev }), t.common.updated); }} />
        </section>
      )}
      <section className="panel rise delay">
        <LessonForm key={`${l.id}-${reset}`} locale={locale} initial={{ title: l.title, body: l.body ?? "", isRequired: l.isRequired }} revision={rev} requireDirty readOnly={readOnly} busy={m.busy} submitLabel={t.common.save}
          onSubmit={async (d, baseRevision) => { if ((await m.run(send("PATCH", base, { title: d.title, body: d.body, isRequired: d.isRequired, expectedRevision: baseRevision }), t.common.saved)) !== null) setReset((n) => n + 1); }} />
      </section>
      <AdminMediaManager locale={locale} scope="lessons" parentId={l.id} readOnly={readOnly} />
      <Toast text={toast} />
    </div>
  );
}
