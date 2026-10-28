"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  AdminQuestionDetail,
  AdminQuestionPage,
  AdminQuestionRevision,
  AdminQuestionRevisionPage,
  AdminSkillDetail,
  AdminQuizPreviewQuestion,
} from "@workspace/saudisensei-api-client";
import {
  assessmentTimestamp,
  href,
  questionTypes,
  selectedLocale,
  skillPath,
  type PinnedPresentation,
} from "./model";
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
  Modal,
  label,
  Note,
} from "./common";
import { SkillPicker } from "./skills";
import { Markdown } from "../Markdown";
// Display labels only, bounded to this bank view. Eligibility always reads fresh.
function useSkillLabels(ids: string[]) {
  const { api, locale } = useAssessment();
  const [cache] = useState(() => new Map<string, AdminSkillDetail>());
  const [labels, setLabels] = useState<Record<string, string>>({});
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    let live = true;
    void (async () => {
      const resolved: Record<string, string> = {};
      for (const id of key ? key.split(",") : []) {
        let value = cache.get(id);
        if (!value) {
          const r = await api.request<AdminSkillDetail>(`admin/skills/${id}`);
          if (!live) return;
          if (!r.ok) {
            if ([401, 403, 429].includes(r.error.status)) break;
            continue;
          }
          value = r.data;
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(id, value);
        }
        resolved[id] = skillPath(value, locale);
        if (live) setLabels({ ...resolved });
      }
    })();
    return () => {
      live = false;
    };
  }, [api, cache, key, locale]);
  return labels;
}
export function QuestionBank({
  choose,
  onKnownIneligible,
}: {
  choose?: (r: AdminQuestionRevision) => void;
  onKnownIneligible?: (id: string, revision?: string) => void;
}) {
  const { locale, t } = useAssessment();
  const [input, setInput] = useState(""),
    [search, setSearch] = useState(""),
    [filters, setFilters] = useState<Record<string, string>>(
      choose ? { status: "active" } : {},
    ),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [skill, setSkill] = useState<AdminSkillDetail | null>(null),
    [pickSkill, setPickSkill] = useState(false);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    ...(search ? { search } : {}),
    ...(skill ? { primarySkillId: skill.id } : {}),
  });
  const q = useRead<AdminQuestionPage>(
    `admin/question-bank/questions?${params}`,
  );
  useEffect(() => {
    // Reuse the bounded metadata page; do not fetch eligibility for every row.
    q.data?.items
      .filter((item) => item.status === "archived")
      .forEach((item) => onKnownIneligible?.(item.id));
  }, [q.data, onKnownIneligible]);
  const skillLabels = useSkillLabels(
    q.data?.items.flatMap((i) =>
      i.primarySkillId ? [i.primarySkillId] : [],
    ) ?? [],
  );
  const change = (k: string, v: string) => {
    setFilters({ ...filters, [k]: v });
    setPage(1);
    setSelected(null);
  };
  return (
    <>
      {!choose && (
        <Head
          title={t("بنك الأسئلة", "Question Bank")}
          lead={t(
            "مكتبة مشتركة لجميع المقررات. اختر سؤالًا لقراءة محتواه وإصداراته.",
            "A shared library across courses. Select a question to read its content and revisions.",
          )}
          actions={
            <Link
              className="aa-button primary"
              href={href(locale, "question-bank/new")}
            >
              {t("إنشاء سؤال", "Create question")}
            </Link>
          }
        />
      )}
      <form
        className="aa-filter"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(input.trim());
          setPage(1);
          setSelected(null);
        }}
      >
        <Field
          id="bank-search"
          label={t("البحث في نص السؤال", "Search question text")}
        >
          <input
            id="bank-search"
            type="search"
            maxLength={200}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <button>{t("بحث", "Search")}</button>
        <Field id="bank-type" label={t("نوع السؤال", "Question type")}>
          <select
            id="bank-type"
            value={filters.type ?? ""}
            onChange={(e) => change("type", e.target.value)}
          >
            <option value="">{t("الكل", "All")}</option>
            {questionTypes.map((v) => (
              <option key={v} value={v}>
                {label(v, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="bank-status" label={t("الحالة", "Status")}>
          <select
            id="bank-status"
            value={filters.status ?? ""}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">{t("الكل", "All")}</option>
            {["active", "archived"].map((v) => (
              <option key={v} value={v}>
                {label(v, t)}
              </option>
            ))}
          </select>
        </Field>
      </form>
      <details>
        <summary>{t("تصفية إضافية", "More filters")}</summary>
        <div className="aa-grid">
          {(
            [
              [
                "difficulty",
                t("الصعوبة", "Difficulty"),
                ["easy", "medium", "hard"],
              ],
              [
                "cognitiveTag",
                t("الوسم المعرفي", "Cognitive tag"),
                [
                  "concept",
                  "code_tracing",
                  "debugging",
                  "problem_solving",
                  "implementation",
                ],
              ],
              ["locale", t("اللغة المؤلفة", "Authored language"), ["ar", "en"]],
            ] as [string, string, string[]][]
          ).map(([k, title, values]) => (
            <Field key={k} id={`bank-${k}`} label={title}>
              <select
                id={`bank-${k}`}
                value={filters[k] ?? ""}
                onChange={(e) => change(k, e.target.value)}
              >
                <option value="">{t("الكل", "All")}</option>
                {values.map((v) => (
                  <option key={v} value={v}>
                    {v === "ar"
                      ? "العربية"
                      : v === "en"
                        ? "English"
                        : label(v, t)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <div className="field">
            <span>{t("المهارة الأساسية", "Primary skill")}</span>
            <div className="aa-actions">
              <button
                aria-pressed={!skill}
                onClick={() => {
                  setSkill(null);
                  setPage(1);
                }}
              >
                {t("الكل", "All")}
              </button>
              <button onClick={() => setPickSkill(true)}>
                {skill
                  ? skillPath(skill, locale)
                  : t("اختيار مهارة", "Choose skill")}
              </button>
            </div>
          </div>
        </div>
      </details>
      {(search || skill || Object.values(filters).some(Boolean)) && (
        <button
          onClick={() => {
            setInput("");
            setSearch("");
            setFilters({});
            setSkill(null);
            setPage(1);
            setSelected(null);
          }}
        >
          {t("مسح التصفية", "Clear filters")}
        </button>
      )}
      <div className="aa-columns aa-bank">
        <Panel>
          {q.loading ? (
            <Skeleton rows={5} />
          ) : q.error ? (
            <FailureView error={q.error} retry={q.reload} />
          ) : (
            q.data && (
              <>
                {!q.data.items.length ? (
                  <Empty>
                    {search || skill || Object.values(filters).some(Boolean)
                      ? t(
                          "لا نتائج مطابقة. غيّر التصفية أو البحث.",
                          "No matches. Change filters or search.",
                        )
                      : t(
                          "البنك فارغ. أنشئ أول سؤال.",
                          "The bank is empty. Create the first question.",
                        )}
                  </Empty>
                ) : (
                  q.data.items.map((item) => (
                    <button
                      className="aa-bank-row"
                      aria-pressed={selected === item.id}
                      key={item.id}
                      onClick={() => {
                        setSelected(item.id);
                        if (item.status === "archived")
                          onKnownIneligible?.(item.id);
                      }}
                    >
                      <span>
                        <strong>{label(item.type, t)}</strong>
                        <small>
                          <bdi>{item.id.slice(0, 8)}</bdi>
                        </small>
                      </span>
                      <span className="aa-classification">
                        {label(item.difficulty, t)}
                        <small>
                          {t("المهارة", "Skill")}:{" "}
                          <bdi>
                            {item.primarySkillId
                              ? (skillLabels[item.primarySkillId] ??
                                item.primarySkillId.slice(0, 8))
                              : "—"}
                          </bdi>
                        </small>
                      </span>
                      <span>
                        <Status value={item.status} />
                        <small>
                          {item.currentRevisionId
                            ? t("له إصدار مثبّت", "Has sealed revision")
                            : t("مسودة فقط", "Draft only")}{" "}
                          ·{" "}
                          <bdi>
                            {item.locales.map((l) => label(l, t)).join(" / ")}
                          </bdi>
                        </small>
                      </span>
                    </button>
                  ))
                )}
                <Pager
                  {...q.data}
                  locale={locale}
                  onPage={(p) => {
                    setPage(p);
                    setSelected(null);
                  }}
                />
              </>
            )
          )}
        </Panel>
        <Panel>
          {selected ? (
            <BankDetail
              key={selected}
              id={selected}
              choose={choose}
              onKnownIneligible={onKnownIneligible}
            />
          ) : (
            <Empty>
              {t(
                "اختر سؤالًا لعرض التفاصيل.",
                "Select a question for details.",
              )}
            </Empty>
          )}
        </Panel>
      </div>
      {pickSkill && (
        <SkillPicker
          onClose={() => setPickSkill(false)}
          onChoose={(s) => {
            setSkill(s);
            setPage(1);
            setPickSkill(false);
          }}
        />
      )}
    </>
  );
}
function BankDetail({
  id,
  choose,
  onKnownIneligible,
}: {
  id: string;
  choose?: (r: AdminQuestionRevision) => void;
  onKnownIneligible?: (id: string, revision?: string) => void;
}) {
  const { locale, t } = useAssessment();
  const q = useRead<AdminQuestionDetail>(`admin/question-bank/questions/${id}`);
  const [history, setHistory] = useState(!!choose);
  useEffect(() => {
    if (q.data?.status === "archived") onKnownIneligible?.(id);
  }, [q.data, id, onKnownIneligible]);
  if (q.loading) return <Skeleton />;
  if (q.error) return <FailureView error={q.error} retry={q.reload} />;
  if (!q.data) return null;
  const d = q.data,
    l = selectedLocale(d.draft.content, locale, d.draft.defaultContentLocale);
  return (
    <div className="aa-stack">
      <Status value={d.status} />
      {!choose && (
        <>
          <small>{t("محتوى المسودة الحالية", "Current draft content")}</small>
          <div dir={l === "ar" ? "rtl" : "ltr"} lang={l}>
            <Markdown source={d.draft.content[l]!.prompt} />
          </div>
          <p>
            {t("المهارة الأساسية", "Primary skill")}:{" "}
            <SkillPath id={d.draft.primarySkillId} />
          </p>
          <Link
            className="aa-button primary"
            href={href(locale, `question-bank/${id}`)}
          >
            {t("تحرير السؤال", "Edit question")}
          </Link>
        </>
      )}
      {choose && (
        <Note>
          {t(
            "اختر إصدارًا ثم اقرأ محتواه المثبّت قبل الإضافة.",
            "Select a revision and inspect its pinned content before adding it.",
          )}
        </Note>
      )}
      <button onClick={() => setHistory(!history)}>
        {t("الإصدارات المثبّتة", "Sealed revisions")}
      </button>
      {history && (
        <QuestionHistory
          id={id}
          eligible={d.status === "active"}
          choose={choose}
          onKnownIneligible={onKnownIneligible}
        />
      )}
    </div>
  );
}
export function SkillPath({ id }: { id: string | null }) {
  const { locale } = useAssessment();
  const q = useRead<AdminSkillDetail>(id ? `admin/skills/${id}` : null);
  return (
    <span>{q.data ? skillPath(q.data, locale) : <bdi>{id ?? "—"}</bdi>}</span>
  );
}
export function QuestionHistory({
  id,
  eligible = true,
  choose,
  onKnownIneligible,
}: {
  id: string;
  eligible?: boolean;
  choose?: (r: AdminQuestionRevision) => void;
  onKnownIneligible?: (id: string, revision?: string) => void;
}) {
  const { locale, t } = useAssessment();
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState<string | null>(null);
  const q = useRead<AdminQuestionRevisionPage>(
    `admin/question-bank/questions/${id}/revisions?page=${page}&pageSize=10`,
  );
  return (
    <div className="aa-stack">
      {q.loading ? (
        <Skeleton />
      ) : q.error ? (
        <FailureView error={q.error} retry={q.reload} />
      ) : (
        q.data && (
          <>
            {q.data.items.map((r) => (
              <button key={r.id} onClick={() => setRevision(r.id)}>
                {t("الإصدار", "Revision")} {r.number} ·{" "}
                <bdi>{assessmentTimestamp(r.createdAt, locale)}</bdi>
              </button>
            ))}
            {!q.data.total && (
              <Empty>
                {t(
                  "لا إصدار مثبّت بعد. احفظ السؤال ثم ثبّت إصدارًا.",
                  "No sealed revision yet. Save the question, then seal a revision.",
                )}
              </Empty>
            )}
            <Pager {...q.data} locale={locale} onPage={setPage} />
          </>
        )
      )}
      {revision && (
        <RevisionInspector
          id={id}
          revision={revision}
          eligible={eligible}
          onClose={() => setRevision(null)}
          choose={choose}
          onKnownIneligible={onKnownIneligible}
        />
      )}
    </div>
  );
}
export function safeRevision(
  r: AdminQuestionRevision,
  locale: "ar" | "en",
): PinnedPresentation {
  const l = selectedLocale(r.content, locale, r.defaultContentLocale),
    c = r.content[l]!;
  return {
    questionId: r.questionId,
    questionRevisionId: r.id,
    revisionNumber: r.number,
    position: 0,
    points: r.content.defaultPoints,
    type: r.type,
    locale: l,
    prompt: c.prompt,
    ...(c.code
      ? { code: { language: c.code.language, source: c.code.source } }
      : {}),
    ...(c.options
      ? { options: c.options.map((o) => ({ id: o.id, label: o.label })) }
      : {}),
    ...(c.items
      ? { items: c.items.map((o) => ({ id: o.id, label: o.label })) }
      : {}),
  };
}
export function RevisionInspector({
  id,
  revision,
  onClose,
  choose,
  eligible = true,
  onKnownIneligible,
  onLoaded,
}: {
  id: string;
  revision: string;
  onLoaded?: (r: AdminQuestionRevision) => void;
  onClose: () => void;
  choose?: (r: AdminQuestionRevision) => void;
  eligible?: boolean;
  onKnownIneligible?: (id: string, revision?: string) => void;
}) {
  const { locale, t, api } = useAssessment();
  const q = useRead<AdminQuestionRevision>(
    `admin/question-bank/questions/${id}/revisions/${revision}`,
  );
  const [checking, setChecking] = useState(false),
    [ineligible, setIneligible] = useState(!eligible),
    [checked, setChecked] = useState(false),
    [error, setError] = useState<import("./transport").Failure | null>(null);
  useEffect(() => {
    if (q.data?.id === revision && q.data.questionId === id) onLoaded?.(q.data);
  }, [q.data, revision, id, onLoaded]);
  async function check() {
    if (!q.data) return;
    setChecking(true);
    setChecked(false);
    setError(null);
    const question = await api.request<AdminQuestionDetail>(
      `admin/question-bank/questions/${id}`,
    );
    if (!question.ok) {
      setError(question.error);
      setChecking(false);
      return;
    }
    let bad = question.data.status !== "active";
    const ids = [
      ...new Set([
        ...q.data.skillSnapshot.map((s) => s.skillId),
        ...q.data.skillSnapshot.flatMap((s) => s.path.map((p) => p.skillId)),
      ]),
    ];
    const verified = new Set<string>();
    for (const sid of ids) {
      if (bad) break;
      if (verified.has(sid)) continue;
      const r = await api.request<AdminSkillDetail>(`admin/skills/${sid}`);
      if (!r.ok) {
        setError(r.error);
        setChecking(false);
        return;
      }
      bad =
        r.data.status !== "active" ||
        r.data.ancestors.some((a) => a.status !== "active");
      verified.add(r.data.id);
      r.data.ancestors.forEach((a) => verified.add(a.id));
    }
    setChecking(false);
    setChecked(true);
    setIneligible(bad);
    if (bad) onKnownIneligible?.(id, revision);
  }
  return (
    <Modal
      title={t("فحص إصدار سؤال ثابت", "Inspect pinned question revision")}
      onClose={onClose}
      busy={checking}
      action={
        choose && checked && !ineligible
          ? t("إضافة هذا الإصدار", "Add this revision")
          : undefined
      }
      onConfirm={() => {
        if (q.data && choose) {
          choose(q.data);
          onClose();
        }
      }}
    >
      {q.loading ? (
        <Skeleton />
      ) : q.error ? (
        <FailureView error={q.error} retry={q.reload} />
      ) : (
        q.data && (
          <>
            <p>
              {t("الإصدار", "Revision")} {q.data.number} · <bdi>{revision}</bdi>
            </p>
            <Presentation question={safeRevision(q.data, locale)} />
            <p>
              {t("النقاط الافتراضية", "Default points")}:{" "}
              {q.data.content.defaultPoints}
            </p>
            <Note>
              {t(
                "هذا محتوى الإصدار المختار؛ تحرير المسودة لا يغيره.",
                "This is the selected revision. Draft edits do not change it.",
              )}
            </Note>
            <FailureView error={error} />
            {ineligible && (
              <Note error>
                {t(
                  "غير مؤهل — أزل السؤال أو استبدله. يبقى التاريخ محفوظًا.",
                  "Ineligible — remove or replace. History remains preserved.",
                )}
              </Note>
            )}
            <button disabled={checking} onClick={() => void check()}>
              {checking
                ? t("جارٍ فحص الأهلية…", "Checking eligibility…")
                : t(
                    "فحص أهلية السؤال والمهارات",
                    "Check question and skill eligibility",
                  )}
            </button>
            {checked && !ineligible && (
              <small>
                {t(
                  "مؤهل عند الفحص؛ يعيد الخادم التحقق عند الحفظ والنشر.",
                  "Eligible when checked; the server revalidates at save and publication.",
                )}
              </small>
            )}
          </>
        )
      )}
    </Modal>
  );
}
export function Presentation({
  question: q,
}: {
  question: AdminQuizPreviewQuestion;
}) {
  const { t } = useAssessment();
  return (
    <div
      dir={q.locale === "ar" ? "rtl" : "ltr"}
      lang={q.locale}
      className="aa-stack"
    >
      <small>
        <bdi>{label(q.locale, t)}</bdi>
      </small>
      <Markdown source={q.prompt} />
      {q.code && (
        <pre className="aa-pre">
          <code>{q.code.source}</code>
        </pre>
      )}
      {(q.options ?? q.items ?? []).map((o) => (
        <div className="aa-panel" key={o.id}>
          <Markdown source={o.label} />
        </div>
      ))}
    </div>
  );
}
