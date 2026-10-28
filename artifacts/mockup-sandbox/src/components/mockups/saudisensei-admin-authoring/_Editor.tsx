import { useState } from "react";
import { Check, FileCheck2, History, Plus, Save } from "lucide-react";
import {
  Field,
  Move,
  Notice,
  Panel,
  PrivateLabel,
  Tag,
  samples,
  typeLabel,
  types,
  useDesign,
  type QuestionType,
} from "./_shared";

const explanations: Record<QuestionType, [string, string]> = {
  single_choice: [
    "تختبر حلقة while الشرط قبل كل تكرار، دون قسم للتهيئة أو التحديث في بنيتها.",
    "A while loop checks its condition before each iteration and has no initialization or update section in its syntax.",
  ],
  multiple_choice: [
    "for وwhile وdo-while هي بُنى تكرار في Java؛ أما if فهي عبارة شرطية.",
    "for, while and do-while are loop structures in Java; if is a conditional statement.",
  ],
  true_false: [
    "تنفذ do-while جسم الحلقة قبل اختبار الشرط، لذلك يُنفَّذ مرة واحدة على الأقل.",
    "do-while executes the loop body before testing its condition, so the body runs at least once.",
  ],
  ordering: [
    "تبدأ for بالتهيئة، ثم تختبر الشرط، وتنفذ الجسم إذا تحقق، ثم التحديث قبل اختبار الشرط التالي.",
    "A for loop initializes, checks its condition, executes the body if true, then updates before the next condition check.",
  ],
  short_text: [
    "تُنهي break أقرب حلقة محيطة فورًا، ثم يستمر التنفيذ بعد الحلقة.",
    "break exits the nearest enclosing loop immediately; execution continues after that loop.",
  ],
};

