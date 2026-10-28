import { useState } from "react";
import {
  Check,
  Eye,
  FileCheck2,
  History,
  LockKeyhole,
  Send,
  ShieldCheck,
} from "lucide-react";
import { QuizHeading } from "./_Builder";
import { Field, Notice, Panel, PrivateLabel, Tag, useDesign } from "./_shared";

type Visibility =
  "after_grading" | "after_attempt_limit" | "manual_release" | "never";
const visibility: Visibility[] = [
  "after_grading",
  "after_attempt_limit",
  "manual_release",
  "never",
];
const labels: Record<Visibility, [string, string]> = {
  after_grading: ["بعد التصحيح", "After grading"],
  after_attempt_limit: ["بعد استنفاد المحاولات", "After attempt limit"],
  manual_release: ["إتاحة يدوية", "Manual release"],
  never: ["أبدًا", "Never"],
};
const within = (a: Visibility, b: Visibility) =>
  b === "never" || a === b || a === "after_grading";

export function PolicyPublication() {
  const { en, t, scene, setScene, modal, notify } = useDesign();
  const [policy, setPolicy] = useState<Visibility[]>([
      "after_grading",
      "manual_release",
      "manual_release",
    ]),
    [unlimited, setUnlimited] = useState(false),
    [saved, setSaved] = useState(true),
    [mode, setMode] = useState("graded");
  const [attempts, setAttempts] = useState("2"),
    [duration, setDuration] = useState("30"),
    [threshold, setThreshold] = useState("70");
  const locked = scene === "archived",
    invalid = scene === "invalid-policy" || scene === "validation",
    failed = scene === "failed-publication";
  function change(index: number, value: Visibility) {
    const next = [...policy];
    next[index] = value;
    if (!within(next[0]!, next[1]!) || !within(next[1]!, next[2]!)) {
      const fixed = [...next];
      if (!within(fixed[0]!, fixed[1]!)) fixed[1] = fixed[0]!;
      if (!within(fixed[1]!, fixed[2]!)) fixed[2] = fixed[1]!;
      modal({
        title: t(
          "تعديل الحقول التابعة؟",
          "Update dependent visibility fields?",
        ),
        body: (
          <>
            <p>
              {t(
                "لا يمكن إتاحة المراجعة قبل الدرجة أو التفسير قبل المراجعة. راجع التغيير المقترح قبل تطبيقه.",
                "Review cannot precede score, and explanation cannot precede review. Confirm these proposed changes.",
              )}
            </p>
            <p>{fixed.map((x) => labels[x][en ? 1 : 0]).join(" / ")}</p>
          </>
        ),
        action: t("تطبيق الاختيارات", "Apply selections"),
        onConfirm: () => {
          setPolicy(fixed);
          setSaved(false);
        },
      });
    } else {
      setPolicy(next);
      setSaved(false);
    }
  }
  return (
    <>
      <QuizHeading section="policy" />
      {failed && (
        <Notice
          tone="error"
          title={t("لم يُنشر إصدار جديد", "A new revision was not published")}
        >
          {t(
            "تعذّر إتمام النشر. الإصدار 3 ما زال منشورًا كما هو. احتفظنا بالمسودة؛ راجع الحالة الحالية قبل إعادة المحاولة.",
            "Publication could not complete. Revision 3 is still published unchanged. The draft remains; refresh its status before retrying.",
          )}
        </Notice>
      )}
      {invalid && (
        <Notice
          tone="error"
          title={t("السياسة غير متوافقة", "This policy is incompatible")}
        >
          {t(
            "مثال لمسودة قديمة: الدرجة «أبدًا» والمراجعة «بعد التصحيح». لا يمكن حفظها أو نشرها بهذه الصورة. اختر سياسة صحيحة أدناه؛ الإصدارات التاريخية تظل محفوظة ومحكومة بالخادم.",
            "Legacy draft example: score Never, review After grading. It cannot be saved or published in that form. Choose a valid policy below; historical revisions remain preserved and server-gated.",
          )}
          <button onClick={() => setScene("default")}>
            {t("مراجعة الاختيارات الصحيحة", "Review valid selections")}
          </button>
        </Notice>
      )}
      <div className="q7-builder-layout">
        <div className="q7-stack">
          <Panel
            title={t("المحاولات والتوقيت", "Attempts & timing")}
            kicker={t(
              "سياسة المسودة · تُثبّت عند النشر",
              "DRAFT POLICY · SEALED AT PUBLICATION",
            )}
          >
            <fieldset disabled={locked} onChange={() => setSaved(false)}>
              <div className="q7-form-grid">
                <Field label={t("نمط التقييم", "Assessment mode")}>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="graded">{t("مقيّم", "Graded")}</option>
                    <option value="practice">{t("تدريب", "Practice")}</option>
                  </select>
                </Field>
                <Field
                  label={t("نسبة الاجتياز", "Pass threshold")}
                  hint={t(
                    "من 0 إلى 100% بدقة منزلتين؛ القرار بحساب صحيح على الخادم.",
                    "0–100%, two decimal places; server uses exact integer arithmetic.",
                  )}
                >
                  <span className="q7-suffix-input">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                    <span>%</span>
                  </span>
                </Field>
                <Field label={t("عدد المحاولات", "Attempt allowance")}>
                  <select
                    value={unlimited ? "unlimited" : "finite"}
                    onChange={(e) => {
                      if (
                        e.target.value === "unlimited" &&
                        policy.includes("after_attempt_limit")
                      ) {
                        modal({
                          title: t(
                            "غيّر سياسة الإتاحة أولًا",
                            "Change visibility first",
                          ),
                          body: t(
                            "المحاولات غير المحدودة لا تُستنفد. اختر إتاحة أخرى للحقول المعتمدة على حد المحاولات، ثم عد لهذا الخيار.",
                            "Unlimited attempts never exhaust. Change fields using attempt-limit visibility before selecting unlimited.",
                          ),
                        });
                      } else setUnlimited(e.target.value === "unlimited");
                    }}
                  >
                    <option value="finite">
                      {t("عدد محدد", "Finite allowance")}
                    </option>
                    <option value="unlimited">
                      {t("غير محدود", "Unlimited")}
                    </option>
                  </select>
                </Field>
                {!unlimited && (
                  <Field label={t("الحد الأقصى للمحاولات", "Maximum attempts")}>
                    <input
                      type="number"
                      min={1}
                      max={2147483647}
                      value={attempts}
                      onChange={(e) => setAttempts(e.target.value)}
                    />
                  </Field>
                )}
                <Field
                  label={t(
                    "المدة بالدقائق · اختياري",
                    "Time limit, minutes · optional",
                  )}
                  hint={t(
                    "اتركه فارغًا بلا مدة؛ أو من 1 إلى 180 دقيقة.",
                    "Leave blank for untimed, or choose 1–180 minutes.",
                  )}
                >
                  <input
                    type="number"
                    min={1}
                    max={180}
                    step={1}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </Field>
                <Field label={t("الإلزام", "Requirement")}>
                  <select>
                    <option>{t("اختياري", "Optional")}</option>
                    <option>
                      {t(
                        "مطلوب · معلوماتي فقط",
                        "Required · informational only",
                      )}
                    </option>
                  </select>
                </Field>
              </div>
              <p className="q7-help">
                {t(
                  "تُحسب المحاولات عبر جميع الإصدارات وإعادة التفعيل. تغيير النمط هنا لا يعيد ضبط بقية اختياراتك. المطلوب لا يغلق الدروس أو يغيّر التقدم.",
                  "Allowance spans revisions and re-enrollment. Changing mode here preserves your other selections. Required does not gate lessons or alter progress.",
                )}
              </p>
              <details className="q7-disclosure" open>
                <summary>
                  {t(
                    "نافذة الإتاحة · اختياري",
                    "Availability window · optional",
                  )}
                </summary>
                <p className="q7-timezone">
                  {t(
                    "التوقيت المعروض: الرياض (UTC+03:00)",
                    "Displayed time zone: Riyadh (UTC+03:00)",
                  )}
                </p>
                <div className="q7-form-grid">
                  <Field label={t("يفتح في", "Opens at")}>
                    <input
                      dir="ltr"
                      type="datetime-local"
                      defaultValue="2026-11-01T09:00"
                    />
                  </Field>
                  <Field label={t("يغلق في", "Closes at")}>
                    <input
                      dir="ltr"
                      type="datetime-local"
                      defaultValue="2026-11-01T11:00"
                    />
                  </Field>
                </div>
                <Notice>
                  {t(
                    "تغلق النافذة عند 11:00 تمامًا. بدء محاولة في 10:50 يمنح 10 دقائق فقط، ولو كانت المدة 30 دقيقة. تُحفظ الأوقات بصيغة UTC.",
                    "The window closes at exactly 11:00. A 10:50 start has only 10 minutes, even with a 30-minute limit. Instants are stored in UTC.",
                  )}
                </Notice>
              </details>
              <div className="q7-checks">
                <label>
                  <input type="checkbox" />
                  {t("خلط ترتيب الأسئلة", "Shuffle questions")}
                </label>
                <label>
                  <input type="checkbox" />
                  {t(
                    "خلط الخيارات حيث ينطبق",
                    "Shuffle options where applicable",
                  )}
                </label>
              </div>
            </fieldset>
          </Panel>
          <Panel
            title={t(
              "متى تظهر النتيجة والمراجعة؟",
              "When can results and review appear?",
            )}
            kicker={t(
              "الدرجة ← المراجعة ← التفسير",
              "SCORE → REVIEW → EXPLANATION",
            )}
          >
            <fieldset disabled={locked}>
              <div className="q7-visibility-stack">
                {[
                  ["الدرجة", "Score"],
                  ["المراجعة والإجابات الصحيحة", "Review & correct answers"],
                  ["التفسير", "Explanation"],
                ].map(([ar, english], i) => (
                  <Field key={english} label={`${i + 1}. ${t(ar!, english!)}`}>
                    <select
                      value={policy[i]}
                      onChange={(e) => change(i, e.target.value as Visibility)}
                    >
                      {visibility.map((v) => (
                        <option
                          key={v}
                          value={v}
                          disabled={
                            (unlimited && v === "after_attempt_limit") ||
                            (i > 0 && !within(policy[i - 1]!, v))
                          }
                        >
                          {labels[v][en ? 1 : 0]}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </fieldset>
            <div className="q7-release-rule">
              <ShieldCheck size={22} />
              <div>
                <strong>
                  {t(
                    "لا إتاحة للمراجعة قبل الدرجة",
                    "Review never precedes score",
                  )}
                </strong>
                <p>
                  {t(
                    "بعد حد المحاولات يعني استنفاد الحد المحدود وعدم وجود أي محاولة قيد التنفيذ لهذا الطالب والاختبار. بدء المحاولة الأخيرة لا يكفي. الإتاحة اليدوية وحدّ المحاولات شرطان مستقلان.",
                    "Attempt-limit release requires a finite exhausted allowance and no in-progress attempt for that Student and Quiz. Starting the final attempt is insufficient. Manual release and attempt exhaustion are independent conditions.",
                  )}
                </p>
              </div>
            </div>
            {policy[1] === "after_grading" && (
              <Notice tone="warning">
                {t(
                  "المراجعة الفورية قد تكشف المفاتيح قبل محاولات لاحقة. تأكد أن ذلك مقصود.",
                  "Immediate review can reveal keys before later retries. Confirm this is intentional.",
                )}
              </Notice>
            )}
            <div className="q7-inline-save">
              <Tag tone={saved ? "good" : "warm"}>
                {saved
                  ? t("السياسة محفوظة", "Policy saved")
                  : t("تغييرات غير محفوظة", "Unsaved changes")}
              </Tag>
              <button
                disabled={locked || invalid}
                onClick={() => {
                  setSaved(true);
                  notify(
                    t("محاكاة حفظ السياسة فقط", "Policy save simulated only"),
                  );
                }}
              >
                {t("حفظ السياسة", "Save policy")}
              </button>
            </div>
          </Panel>
        </div>
        <aside className="q7-stack q7-builder-aside">
          <Panel
            className="q7-readiness"
            title={t("مراجعة قبل النشر", "Before you publish")}
          >
            <FileCheck2 size={29} />
            <ul className="q7-checklist">
              {[
                t("العنوان واللغة الافتراضية", "Title and default locale"),
                t(
                  "5 أسئلة بإصدارات محددة",
                  "5 questions with pinned revisions",
                ),
                t("25 نقطة صحيحة", "25 integer points"),
                invalid
                  ? t("السياسة تحتاج تصحيحًا", "Policy needs correction")
                  : t("ترتيب وسياسة متوافقان", "Valid order and policy"),
              ].map((x, index) => (
                <li
                  key={x}
                  className={
                    invalid && index === 3 ? "q7-error-text" : undefined
                  }
                >
                  {invalid && index === 3 ? (
                    <strong aria-hidden="true">!</strong>
                  ) : (
                    <Check size={16} />
                  )}
                  {x}
                </li>
              ))}
            </ul>
            <p className="q7-help">
              {t(
                "هذه مراجعة محلية. الخادم يعيد فحص أهلية النطاق والأسئلة والمهارات والنقاط والسياسة عند النشر.",
                "This is a local checklist. The server rechecks parent, question and skill eligibility, totals and policy at publication.",
              )}
            </p>
            <button
              className="q7-primary"
              disabled={!saved || invalid || locked}
              onClick={() =>
                modal({
                  title: t("نشر إصدار جديد؟", "Publish a new revision?"),
                  body: (
                    <>
                      <p>
                        <strong>
                          {t(
                            "الحلقات وتدفق التحكم · الإصدار التالي",
                            "Loops & control flow · next revision",
                          )}
                        </strong>
                      </p>
                      <p>
                        {t(
                          "5 أسئلة · 25 نقطة · نطاق الفصل الثاني",
                          "5 questions · 25 points · Chapter 2",
                        )}
                      </p>
                      <p>
                        {t("المحاولات", "Attempts")}:{" "}
                        {unlimited ? t("غير محدودة", "Unlimited") : attempts} ·{" "}
                        {t("المدة بالدقائق", "Minutes")}:{" "}
                        {duration || t("بلا مدة", "Untimed")} ·{" "}
                        {t("الاجتياز", "Pass")}: {threshold}%
                      </p>
                      <p>
                        {policy.map((v) => labels[v][en ? 1 : 0]).join(" / ")}
                      </p>
                      <Notice>
                        {t(
                          "تستخدم المحاولات الجديدة الإصدار الجديد. المحاولات السابقة تحتفظ بمحتواها وسياستها. لا تظهر حالة منشور حتى يؤكد الخادم نجاح العملية.",
                          "New attempts use the new revision. Earlier attempts keep their content and policy. Published status appears only after server confirmation.",
                        )}
                      </Notice>
                    </>
                  ),
                  action: t(
                    "تأكيد النشر · محاكاة",
                    "Confirm publication · simulate",
                  ),
                  onConfirm: () =>
                    notify(
                      t(
                        "محاكاة التأكيد فقط؛ لم يُنشر اختبار",
                        "Confirmation simulated only; no quiz published",
                      ),
                    ),
                })
              }
            >
              <Send size={16} />
              {t("مراجعة وتأكيد النشر", "Review & confirm publication")}
            </button>
            <p>
              {t(
                "المسودة ليست الإصدار المنشور.",
                "The draft is not the published revision.",
              )}
            </p>
          </Panel>
          <Panel title={t("الإصدار الحالي", "Current publication")}>
            <Tag tone={locked ? "neutral" : "good"}>
              {locked
                ? t(
                    "الإصدار 3 · محفوظ تاريخيًا",
                    "Revision 3 · retained history",
                  )
                : t("الإصدار 3 · منشور", "Revision 3 · published")}
            </Tag>
            <p>
              {t(
                "يبقى كما هو إذا فشل نشر المسودة.",
                "Remains unchanged if publishing the draft fails.",
              )}
            </p>
            <button
              disabled={locked}
              onClick={() =>
                modal({
                  title: t("إلغاء نشر الاختبار؟", "Unpublish this quiz?"),
                  body: t(
                    "يتوقف بدء المحاولات والوصول التفاعلي، بما في ذلك الاستئناف والنتائج والمراجعة. تبقى الإجابات والسجلات؛ قد تستمر المعالجة الداخلية. يعود الاختبار إلى مسودة دون حذف الإصدارات.",
                    "Stops new attempts and interactive access, including resume, results and review. Answers and history remain; internal processing may continue. Returns the quiz to draft without deleting revisions.",
                  ),
                  action: t("إلغاء النشر · محاكاة", "Unpublish · simulate"),
                  danger: true,
                  onConfirm: () =>
                    notify(
                      t(
                        "محاكاة فقط؛ النشر الفعلي لم يتغير",
                        "Simulation only; actual publication unchanged",
                      ),
                    ),
                })
              }
            >
              {t("إلغاء النشر", "Unpublish")}
            </button>
            <button
              disabled={locked}
              className="q7-text-button"
              onClick={() =>
                modal({
                  title: t("أرشفة الاختبار؟", "Archive this quiz?"),
                  body: t(
                    "يصبح للقراءة فقط ويتوقف وصول الطلاب التفاعلي. السجل محفوظ ولا توجد استعادة أو حذف نهائي.",
                    "Authoring becomes read only and Student interactive access stops. History remains; no restore or hard delete.",
                  ),
                  action: t("أرشفة · محاكاة", "Archive · simulate"),
                  danger: true,
                  onConfirm: () =>
                    notify(
                      t(
                        "تأكيد الأرشفة مرئي فقط",
                        "Archive confirmation is visual only",
                      ),
                    ),
                })
              }
            >
              {t("أرشفة الاختبار", "Archive quiz")}
            </button>
          </Panel>
        </aside>
      </div>
    </>
  );
}

export function PreviewRelease() {
  const { t, en, scene, modal, notify } = useDesign();
  const [privateView, setPrivateView] = useState(false),
    [locale, setLocale] = useState("ar"),
    [revision, setRevision] = useState(3),
    [released, setReleased] = useState<Record<number, boolean>>({});
  const isReleased = !!released[revision] || scene === "released",
    na = scene === "release-na" || revision === 1,
    locked = scene === "archived";
  function requestRelease() {
    modal({
      title: t(
        `إتاحة الإصدار ${revision} يدويًا؟`,
        `Manually release revision ${revision}?`,
      ),
      body: (
        <>
          <div className="q7-release-target">
            <strong>{t("الحلقات وتدفق التحكم", "Loops & control flow")}</strong>
            <span>
              {t(
                "الفصل الثاني · مقدمة في Java",
                "Chapter 2 · Introduction to Java",
              )}
            </span>
            <b>
              {t(
                `إصدار الاختبار ${revision} فقط`,
                `Quiz revision ${revision} only`,
              )}
            </b>
            <code dir="ltr">…b7e{revision}</code>
          </div>
          <Notice
            tone="warning"
            title={t("لا يمكن التراجع", "Cannot be undone")}
          >
            {t(
              "ينطبق على جميع المحاولات المرتبطة بهذا الإصدار، بعد تحقق الوصول والتصحيح وسياسات الدرجة والمراجعة والتفسير. لا يغيّر الدرجات ولا يحرر إصدارًا آخر.",
              "Applies to attempts pinned to this revision, subject to access, grading and score/review/explanation gates. It does not change grades or release another revision.",
            )}
          </Notice>
          <p>
            {t(
              "ستُتاح حقول الإتاحة اليدوية في هذا الإصدار فقط؛ لا يتجاوز ذلك الشروط الأخرى.",
              "Only this revision's manual-release conditions are satisfied; other gates still apply.",
            )}
          </p>
        </>
      ),
      action: t(
        `إتاحة الإصدار ${revision} · محاكاة`,
        `Release revision ${revision} · simulate`,
      ),
      danger: true,
      onConfirm: () => {
        setReleased({ ...released, [revision]: true });
        notify(
          t(
            "تمت محاكاة الإتاحة لهذا الإصدار فقط",
            "Release simulated for this revision only",
          ),
        );
      },
    });
  }
  return (
    <>
      <QuizHeading section="review" />
      <div className="q7-preview-layout">
        <div className="q7-stack">
          <Panel
            title={t("معاينة المسودة المحفوظة", "Preview saved draft")}
            aside={<Eye size={20} />}
          >
            <div
              className="q7-preview-modes"
              role="group"
              aria-label={t("نوع المعاينة", "Preview mode")}
            >
              <button
                aria-pressed={!privateView}
                className={!privateView ? "active" : ""}
                onClick={() => setPrivateView(false)}
              >
                <ShieldCheck size={17} />
                {t("عرض آمن للطالب", "Student-safe preview")}
              </button>
              <button
                aria-pressed={privateView}
                className={privateView ? "active private" : ""}
                onClick={() => setPrivateView(true)}
              >
                <LockKeyhole size={17} />
                {t("إجابات المشرف", "Admin answers")}
              </button>
            </div>
            <Notice
              tone={privateView ? "warning" : "info"}
              title={
                privateView
                  ? t("خاص بالمشرف فقط", "Private · Admin only")
                  : t(
                      "بلا مفاتيح إجابة أو تفسيرات",
                      "No answer keys or explanations",
                    )
              }
            >
              {privateView
                ? t(
                    "معاينة خاصة تتضمن مفاتيح الإجابة. لا تستخدمها لمشاركة العرض مع الطلاب.",
                    "Private preview contains answer keys. Do not use it for a Student-facing display.",
                  )
                : t(
                    "عرض للتأليف فقط: لا محاولة أو مؤقت أو تصحيح. يُعرض ترتيب التأليف دون خلط.",
                    "Authoring preview only: no attempt, timer or grading. Displays authored order without shuffling.",
                  )}
            </Notice>
            <Field
              label={t("لغة المعاينة المطلوبة", "Requested preview language")}
            >
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </Field>
            <article
              className="q7-paper-preview"
              lang={locale}
              dir={locale === "ar" ? "rtl" : "ltr"}
            >
              <div className="q7-row-between">
                <Tag>
                  {locale === "ar"
                    ? "العربية · اللغة المعروضة"
                    : "English · resolved locale"}
                </Tag>
                <span>
                  {locale === "ar"
                    ? "السؤال 1 · 5 نقاط"
                    : "Question 1 · 5 points"}
                </span>
              </div>
              <h2>
                {locale === "ar"
                  ? "أي حلقة تختبر الشرط قبل التكرار ولا تضم قسمًا للتهيئة أو التحديث؟"
                  : "Which loop checks its condition before each iteration, without an initialization or update section?"}
              </h2>
              {["for", "while", "if"].map((label, i) => (
                <div
                  key={label}
                  className={`q7-preview-choice ${privateView && i === 1 ? "answer" : ""}`}
                >
                  <span className="q7-radio-mark" />
                  <bdi>{label}</bdi>
                  {privateView && i === 1 && (
                    <Tag tone="good">{t("صحيح", "Correct")}</Tag>
                  )}
                </div>
              ))}
              {privateView && (
                <div className="q7-answer-explanation">
                  <PrivateLabel />
                  <p>
                    {locale === "ar"
                      ? "التفسير: تختبر while الشرط قبل كل تكرار."
                      : "Explanation: while checks its condition before each iteration."}
                  </p>
                </div>
              )}
            </article>
            <p className="q7-help">
              {t(
                "إذا لم تُؤلف اللغة المطلوبة، يُظهر كل عنصر لغته الافتراضية مع بيانها. لا ترجمة تلقائية.",
                "If the requested locale is missing, each item shows its authored default with an explicit locale label. No automatic translation.",
              )}
            </p>
          </Panel>
        </div>
        <aside className="q7-stack">
          <Panel
            title={t("الإصدارات المنشورة سابقًا", "Published revision history")}
            aside={<History size={20} />}
          >
            <p className="q7-help">
              {t(
                "المعاينة بجانبك للمسودة. اختيار إصدار هنا يفتح تفاصيله التاريخية فقط.",
                "The preview beside this panel is the draft. Selecting a revision here opens its historical details only.",
              )}
            </p>
            <div className="q7-revision-list">
              {[3, 2, 1].map((r) => (
                <button
                  key={r}
                  className={revision === r ? "selected" : ""}
                  aria-pressed={revision === r}
                  onClick={() => {
                    setRevision(r);
                  }}
                >
                  <span>
                    <strong>{t(`الإصدار ${r}`, `Revision ${r}`)}</strong>
                    <small>
                      <bdi>{14 + r} Oct 2026</bdi> · 25 {t("نقطة", "points")}
                    </small>
                  </span>
                  {r === 3 && !locked ? (
                    <Tag tone="good">{t("نشط", "Current")}</Tag>
                  ) : (
                    <Tag>{t("تاريخي", "Historical")}</Tag>
                  )}
                </button>
              ))}
            </div>
          </Panel>
          <Panel
            className="q7-release-panel"
            title={t("الإتاحة اليدوية", "Manual release")}
            kicker={t(
              `تفاصيل الإصدار ${revision} المحدد`,
              `SELECTED REVISION ${revision} DETAILS`,
            )}
          >
            <dl className="q7-facts">
              <div>
                <dt>{t("الدرجة", "Score")}</dt>
                <dd>{t("بعد التصحيح", "After grading")}</dd>
              </div>
              <div>
                <dt>{t("المراجعة", "Review")}</dt>
                <dd>
                  {na
                    ? t("أبدًا", "Never")
                    : t("إتاحة يدوية", "Manual release")}
                </dd>
              </div>
              <div>
                <dt>{t("التفسير", "Explanation")}</dt>
                <dd>
                  {na
                    ? t("أبدًا", "Never")
                    : t("إتاحة يدوية", "Manual release")}
                </dd>
              </div>
            </dl>
            {na ? (
              <Notice>
                {t(
                  "لا تنطبق الإتاحة اليدوية: لا حقل يستخدم هذه السياسة في الإصدار المحدد.",
                  "Not applicable: no field uses manual release in this revision.",
                )}
              </Notice>
            ) : isReleased ? (
              <Notice title={t("أُتيح مسبقًا", "Already released")}>
                <Check size={16} />{" "}
                <bdi>
                  {en
                    ? "23 Oct 2026 · 10:30 Riyadh"
                    : "23 أكتوبر 2026 · 10:30 الرياض"}
                </bdi>
                <p>
                  {t(
                    "إعادة الطلب تعيد الإيصال نفسه. لا تراجع عن الإتاحة.",
                    "A repeated request returns the same receipt. There is no revoke action.",
                  )}
                </p>
              </Notice>
            ) : (
              <>
                <p>
                  {t(
                    "خطوة مستقلة عن النشر والتصحيح. لا تُتاح إصدارات أخرى تلقائيًا.",
                    "Separate from publishing and grading. Other revisions are not released automatically.",
                  )}
                </p>
                <button
                  className="q7-primary"
                  disabled={locked}
                  onClick={requestRelease}
                >
                  <LockKeyhole size={16} />
                  {t(
                    `إتاحة الإصدار ${revision}`,
                    `Release revision ${revision}`,
                  )}
                </button>
              </>
            )}
            <p className="q7-help">
              {t(
                "درجة ثم مراجعة ثم تفسير؛ تظل شروط الوصول والسياسات التاريخية هي المرجع.",
                "Score, then review, then explanation; access and historical policies remain authoritative.",
              )}
            </p>
          </Panel>
          <Notice>
            {t(
              "تقارير محاولات الطلاب ليست ضمن الواجهات الحالية؛ لا جدول درجات أو تنزيل تقرير في هذا التصميم.",
              "Admin attempt-report APIs are not available. No grade table or report download is proposed here.",
            )}
          </Notice>
        </aside>
      </div>
    </>
  );
}
