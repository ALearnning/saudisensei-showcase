"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminQuestionDetail,
  AdminQuestionDraft,
  AdminQuestionType,
  AdminSkillDetail,
} from "@workspace/saudisensei-api-client";
import {
  addQuestionLocale,
  emptyQuestion,
  href,
  localesOf,
  moveItem,
  questionIssues,
  removeQuestionLocale,
  same,
  type Locale,
  questionTypes,
  skillPath,
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
  Issues,
  LocaleTabs,
  Move,
  label,
  Status,
  UncertainCreate,
} from "./common";
import {
  invalidAcknowledgement,
  isQuestionDetail,
  isSealedQuestion,
} from "./acknowledgements";
import { SkillPicker } from "./skills";
import { QuestionHistory, SkillPath } from "./bank";
export function QuestionEditor({ id }: { id: string }) {
  const { locale, t } = useAssessment(),
    router = useRouter(),
    m = useAction();
  const q = useRead<AdminQuestionDetail>(
    id !== "new" ? `admin/question-bank/questions/${id}` : null,
  );
  const [ack, setAck] = useState<AdminQuestionDetail | null>(null),
    [draft, setDraft] = useState<AdminQuestionDraft | null>(null),
    [confirmation, setConfirmation] = useState<
      "seal" | "archive" | "reload" | null
    >(null),
    [history, setHistory] = useState(false),
    [unconfirmed, setUnconfirmed] = useState(false),
    [fresh, setFresh] = useState<AdminQuestionDetail | null>(null);
  const { api } = useAssessment();
  useEffect(() => {
    if (q.data) {
      setAck(q.data);
      setDraft(structuredClone(q.data.draft));
    } else if (id === "new") setDraft(emptyQuestion("single_choice", locale));
  }, [q.data, id, locale]);
  const dirty = !!draft && (!ack || !same(draft, ack.draft));
  useLeaving(dirty);
  const issues = draft ? questionIssues(draft) : [],
    conflict =
      unconfirmed ||
      (!!m.error &&
        (m.error.status === 409 ||
          m.error.status === 0 ||
          m.error.status >= 500)),
    locked = ack?.status === "archived";
  async function save() {
    if (!draft || issues.length || conflict) return;
    m.setMessage("");
    const r = await m.run<unknown>(
      id === "new"
        ? "admin/question-bank/questions"
        : `admin/question-bank/questions/${id}`,
      id === "new" ? "POST" : "PATCH",
      { ...(ack ? { expectedRevision: ack.editRevision } : {}), draft },
    );
    if (r) {
      if (
        !isQuestionDetail(r, ack ?? undefined, true) ||
        r.status !== "active"
      ) {
        setUnconfirmed(true);
        m.setError(invalidAcknowledgement);
        return;
      }
      setAck(r);
      setDraft(r.draft);
      m.setMessage(t("حُفظت المسودة", "Draft saved"));
      if (id === "new") router.replace(href(locale, `question-bank/${r.id}`));
    }
  }
  if (q.loading) return <Skeleton rows={5} />;
  if (q.error) return <FailureView error={q.error} retry={q.reload} />;
  if (!draft) return <Skeleton />;
  return (
    <>
      <Head
        title={t("حرّر سؤالًا واضحًا", "Write a clear question.")}
        lead={t(
          "المحتوى أولًا، ثم مفتاح الإجابة الخاص، ثم التفسير.",
          "Content first, then the private answer key and explanation.",
        )}
        actions={
          <>
            {ack && <Status value={ack.status} />}
            <span>
              {dirty
                ? t("تغييرات غير محفوظة", "Unsaved changes")
                : t("مسودة محفوظة", "Saved draft")}
            </span>
            <button
              className="primary"
              disabled={
                locked || m.busy || conflict || !!issues.length || !dirty
              }
              onClick={() => void save()}
            >
              {t("حفظ المسودة", "Save draft")}
            </button>
          </>
        }
      />
      <div className="aa-live" role="status">
        {m.message}
      </div>
      <FailureView error={m.error} />
      {conflict && !ack && <UncertainCreate />}
      {conflict && ack && (
        <button
          onClick={() => {
            setUnconfirmed(true);
            void api
              .request<unknown>(`admin/question-bank/questions/${id}`)
              .then((r) => {
                if (r.ok) {
                  if (!isQuestionDetail(r.data, ack)) {
                    setFresh(null);
                    setConfirmation(null);
                    m.setError(invalidAcknowledgement);
                    return;
                  }
                  setFresh(r.data);
                  setConfirmation("reload");
                } else m.setError(r.error);
              });
          }}
        >
          {t("مراجعة النسخة الحالية", "Review current version")}
        </button>
      )}
      <Issues issues={issues} />
      <QuestionFields
        draft={draft}
        onChange={setDraft}
        disabled={locked || m.busy || conflict}
      />
      {ack && (
        <Panel title={t("الإصدارات وإعادة الاستخدام", "Revisions and reuse")}>
          <Note>
            {t(
              "تثبيت إصدار ينسخ المحتوى والمفتاح والتصنيف كما هي. التعديلات التالية لا تغيّر أي إصدار سابق.",
              "Sealing snapshots content, key and classification. Later edits never change an earlier revision.",
            )}
          </Note>
          <div className="aa-actions">
            <button
              className="primary"
              disabled={
                locked ||
                m.busy ||
                dirty ||
                conflict ||
                issues.length > 0 ||
                !draft.primarySkillId
              }
              onClick={() => setConfirmation("seal")}
            >
              {t("تثبيت إصدار", "Seal revision")}
            </button>
            <button onClick={() => setHistory(!history)}>
              {t("سجل الإصدارات", "Revision history")}
            </button>
            <button
              className="danger"
              disabled={locked || m.busy || dirty || conflict}
              onClick={() => setConfirmation("archive")}
            >
              {t("أرشفة السؤال", "Archive question")}
            </button>
          </div>
          {history && (
            <QuestionHistory
              key={ack.editRevision}
              id={ack.id}
              eligible={!locked}
            />
          )}
        </Panel>
      )}
      {confirmation && (
        <Modal
          title={
            confirmation === "reload"
              ? t("مراجعة التعارض", "Review conflict")
              : confirmation === "seal"
                ? t("تثبيت إصدار جديد؟", "Seal a new revision?")
                : t("أرشفة السؤال؟", "Archive question?")
          }
          onClose={() => setConfirmation(null)}
          busy={m.busy}
          danger={confirmation !== "seal"}
          action={
            confirmation === "reload"
              ? t(
                  "استبدال تعديلاتي بالنسخة الحالية",
                  "Replace my edits with current version",
                )
              : t("تأكيد", "Confirm")
          }
          onConfirm={() => {
            if (confirmation === "reload" && fresh) {
              setAck(fresh);
              setDraft(structuredClone(fresh.draft));
              m.setError(null);
              setUnconfirmed(false);
              setConfirmation(null);
              return;
            }
            if (!ack) return;
            m.setMessage("");
            void m
              .run<unknown>(
                `admin/question-bank/questions/${ack.id}/${confirmation === "seal" ? "revisions" : "archive"}`,
                "POST",
                { expectedRevision: ack.editRevision },
              )
              .then((r) => {
                if (r) {
                  if (confirmation === "seal" && isSealedQuestion(r, ack)) {
                    setAck({
                      ...ack,
                      editRevision: r.editRevision,
                      currentRevisionId: r.revision.id,
                    });
                    m.setMessage(t("تم تأكيد العملية", "Operation confirmed"));
                  } else if (
                    confirmation === "archive" &&
                    isQuestionDetail(r, ack, true) &&
                    r.status === "archived"
                  ) {
                    setAck(r);
                    m.setMessage(t("تم تأكيد العملية", "Operation confirmed"));
                  } else {
                    setUnconfirmed(true);
                    m.setError(invalidAcknowledgement);
                  }
                }
                setConfirmation(null);
              });
          }}
        >
          {confirmation === "archive" ? (
            <Note>
              {t(
                "لن يصلح السؤال لإضافته أو لنشر اختبار جديد يعتمد عليه. تبقى الإصدارات والمحاولات التاريخية ثابتة. يجب إزالة العناصر المتأثرة أو استبدالها يدويًا. لا استعادة للأرشفة.",
                "The question becomes ineligible for addition or new quiz publication. Historical revisions and attempts remain immutable. Affected draft items must be removed or replaced explicitly. Archive cannot be undone.",
              )}
            </Note>
          ) : confirmation === "reload" ? (
            <>
              <Note>
                {t(
                  "تعديلاتك باقية خلف هذه النافذة. راجعها قبل الاستبدال الصريح.",
                  "Your edits remain behind this dialog. Review them before explicitly replacing them.",
                )}
              </Note>
              {fresh &&
                localesOf(fresh.draft.content).map((l) => (
                  <div key={l} lang={l} dir={l === "ar" ? "rtl" : "ltr"}>
                    <strong>{label(l, t)}</strong>
                    <p>{fresh.draft.content[l]!.prompt}</p>
                  </div>
                ))}
            </>
          ) : (
            <p>
              {t(
                "سيصبح هذا الإصدار ثابتًا وقابلًا للاختيار في الاختبارات؛ لا يتغير أي اختبار تلقائيًا.",
                "This revision becomes immutable and selectable for quizzes; no quiz updates automatically.",
              )}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
export function QuestionFields({
  draft: d,
  onChange,
  disabled = false,
}: {
  draft: AdminQuestionDraft;
  onChange: (d: AdminQuestionDraft) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useAssessment();
  const [lang, setLang] = useState<Locale>(d.defaultContentLocale),
    [typeChange, setTypeChange] = useState<AdminQuestionType | null>(null),
    [removeLocale, setRemoveLocale] = useState<Locale | null>(null),
    [skillMode, setSkillMode] = useState<"primary" | "secondary" | null>(null),
    [known, setKnown] = useState<Record<string, AdminSkillDetail>>({});
  const l = d.content[lang] ? lang : d.defaultContentLocale,
    c = d.content[l]!,
    g = d.gradingDefinition,
    options = c.options ?? c.items ?? [];
  const edit = (patch: Partial<AdminQuestionDraft>) =>
    onChange({ ...d, ...patch });
  const content = (patch: Partial<typeof c>) =>
    edit({ content: { ...d.content, [l]: { ...c, ...patch } } });
  function addOption() {
    const id = crypto.randomUUID(),
      content = structuredClone(d.content);
    for (const locale of localesOf(content)) {
      const x = content[locale]!;
      if (d.type === "ordering")
        x.items = [...(x.items ?? []), { id, label: "" }];
      else x.options = [...(x.options ?? []), { id, label: "" }];
    }
    edit({
      content,
      gradingDefinition:
        g.type === "ordering"
          ? { ...g, correctOrderedItemIds: [...g.correctOrderedItemIds, id] }
          : g,
    });
  }
  function removeOption(id: string) {
    const content = structuredClone(d.content);
    for (const locale of localesOf(content)) {
      const x = content[locale]!;
      if (x.items) x.items = x.items.filter((o) => o.id !== id);
      if (x.options) x.options = x.options.filter((o) => o.id !== id);
    }
    const key =
      g.type === "single_choice"
        ? {
            ...g,
            correctOptionId: g.correctOptionId === id ? "" : g.correctOptionId,
          }
        : g.type === "multiple_choice"
          ? {
              ...g,
              correctOptionIds: g.correctOptionIds.filter((v) => v !== id),
            }
          : g.type === "ordering"
            ? {
                ...g,
                correctOrderedItemIds: g.correctOrderedItemIds.filter(
                  (v) => v !== id,
                ),
              }
            : g;
    edit({ content, gradingDefinition: key });
  }
  return (
    <>
      <div className="aa-columns">
        <div className="aa-stack">
          <Panel title={t("01 / محتوى السؤال", "01 / Question content")}>
            <fieldset disabled={disabled}>
              <div className="aa-grid">
                <Field
                  id="question-type"
                  label={t("نوع الإجابة", "Answer type")}
                >
                  <select
                    id="question-type"
                    value={d.type}
                    onChange={(e) =>
                      setTypeChange(e.target.value as AdminQuestionType)
                    }
                  >
                    {questionTypes.map((v) => (
                      <option value={v} key={v}>
                        {label(v, t)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id="question-default-locale"
                  label={t(
                    "لغة المحتوى الافتراضية",
                    "Default content language",
                  )}
                >
                  <select
                    id="question-default-locale"
                    value={d.defaultContentLocale}
                    onChange={(e) =>
                      edit({ defaultContentLocale: e.target.value as Locale })
                    }
                  >
                    {localesOf(d.content).map((l) => (
                      <option key={l} value={l}>
                        {l === "ar" ? "العربية" : "English"}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="aa-actions">
                <LocaleTabs
                  value={l}
                  onChange={setLang}
                  locales={localesOf(d.content)}
                />
                {(["ar", "en"] as const)
                  .filter((x) => !d.content[x])
                  .map((x) => (
                    <button
                      key={x}
                      onClick={() => {
                        onChange(addQuestionLocale(d, x));
                        setLang(x);
                      }}
                    >
                      {t("إضافة لغة", "Add language")} · {label(x, t)}
                    </button>
                  ))}
                {localesOf(d.content).length > 1 && (
                  <button onClick={() => setRemoveLocale(l)}>
                    {t("إزالة هذه اللغة", "Remove this language")}
                  </button>
                )}
              </div>
              <small>
                {t(
                  "لغة المحتوى مستقلة عن لغة الواجهة. الترجمات تشترك في هويات الخيارات.",
                  "Content language is separate from interface language. Translations share option identities.",
                )}
              </small>
              <div lang={l} dir={l === "ar" ? "rtl" : "ltr"}>
                <Field
                  id="question-prompt"
                  label={t("نص السؤال", "Question prompt")}
                  help={t(
                    "Markdown مقيّد؛ لا روابط أو صور أو HTML. حد 20000 حرف.",
                    "Restricted Markdown; no links, images or HTML. Maximum 20,000 characters.",
                  )}
                >
                  <textarea
                    id="question-prompt"
                    aria-describedby="question-prompt-help"
                    rows={4}
                    maxLength={20000}
                    value={c.prompt}
                    onChange={(e) => content({ prompt: e.target.value })}
                  />
                </Field>
                {options.map((o, i) => (
                  <div className="aa-row" key={o.id}>
                    <div className="aa-row-main">
                      <Field
                        id={`option-${l}-${o.id}`}
                        label={`${t("العنصر", "Item")} ${i + 1}`}
                      >
                        <textarea
                          id={`option-${l}-${o.id}`}
                          rows={2}
                          maxLength={20000}
                          value={o.label}
                          onChange={(e) =>
                            content({
                              [d.type === "ordering" ? "items" : "options"]:
                                options.map((v) =>
                                  v.id === o.id
                                    ? { ...v, label: e.target.value }
                                    : v,
                                ),
                            })
                          }
                        />
                      </Field>
                    </div>
                    <button
                      disabled={options.length <= 2}
                      aria-label={`${t("إزالة العنصر", "Remove item")} ${i + 1}`}
                      onClick={() => removeOption(o.id)}
                    >
                      {t("إزالة", "Remove")}
                    </button>
                  </div>
                ))}
                {(d.type.includes("choice") || d.type === "ordering") && (
                  <button disabled={options.length >= 20} onClick={addOption}>
                    {t("إضافة عنصر", "Add item")}
                  </button>
                )}
              </div>
              <details>
                <summary>
                  {t(
                    "مقطع Java للعرض فقط (اختياري)",
                    "Inert Java snippet (optional)",
                  )}
                </summary>
                <Field
                  id="question-code"
                  label={t("الكود — لا يُنفّذ", "Code — never executed")}
                >
                  <textarea
                    id="question-code"
                    dir="ltr"
                    rows={5}
                    maxLength={20000}
                    value={c.code?.source ?? ""}
                    onChange={(e) => {
                      const next = { ...c };
                      if (e.target.value)
                        next.code = {
                          language: "java",
                          source: e.target.value,
                        };
                      else delete next.code;
                      edit({ content: { ...d.content, [l]: next } });
                    }}
                  />
                </Field>
              </details>
            </fieldset>
          </Panel>
          <Panel
            title={t("02 / مفتاح الإجابة", "02 / Answer key")}
            className="aa-private"
          >
            <span className="aa-private-label">
              {t(
                "خاص بالمشرف — تعريف التصحيح",
                "ADMIN ONLY — GRADING DEFINITION",
              )}
            </span>
            <p>
              {t(
                "التصحيح كامل أو صفر. لا يظهر المفتاح في المعاينة الآمنة.",
                "All-or-nothing grading. The key is excluded from safe preview.",
              )}
            </p>
            <fieldset disabled={disabled}>
              {(g.type === "single_choice" || g.type === "multiple_choice") && (
                <div className="aa-key-options">
                  {options.map((o, i) => (
                    <label key={o.id}>
                      <input
                        type={g.type === "single_choice" ? "radio" : "checkbox"}
                        name="answer-key"
                        checked={
                          g.type === "single_choice"
                            ? g.correctOptionId === o.id
                            : g.correctOptionIds.includes(o.id)
                        }
                        onChange={(e) =>
                          edit({
                            gradingDefinition:
                              g.type === "single_choice"
                                ? { ...g, correctOptionId: o.id }
                                : {
                                    ...g,
                                    correctOptionIds: e.target.checked
                                      ? [...g.correctOptionIds, o.id]
                                      : g.correctOptionIds.filter(
                                          (x) => x !== o.id,
                                        ),
                                  },
                          })
                        }
                      />
                      <span dir="auto">
                        {o.label || `${t("الخيار", "Option")} ${i + 1}`}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {g.type === "true_false" && (
                <div className="aa-key-options">
                  {[true, false].map((v) => (
                    <label key={String(v)}>
                      <input
                        type="radio"
                        name="boolean-key"
                        checked={g.correctValue === v}
                        onChange={() =>
                          edit({ gradingDefinition: { ...g, correctValue: v } })
                        }
                      />
                      {v ? t("صح", "True") : t("خطأ", "False")}
                    </label>
                  ))}
                </div>
              )}
              {g.type === "ordering" && (
                <ol>
                  {g.correctOrderedItemIds.map((id, i) => (
                    <li className="aa-row" key={id}>
                      <span dir="auto">
                        {options.find((o) => o.id === id)?.label ||
                          `${t("العنصر", "Item")} ${i + 1}`}
                      </span>
                      <Move
                        index={i}
                        count={options.length}
                        name={`${t("موضع المفتاح", "Key position")} ${i + 1}`}
                        onMove={(delta) =>
                          edit({
                            gradingDefinition: {
                              ...g,
                              correctOrderedItemIds: moveItem(
                                g.correctOrderedItemIds,
                                i,
                                delta,
                              ),
                            },
                          })
                        }
                      />
                    </li>
                  ))}
                </ol>
              )}
              {g.type === "short_text" && (
                <>
                  <Note>
                    {t(
                      "لكل لغة إجابات مستقلة. كل مربع يمثل إجابة كاملة؛ يمكن أن تحتوي الإجابة على أسطر متعددة.",
                      "Each language has its own answers. Each field is one complete answer and may contain multiple lines.",
                    )}
                  </Note>
                  {localesOf(d.content).map((answerLocale) => (
                    <section
                      key={answerLocale}
                      lang={answerLocale}
                      dir={answerLocale === "ar" ? "rtl" : "ltr"}
                    >
                      <h3>
                        {answerLocale === "ar"
                          ? "الإجابات المقبولة بالعربية"
                          : "Accepted answers in English"}
                      </h3>
                      {(g.acceptedByLocale[answerLocale] ?? []).map(
                        (value, i) => (
                          <div className="aa-row" key={`${answerLocale}-${i}`}>
                            <div className="aa-row-main">
                              <Field
                                id={`accepted-${answerLocale}-${i}`}
                                label={`${t("إجابة مقبولة", "Accepted answer")} ${label(answerLocale, t)} ${i + 1}`}
                              >
                                <textarea
                                  id={`accepted-${answerLocale}-${i}`}
                                  rows={2}
                                  maxLength={2000}
                                  value={value}
                                  onChange={(e) =>
                                    edit({
                                      gradingDefinition: {
                                        ...g,
                                        acceptedByLocale: {
                                          ...g.acceptedByLocale,
                                          [answerLocale]: g.acceptedByLocale[
                                            answerLocale
                                          ]!.map((s, n) =>
                                            n === i ? e.target.value : s,
                                          ),
                                        },
                                      },
                                    })
                                  }
                                />
                              </Field>
                            </div>
                            <button
                              disabled={
                                g.acceptedByLocale[answerLocale]!.length <= 1
                              }
                              aria-label={`${t("إزالة الإجابة", "Remove answer")} ${label(answerLocale, t)} ${i + 1}`}
                              onClick={() =>
                                edit({
                                  gradingDefinition: {
                                    ...g,
                                    acceptedByLocale: {
                                      ...g.acceptedByLocale,
                                      [answerLocale]: g.acceptedByLocale[
                                        answerLocale
                                      ]!.filter((_, n) => n !== i),
                                    },
                                  },
                                })
                              }
                            >
                              {t("إزالة", "Remove")}
                            </button>
                          </div>
                        ),
                      )}
                      <button
                        disabled={
                          (g.acceptedByLocale[answerLocale]?.length ?? 0) >= 20
                        }
                        onClick={() =>
                          edit({
                            gradingDefinition: {
                              ...g,
                              acceptedByLocale: {
                                ...g.acceptedByLocale,
                                [answerLocale]: [
                                  ...(g.acceptedByLocale[answerLocale] ?? []),
                                  "",
                                ],
                              },
                            },
                          })
                        }
                      >
                        {t("إضافة إجابة", "Add answer")} ·{" "}
                        {label(answerLocale, t)}
                      </button>
                    </section>
                  ))}
                  {(
                    [
                      [
                        "trim",
                        t(
                          "حذف الفراغات الطرفية",
                          "Trim leading/trailing whitespace",
                        ),
                      ],
                      [
                        "collapseWhitespace",
                        t(
                          "دمج الفراغات المتتالية",
                          "Collapse consecutive whitespace",
                        ),
                      ],
                      [
                        "caseFold",
                        t("تجاهل حالة الأحرف", "Ignore letter case"),
                      ],
                    ] as const
                  ).map(([k, name]) => (
                    <label className="aa-check" key={k}>
                      <input
                        type="checkbox"
                        checked={g.normalizer[k]}
                        onChange={(e) =>
                          edit({
                            gradingDefinition: {
                              ...g,
                              normalizer: {
                                ...g.normalizer,
                                [k]: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                      {name}
                    </label>
                  ))}
                  <small>
                    {t(
                      "NFC ونهايات الأسطر مطبّعة دائمًا. التشكيل والترقيم وأشكال الحروف العربية ذات معنى. لا مطابقة تقريبية.",
                      "NFC and line endings always normalize. Arabic diacritics, punctuation and letter variants remain meaningful. No fuzzy matching.",
                    )}
                  </small>
                </>
              )}
            </fieldset>
          </Panel>
          <Panel title={t("03 / تفسير الإجابة", "03 / Explanation")}>
            <Field
              id="question-explanation"
              label={t(
                "التفسير بلغة المحتوى المختارة",
                "Explanation in selected content language",
              )}
              help={t(
                "خاص أثناء التأليف؛ ظهور الطالب محكوم بالدرجة والمراجعة والتفسير.",
                "Private during authoring; Student disclosure follows score, review and explanation gates.",
              )}
            >
              <textarea
                id="question-explanation"
                disabled={disabled}
                lang={l}
                dir={l === "ar" ? "rtl" : "ltr"}
                rows={4}
                maxLength={20000}
                value={d.explanation[l] ?? ""}
                onChange={(e) =>
                  edit({
                    explanation: { ...d.explanation, [l]: e.target.value },
                  })
                }
              />
            </Field>
          </Panel>
        </div>
        <aside className="aa-stack">
          <Panel title={t("التصنيف", "Classification")}>
            <fieldset disabled={disabled}>
              <Field
                id="question-difficulty"
                label={t("الصعوبة", "Difficulty")}
              >
                <select
                  id="question-difficulty"
                  value={d.difficulty}
                  onChange={(e) =>
                    edit({
                      difficulty: e.target
                        .value as AdminQuestionDraft["difficulty"],
                    })
                  }
                >
                  {["easy", "medium", "hard"].map((v) => (
                    <option key={v} value={v}>
                      {label(v, t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="question-points"
                label={t("النقاط الافتراضية", "Default points")}
              >
                <input
                  id="question-points"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={
                    Number.isFinite(d.defaultPoints) ? d.defaultPoints : ""
                  }
                  onChange={(e) =>
                    edit({
                      defaultPoints:
                        e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                />
              </Field>
              <h3>{t("المهارة الأساسية", "Primary skill")}</h3>
              <p>
                {d.primarySkillId ? (
                  known[d.primarySkillId] ? (
                    skillPath(known[d.primarySkillId], locale)
                  ) : (
                    <SkillPath id={d.primarySkillId} />
                  )
                ) : (
                  t(
                    "غير محددة؛ مطلوبة لتثبيت الإصدار",
                    "Not selected; required before sealing",
                  )
                )}
              </p>
              <div className="aa-actions">
                <button onClick={() => setSkillMode("primary")}>
                  {t("اختيار", "Choose")}
                </button>
                {d.primarySkillId && (
                  <button onClick={() => edit({ primarySkillId: null })}>
                    {t("إزالة", "Remove")}
                  </button>
                )}
              </div>
              <h3>
                {t("مهارات ثانوية (حتى 20)", "Secondary skills (up to 20)")}
              </h3>
              {d.secondarySkillIds.map((id, i) => (
                <div className="aa-row" key={id}>
                  <bdi>
                    {known[id] ? skillPath(known[id], locale) : id.slice(0, 8)}
                  </bdi>
                  <button
                    aria-label={`${t("إزالة المهارة الثانوية", "Remove secondary skill")} ${i + 1}`}
                    onClick={() =>
                      edit({
                        secondarySkillIds: d.secondarySkillIds.filter(
                          (v) => v !== id,
                        ),
                      })
                    }
                  >
                    {t("إزالة", "Remove")}
                  </button>
                </div>
              ))}
              <button
                disabled={d.secondarySkillIds.length >= 20}
                onClick={() => setSkillMode("secondary")}
              >
                {t("إضافة مهارة", "Add skill")}
              </button>
              <h3>{t("الوسوم المعرفية", "Cognitive tags")}</h3>
              {(
                [
                  "concept",
                  "code_tracing",
                  "debugging",
                  "problem_solving",
                  "implementation",
                ] as const
              ).map((tag) => (
                <label className="aa-check" key={tag}>
                  <input
                    type="checkbox"
                    checked={d.cognitiveTags.includes(tag)}
                    onChange={(e) =>
                      edit({
                        cognitiveTags: e.target.checked
                          ? [...d.cognitiveTags, tag]
                          : d.cognitiveTags.filter((x) => x !== tag),
                      })
                    }
                  />
                  {label(tag, t)}
                </label>
              ))}
            </fieldset>
          </Panel>
        </aside>
      </div>
      {skillMode && (
        <SkillPicker
          exclude={[
            ...(d.primarySkillId ? [d.primarySkillId] : []),
            ...d.secondarySkillIds,
          ]}
          onClose={() => setSkillMode(null)}
          onChoose={(s) => {
            setKnown({ ...known, [s.id]: s });
            edit(
              skillMode === "primary"
                ? { primarySkillId: s.id }
                : { secondarySkillIds: [...d.secondarySkillIds, s.id] },
            );
            setSkillMode(null);
          }}
        />
      )}
      {typeChange && (
        <Modal
          title={t("تغيير نوع السؤال؟", "Change question type?")}
          onClose={() => setTypeChange(null)}
          action={t("تغيير النوع", "Change type")}
          danger
          onConfirm={() => {
            let next = emptyQuestion(typeChange, d.defaultContentLocale);
            for (const locale of localesOf(d.content))
              if (!next.content[locale]) next = addQuestionLocale(next, locale);
            for (const locale of localesOf(next.content)) {
              next.content[locale]!.prompt = d.content[locale]!.prompt;
              if (d.content[locale]!.code)
                next.content[locale]!.code = d.content[locale]!.code;
            }
            onChange({
              ...d,
              type: typeChange,
              content: next.content,
              gradingDefinition: next.gradingDefinition,
            });
            setTypeChange(null);
          }}
        >
          <p>
            {t(
              "ستُستبدل الخيارات ومفتاح الإجابة. تبقى الإصدارات السابقة ثابتة؛ راجع التفسير بعد التغيير.",
              "Choices and answer key will be replaced. Earlier revisions remain unchanged; review the explanation after changing type.",
            )}
          </p>
        </Modal>
      )}
      {removeLocale && (
        <Modal
          title={t("إزالة اللغة المؤلفة؟", "Remove authored language?")}
          onClose={() => setRemoveLocale(null)}
          action={t("إزالة اللغة", "Remove language")}
          danger
          onConfirm={() => {
            onChange(removeQuestionLocale(d, removeLocale));
            setLang(localesOf(d.content).find((x) => x !== removeLocale)!);
            setRemoveLocale(null);
          }}
        >
          <p>
            {t(
              "سيُحذف محتوى هذه اللغة وتفسيرها وإجاباتها المقبولة من المسودة فقط.",
              "This language's content, explanation and accepted answers will be removed from the draft only.",
            )}
          </p>
        </Modal>
      )}
    </>
  );
}
