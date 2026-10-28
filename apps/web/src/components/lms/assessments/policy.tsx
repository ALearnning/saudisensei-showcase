"use client";
import { useEffect, useState } from "react";
import type {
  AssessmentQuizPolicy,
  AdminQuizDraft,
} from "@workspace/saudisensei-api-client";
import {
  basisPoints,
  localesOf,
  normalizeVisibility,
  policyIssues,
  riyadhInput,
  riyadhInstant,
  same,
  visibility,
  within,
  type Locale,
} from "./model";
import {
  useAssessment,
  Panel,
  Field,
  Note,
  Modal,
  Issues,
  LocaleTabs,
  label,
} from "./common";
export function QuizInfo({
  value,
  onChange,
  disabled = false,
}: {
  value: Pick<AdminQuizDraft, "content" | "defaultContentLocale">;
  onChange: (v: typeof value) => void;
  disabled?: boolean;
}) {
  const { t } = useAssessment();
  const [lang, setLang] = useState<Locale>(value.defaultContentLocale),
    [remove, setRemove] = useState<Locale | null>(null);
  const l = value.content[lang] ? lang : value.defaultContentLocale,
    c = value.content[l]!;
  return (
    <fieldset disabled={disabled}>
      <div className="aa-actions">
        <LocaleTabs
          value={l}
          onChange={setLang}
          locales={localesOf(value.content)}
        />
        {(["ar", "en"] as const)
          .filter((v) => !value.content[v])
          .map((v) => (
            <button
              key={v}
              onClick={() => {
                onChange({
                  ...value,
                  content: {
                    ...value.content,
                    [v]: { title: "", instructions: "" },
                  },
                });
                setLang(v);
              }}
            >
              {t("إضافة لغة", "Add language")} · {label(v, t)}
            </button>
          ))}
        {localesOf(value.content).length > 1 && (
          <button onClick={() => setRemove(l)}>
            {t("إزالة اللغة", "Remove language")}
          </button>
        )}
      </div>
      <Field
        id="quiz-default-language"
        label={t("لغة المحتوى الافتراضية", "Default content language")}
      >
        <select
          id="quiz-default-language"
          value={value.defaultContentLocale}
          onChange={(e) =>
            onChange({
              ...value,
              defaultContentLocale: e.target.value as Locale,
            })
          }
        >
          {localesOf(value.content).map((v) => (
            <option key={v} value={v}>
              {v === "ar" ? "العربية" : "English"}
            </option>
          ))}
        </select>
      </Field>
      <div lang={l} dir={l === "ar" ? "rtl" : "ltr"}>
        <Field id="quiz-title" label={t("العنوان", "Title")}>
          <input
            id="quiz-title"
            maxLength={255}
            value={c.title}
            onChange={(e) =>
              onChange({
                ...value,
                content: {
                  ...value.content,
                  [l]: { ...c, title: e.target.value },
                },
              })
            }
          />
        </Field>
        <Field id="quiz-instructions" label={t("التعليمات", "Instructions")}>
          <textarea
            id="quiz-instructions"
            rows={4}
            maxLength={20000}
            value={c.instructions}
            onChange={(e) =>
              onChange({
                ...value,
                content: {
                  ...value.content,
                  [l]: { ...c, instructions: e.target.value },
                },
              })
            }
          />
        </Field>
      </div>
      {remove && (
        <Modal
          title={t(
            "إزالة اللغة من المسودة؟",
            "Remove this language from the draft?",
          )}
          onClose={() => setRemove(null)}
          action={t("إزالة", "Remove")}
          danger
          onConfirm={() => {
            const content = { ...value.content };
            delete content[remove];
            onChange({
              content,
              defaultContentLocale:
                value.defaultContentLocale === remove
                  ? localesOf(content)[0]
                  : value.defaultContentLocale,
            });
            setLang(localesOf(content)[0]);
            setRemove(null);
          }}
        >
          <p>
            {t(
              "لا تتغير الإصدارات التاريخية.",
              "Historical revisions remain unchanged.",
            )}
          </p>
        </Modal>
      )}
    </fieldset>
  );
}
export function PolicyFields({
  value: p,
  onChange,
  disabled = false,
}: {
  value: AssessmentQuizPolicy;
  onChange: (v: AssessmentQuizPolicy) => void;
  disabled?: boolean;
}) {
  const { t } = useAssessment();
  const [proposal, setProposal] = useState<AssessmentQuizPolicy | null>(null),
    [percent, setPercent] = useState(String(p.passBasisPoints / 100));
  useEffect(() => {
    setPercent((current) =>
      Object.is(basisPoints(current), p.passBasisPoints)
        ? current
        : String(p.passBasisPoints / 100),
    );
  }, [p.passBasisPoints]);
  const change = (patch: Partial<AssessmentQuizPolicy>) => {
    const raw = { ...p, ...patch },
      normalized = normalizeVisibility(raw);
    if (!same(raw, normalized)) setProposal(normalized);
    else onChange(raw);
  };
  return (
    <>
      <Issues issues={policyIssues(p)} />
      <Panel title={t("المحاولات والتوقيت", "Attempts and timing")}>
        <fieldset disabled={disabled}>
          <div className="aa-grid">
            <Field id="quiz-mode" label={t("نمط التقييم", "Assessment mode")}>
              <select
                id="quiz-mode"
                value={p.mode}
                onChange={(e) =>
                  onChange({
                    ...p,
                    mode: e.target.value as AssessmentQuizPolicy["mode"],
                  })
                }
              >
                <option value="graded">{t("مقيّم", "Graded")}</option>
                <option value="practice">{t("تدريب", "Practice")}</option>
              </select>
            </Field>
            <Field
              id="quiz-pass"
              label={t("نسبة الاجتياز (%)", "Pass percentage (%)")}
            >
              <input
                id="quiz-pass"
                inputMode="decimal"
                value={percent}
                onChange={(e) => {
                  setPercent(e.target.value);
                  onChange({
                    ...p,
                    passBasisPoints: basisPoints(e.target.value),
                  });
                }}
              />
            </Field>
            <Field
              id="quiz-allowance"
              label={t("عدد المحاولات", "Attempt allowance")}
            >
              <select
                id="quiz-allowance"
                value={p.maxAttempts === null ? "unlimited" : "finite"}
                onChange={(e) =>
                  change({
                    maxAttempts: e.target.value === "unlimited" ? null : 1,
                  })
                }
              >
                <option value="finite">{t("محدود", "Finite")}</option>
                <option value="unlimited">{t("غير محدود", "Unlimited")}</option>
              </select>
            </Field>
            {p.maxAttempts !== null && (
              <Field
                id="quiz-max-attempts"
                label={t("الحد الأقصى للمحاولات", "Maximum attempts")}
              >
                <input
                  id="quiz-max-attempts"
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  value={Number.isFinite(p.maxAttempts) ? p.maxAttempts : ""}
                  onChange={(e) =>
                    onChange({
                      ...p,
                      maxAttempts:
                        e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                />
              </Field>
            )}
            <Field
              id="quiz-minutes"
              label={t(
                "المدة بالدقائق (اختياري)",
                "Time limit in minutes (optional)",
              )}
              help={
                p.timeLimitSeconds !== null && p.timeLimitSeconds % 60 !== 0
                  ? t(
                      `القيمة الحالية الدقيقة: ${p.timeLimitSeconds} ثانية؛ لا تُقرّب تلقائيًا.`,
                      `Exact current value: ${p.timeLimitSeconds} seconds; never rounded automatically.`,
                    )
                  : t(
                      "اتركه فارغًا بلا حد، أو من 1 إلى 180 دقيقة.",
                      "Leave blank for untimed, or use 1–180 minutes.",
                    )
              }
            >
              <input
                id="quiz-minutes"
                aria-describedby="quiz-minutes-help"
                type="number"
                min={1}
                max={180}
                step="any"
                value={
                  p.timeLimitSeconds === null
                    ? ""
                    : Number.isFinite(p.timeLimitSeconds)
                      ? p.timeLimitSeconds / 60
                      : ""
                }
                onChange={(e) =>
                  onChange({
                    ...p,
                    timeLimitSeconds:
                      e.target.value === ""
                        ? null
                        : Number(e.target.value) * 60,
                  })
                }
              />
            </Field>
            <Field id="quiz-required" label={t("الإلزام", "Requirement")}>
              <select
                id="quiz-required"
                value={String(p.required)}
                onChange={(e) =>
                  onChange({ ...p, required: e.target.value === "true" })
                }
              >
                <option value="false">{t("اختياري", "Optional")}</option>
                <option value="true">
                  {t("مطلوب (معلوماتي)", "Required (informational)")}
                </option>
              </select>
            </Field>
          </div>
          <Note>
            {t(
              "المحاولات مدى الحياة عبر الإصدارات وإعادة التفعيل. المطلوب لا يغيّر إكمال الدروس أو التقدم. تغيير النمط لا يعيد ضبط الخيارات الأخرى.",
              "Lifetime attempts span revisions and re-enrollment. Required does not change lesson completion or progress. Changing mode preserves the other settings.",
            )}
          </Note>
          <details open={!!p.opensAt || !!p.closesAt}>
            <summary>
              {t("نافذة الإتاحة (اختيارية)", "Availability window (optional)")}
            </summary>
            <p>
              {t(
                "التوقيت المعروض: الرياض (UTC+03:00)",
                "Display time zone: Riyadh (UTC+03:00)",
              )}
            </p>
            <div className="aa-grid">
              {(
                [
                  ["opensAt", t("يفتح في", "Opens at")],
                  ["closesAt", t("يغلق في", "Closes at")],
                ] as const
              ).map(([k, title]) => (
                <Field key={k} id={`quiz-${k}`} label={title}>
                  <input
                    id={`quiz-${k}`}
                    type="datetime-local"
                    step={1}
                    dir="ltr"
                    value={riyadhInput(p[k])}
                    onChange={(e) =>
                      onChange({ ...p, [k]: riyadhInstant(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
            <small>
              {t(
                "الإغلاق حد نهائي. البدء قرب الإغلاق يمنح المدة المتبقية فقط. تُحفظ الأوقات بصيغة UTC.",
                "Closing time is exclusive. Starting near closure grants only the remaining time. Instants are stored in UTC.",
              )}
            </small>
          </details>
          {(
            [
              ["shuffleQuestions", t("خلط ترتيب الأسئلة", "Shuffle questions")],
              [
                "shuffleOptions",
                t("خلط الخيارات حيث ينطبق", "Shuffle options where applicable"),
              ],
            ] as const
          ).map(([k, title]) => (
            <label className="aa-check" key={k}>
              <input
                type="checkbox"
                checked={p[k]}
                onChange={(e) => onChange({ ...p, [k]: e.target.checked })}
              />
              {title}
            </label>
          ))}
        </fieldset>
      </Panel>
      <Panel
        title={t(
          "متى تظهر الدرجة والمراجعة؟",
          "When can score and review appear?",
        )}
      >
        <fieldset disabled={disabled}>
          <div className="aa-grid three">
            {(
              [
                ["scoreVisibility", t("1. الدرجة", "1. Score")],
                [
                  "reviewVisibility",
                  t(
                    "2. المراجعة والإجابات الصحيحة",
                    "2. Review and correct answers",
                  ),
                ],
                ["explanationVisibility", t("3. التفسير", "3. Explanation")],
              ] as const
            ).map(([k, title], i) => (
              <Field key={k} id={`quiz-${k}`} label={title}>
                <select
                  id={`quiz-${k}`}
                  value={p[k]}
                  onChange={(e) => change({ [k]: e.target.value })}
                >
                  {visibility.map((v) => (
                    <option
                      key={v}
                      value={v}
                      disabled={
                        (p.maxAttempts === null &&
                          v === "after_attempt_limit") ||
                        (i === 1 && !within(p.scoreVisibility, v)) ||
                        (i === 2 && !within(p.reviewVisibility, v))
                      }
                    >
                      {label(v, t)}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </fieldset>
        <Note>
          <strong>
            {t(
              "الدرجة ثم المراجعة ثم التفسير",
              "Score, then review, then explanation",
            )}
          </strong>
          <p>
            {t(
              "الإتاحة بعد المحاولات تتطلب استنفاد الحد المحدود وعدم وجود محاولة قيد التنفيذ لهذا الطالب والاختبار. بدء المحاولة الأخيرة لا يكفي. الإتاحة اليدوية واستنفاد المحاولات شرطان مستقلان.",
              "Attempt-limit release requires a finite exhausted allowance and no IN_PROGRESS attempt for that Student and Quiz. Starting the final attempt is insufficient. Manual release and attempt exhaustion are independent conditions.",
            )}
          </p>
        </Note>
        {p.reviewVisibility === "after_grading" &&
          (p.maxAttempts === null || p.maxAttempts > 1) && (
            <Note>
              {t(
                "يمكن للطالب استخدام الإجابات المكشوفة في محاولات لاحقة. اختر هذه السياسة عن قصد.",
                "Students can reuse disclosed keys in later attempts. Choose this policy deliberately.",
              )}
            </Note>
          )}
      </Panel>
      {proposal && (
        <Modal
          title={t(
            "تحديث سياسات الإتاحة التابعة؟",
            "Update dependent release policies?",
          )}
          onClose={() => setProposal(null)}
          action={t("تطبيق الخيارات", "Apply selections")}
          onConfirm={() => {
            onChange(proposal);
            setProposal(null);
          }}
        >
          <p>
            {t(
              "يلزم تعديل الخيارات التالية حتى لا تسبق المراجعة الدرجة أو يسبق التفسير المراجعة.",
              "These selections must change so review cannot precede score and explanation cannot precede review.",
            )}
          </p>
          <PolicySummary policy={proposal} />
        </Modal>
      )}
    </>
  );
}
export function PolicySummary({ policy: p }: { policy: AssessmentQuizPolicy }) {
  const { t } = useAssessment();
  return (
    <dl>
      {(
        [
          ["scoreVisibility", t("الدرجة", "Score")],
          [
            "reviewVisibility",
            t("المراجعة والإجابات الصحيحة", "Review and correct answers"),
          ],
          ["explanationVisibility", t("التفسير", "Explanation")],
        ] as const
      ).map(([k, title]) => (
        <div key={k} className="aa-row">
          <dt>{title}</dt>
          <dd>{label(p[k], t)}</dd>
        </div>
      ))}
    </dl>
  );
}
