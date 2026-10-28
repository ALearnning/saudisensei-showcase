"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminQuizDetail,
  AdminQuizDraft,
  AdminQuestionRevision,
  AdminQuizSafePreview,
  AdminQuizRevision,
  AdminQuizRevisionPage,
} from "@workspace/saudisensei-api-client";
import {
  acknowledge,
  defaultPolicy,
  dirtySections,
  draftDiffers,
  href,
  itemsValid,
  moveItem,
  mergePinnedPresentations,
  type PinnedPresentation,
  policyIssues,
  positioned,
  publicationState,
  quizBlocked,
  quizInfoValid,
  quizPath,
  quizState,
  saveBody,
  selectedLocale,
  type Locale,
  type QuizState,
  type Scope,
} from "./model";
import {
  useAssessment,
  useRead,
  useAction,
  useLeaving,
  Head,
  Panel,
  Field,
  FailureView,
  Skeleton,
  Modal,
  Note,
  Move,
  Status,
  label,
  Empty,
  uncertain,
  UncertainCreate,
} from "./common";
import { useParent } from "./quizzes";
import { PolicyFields, PolicySummary, QuizInfo } from "./policy";
import { QuestionBank, RevisionInspector, safeRevision } from "./bank";
import { RevisionHistory, SavedPreview } from "./review";
import { writeFailureKind, type Failure } from "./transport";
import {
  invalidAcknowledgement as invalidResponse,
  isCreatedQuiz,
  isPublishedQuiz,
} from "./acknowledgements";
import { isQuizDetailResponse } from "./quiz-response";
export function QuizEditor({
  id,
  scope,
  parent,
}: {
  id: string;
  scope: Scope;
  parent: string;
}) {
  const { t } = useAssessment();
  const q = useRead<AdminQuizDetail>(
    id !== "new" ? quizPath(scope, parent, id) : null,
  );
  const context = useParent(scope, parent);
  if (q.loading || context.loading) return <Skeleton rows={4} />;
  if (q.error || context.error)
    return (
      <FailureView
        error={q.error ?? context.error}
        retry={() => {
          q.reload();
          context.reload();
        }}
      />
    );
  return (
    <>
      <div className="aa-trail">
        <span>{context.breadcrumb}</span>
        <span> / {label(scope, t)}</span>
        <bdi>{parent}</bdi>
      </div>
      {id === "new" ? (
        <NewQuiz
          scope={scope}
          parent={parent}
          locked={context.locked}
          scopeLabel={context.breadcrumb}
        />
      ) : q.data ? (
        <Builder
          initial={q.data}
          base={quizPath(scope, parent, id)}
          lockedParent={context.locked}
          scopeLabel={context.breadcrumb}
        />
      ) : null}
    </>
  );
}
function NewQuiz({
  scope,
  parent,
  locked,
  scopeLabel,
}: {
  scope: Scope;
  parent: string;
  locked: boolean;
  scopeLabel: string;
}) {
  const { locale, t } = useAssessment(),
    m = useAction(),
    router = useRouter();
  const [draft, setDraft] = useState<AdminQuizDraft>({
      content: { [locale]: { title: "", instructions: "" } },
      defaultContentLocale: locale,
      policy: defaultPolicy(),
    }),
    [confirm, setConfirm] = useState(false);
  useLeaving(
    Object.values(draft.content).some((c) => !!c?.title || !!c?.instructions),
  );
  const createUncertain = uncertain(m.error);
  const valid = quizInfoValid(draft) && policyIssues(draft.policy).length === 0;
  return (
    <>
      <Head title={t("اختبار جديد", "New quiz")} lead={scopeLabel} />
      <Note>
        {t(
          "الموضع ثابت منذ الإنشاء. لا نقل بين المقررات أو الفصول أو الدروس.",
          "Attachment is fixed from creation. Quizzes cannot be moved between courses, chapters or lessons.",
        )}
      </Note>
      <FailureView error={m.error} />
      {createUncertain && <UncertainCreate />}
      <Panel title={t("معلومات الاختبار", "Quiz information")}>
        <QuizInfo
          value={draft}
          onChange={(info) => setDraft({ ...draft, ...info })}
          disabled={locked || m.busy}
        />
        <Field id="new-quiz-mode" label={t("النمط الابتدائي", "Initial mode")}>
          <select
            id="new-quiz-mode"
            disabled={locked || m.busy}
            value={draft.policy.mode}
            onChange={(e) =>
              setDraft({
                ...draft,
                policy: defaultPolicy(e.target.value as "practice" | "graded"),
              })
            }
          >
            <option value="graded">{t("مقيّم", "Graded")}</option>
            <option value="practice">{t("تدريب", "Practice")}</option>
          </select>
        </Field>
        <p>
          {t(
            "يمكن ضبط السياسة بعد الإنشاء. إنشاء المسودة لا ينشرها.",
            "Policy can be adjusted after creation. Creating a draft does not publish it.",
          )}
        </p>
        <button
          disabled={!valid || locked || m.busy || createUncertain}
          className="primary"
          onClick={() => setConfirm(true)}
        >
          {t("إنشاء المسودة", "Create draft")}
        </button>
      </Panel>
      {confirm && (
        <Modal
          title={t(
            "إنشاء اختبار في هذا الموضع؟",
            "Create quiz at this parent?",
          )}
          onClose={() => setConfirm(false)}
          action={t("إنشاء", "Create")}
          busy={m.busy}
          onConfirm={() => {
            void m
              .run<unknown>(quizPath(scope, parent), "POST", { draft })
              .then((r) => {
                setConfirm(false);
                if (r) {
                  if (isCreatedQuiz(r, scope, parent))
                    router.replace(
                      href(locale, `quizzes/${scope}/${parent}/${r.id}`),
                    );
                  else m.setError(invalidResponse);
                }
              });
          }}
        >
          <p>{scopeLabel}</p>
          <bdi>{parent}</bdi>
          <p>{draft.content[draft.defaultContentLocale]!.title}</p>
        </Modal>
      )}
    </>
  );
}
export function Builder({
  initial,
  base,
  lockedParent,
  scopeLabel,
}: {
  initial: AdminQuizDetail;
  base: string;
  lockedParent: boolean;
  scopeLabel: string;
}) {
  const { locale, t, api } = useAssessment(),
    m = useAction();
  const [s, setS] = useState<QuizState>(() => quizState(initial)),
    [cooldown, setCooldown] = useState(0),
    [tab, setTab] = useState<"content" | "policy" | "review">("content"),
    [picker, setPicker] = useState(false),
    [inspect, setInspect] = useState<{ id: string; revision: string } | null>(
      null,
    ),
    [ineligible, setIneligible] = useState<Set<string>>(new Set()),
    [presentations, setPresentations] = useState<
      Record<string, PinnedPresentation>
    >({}),
    [safe, setSafe] = useState<AdminQuizSafePreview>(),
    [previewError, setPreviewError] = useState<Failure | null>(null),
    [previewPending, setPreviewPending] = useState(false),
    [previewLocale, setPreviewLocale] = useState<Locale>(locale),
    [previewTick, setPreviewTick] = useState(0),
    [historyTick, setHistoryTick] = useState(0),
    [confirmation, setConfirmation] = useState<
      "publish" | "unpublish" | "archive" | "reload" | null
    >(null),
    [fresh, setFresh] = useState<AdminQuizDetail | null>(null),
    [publishFailure, setPublishFailure] = useState<
      "rejected" | "uncertain" | "throttled" | null
    >(null);
  const publicationSummary = useRef<HTMLDivElement>(null);
  const publicationFocus = useRef<HTMLElement | null>(null);
  const stateRef = useRef(s);
  stateRef.current = s;
  const history = useRead<AdminQuizRevisionPage>(
      `${base}/revisions?page=1&pageSize=10`,
      historyTick,
    ),
    current = useRead<AdminQuizRevision>(
      s.ack.currentRevisionId
        ? `${base}/revisions/${s.ack.currentRevisionId}`
        : null,
      historyTick,
    );
  const dirty = dirtySections(s),
    hasDirty = Object.values(dirty).some(Boolean),
    locked = lockedParent || s.ack.status === "archived",
    blocked = quizBlocked(s) || ineligible.size > 0 || locked;
  useLeaving(hasDirty);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const seconds = api.retryAfter();
      setCooldown(seconds);
      // Local display only: never poll the server or retry a write automatically.
      if (seconds > 0) timer = setTimeout(update, 1000);
    };
    update();
    return () => clearTimeout(timer);
  }, [api, m.error]);
  useEffect(() => {
    let live = true;
    setSafe(undefined);
    setPreviewError(null);
    const q = s.ack;
    if (
      !q.items.length ||
      policyIssues(q.draft.policy).length ||
      !quizInfoValid(q.draft)
    ) {
      setPreviewPending(false);
      return;
    }
    setPreviewPending(true);
    void api
      .request<AdminQuizSafePreview>(`${base}/preview`, "POST", {
        expectedRevision: q.editRevision,
        locale: previewLocale,
      })
      .then((r) => {
        if (!live) return;
        setPreviewPending(false);
        if (!r.ok) {
          setPreviewError(r.error);
          if (r.error.status === 409) setS((v) => ({ ...v, conflict: true }));
          return;
        }
        if (r.data.editRevision !== q.editRevision || r.data.quizId !== q.id) {
          setPreviewError({ status: 409, code: "QUIZ_CHANGED" });
          return;
        }
        setSafe(r.data);
        setPresentations((v) =>
          mergePinnedPresentations(v, r.data.questions, stateRef.current.items),
        );
      });
    return () => {
      live = false;
    };
  }, [api, base, s.ack.editRevision, s.ack.id, previewLocale, previewTick]);
  const markIneligible = useCallback((id: string, revision?: string) => {
    const affected = stateRef.current.items.filter(
      (item) =>
        item.questionId === id &&
        (!revision || item.questionRevisionId === revision),
    );
    setIneligible((previous) => {
      if (affected.every((item) => previous.has(item.questionRevisionId)))
        return previous;
      return new Set([
        ...previous,
        ...affected.map((item) => item.questionRevisionId),
      ]);
    });
  }, []);
  const rememberRevision = useCallback(
    (revision: AdminQuestionRevision) => {
      setPresentations((v) =>
        mergePinnedPresentations(
          v,
          [safeRevision(revision, previewLocale)],
          stateRef.current.items,
        ),
      );
    },
    [previewLocale],
  );
  useEffect(() => {
    setPresentations((v) => mergePinnedPresentations(v, [], s.items));
  }, [s.items]);
  function invalidAcknowledgement() {
    m.setError({ status: 502, code: "INVALID_RESPONSE" });
    setFresh(null);
    setConfirmation(null);
    setS((v) => ({ ...v, pending: false, conflict: true }));
  }
  async function save(section: "info" | "policy" | "items") {
    if (s.pending || s.conflict || locked) return;
    const body = saveBody(s, section);
    setS((v) => ({ ...v, pending: true }));
    const r = await m.runResult<unknown>(
      section === "items" ? `${base}/items` : base,
      section === "items" ? "PUT" : "PATCH",
      body,
    );
    if (!r) return; // Another section write is already pending; let it finish.
    if (r.ok) {
      const saved = r.data;
      if (!isQuizDetailResponse(saved, s.ack, body.expectedRevision + 1)) {
        invalidAcknowledgement();
        return;
      }
      setS((v) => acknowledge(v, saved, section));
      setPublishFailure(null);
      m.setMessage(
        t(
          "حُفظ القسم؛ الأقسام الأخرى تحتفظ بتغييراتها.",
          "Section saved; other sections retain their edits.",
        ),
      );
    } else {
      const kind = writeFailureKind(r.error);
      setS((v) => ({
        ...v,
        pending: false,
        conflict: v.conflict || kind === "conflict" || kind === "uncertain",
      }));
    }
  }
  async function loadCurrent() {
    const r = await api.request<unknown>(base);
    if (r.ok) {
      if (!isQuizDetailResponse(r.data, stateRef.current.ack)) {
        invalidAcknowledgement();
        return;
      }
      setFresh(r.data);
      setConfirmation("reload");
    } else m.setError(r.error);
  }
  async function lifecycle(action: "publish" | "unpublish" | "archive") {
    if (
      action === "publish" &&
      (quizBlocked(stateRef.current) ||
        locked ||
        ineligible.size ||
        cooldown > 0)
    )
      return;
    publicationFocus.current =
      action === "publish" ? publicationSummary.current : null;
    setS((v) => ({ ...v, pending: true }));
    setPublishFailure(null);
    m.setMessage("");
    const r = await api.request<unknown>(`${base}/${action}`, "POST", {
      expectedRevision: s.ack.editRevision,
    });
    if (!r.ok) {
      m.setError(r.error);
      const uncertain = r.error.status === 0 || r.error.status >= 500;
      setPublishFailure(
        action === "publish"
          ? r.error.status === 429
            ? "throttled"
            : uncertain
              ? "uncertain"
              : "rejected"
          : null,
      );
      setS((v) => ({
        ...v,
        pending: false,
        conflict: uncertain || r.error.status === 409,
      }));
      setConfirmation(null);
      return;
    }
    if (
      action === "publish"
        ? !isPublishedQuiz(r.data, s.ack)
        : !isQuizDetailResponse(r.data, s.ack, s.ack.editRevision + 1) ||
          r.data.status !== (action === "archive" ? "archived" : "draft")
    ) {
      invalidAcknowledgement();
      setPublishFailure(action === "publish" ? "uncertain" : null);
      return;
    }
    if (action === "publish" && isPublishedQuiz(r.data, s.ack)) {
      const next = {
        ...s.ack,
        status: "published" as const,
        currentRevisionId: r.data.revision.id,
        editRevision: r.data.editRevision,
      };
      setS(quizState(next));
    } else if (isQuizDetailResponse(r.data, s.ack, s.ack.editRevision + 1))
      setS(quizState(r.data));
    m.setError(null);
    m.setMessage(
      t("تم تأكيد الحالة من الخادم", "Server confirmed the new state"),
    );
    setHistoryTick((v) => v + 1);
    setConfirmation(null);
  }
  const pub = publicationState(s.ack, history.data?.total),
    contentLocale = selectedLocale(
      s.info.content,
      locale,
      s.info.defaultContentLocale,
    ),
    title =
      s.info.content[contentLocale]?.title ||
      t("اختبار بلا عنوان", "Untitled quiz"),
    total = s.items.reduce(
      (a, i) => a + (Number.isFinite(i.points) ? i.points! : 0),
      0,
    ),
    infoValid = quizInfoValid({ ...s.info, policy: s.policy }),
    itemsOkay = itemsValid(s.items),
    policyOkay = policyIssues(s.policy).length === 0,
    ackPolicyOkay = policyIssues(s.ack.draft.policy).length === 0;
  return (
    <>
      <Head title={title} actions={<Status value={s.ack.status} />} />
      <div
        className="aa-publication"
        ref={publicationSummary}
        tabIndex={-1}
        role="region"
        aria-label={t("حالة النشر الحالية", "Current publication")}
      >
        <div>
          <strong>
            {pub === "archived"
              ? t("مؤرشف — السجل محفوظ", "Archived — history retained")
              : pub === "published"
                ? t(
                    `الإصدار ${current.data?.number ?? "…"} منشور حاليًا`,
                    `Revision ${current.data?.number ?? "…"} is currently published`,
                  )
                : pub === "unpublished"
                  ? t(
                      "غير منشور حاليًا، وله سجل نشر",
                      "Unpublished, has publication history",
                    )
                  : pub === "first"
                    ? t(
                        "لم يُنشر أي إصدار بعد",
                        "No revision has been published yet",
                      )
                    : t(
                        "جارٍ التحقق من سجل النشر",
                        "Checking publication history",
                      )}
          </strong>
          <small>
            {pub === "archived"
              ? t("قراءة فقط؛ لا استعادة.", "Read only; no restore.")
              : pub === "unpublished"
                ? t(
                    "النشر التالي ينشئ إصدارًا جديدًا من المسودة المحفوظة، ولا يعيد تفعيل إصدار سابق.",
                    "Publishing creates a new revision from the saved draft; it does not reactivate an older revision.",
                  )
                : t(
                    "المسودة والإصدار المنشور مستقلان؛ المحاولات السابقة تحتفظ بإصداراتها.",
                    "Draft and publication are separate; previous attempts retain their exact revisions.",
                  )}
          </small>
          {current.data && draftDiffers(s.ack, current.data) && (
            <p>
              {t(
                "تغييرات محفوظة أحدث لم تُنشر",
                "Newer saved draft changes are not published",
              )}
            </p>
          )}
        </div>
        {pub !== "archived" && (
          <span className="aa-tag draft">
            {hasDirty
              ? t("تغييرات غير محفوظة", "Unsaved changes")
              : t("مسودة العمل المحفوظة", "Saved working draft")}
          </span>
        )}
      </div>
      <div className="aa-live" role="status">
        {s.pending ? t("جارٍ الحفظ…", "Saving…") : m.message}
      </div>
      <FailureView error={m.error?.status === 429 ? null : m.error} />
      {m.error?.status === 429 && (
        <Note error>
          <p>
            {m.error.rateLimitSource === "client"
              ? t(
                  "طلبات كثيرة في مساحة العمل هذه.",
                  "Too many requests in this workspace.",
                )
              : t(
                  "الخادم يقيّد معدل الطلبات.",
                  "Too many requests. The server is limiting requests.",
                )}
          </p>
          <p>
            {cooldown > 0
              ? t(
                  `انتظر ${cooldown} ثانية قبل إعادة المحاولة يدويًا.`,
                  `Wait ${cooldown} seconds before retrying manually.`,
                )
              : t(
                  "انتهت فترة الانتظار؛ يمكنك إعادة المحاولة يدويًا بعد استيفاء شروط الحفظ والنشر.",
                  "The cooldown has ended; retry manually when save and publication requirements are met.",
                )}
          </p>
        </Note>
      )}
      {m.error &&
        [
          "QUESTION_NOT_ACTIVE",
          "SKILL_NOT_ACTIVE",
          "INVALID_QUESTION_REVISION",
          "QUESTION_REVISION_INCOMPATIBLE",
        ].includes(m.error.code) && (
          <Note error>
            {t(
              "رفض الخادم أهلية المحتوى دون تحديد عنصر. لم يُنسب الخطأ إلى صف بعينه. افحص الإصدارات المحددة للتحقق؛ تبقى جميع تعديلاتك كما هي.",
              "The server rejected content eligibility without identifying an item. No row is blamed. Inspect exact revisions to check eligibility; all edits are retained.",
            )}
          </Note>
        )}
      {cooldown > 0 && (
        <p role="status">
          {t(
            `يمكنك متابعة التعديل. أعد محاولة الحفظ أو النشر بعد ${cooldown} ثانية.`,
            `You can keep editing. Retry saving or publication in ${cooldown} seconds.`,
          )}
        </p>
      )}
      <FailureView error={history.error} retry={history.reload} />
      <FailureView error={current.error} retry={current.reload} />
      {s.conflict && (
        <Note error>
          <p>
            {t(
              "تعديلاتك محفوظة في هذه الصفحة فقط. راجع الحالة الحالية قبل أي كتابة جديدة؛ لا إعادة تلقائية.",
              "Your edits remain in this page only. Review current state before any further write; there is no automatic retry.",
            )}
          </p>
          <button onClick={() => void loadCurrent()}>
            {t("مراجعة الحالة الحالية", "Review current state")}
          </button>
        </Note>
      )}
      {publishFailure && (
        <Note error>
          {publishFailure === "throttled"
            ? t(
                "لم يُنفّذ طلب النشر بسبب حدّ الطلبات. لم تتغير حالة النشر أو تعديلاتك. انتظر انتهاء الفترة ثم أكد النشر يدويًا؛ هذا ليس رفضًا لأهلية العناصر.",
                "Publication was throttled. Publication state and your edits are unchanged. Wait for the cooldown, then confirm publication manually; this is not an item eligibility rejection.",
              )
            : publishFailure === "uncertain"
              ? t(
                  "تعذّر تأكيد النشر. قد تكون العملية اكتملت؛ راجع الحالة الحالية قبل إعادة المحاولة.",
                  "Publication could not be confirmed. It may have completed; review current state before retrying.",
                )
              : t(
                  "رفض الخادم النشر. لم تُستبدل المراجعة المنشورة بهذا الطلب. راجع الخطأ؛ لا يحدد العقد الحالي عنصرًا متأثرًا بعينه.",
                  "The server rejected publication. This request did not replace the published revision. Review the error; the current contract does not identify an affected item.",
                )}
        </Note>
      )}
      <nav
        className="aa-steps"
        aria-label={t("أقسام الاختبار", "Quiz sections")}
      >
        {(
          [
            ["content", t("01 المحتوى", "01 Content")],
            ["policy", t("02 السياسة والنشر", "02 Policy & publication")],
            ["review", t("03 المعاينة والإصدارات", "03 Preview & revisions")],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            {name}
          </button>
        ))}
      </nav>
      {tab === "content" && (
        <div className="aa-columns">
          <div className="aa-stack">
            <details
              className="aa-info aa-panel"
              open={!s.ack.currentRevisionId}
            >
              <summary>
                {t("معلومات الاختبار", "Quiz information")} ·{" "}
                {dirty.info ? t("غير محفوظة", "Unsaved") : t("محفوظة", "Saved")}
              </summary>
              <QuizInfo
                value={s.info}
                disabled={locked || s.pending || s.conflict}
                onChange={(info) => setS((v) => ({ ...v, info }))}
              />
              {!infoValid && (
                <Note error>
                  {t(
                    "أكمل العنوان والتوجيهات بلغة افتراضية مؤلفة وضمن حدود النص.",
                    "Complete title/instructions with an authored default language and valid text limits.",
                  )}
                </Note>
              )}
              <button
                disabled={
                  locked ||
                  s.pending ||
                  s.conflict ||
                  cooldown > 0 ||
                  !dirty.info ||
                  !infoValid ||
                  !ackPolicyOkay
                }
                onClick={() => void save("info")}
              >
                {t("حفظ المعلومات", "Save information")}
              </button>
              {!ackPolicyOkay && (
                <Note error>
                  {t(
                    "السياسة المحفوظة غير صالحة. أصلحها واحفظها في قسم السياسة أولًا.",
                    "The saved policy is invalid. Repair and save it in Policy first.",
                  )}
                </Note>
              )}
            </details>
            <Panel title={t("تكوين الأسئلة", "Question composition")}>
              <div className="aa-actions">
                <bdi>{s.items.length} / 100</bdi>
                <button
                  className="primary"
                  disabled={
                    locked || s.pending || s.conflict || s.items.length >= 100
                  }
                  onClick={() => setPicker(true)}
                >
                  {t("إضافة من البنك", "Add from bank")}
                </button>
              </div>
              <FailureView
                error={previewError}
                retry={() => setPreviewTick((v) => v + 1)}
              />
              {previewPending && (
                <p role="status">
                  {t(
                    "تحميل محتوى الإصدارات المثبّتة…",
                    "Loading pinned revision content…",
                  )}
                </p>
              )}
              {!s.items.length && (
                <Empty>
                  {t(
                    "لا أسئلة بعد. أضف إصدارًا محددًا من البنك.",
                    "No questions yet. Add an exact revision from the bank.",
                  )}
                </Empty>
              )}
              <ol className="aa-composition">
                {s.items.map((i, index) => {
                  const p = presentations[i.questionRevisionId];
                  return (
                    <li key={i.questionId} data-question-id={i.questionId}>
                      <span className="aa-position">
                        <bdi>{index + 1}</bdi>
                      </span>
                      <div>
                        <small>
                          {p
                            ? label(p.type, t)
                            : t(
                                "إصدار سؤال محدد",
                                "Pinned question revision",
                              )}{" "}
                          ·{" "}
                          {p?.revisionNumber !== undefined && (
                            <>
                              {t("الإصدار", "Revision")} {p.revisionNumber}{" "}
                              ·{" "}
                            </>
                          )}
                          <bdi>{i.questionRevisionId.slice(0, 8)}</bdi>
                        </small>
                        <p
                          dir={p?.locale === "ar" ? "rtl" : "ltr"}
                          lang={p?.locale}
                        >
                          {p?.prompt ??
                            t(
                              "المحتوى غير محمّل؛ افحص هذا الإصدار بعينه.",
                              "Content not loaded; inspect this exact revision.",
                            )}
                        </p>
                        <button
                          onClick={() =>
                            setInspect({
                              id: i.questionId,
                              revision: i.questionRevisionId,
                            })
                          }
                        >
                          {t(
                            "فحص الإصدار والأهلية",
                            "Inspect revision and eligibility",
                          )}
                        </button>
                        {ineligible.has(i.questionRevisionId) && (
                          <Note error>
                            {t(
                              "غير مؤهل وفق بيانات الأرشفة أو فحص الأهلية. لم يُحذف أو يُستبدل؛ افحص الإصدار واختر الإجراء المناسب.",
                              "Known ineligible from archive data or an eligibility check. Retained unchanged; inspect this revision and choose whether to remove or replace it.",
                            )}
                          </Note>
                        )}
                      </div>
                      <div className="aa-points">
                        <Field
                          id={`points-${i.questionId}`}
                          label={t("النقاط", "Points")}
                        >
                          <input
                            id={`points-${i.questionId}`}
                            aria-label={`${t("نقاط السؤال", "Points for question")} ${index + 1}`}
                            type="number"
                            min={1}
                            max={1000}
                            step={1}
                            disabled={locked || s.pending || s.conflict}
                            value={Number.isFinite(i.points) ? i.points : ""}
                            onChange={(e) => {
                              const points =
                                e.target.value === ""
                                  ? NaN
                                  : Number(e.target.value);
                              setS((v) => ({
                                ...v,
                                items: v.items.map((x) =>
                                  x.questionId === i.questionId
                                    ? { ...x, points }
                                    : x,
                                ),
                              }));
                            }}
                          />
                        </Field>
                      </div>
                      <div className="aa-row-actions">
                        <Move
                          index={index}
                          count={s.items.length}
                          disabled={locked || s.pending || s.conflict}
                          name={`${t("السؤال", "Question")} ${index + 1}`}
                          onMove={(delta) => {
                            setS((v) => ({
                              ...v,
                              items: positioned(
                                moveItem(v.items, index, delta),
                              ),
                            }));
                            m.setMessage(
                              t(
                                `نُقل السؤال ${index + 1}`,
                                `Question ${index + 1} moved`,
                              ),
                            );
                          }}
                        />
                        <button
                          className="danger"
                          disabled={locked || s.pending || s.conflict}
                          aria-label={`${t("إزالة السؤال", "Remove question")} ${index + 1}`}
                          onClick={() => {
                            setS((v) => ({
                              ...v,
                              items: positioned(
                                v.items.filter(
                                  (x) => x.questionId !== i.questionId,
                                ),
                              ),
                            }));
                            setIneligible((v) => {
                              const n = new Set(v);
                              n.delete(i.questionRevisionId);
                              return n;
                            });
                          }}
                        >
                          {t("إزالة", "Remove")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!itemsOkay && (
                <Note error>
                  {t(
                    "النقاط أعداد صحيحة من 1 إلى 1000؛ حد 100 سؤال فريد.",
                    "Points must be integers 1–1000; at most 100 unique questions.",
                  )}
                </Note>
              )}
              <div className="aa-row">
                <strong>
                  {total} {t("نقطة إجمالًا", "total points")}
                </strong>
                <button
                  disabled={
                    locked ||
                    s.pending ||
                    s.conflict ||
                    cooldown > 0 ||
                    !dirty.items ||
                    !itemsOkay
                  }
                  onClick={() => void save("items")}
                >
                  {t("حفظ الأسئلة", "Save questions")}
                </button>
              </div>
            </Panel>
          </div>
          <aside className="aa-stack">
            <Panel
              title={t("ملخص المسودة", "Draft at a glance")}
              className="aa-summary"
            >
              <div className="aa-total">{total}</div>
              <p>{t("نقطة", "points")}</p>
              <dl>
                <div>
                  <dt>{t("الأسئلة", "Questions")}</dt>
                  <dd>
                    <bdi>{s.items.length} / 100</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{t("النمط", "Mode")}</dt>
                  <dd>{label(s.policy.mode, t)}</dd>
                </div>
                <div>
                  <dt>{t("الحفظ", "Save state")}</dt>
                  <dd>
                    {hasDirty ? t("غير محفوظ", "Unsaved") : t("محفوظ", "Saved")}
                  </dd>
                </div>
              </dl>
              <div className="aa-stack">
                <button onClick={() => setTab("policy")}>
                  {t("السياسة والنشر", "Policy & publication")}
                </button>
                <button
                  disabled={blocked || previewPending}
                  onClick={() => setTab("review")}
                >
                  {t("معاينة المسودة المحفوظة", "Preview saved draft")}
                </button>
              </div>
            </Panel>
            <Note>
              {t(
                "الأسئلة مرتبطة بإصدارات محددة؛ تحديث البنك لا يستبدلها. المطلوب لا يغيّر التقدم أو إكمال الدروس.",
                "Questions pin exact revisions; bank edits never replace them. Required does not change progress or lesson completion.",
              )}
            </Note>
          </aside>
        </div>
      )}
      {tab === "policy" && (
        <div className="aa-columns">
          <div className="aa-stack">
            <PolicyFields
              key={`policy-${s.ack.id}`}
              value={s.policy}
              disabled={locked || s.pending || s.conflict}
              onChange={(policy) => setS((v) => ({ ...v, policy }))}
            />
            <button
              disabled={
                locked ||
                s.pending ||
                s.conflict ||
                cooldown > 0 ||
                !dirty.policy ||
                !policyOkay ||
                !quizInfoValid(s.ack.draft)
              }
              onClick={() => void save("policy")}
            >
              {t("حفظ السياسة", "Save policy")}
            </button>
          </div>
          <aside className="aa-stack">
            <Panel title={t("مراجعة قبل النشر", "Before publication")}>
              <p>
                {t(
                  "الجاهزية المحلية لا تحل محل تحقق الخادم من النطاق والأسئلة والمهارات.",
                  "Local readiness does not replace server validation of scope, questions and skills.",
                )}
              </p>
              <p>
                {t("المعلومات", "Information")}:{" "}
                {dirty.info ? t("غير محفوظة", "Unsaved") : t("محفوظة", "Saved")}
              </p>
              <p>
                {t("الأسئلة", "Questions")}:{" "}
                {dirty.items
                  ? t("غير محفوظة", "Unsaved")
                  : t("محفوظة", "Saved")}
              </p>
              <p>
                {t("السياسة", "Policy")}:{" "}
                {dirty.policy
                  ? t("غير محفوظة", "Unsaved")
                  : t("محفوظة", "Saved")}
              </p>
              <button
                className="primary"
                disabled={
                  blocked ||
                  cooldown > 0 ||
                  history.loading ||
                  !!history.error ||
                  current.loading ||
                  !!current.error
                }
                onClick={() => {
                  publicationFocus.current = null;
                  setConfirmation("publish");
                }}
              >
                {t("مراجعة وتأكيد النشر", "Review and confirm publication")}
              </button>
              {blocked && (
                <small>
                  {t(
                    "احفظ كل الأقسام وأصلح الأخطاء والتعارضات والعناصر غير المؤهلة أولًا.",
                    "Save all sections and resolve errors, conflicts and ineligible items first.",
                  )}
                </small>
              )}
            </Panel>
            <Panel title={t("حالة النشر الحالية", "Current publication")}>
              <Status value={s.ack.status} />
              <div className="aa-actions">
                {s.ack.status === "published" && (
                  <button
                    disabled={s.pending || s.conflict || hasDirty || locked}
                    onClick={() => setConfirmation("unpublish")}
                  >
                    {t("إلغاء النشر", "Unpublish")}
                  </button>
                )}
                {!locked && (
                  <button
                    className="danger"
                    disabled={s.pending || s.conflict || hasDirty}
                    onClick={() => setConfirmation("archive")}
                  >
                    {t("أرشفة الاختبار", "Archive quiz")}
                  </button>
                )}
              </div>
            </Panel>
          </aside>
        </div>
      )}
      {tab === "review" && (
        <>
          <Field
            id="quiz-preview-locale"
            label={t("لغة المعاينة المطلوبة", "Requested preview language")}
          >
            <select
              id="quiz-preview-locale"
              value={previewLocale}
              disabled={s.pending || hasDirty || s.conflict}
              onChange={(e) => setPreviewLocale(e.target.value as Locale)}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </Field>
          <FailureView
            error={previewError}
            retry={() => setPreviewTick((v) => v + 1)}
          />
          <div className="aa-columns">
            <SavedPreview
              data={safe}
              base={base}
              blocked={blocked || previewPending}
            />
            <RevisionHistory
              base={base}
              currentId={s.ack.currentRevisionId}
              published={s.ack.status === "published"}
              locked={locked || s.pending || s.conflict}
              scopeLabel={scopeLabel}
              refresh={historyTick}
            />
          </div>
        </>
      )}
      {picker && (
        <Modal
          title={t("إضافة إصدار سؤال", "Add a question revision")}
          onClose={() => setPicker(false)}
        >
          <QuestionBank
            onKnownIneligible={markIneligible}
            choose={(r) => {
              if (
                stateRef.current.items.some(
                  (i) => i.questionId === r.questionId,
                )
              ) {
                m.setMessage(
                  t(
                    "السؤال موجود بالفعل. أزله قبل استبدال إصداره.",
                    "This question is already included. Remove it before replacing its revision.",
                  ),
                );
                return;
              }
              setPresentations((v) => ({
                ...v,
                [r.id]: safeRevision(r, previewLocale),
              }));
              setS((v) => ({
                ...v,
                items: positioned([
                  ...v.items,
                  {
                    questionId: r.questionId,
                    questionRevisionId: r.id,
                    position: v.items.length,
                    points: r.content.defaultPoints,
                  },
                ]),
              }));
              setPicker(false);
            }}
          />
        </Modal>
      )}
      {inspect && (
        <RevisionInspector
          {...inspect}
          onClose={() => setInspect(null)}
          onKnownIneligible={markIneligible}
          onLoaded={rememberRevision}
        />
      )}
      {confirmation && (
        <Modal
          title={
            confirmation === "reload"
              ? t("مراجعة الحالة الحالية", "Review current state")
              : confirmation === "publish"
                ? t("نشر إصدار جديد؟", "Publish a new revision?")
                : confirmation === "unpublish"
                  ? t("إلغاء نشر الاختبار؟", "Unpublish quiz?")
                  : t("أرشفة الاختبار؟", "Archive quiz?")
          }
          onClose={() => setConfirmation(null)}
          busy={s.pending}
          returnFocus={
            confirmation === "publish"
              ? () => publicationFocus.current
              : undefined
          }
          confirmDisabled={
            confirmation === "publish" && (cooldown > 0 || blocked)
          }
          danger={confirmation !== "publish"}
          action={
            confirmation === "reload"
              ? t(
                  "استبدال تعديلاتي بالنسخة الحالية",
                  "Replace my edits with current state",
                )
              : t("تأكيد", "Confirm")
          }
          onConfirm={() => {
            if (confirmation === "reload" && fresh) {
              setS(quizState(fresh));
              setIneligible(new Set());
              setPresentations({});
              setPreviewTick((v) => v + 1);
              setHistoryTick((v) => v + 1);
              setPublishFailure(null);
              m.setError(null);
              setConfirmation(null);
              return;
            }
            if (confirmation !== "reload") void lifecycle(confirmation);
          }}
        >
          <p>{scopeLabel}</p>
          <strong dir="auto">
            {confirmation === "reload"
              ? fresh?.draft.content[fresh.draft.defaultContentLocale]?.title
              : title}
          </strong>
          <bdi>{s.ack.id}</bdi>
          {confirmation === "publish" ? (
            <>
              <p>
                {s.items.length} {t("سؤالًا", "questions")} · {total}{" "}
                {t("نقطة", "points")}
              </p>
              <PolicySummary policy={s.ack.draft.policy} />
              <Note>
                {t(
                  "سينشأ إصدار جديد من المسودة المحفوظة فقط. تبقى الإصدارات والمحاولات السابقة ثابتة. لا يصبح التعديل منشورًا إلا بعد تأكيد الخادم.",
                  "A new revision is created from the saved draft only. Earlier revisions and attempts remain immutable. Publication changes only after server acknowledgement.",
                )}
              </Note>
            </>
          ) : confirmation === "reload" ? (
            <Note>
              {t(
                "ستُستبدل التعديلات المحلية في جميع الأقسام. راجعها أو انسخها قبل التأكيد.",
                "Local edits in every section will be replaced. Review or copy them before confirming.",
              )}{" "}
              {fresh && (
                <p>
                  {t("نسخة التحرير الحالية", "Current edit revision")}:{" "}
                  {fresh.editRevision} · {fresh.items.length}{" "}
                  {t("سؤالًا", "questions")}
                </p>
              )}
            </Note>
          ) : (
            <Note>
              {t(
                "يتوقف وصول الطلاب التفاعلي، بما فيه استئناف المحاولات والنتائج والمراجعة. تبقى البيانات التاريخية؛ قد يكتمل التصحيح الداخلي. إلغاء النشر يحتفظ بالتاريخ، والنشر اللاحق ينشئ إصدارًا جديدًا. الأرشفة للقراءة فقط ولا استعادة لها.",
                "Student interactive access stops, including resume, results and review. History remains; internal grading may finish. Unpublish retains history and later publication creates a new revision. Archive is read only and cannot be restored.",
              )}
            </Note>
          )}
        </Modal>
      )}
    </>
  );
}