export function QuestionEditor() {
  const { en, t, scene, modal, notify } = useDesign();
  const query = new URLSearchParams(window.location.search).get("type");
  const [kind, setKind] = useState<QuestionType>(
    types.includes(query as QuestionType)
      ? (query as QuestionType)
      : "single_choice",
  );
  const [lang, setLang] = useState<"ar" | "en">("ar"),
    [dirty, setDirty] = useState(false),
    [primary, setPrimary] = useState("loops");
  const [order, setOrder] = useState([0, 1, 2, 3]),
    [answer, setAnswer] = useState(1),
    [multi, setMulti] = useState([0, 1, 2]);
  const [localeSet, setLocaleSet] = useState("both");
  const locked = scene === "archived",
    invalid = scene === "validation";
  const choiceLabels =
    kind === "ordering"
      ? lang === "ar"
        ? ["التهيئة", "اختبار الشرط", "تنفيذ الجسم", "التحديث"]
        : ["Initialize", "Check condition", "Execute body", "Update"]
      : ["for", "while", "do-while", "if"];
  function save() {
    if (invalid) {
      notify(
        t(
          "أكمل نص الخيار ومفتاح الإجابة قبل حفظ المسودة.",
          "Complete the option and answer key before saving.",
        ),
      );
      return;
    }
    setDirty(false);
    notify(
      t(
        "تمت محاكاة حفظ المسودة؛ لا بيانات فعلية",
        "Draft save simulated; no real data",
      ),
    );
  }
  return (
    <>
      <div className="q7-heading">
        <div>
          <span className="q7-eyebrow">
            {t("بنك الأسئلة / سؤال محدد", "QUESTION BANK / SELECTED QUESTION")}
          </span>
          <h1>{t("حرّر سؤالًا واضحًا", "Write a clear question.")}</h1>
          <p>
            {t(
              "المحتوى أولًا. مفتاح الإجابة والتفسير في مساحتين منفصلتين.",
              "Content first. Keep the answer key and explanation distinct.",
            )}
          </p>
        </div>
        <div className="q7-actions">
          <Tag tone={locked ? "neutral" : dirty ? "warm" : "good"}>
            {locked
              ? t("مؤرشف · قراءة فقط", "Archived · read only")
              : dirty
                ? t("تغييرات غير محفوظة", "Unsaved changes")
                : t("مسودة محفوظة", "Saved draft")}
          </Tag>
          <button disabled={locked} className="q7-primary" onClick={save}>
            <Save size={16} />
            {t("حفظ المسودة", "Save draft")}
          </button>
        </div>
      </div>
      {scene === "conflict" && (
        <Notice
          tone="error"
          title={t(
            "حُدّث السؤال في جلسة أخرى",
            "This question changed in another session",
          )}
        >
          {t(
            "تغييراتك باقية في هذه الصفحة فقط. حمّل النسخة الحالية وقارنها قبل إعادة الحفظ؛ لا استبدال تلقائي.",
            "Your edits remain in this page only. Load the current version and reconcile before saving; no automatic overwrite.",
          )}{" "}
          <button
            onClick={() =>
              modal({
                title: t("مقارنة قبل الاستبدال", "Compare before replacing"),
                body: t(
                  "اعرض النسخة المحفوظة بجانب تغييراتك. مغادرة الصفحة تفقد التعديلات التي لم تصل إلى الخادم.",
                  "Review the saved version alongside your edits. Leaving loses changes not sent to the server.",
                ),
              })
            }
          >
            {t("مراجعة التعارض", "Review conflict")}
          </button>
        </Notice>
      )}
      <div className="q7-editor-layout">
        <div className="q7-stack">
          <Panel
            kicker={t("01 / محتوى السؤال", "01 / QUESTION CONTENT")}
            title={t("ما الذي تريد أن تسأل عنه؟", "What do you want to ask?")}
          >
            <fieldset disabled={locked} onChange={() => setDirty(true)}>
              <div className="q7-form-grid">
                <Field label={t("نوع الإجابة", "Answer type")}>
                  <select
                    value={kind}
                    onChange={(e) => {
                      const next = e.target.value as QuestionType;
                      modal({
                        title: t("تغيير نوع السؤال؟", "Change question type?"),
                        body: t(
                          "قد تحتاج الخيارات ومفتاح الإجابة إلى إعادة التأليف. لن يتغير أي إصدار سابق.",
                          "Options and the answer key may need rewriting. Earlier revisions remain unchanged.",
                        ),
                        action: t("تغيير النوع", "Change type"),
                        onConfirm: () => {
                          setKind(next);
                          setOrder([0, 1, 2, 3]);
                          setDirty(true);
                        },
                      });
                    }}
                  >
                    {types.map((x) => (
                      <option key={x} value={x}>
                        {typeLabel(x, en)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("اللغات المؤلفة", "Authored languages")}>
                  <select
                    value={localeSet}
                    onChange={(e) => {
                      setLocaleSet(e.target.value);
                      setLang(e.target.value === "en" ? "en" : "ar");
                    }}
                  >
                    <option value="both">العربية + English</option>
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </Field>
              </div>
              <div
                className="q7-language-tabs"
                role="group"
                aria-label={t("لغة المحتوى", "Content language")}
              >
                {["ar", "en"]
                  .filter((x) => localeSet === "both" || localeSet === x)
                  .map((x) => (
                    <button
                      type="button"
                      key={x}
                      aria-pressed={lang === x}
                      className={lang === x ? "active" : ""}
                      onClick={() => setLang(x as "ar" | "en")}
                    >
                      {x === "ar" ? "العربية" : "English"}
                      <Check size={13} />
                    </button>
                  ))}
                <span>
                  {t(
                    "لغة المحتوى مستقلة عن لغة الواجهة",
                    "Content language is separate from interface language",
                  )}
                </span>
              </div>
              <Field
                label={t("نص السؤال", "Question prompt")}
                hint={t(
                  "Markdown مقيّد؛ لا روابط أو صور أو HTML. حد 20,000 حرف.",
                  "Restricted Markdown; no links, images or HTML. 20,000 characters maximum.",
                )}
              >
                <textarea
                  key={kind + lang}
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  rows={3}
                  maxLength={20000}
                  defaultValue={samples[kind][lang === "en" ? 1 : 0]}
                />
              </Field>
              {(kind === "single_choice" ||
                kind === "multiple_choice" ||
                kind === "ordering") && (
                <div className="q7-stack">
                  <div className="q7-row-between">
                    <strong>
                      {kind === "ordering"
                        ? t("العناصر المعروضة", "Displayed items")
                        : t("خيارات الإجابة", "Answer options")}
                    </strong>
                    <small>{t("من 2 إلى 20", "2–20")}</small>
                  </div>
                  {choiceLabels.map((value, i) => (
                    <Field
                      key={`${kind}-${lang}-${i}`}
                      label={`${t("العنصر", "Item")} ${i + 1}`}
                    >
                      <span className="q7-option-input">
                        <b aria-hidden="true">{String.fromCharCode(65 + i)}</b>
                        <input
                          dir="auto"
                          defaultValue={invalid && i === 3 ? "" : value}
                          aria-invalid={invalid && i === 3}
                          aria-describedby={
                            invalid && i === 3 ? "q7-option-error" : undefined
                          }
                        />
                      </span>
                    </Field>
                  ))}
                  {invalid && (
                    <p
                      id="q7-option-error"
                      className="q7-error-text"
                      role="alert"
                    >
                      {t(
                        "أكمل نص العنصر الرابع في اللغتين قبل الحفظ.",
                        "Complete the fourth item in both authored languages before saving.",
                      )}
                    </p>
                  )}
                  <button
                    className="q7-text-button"
                    onClick={() =>
                      notify(
                        t(
                          "مثال مرئي: إضافة عنصر بنفس المعرّف في اللغتين",
                          "Visual example: add an item with the same identity in both languages",
                        ),
                      )
                    }
                  >
                    <Plus size={15} />
                    {t("إضافة عنصر", "Add item")}
                  </button>
                  <p className="q7-help">
                    {t(
                      "تحتفظ الترجمة بهوية العناصر نفسها. الأحرف هنا للعرض فقط ولا تحدد الإجابة.",
                      "Translations share the same item identities. Display letters do not determine correctness.",
                    )}
                  </p>
                </div>
              )}
              <details className="q7-disclosure">
                <summary>
                  {t(
                    "إضافة مقطع Java ثابت (اختياري)",
                    "Add an inert Java snippet (optional)",
                  )}
                </summary>
                <Field
                  label={t("نص الكود · لا تنفيذ", "Code text · no execution")}
                >
                  <textarea
                    dir="ltr"
                    className="q7-code"
                    rows={3}
                    placeholder="for (int i = 0; i < 3; i++) { /* … */ }"
                  />
                </Field>
              </details>
            </fieldset>
          </Panel>
          <Panel
            className="q7-key-panel"
            title={t("مفتاح الإجابة", "Answer key")}
            aside={<PrivateLabel />}
          >
            <fieldset disabled={locked} onChange={() => setDirty(true)}>
              <p className="q7-help">
                {t(
                  "بيانات خاصة بالتأليف. لا تدخل العرض الآمن للطالب. التصحيح كامل أو صفر.",
                  "Private authoring data. Excluded from Student-safe preview. Scoring is all or nothing.",
                )}
              </p>
              {(kind === "single_choice" || kind === "multiple_choice") && (
                <div className="q7-key-options">
                  {choiceLabels.map((x, i) => (
                    <label
                      className={
                        (
                          kind === "single_choice"
                            ? answer === i
                            : multi.includes(i)
                        )
                          ? "chosen"
                          : ""
                      }
                      key={x}
                    >
                      <input
                        type={kind === "single_choice" ? "radio" : "checkbox"}
                        name="answer-key"
                        checked={
                          kind === "single_choice"
                            ? answer === i
                            : multi.includes(i)
                        }
                        onChange={() =>
                          kind === "single_choice"
                            ? setAnswer(i)
                            : setMulti(
                                multi.includes(i)
                                  ? multi.filter((v) => v !== i)
                                  : [...multi, i],
                              )
                        }
                      />
                      <span dir="ltr">{x}</span>
                    </label>
                  ))}
                </div>
              )}
              {kind === "multiple_choice" && (
                <Notice>
                  {t(
                    "يجب تحديد المجموعة الصحيحة كاملة؛ لا درجات جزئية.",
                    "The full correct set must match. No partial credit.",
                  )}
                </Notice>
              )}
              {kind === "true_false" && (
                <div className="q7-key-options">
                  <label className="chosen">
                    <input type="radio" name="boolean-key" defaultChecked />
                    {t("صح", "True")}
                  </label>
                  <label>
                    <input type="radio" name="boolean-key" />
                    {t("خطأ", "False")}
                  </label>
                </div>
              )}
              {kind === "ordering" && (
                <>
                  <p>
                    {t(
                      "رتّب التسلسل الصحيح كاملًا. ترتيب العرض مستقل عن هذا المفتاح.",
                      "Arrange the entire correct sequence. Presentation order is separate from this key.",
                    )}
                  </p>
                  <ol className="q7-order-key">
                    {order.map((x, i) => (
                      <li key={x}>
                        <b>{i + 1}</b>
                        <span>{choiceLabels[x]}</span>
                        <Move
                          name={choiceLabels[x]!}
                          index={i}
                          count={4}
                          onMove={(d) => {
                            const a = [...order];
                            [a[i], a[i + d]] = [a[i + d]!, a[i]!];
                            setOrder(a);
                            setDirty(true);
                          }}
                        />
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {kind === "short_text" && (
                <>
                  <Field
                    label={t(
                      "الإجابات المقبولة · لكل لغة مؤلفة",
                      "Accepted variants · per authored locale",
                    )}
                    hint={t(
                      "من 1 إلى 20 قيمة لكل لغة، حتى 2,000 حرف للقيمة. لا تكرار بعد التطبيع.",
                      "1–20 values per locale, up to 2,000 characters each. No duplicates after normalization.",
                    )}
                  >
                    <textarea dir="ltr" rows={2} defaultValue="break" />
                  </Field>
                  <div className="q7-checks">
                    <label>
                      <input type="checkbox" />
                      {t(
                        "تجاهل المسافات في البداية والنهاية",
                        "Trim leading and trailing whitespace",
                      )}
                    </label>
                    <label>
                      <input type="checkbox" />
                      {t(
                        "دمج المسافات المتتابعة",
                        "Collapse consecutive whitespace",
                      )}
                    </label>
                    <label>
                      <input type="checkbox" />
                      {t("تجاهل حالة الأحرف", "Ignore letter case")}
                    </label>
                  </div>
                  <Notice>
                    {t(
                      "توحيد Unicode NFC ونهايات الأسطر دائمًا. التشكيل وعلامات الترقيم واختلافات الحروف العربية تبقى مهمة. لا مطابقة تقريبية أو ذكاء اصطناعي.",
                      "Unicode NFC and line endings are always normalized. Arabic diacritics, punctuation and letter variants remain meaningful. No fuzzy matching or AI.",
                    )}
                  </Notice>
                </>
              )}
            </fieldset>
          </Panel>
          <Panel
            kicker={t("03 / تفسير الإجابة", "03 / EXPLANATION")}
            title={t("لماذا هذه الإجابة؟", "Why this answer?")}
          >
            <Field
              label={t(
                "التفسير · حسب لغة المحتوى",
                "Explanation · in the content language",
              )}
              hint={t(
                "لا يظهر في المعاينة الآمنة؛ ظهوره للطالب تحكمه سياسة الاختبار بعد النتيجة والمراجعة.",
                "Excluded from safe preview. Student visibility follows score and review release policies.",
              )}
            >
              <textarea
                onChange={() => setDirty(true)}
                disabled={locked}
                key={kind + lang}
                dir={lang === "ar" ? "rtl" : "ltr"}
                rows={3}
                defaultValue={explanations[kind][lang === "en" ? 1 : 0]}
              />
            </Field>
          </Panel>
        </div>
        <aside className="q7-stack">
          <Panel
            kicker={t("سياق السؤال", "QUESTION CONTEXT")}
            title={t("التصنيف", "Classification")}
          >
            <fieldset disabled={locked} onChange={() => setDirty(true)}>
              <Field
                label={t("المهارة الأساسية", "Primary skill")}
                hint={t(
                  "يمكن تأجيلها في المسودة. مطلوبة لتثبيت الإصدار.",
                  "May be missing in a draft. Required to seal.",
                )}
              >
                <select
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                >
                  <option value="loops">
                    {t(
                      "Java / تدفق التحكم / الحلقات",
                      "Java / Control flow / Loops",
                    )}
                  </option>
                  <option value="">
                    {t("لم تُحدّد بعد", "Not assigned yet")}
                  </option>
                </select>
              </Field>
              <Field
                label={t(
                  "مهارات ثانوية (حتى 20)",
                  "Secondary skills (up to 20)",
                )}
              >
                <select multiple defaultValue={["boolean"]} size={2}>
                  <option value="boolean">
                    {t("التعبيرات المنطقية", "Boolean expressions")}
                  </option>
                  <option value="variables">
                    {t("المتغيرات", "Variables")}
                  </option>
                </select>
              </Field>
              <Field label={t("الصعوبة", "Difficulty")}>
                <select>
                  <option>{t("سهل", "Easy")}</option>
                  <option>{t("متوسط", "Medium")}</option>
                  <option>{t("صعب", "Hard")}</option>
                </select>
              </Field>
              <Field
                label={t("النقاط الافتراضية", "Default points")}
                hint={t(
                  "عدد صحيح من 1 إلى 1,000؛ يمكن تخصيصه داخل الاختبار.",
                  "Integer 1–1,000; may be overridden in a quiz.",
                )}
              >
                <input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  defaultValue={5}
                />
              </Field>
              <Field
                label={t("لغة المحتوى الافتراضية", "Default content locale")}
              >
                <select
                  key={localeSet}
                  defaultValue={localeSet === "en" ? "en" : "ar"}
                >
                  <option value="ar" disabled={localeSet === "en"}>
                    العربية
                  </option>
                  <option value="en" disabled={localeSet === "ar"}>
                    English
                  </option>
                </select>
              </Field>
              <fieldset className="q7-checks">
                <legend>{t("الوسوم المعرفية", "Cognitive tags")}</legend>
                {[
                  ["المفاهيم", "Concept"],
                  ["تتبع الكود", "Code tracing"],
                  ["تصحيح الأخطاء", "Debugging"],
                  ["حل المشكلات", "Problem solving"],
                  ["التنفيذ", "Implementation"],
                ].map(([ar, english], i) => (
                  <label key={english}>
                    <input type="checkbox" defaultChecked={i === 0} />
                    {t(ar!, english!)}
                  </label>
                ))}
              </fieldset>
            </fieldset>
          </Panel>
          <Panel
            className="q7-seal-card"
            title={t("جاهز لإعادة الاستخدام؟", "Ready to reuse?")}
          >
            <FileCheck2 size={28} />
            <p>
              {t(
                "ثبّت إصدارًا بعد الحفظ. سيظل هذا الإصدار ثابتًا حتى إذا عدّلت المسودة لاحقًا.",
                "Seal a revision after saving. It stays immutable when the draft changes later.",
              )}
            </p>
            <button
              className="q7-primary"
              disabled={locked || dirty || !primary || invalid}
              onClick={() =>
                modal({
                  title: t("تثبيت إصدار السؤال", "Seal question revision"),
                  body: t(
                    "يُحفظ المحتوى والمفتاح والتصنيف معًا. الاختبارات تستخدم إصدارًا محددًا، ولا تنتقل تلقائيًا إلى إصدار جديد.",
                    "Content, key and classification are sealed together. Quizzes select an exact revision and never upgrade automatically.",
                  ),
                  action: t("تثبيت · محاكاة", "Seal · simulate"),
                  onConfirm: () =>
                    notify(
                      t(
                        "محاكاة فقط؛ لم يُنشأ إصدار",
                        "Simulation only; no revision created",
                      ),
                    ),
                })
              }
            >
              {t("تثبيت إصدار", "Seal revision")}
            </button>
            <p className="q7-help">
              {dirty
                ? t("احفظ المسودة أولًا.", "Save the draft first.")
                : !primary
                  ? t(
                      "اختر مهارة أساسية نشطة.",
                      "Choose an active primary skill.",
                    )
                  : t(
                      "الإصدارات السابقة لا تتغير.",
                      "Earlier revisions stay unchanged.",
                    )}
            </p>
            <span className="q7-muted-line">
              <History size={15} />
              {t(
                "الإصدار السابق 3 · قراءة فقط",
                "Previous revision 3 · read only",
              )}
            </span>
          </Panel>
        </aside>
      </div>
    </>
  );
}
