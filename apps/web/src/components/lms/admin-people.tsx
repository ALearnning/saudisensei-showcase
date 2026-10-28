"use client";
import Link from "next/link";
import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import type { LmsCourse, LmsEnrollment, LmsEnrollmentPage, LmsStudent, LmsStudentPage } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { useLms } from "@/lib/lms-client";
import { fmt, paths } from "@/lib/lms-paths";
import { Badge, ConfirmButton, Empty, ErrorState, MutationError, PageHead, Pager, ProgressBar, SearchBox, Skeleton, Toast, formatDate, useToast } from "./ui";
import { send, useMutator } from "./admin-common";

function EnrollmentRows({ locale, rows, show, onChange, busy }: { locale: Locale; rows: LmsEnrollment[]; show: "student" | "course"; busy: boolean; onChange: (e: LmsEnrollment, to: "active" | "revoked") => void | Promise<void> }) {
  const t = getLms(locale);
  return (
    <div className="table enroll" role="table">
      <div className="tr th" role="row">
        <span role="columnheader">{show === "student" ? t.admin.student : t.admin.course}</span>
        <span role="columnheader">{t.common.statusLabel}</span>
        <span role="columnheader">{t.admin.progress}</span>
        <span role="columnheader">{t.common.actions}</span>
      </div>
      {rows.map((e) => (
        <div className="tr" role="row" key={e.id} data-testid={`row-enrollment-${e.id}`}>
          <span role="cell" className="cell-main">
            {show === "student"
              ? <><Link href={paths.adminStudent(locale, e.userId)} dir="auto" data-testid={`link-student-${e.userId}`}>{e.student?.displayName ?? e.userId}</Link>{e.student && <small className="muted"><bdi>{e.student.email}</bdi></small>}</>
              : <><Link href={paths.adminCourse(locale, e.courseId)} dir="auto" data-testid={`link-course-${e.courseId}`}>{e.course?.title ?? e.courseId}</Link>{e.course && <Badge status={e.course.status} locale={locale} />}</>}
            <small className="muted">{t.admin.enrolledAt}: {formatDate(e.enrolledAt, locale)}</small>
          </span>
          <span role="cell" data-label={t.common.statusLabel}><Badge status={e.status} locale={locale} /></span>
          <span role="cell" data-label={t.admin.progress} className="cell-progress">
            {e.progress ? <ProgressBar percentage={e.progress.percentage} isCompleted={e.progress.isCompleted} label={fmt(t.student.progress, { c: e.progress.completedRequired, t: e.progress.totalRequired })} /> : <span className="muted">-</span>}
          </span>
          <span role="cell" className="cell-actions">
            {e.status === "active"
              ? <ConfirmButton locale={locale} label={t.admin.revoke} message={t.admin.revokeConfirm} className="btn danger sm" disabled={busy} testId={`button-revoke-${e.id}`} onConfirm={() => onChange(e, "revoked")} />
              : e.course?.status !== "archived" && <ConfirmButton locale={locale} label={t.admin.reactivate} message={t.admin.reactivateConfirm} className="btn ghost sm" disabled={busy} testId={`button-reactivate-${e.id}`} onConfirm={() => onChange(e, "active")} />}
          </span>
        </div>
      ))}
    </div>
  );
}

