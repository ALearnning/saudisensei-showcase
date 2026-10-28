"use client";
import {
  invalidAcknowledgement,
  isReleaseReceipt,
  isReleaseStatus,
} from "./acknowledgements";
import { useEffect, useRef, useState } from "react";
import type {
  AdminQuizSafePreview,
  AdminQuizAnswerPreview,
  AdminQuestionGradingDefinition,
  AdminQuizPreviewQuestion,
  AdminQuizRevision,
  AdminQuizRevisionPage,
  AdminQuizReviewRelease,
} from "@workspace/saudisensei-api-client";
import {
  useAssessment,
  useRead,
  useAction,
  Panel,
  Field,
  Note,
  Modal,
  FailureView,
  Skeleton,
  Pager,
  Empty,
} from "./common";
import type { Failure } from "./transport";
import { Presentation, RevisionInspector } from "./bank";
import { PolicySummary } from "./policy";
import { assessmentTimestamp, selectedLocale, type Locale } from "./model";
import { Markdown } from "../Markdown";
export function SavedPreview({
  data,
  base,
  blocked,
}: {
  data?: AdminQuizSafePreview;
  base: string;
  blocked: boolean;
}) {
  const { t } = useAssessment();
  const [privateMode, setPrivateMode] = useState(false);
  useEffect(
    () => setPrivateMode(false),
    [blocked, data?.editRevision, data?.requestedLocale],
  );
  return (
    <Panel title={t("معاينة المسودة المحفوظة", "Preview saved draft")}>
      <div className="aa-actions">
        <button
          disabled={blocked}
          aria-pressed={!privateMode}
          onClick={() => setPrivateMode(false)}
        >
          {t("عرض آمن للطالب", "Student-safe preview")}
        </button>
        <button
          disabled={blocked}
          aria-pressed={privateMode}
          onClick={() => setPrivateMode(true)}
        >
          {t("إجابات المشرف — خاصة", "Admin answers — private")}
        </button>
      </div>
      {blocked ? (
        <Note>
          {t(
            "المعاينة والنشر متوقفان حتى تُحفظ جميع الأقسام وتُحل التعارضات والأخطاء.",
            "Preview and publication are blocked until all sections are saved and conflicts/errors resolved.",
          )}
        </Note>
      ) : !data ? (
        <Empty>
          {t(
            "المعاينة غير متاحة. احفظ أسئلة صحيحة وأعد تحميل العرض.",
            "Preview is unavailable. Save valid questions and reload the presentation.",
          )}
        </Empty>
      ) : privateMode ? (
        <PrivatePreview
          key={`${data.editRevision}-${data.requestedLocale}`}
          data={data}
          base={base}
        />
      ) : (
        <>
          <Note>
            {t(
              "لا مفاتيح إجابة ولا تفسيرات. معاينة تأليف فقط؛ لا محاولة أو مؤقت أو تصحيح أو خلط.",
              "No answer keys or explanations. Authoring preview only: no attempt, timer, grading or shuffle.",
            )}
          </Note>
          <div lang={data.locale} dir={data.locale === "ar" ? "rtl" : "ltr"}>
            <h3>{data.title}</h3>
            <Markdown source={data.instructions} />
          </div>
          {data.questions.map((q) => (
            <Panel key={q.questionRevisionId}>
              <p>
                {t("السؤال", "Question")} {q.position + 1} · {q.points}{" "}
                {t("نقطة", "points")}
              </p>
              <Presentation question={q} />
            </Panel>
          ))}
        </>
      )}
    </Panel>
  );
}
function PrivatePreview({
  data,
  base,
}: {
  data: AdminQuizSafePreview;
  base: string;
}) {
  const { api, t } = useAssessment();
  const [answers, setAnswers] = useState<AdminQuizAnswerPreview | null>(null),
    [error, setError] = useState<Failure | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setAnswers(null);
    setError(null);
    void api
      .request<AdminQuizAnswerPreview>(`${base}/answer-preview`, "POST", {
        expectedRevision: data.editRevision,
        locale: data.requestedLocale,
      })
      .then((r) => {
        if (!live) return;
        if (!r.ok) setError(r.error);
        else if (
          r.data.editRevision === data.editRevision &&
          r.data.quizId === data.quizId
        )
          setAnswers(r.data);
        else setError({ status: 409, code: "QUIZ_CHANGED" });
      });
    return () => {
      live = false;
    };
  }, [api, base, data.editRevision, data.requestedLocale, data.quizId, retry]);
  return (
    <div className="aa-stack">
      <Note>
        <strong>
          {t(
            "خاص بالمشرف — مفاتيح الإجابة والتفسيرات",
            "PRIVATE — ADMIN ANSWER KEYS AND EXPLANATIONS",
          )}
        </strong>
        <p>
          {t(
            "لا تستخدم هذا العرض في أي سطح مخصص للطالب.",
            "Do not use this view on a Student-facing surface.",
          )}
        </p>
      </Note>
      {error ? (
        <FailureView error={error} retry={() => setRetry((n) => n + 1)} />
      ) : !answers ? (
        <Skeleton />
      ) : (
        data.questions.map((q) => {
          const a = answers.questions.find(
            (v) =>
              v.questionRevisionId === q.questionRevisionId &&
              v.position === q.position &&
              v.locale === q.locale,
          );
          return (
            <Panel key={q.questionRevisionId} className="aa-private">
              <Presentation question={q} />
              {a && (
                <>
                  <AnswerKey definition={a.gradingDefinition} question={q} />
                  {a.explanation !== null && (
                    <>
                      <h3>{t("التفسير", "Explanation")}</h3>
                      <Markdown source={a.explanation} />
                    </>
                  )}
                </>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
export function AnswerKey({
  definition: g,
  question: q,
}: {
  definition: AdminQuestionGradingDefinition;
  question: AdminQuizPreviewQuestion;
}) {
  const { t } = useAssessment();
  const name = (id: string) =>
    (q.options ?? q.items ?? []).find((o) => o.id === id)?.label ?? id;
  return (
    <div data-private-answer="true">
      <h3>{t("مفتاح الإجابة — خاص بالمشرف", "Answer key — Admin only")}</h3>
      {g.type === "single_choice" ? (
        <p dir="auto">{name(g.correctOptionId)}</p>
      ) : g.type === "multiple_choice" ? (
        <ul>
          {g.correctOptionIds.map((id) => (
            <li dir="auto" key={id}>
              {name(id)}
            </li>
          ))}
        </ul>
      ) : g.type === "ordering" ? (
        <ol>
          {g.correctOrderedItemIds.map((id) => (
            <li dir="auto" key={id}>
              {name(id)}
            </li>
          ))}
        </ol>
      ) : g.type === "true_false" ? (
        <p>{g.correctValue ? t("صح", "True") : t("خطأ", "False")}</p>
      ) : (
        <ul>
          {g.acceptedByLocale[q.locale]?.map((v, i) => (
            <li key={i}>
              <pre
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                dir={q.locale === "ar" ? "rtl" : "ltr"}
              >
                {v}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function ReleaseConfirmation({
  revision,
  onClose,
  onConfirm,
  busy,
  scopeLabel,
}: {
  revision: AdminQuizRevision;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  scopeLabel: string;
}) {
  const { locale, t } = useAssessment();
  const l = selectedLocale(
    revision.content,
    locale,
    revision.defaultContentLocale,
  );
  return (
    <Modal
      title={t(
        `إتاحة الإصدار ${revision.number} يدويًا؟`,
        `Manually release revision ${revision.number}?`,
      )}
      onClose={onClose}
      onConfirm={onConfirm}
      action={t(
        `إتاحة الإصدار ${revision.number}`,
        `Release revision ${revision.number}`,
      )}
      danger
      busy={busy}
    >
      <strong dir="auto">{revision.content[l]!.title}</strong>
      <p>{scopeLabel}</p>
      <p>
        {t("الإصدار المحدد فقط", "Selected revision only")}: {revision.number} ·{" "}
        <bdi>{revision.id}</bdi>
      </p>
      <PolicySummary policy={revision.policy} />
      <Note>
        <strong>{t("إجراء لا يمكن التراجع عنه", "Cannot be undone")}</strong>
        <p>
          {t(
            "تنطبق الإتاحة على جميع المحاولات المؤهلة المرتبطة بهذا الإصدار بعينه، لا على طالب واحد.",
            "Release applies to all eligible attempts pinned to this exact revision, not to an individual Student.",
          )}
        </p>
        <p>
          {t(
            "قد تصبح الإجابات الصحيحة والتفسيرات متاحة وفق السياسات المعروضة. قد يكون لدى الطلاب محاولات متبقية أو محاولة قيد التنفيذ؛ الإتاحة اليدوية لا تمنع ذلك بذاتها.",
            "Correct answers and explanations may become visible according to the policies shown. Students may still have remaining attempts or an active attempt; manual release does not inherently block release on that basis.",
          )}
        </p>
        <p>
          {t(
            "تظل بوابات الدرجة ثم المراجعة ثم التفسير وشروط الوصول والتصحيح سارية. لا تتغير الدرجات ولا يُتاح إصدار آخر.",
            "Score, review and explanation prerequisites, access and grading gates still apply. Grades do not change; no other revision is released.",
          )}
        </p>
      </Note>
    </Modal>
  );
}
export function RevisionHistory({
  base,
  currentId,
  published,
  locked,
  scopeLabel,
  refresh = 0,
}: {
  base: string;
  currentId: string | null;
  published: boolean;
  locked: boolean;
  scopeLabel: string;
  refresh?: number;
}) {
  const { locale, t, api } = useAssessment();
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(currentId),
    [receipt, setReceipt] = useState<Record<string, AdminQuizReviewRelease>>(
      {},
    ),
    [uncertainReleases, setUncertainReleases] = useState(new Set<string>()),
    [checking, setChecking] = useState(false),
    [confirm, setConfirm] = useState(false),
    [inspect, setInspect] = useState<{ id: string; revision: string } | null>(
      null,
    );
  const history = useRead<AdminQuizRevisionPage>(
      `${base}/revisions?page=${page}&pageSize=10`,
      refresh,
    ),
    q = useRead<AdminQuizRevision>(
      selected ? `${base}/revisions/${selected}` : null,
      refresh,
    ),
    m = useAction();
  const mutationIds = useRef(new Map<string, string>());
  const r = q.data,
    release = r ? (receipt[r.id] ?? r.reviewRelease) : null;
  const applicable =
    r &&
    [
      r.policy.scoreVisibility,
      r.policy.reviewVisibility,
      r.policy.explanationVisibility,
    ].includes("manual_release");
  return (
    <div className="aa-stack">
      <Panel title={t("سجل الإصدارات المنشورة", "Published revision history")}>
        <small>
          {t(
            "هذا سجل تاريخي مستقل؛ المعاينة الأخرى تعرض المسودة المحفوظة فقط.",
            "This is separate historical data; the other preview shows the saved draft only.",
          )}
        </small>
        {history.loading ? (
          <Skeleton />
        ) : history.error ? (
          <FailureView error={history.error} retry={history.reload} />
        ) : (
          history.data && (
            <>
              {history.data.items.map((v) => (
                <button
                  className="aa-row"
                  aria-pressed={selected === v.id}
                  key={v.id}
                  onClick={() => {
                    setSelected(v.id);
                    setConfirm(false);
                    m.setError(null);
                  }}
                >
                  <strong>
                    {t("الإصدار", "Revision")} {v.number}
                  </strong>
                  <span>
                    {v.id === currentId
                      ? published
                        ? t("منشور حاليًا", "Currently published")
                        : t(
                            "آخر إصدار قبل الأرشفة — تاريخي",
                            "Last revision before archive — historical",
                          )
                      : t("تاريخي", "Historical")}
                  </span>
                  <small>
                    <bdi>{assessmentTimestamp(v.createdAt, locale)}</bdi> ·{" "}
                    {v.totalPoints}
                  </small>
                </button>
              ))}
              {!history.data.total && (
                <Empty>
                  {t(
                    "لم يُنشر أي إصدار بعد.",
                    "No revision has been published yet.",
                  )}
                </Empty>
              )}
              <Pager {...history.data} locale={locale} onPage={setPage} />
            </>
          )
        )}
      </Panel>
      {q.loading ? (
        <Skeleton />
      ) : q.error ? (
        <FailureView error={q.error} retry={q.reload} />
      ) : (
        r && (
          <Panel
            title={t(
              `تفاصيل الإصدار ${r.number}`,
              `Revision ${r.number} details`,
            )}
          >
            <p dir="auto">
              {
                r.content[
                  selectedLocale(r.content, locale, r.defaultContentLocale)
                ]!.title
              }
            </p>
            <bdi>{r.id}</bdi>
            <PolicySummary policy={r.policy} />
            <details>
              <summary>
                {t("أسئلة الإصدار التاريخية", "Historical revision questions")}{" "}
                · {r.items.length}
              </summary>
              {r.items.map((i) => (
                <div className="aa-row" key={i.questionRevisionId}>
                  <span>
                    {i.position + 1}.{" "}
                    <bdi>{i.questionRevisionId.slice(0, 8)}</bdi> · {i.points}{" "}
                    {t("نقطة", "points")}
                  </span>
                  <button
                    onClick={() =>
                      setInspect({
                        id: i.questionId,
                        revision: i.questionRevisionId,
                      })
                    }
                  >
                    {t("فحص الإصدار الثابت", "Inspect pinned revision")}
                  </button>
                </div>
              ))}
            </details>
            <FailureView error={m.error} />
            {uncertainReleases.has(r.id) && (
              <Note error>
                {t(
                  "قد تكون الإتاحة اكتملت. تحقق من حالة هذا الإصدار قبل إعادة المحاولة يدويًا؛ لا توجد إعادة تلقائية.",
                  "Release may have completed. Check this revision's status before a manual retry; there is no automatic retry.",
                )}
                <button
                  disabled={checking || m.busy}
                  onClick={() => {
                    setChecking(true);
                    void api
                      .request<unknown>(`${base}/revisions/${r.id}`)
                      .then((result) => {
                        setChecking(false);
                        if (!result.ok) {
                          m.setError(result.error);
                          return;
                        }
                        if (!isReleaseStatus(result.data, r.id)) {
                          m.setError(invalidAcknowledgement);
                          return;
                        }
                        if (result.data.reviewRelease) {
                          const receipt = result.data.reviewRelease;
                          setReceipt((s) => ({ ...s, [r.id]: receipt }));
                        }
                        setUncertainReleases((s) => {
                          const next = new Set(s);
                          next.delete(r.id);
                          return next;
                        });
                        m.setError(null);
                      });
                  }}
                >
                  {t("التحقق من حالة الإتاحة", "Check release status")}
                </button>
              </Note>
            )}
            {release ? (
              <Note>
                {t(
                  "أُتيح هذا الإصدار مسبقًا",
                  "This revision is already released",
                )}{" "}
                · <bdi>{assessmentTimestamp(release.releasedAt, locale)}</bdi>
              </Note>
            ) : !applicable ? (
              <Note>
                {t(
                  "الإتاحة اليدوية لا تنطبق: لا حقل يستخدمها في هذا الإصدار.",
                  "Manual release is not applicable: no field uses it in this revision.",
                )}
              </Note>
            ) : (
              <button
                className="primary"
                disabled={
                  locked || m.busy || checking || uncertainReleases.has(r.id)
                }
                onClick={() => setConfirm(true)}
              >
                {t(`إتاحة الإصدار ${r.number}`, `Release revision ${r.number}`)}
              </button>
            )}
            {locked && (
              <Note>
                {t(
                  "النطاق أو الاختبار للقراءة فقط؛ الإتاحة غير متاحة.",
                  "The scope or quiz is read only; release is unavailable.",
                )}
              </Note>
            )}
          </Panel>
        )
      )}
      {confirm && r && (
        <ReleaseConfirmation
          revision={r}
          scopeLabel={scopeLabel}
          busy={m.busy}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            if (uncertainReleases.has(r.id) || checking) return;
            const id = mutationIds.current.get(r.id) ?? crypto.randomUUID();
            mutationIds.current.set(r.id, id);
            void m
              .runResult<unknown>(
                `${base}/revisions/${r.id}/review-release`,
                "POST",
                { clientMutationId: id },
              )
              .then((result) => {
                if (!result) return;
                if (result.ok && isReleaseReceipt(result.data, r.id)) {
                  const value = result.data;
                  setReceipt((s) => ({ ...s, [r.id]: value }));
                } else if (
                  result.ok ||
                  result.error.status === 0 ||
                  result.error.status >= 500
                ) {
                  if (result.ok) m.setError(invalidAcknowledgement);
                  setUncertainReleases((s) => new Set([...s, r.id]));
                }
                setConfirm(false);
              });
          }}
        />
      )}
      {inspect && (
        <RevisionInspector {...inspect} onClose={() => setInspect(null)} />
      )}
    </div>
  );
}
