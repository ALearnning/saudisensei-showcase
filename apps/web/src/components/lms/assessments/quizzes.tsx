"use client";
import Link from "next/link";
import { useState } from "react";
import type {
  AdminQuizPage,
  LmsCoursePage,
  LmsCourse,
  LmsChapter,
  LmsLesson,
} from "@workspace/saudisensei-api-client";
import { href, quizPath, scopes, selectedLocale, type Scope } from "./model";
import {
  useAssessment,
  useRead,
  Head,
  Panel,
  Field,
  FailureView,
  Skeleton,
  Pager,
  Empty,
  Status,
  label,
} from "./common";
export function useParent(scope: Scope, parent: string) {
  const q = useRead<LmsCourse | LmsChapter | LmsLesson>(
    `admin/${scope}/${parent}`,
  );
  const courseId = q.data
    ? "courseId" in q.data
      ? q.data.courseId
      : q.data.id
    : null;
  const course = useRead<LmsCourse>(
    courseId && scope !== "courses" ? `admin/courses/${courseId}` : null,
  );
  const c =
    scope === "courses" ? (q.data as LmsCourse | undefined) : course.data;
  const chapterId = q.data && "chapterId" in q.data ? q.data.chapterId : null;
  const chapter =
    scope === "lessons" && chapterId
      ? c?.chapters?.find((ch) => ch.id === chapterId)
      : undefined;
  return {
    loading: q.loading || course.loading,
    error: q.error ?? course.error,
    reload: () => {
      q.reload();
      course.reload();
    },
    title: q.data?.title,
    course: c,
    locked:
      !q.data ||
      !c ||
      q.data.status === "archived" ||
      c.status === "archived" ||
      (scope === "lessons" && !chapter) ||
      chapter?.status === "archived",
    breadcrumb: [
      c?.title,
      ...(scope !== "courses" ? [chapter?.title, q.data?.title] : []),
    ]
      .filter(Boolean)
      .join(" / "),
  };
}
export function Quizzes() {
  const { locale, t } = useAssessment();
  const [search, setSearch] = useState(""),
    [input, setInput] = useState(""),
    [coursePage, setCoursePage] = useState(1),
    [courseId, setCourseId] = useState(""),
    [scope, setScope] = useState<Scope>("courses"),
    [chapter, setChapter] = useState(""),
    [lesson, setLesson] = useState(""),
    [page, setPage] = useState(1),
    [filters, setFilters] = useState<Record<string, string>>({});
  const courses = useRead<LmsCoursePage>(
      `admin/courses?page=${coursePage}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
    course = useRead<LmsCourse>(courseId ? `admin/courses/${courseId}` : null);
  const ch = course.data?.chapters?.find((v) => v.id === chapter),
    parent =
      scope === "courses" ? courseId : scope === "chapters" ? chapter : lesson;
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const q = useRead<AdminQuizPage>(
    parent ? `${quizPath(scope, parent)}?${params}` : null,
  );
  const locked =
    !course.data ||
    course.data.status === "archived" ||
    (scope !== "courses" && (!ch || ch.status === "archived")) ||
    (scope === "lessons" &&
      ch?.lessons.find((v) => v.id === lesson)?.status === "archived");
  return (
    <>
      <Head
        title={t("الاختبارات", "Quizzes")}
        lead={t(
          "اختر المقرر والنطاق. تعرض القائمة اختبارات ذلك الموضع فقط.",
          "Choose the course and scope. This list contains only quizzes attached directly to that parent.",
        )}
        actions={
          parent && !locked ? (
            <Link
              className="aa-button primary"
              href={href(locale, `quizzes/${scope}/${parent}/new`)}
            >
              {t("إنشاء اختبار", "Create quiz")}
            </Link>
          ) : undefined
        }
      />
      <Panel>
        <form
          className="aa-actions"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(input.trim());
            setCoursePage(1);
          }}
        >
          <Field
            id="quiz-course-search"
            label={t("البحث عن مقرر", "Find a course")}
          >
            <input
              id="quiz-course-search"
              type="search"
              maxLength={100}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <button>{t("بحث", "Search")}</button>
        </form>
        <FailureView error={courses.error} retry={courses.reload} />
        {courses.loading ? (
          <Skeleton rows={1} />
        ) : (
          courses.data && (
            <>
              <Field id="quiz-course" label={t("المقرر", "Course")}>
                <select
                  id="quiz-course"
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setChapter("");
                    setLesson("");
                    setPage(1);
                  }}
                >
                  <option value="">
                    {t("اختر مقررًا", "Select a course")}
                  </option>
                  {courseId &&
                    !courses.data.items.some((v) => v.id === courseId) && (
                      <option value={courseId}>
                        {course.data?.title ?? courseId}
                      </option>
                    )}
                  {courses.data.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {label(c.status, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Pager {...courses.data} locale={locale} onPage={setCoursePage} />
            </>
          )
        )}
        <FailureView error={course.error} retry={course.reload} />
        <div className="aa-grid">
          <Field id="quiz-scope" label={t("النطاق", "Scope")}>
            <select
              id="quiz-scope"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as Scope);
                setPage(1);
              }}
            >
              {scopes.map((v) => (
                <option value={v} key={v}>
                  {label(v, t)}
                </option>
              ))}
            </select>
          </Field>
          {scope !== "courses" && (
            <Field id="quiz-chapter" label={t("الفصل", "Chapter")}>
              <select
                id="quiz-chapter"
                value={chapter}
                onChange={(e) => {
                  setChapter(e.target.value);
                  setLesson("");
                  setPage(1);
                }}
              >
                <option value="">{t("اختر فصلًا", "Select a chapter")}</option>
                {course.data?.chapters?.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title} · {label(c.status, t)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope === "lessons" && (
            <Field id="quiz-lesson" label={t("الدرس", "Lesson")}>
              <select
                id="quiz-lesson"
                value={lesson}
                onChange={(e) => {
                  setLesson(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t("اختر درسًا", "Select a lesson")}</option>
                {ch?.lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} · {label(l.status, t)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </Panel>
      <div className="aa-filter">
        {(
          [
            [
              "status",
              t("الحالة", "Status"),
              ["draft", "published", "archived"],
            ],
            ["mode", t("النمط", "Mode"), ["practice", "graded"]],
            ["required", t("الإلزام", "Requirement"), ["true", "false"]],
            ["locale", t("اللغة المؤلفة", "Authored language"), ["ar", "en"]],
          ] as [string, string, string[]][]
        ).map(([k, title, values]) => (
          <Field key={k} id={`quiz-filter-${k}`} label={title}>
            <select
              id={`quiz-filter-${k}`}
              value={filters[k] ?? ""}
              onChange={(e) => {
                setFilters({ ...filters, [k]: e.target.value });
                setPage(1);
              }}
            >
              <option value="">{t("الكل", "All")}</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v === "true"
                    ? t("مطلوب", "Required")
                    : v === "false"
                      ? t("اختياري", "Optional")
                      : v === "ar"
                        ? "العربية"
                        : v === "en"
                          ? "English"
                          : label(v, t)}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {q.loading ? (
        <Skeleton rows={3} />
      ) : q.error ? (
        <FailureView error={q.error} retry={q.reload} />
      ) : q.data ? (
        <Panel>
          {q.data.items.map((v) => (
            <div className="aa-row" key={v.id}>
              <div className="aa-row-main">
                <h2 dir="auto">
                  {
                    v.draft.content[
                      selectedLocale(
                        v.draft.content,
                        locale,
                        v.draft.defaultContentLocale,
                      )
                    ]!.title
                  }
                </h2>
                <p>
                  {label(v.draft.policy.mode, t)} ·{" "}
                  {v.draft.policy.required
                    ? t("مطلوب", "Required")
                    : t("اختياري", "Optional")}
                </p>
                <small>
                  {t(
                    "افتح الاختبار لمراجعة حالة المسودة وسجل النشر.",
                    "Open the quiz to inspect draft changes and publication history.",
                  )}
                </small>
              </div>
              <Status value={v.status} />
              <Link
                className="aa-button"
                href={href(locale, `quizzes/${scope}/${parent}/${v.id}`)}
              >
                {t("فتح الاختبار", "Open quiz")}
              </Link>
            </div>
          ))}
          {!q.data.total && (
            <Empty>
              {t(
                "لا اختبارات مطابقة في هذا النطاق.",
                "No matching quizzes in this scope.",
              )}
            </Empty>
          )}
          <Pager {...q.data} locale={locale} onPage={setPage} />
        </Panel>
      ) : (
        <Empty>
          {t(
            "حدد المقرر والموضع للبدء.",
            "Choose a course and parent to begin.",
          )}
        </Empty>
      )}
    </>
  );
}