function GrantPanel({ locale, onGrant, busy }: { locale: Locale; busy: boolean; onGrant: (s: LmsStudent) => void }) {
  const t = getLms(locale);
  const [search, setSearch] = useState("");
  const q = useLms<LmsStudentPage>(search.length >= 2 ? `admin/students?${new URLSearchParams({ search, pageSize: "8" })}` : null, 60_000, 2);
  return (
    <section className="panel rise">
      <h2 className="panel-title"><UserPlus size={17} aria-hidden="true" />{t.admin.grant}</h2>
      <SearchBox label={t.admin.grantPh} placeholder={t.admin.grantPh} onSearch={setSearch} testId="input-grant-search" />
      {search.length < 2 ? <p className="muted small">{t.admin.minChars}</p> : q.loading && !q.data ? <Skeleton rows={2} /> : q.error ? <ErrorState error={q.error} locale={locale} onRetry={q.reload} /> : q.data && (
        q.data.items.length === 0 ? <p className="muted small">{t.admin.noStudents}</p> : (
          <ul className="pick">
            {q.data.items.map((s) => (
              <li key={s.id}>
                <span><strong dir="auto">{s.displayName}</strong><small className="muted"><bdi>{s.email}</bdi></small></span>
                <button type="button" className="btn primary sm" disabled={busy || s.status !== "active"} onClick={() => onGrant(s)} data-testid={`button-grant-${s.id}`}>{t.admin.grantBtn}</button>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

export function CourseStudents({ locale, courseId }: { locale: Locale; courseId: string }) {
  const t = getLms(locale);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const cq = useLms<LmsCourse>(`admin/courses/${encodeURIComponent(courseId)}`);
  const qs = new URLSearchParams({ courseId, page: String(page), pageSize: "20", ...(status ? { status } : {}) });
  const eq = useLms<LmsEnrollmentPage>(`admin/enrollments?${qs}`);
  const [toast, setToast] = useToast();
  const m = useMutator(async () => { await eq.reload(); }, setToast);
  if (cq.loading && !cq.data) return <Skeleton rows={4} />;
  if (cq.error) return <ErrorState error={cq.error} locale={locale} onRetry={cq.reload} back={{ href: paths.adminCourses(locale), label: t.admin.coursesTitle }} />;
  const c = cq.data!;
  const archived = c.status === "archived";
  return (
    <div className="stack">
      <PageHead back={{ href: paths.adminCourse(locale, c.id), label: c.title }} eyebrow={t.admin.manageStudents} title={t.admin.students} lead={<bdi>{c.title}</bdi>} actions={<Badge status={c.status} locale={locale} />} />
      {archived && <div className="notice warn" data-testid="status-readonly"><p>{t.admin.archivedNotice}</p></div>}
      <MutationError error={m.error} locale={locale} onRefresh={() => { m.setError(null); void eq.reload(); }} />
      <div className="split rev">
        <section className="panel rise">
          <div className="toolbar">
            <div className="seg" role="group" aria-label={t.common.statusLabel}>
              {["", "active", "revoked", "expired"].map((f) => (
                <button key={f || "all"} type="button" aria-pressed={status === f} className={status === f ? "on" : ""} onClick={() => { setStatus(f); setPage(1); }} data-testid={`filter-enrollment-${f || "all"}`}>
                  {f ? (t.status as Record<string, string>)[f] : t.common.all}
                </button>
              ))}
            </div>
          </div>
          {eq.loading && !eq.data ? <Skeleton rows={4} /> : eq.error ? <ErrorState error={eq.error} locale={locale} onRetry={eq.reload} /> : eq.data && (
            eq.data.items.length === 0 ? <Empty icon={<Users size={24} />} title={t.admin.noEnrollments} /> : <>
              <EnrollmentRows locale={locale} rows={eq.data.items} show="student" busy={m.busy}
                onChange={async (e, to) => { await m.run(send("PATCH", `admin/enrollments/${encodeURIComponent(e.id)}`, { status: to }), t.common.updated); }} />
              <Pager page={eq.data.page} pageSize={eq.data.pageSize} total={eq.data.total} onPage={setPage} locale={locale} />
            </>
          )}
        </section>
        {!archived && <GrantPanel locale={locale} busy={m.busy} onGrant={(s) => void m.run(send("POST", "admin/enrollments", { studentId: s.id, courseId: c.id }), t.admin.granted)} />}
      </div>
      <Toast text={toast} />
    </div>
  );
}

export function AdminStudents({ locale }: { locale: Locale }) {
  const t = getLms(locale);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "20", ...(search ? { search } : {}) });
  const q = useLms<LmsStudentPage>(`admin/students?${qs}`);
  return (
    <div className="stack">
      <PageHead eyebrow={t.admin.eyebrow} title={t.admin.studentsTitle} lead={t.admin.studentsLead} />
      <div className="toolbar"><SearchBox label={t.common.search} placeholder={t.admin.grantPh} onSearch={(v) => { setSearch(v); setPage(1); }} /></div>
      {q.loading && !q.data ? <Skeleton rows={5} /> : q.error ? <ErrorState error={q.error} locale={locale} onRetry={q.reload} /> : q.data && (
        q.data.items.length === 0 ? <Empty icon={<Users size={26} />} title={t.admin.noStudents} /> : <>
          <div className="table people" role="table" aria-label={t.admin.studentsTitle}>
            <div className="tr th" role="row"><span role="columnheader">{t.common.name}</span><span role="columnheader">{t.common.email}</span><span role="columnheader">{t.common.statusLabel}</span><span role="columnheader">{t.common.actions}</span></div>
            {q.data.items.map((s) => (
              <div className="tr" role="row" key={s.id} data-testid={`row-student-${s.id}`}>
                <span role="cell" className="cell-main"><Link href={paths.adminStudent(locale, s.id)} dir="auto" data-testid={`link-student-${s.id}`}>{s.displayName}</Link></span>
                <span role="cell" data-label={t.common.email}><bdi>{s.email}</bdi></span>
                <span role="cell" data-label={t.common.statusLabel}><Badge status={s.status} locale={locale} /></span>
                <span role="cell" className="cell-actions"><Link href={paths.adminStudent(locale, s.id)} className="btn ghost sm" data-testid={`link-view-student-${s.id}`}>{t.common.view}</Link></span>
              </div>
            ))}
          </div>
          <Pager page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} locale={locale} />
        </>
      )}
    </div>
  );
}

export function AdminStudent({ locale, studentId }: { locale: Locale; studentId: string }) {
  const t = getLms(locale);
  const sq = useLms<LmsStudent>(`admin/students/${encodeURIComponent(studentId)}`);
  const [page, setPage] = useState(1);
  const eq = useLms<LmsEnrollmentPage>(`admin/enrollments?${new URLSearchParams({ studentId, page: String(page), pageSize: "20" })}`);
  const [toast, setToast] = useToast();
  const m = useMutator(async () => { await eq.reload(); }, setToast);
  if (sq.loading && !sq.data) return <Skeleton rows={4} />;
  if (sq.error) return <ErrorState error={sq.error} locale={locale} onRetry={sq.reload} back={{ href: paths.adminStudents(locale), label: t.admin.studentsTitle }} />;
  const s = sq.data!;
  return (
    <div className="stack">
      <PageHead back={{ href: paths.adminStudents(locale), label: t.admin.studentsTitle }} eyebrow={t.admin.student} title={<span dir="auto">{s.displayName}</span>}
        lead={<bdi>{s.email}</bdi>} actions={<Badge status={s.status} locale={locale} />} />
      <MutationError error={m.error} locale={locale} onRefresh={() => { m.setError(null); void eq.reload(); }} />
      <section className="panel rise">
        <h2 className="panel-title">{t.admin.studentCourses}</h2>
        {eq.loading && !eq.data ? <Skeleton rows={3} /> : eq.error ? <ErrorState error={eq.error} locale={locale} onRetry={eq.reload} /> : eq.data && (
          eq.data.items.length === 0 ? <Empty icon={<Users size={24} />} title={t.admin.noEnrollments} /> : <>
            <EnrollmentRows locale={locale} rows={eq.data.items} show="course" busy={m.busy}
              onChange={async (e, to) => { await m.run(send("PATCH", `admin/enrollments/${encodeURIComponent(e.id)}`, { status: to }), t.common.updated); }} />
            <Pager page={eq.data.page} pageSize={eq.data.pageSize} total={eq.data.total} onPage={setPage} locale={locale} />
          </>
        )}
      </section>
      <Toast text={toast} />
    </div>
  );
}
