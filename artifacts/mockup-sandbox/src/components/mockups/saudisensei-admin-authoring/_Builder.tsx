import { useState } from "react";
import { BookOpen, Check, Eye, Plus, Save, Trash2 } from "lucide-react";
import {
  AsyncState,
  Empty,
  Field,
  Move,
  Notice,
  Panel,
  Tag,
  samples,
  typeLabel,
  types,
  useDesign,
  type QuestionType,
} from "./_shared";

export function QuizHeading({
  section,
}: {
  section: "builder" | "policy" | "review";
}) {
  const { t, scene, go } = useDesign();
  return (
    <>
      <div className="q7-breadcrumb">
        {t(
          "المقررات / مقدمة في Java / الفصل الثاني · تدفق التحكم",
          "Courses / Introduction to Java / Chapter 2 · Control flow",
        )}
      </div>
      <div className="q7-heading q7-quiz-heading">
        <div>
          <span className="q7-eyebrow">
            {t("اختبار على مستوى الفصل", "CHAPTER QUIZ")}
          </span>
          <h1>
            {scene === "long"
              ? t(
                  "تقييم شامل لفهم الحلقات والتفرّع والتعبيرات المنطقية في تطبيقات البرمجة التمهيدية",
                  "Comprehensive assessment of loops, branching and Boolean expressions in introductory programming applications",
                )
              : t("الحلقات وتدفق التحكم", "Loops & control flow")}
          </h1>
        </div>
        <Tag
          tone={
            scene === "archived"
              ? "neutral"
              : scene === "draft" || scene === "empty"
                ? "warm"
                : "good"
          }
        >
          {scene === "archived"
            ? t("مؤرشف", "Archived")
            : scene === "draft" || scene === "empty"
              ? t("مسودة", "Draft")
              : t("منشور · الإصدار 3", "Published · revision 3")}
        </Tag>
      </div>
      <div className="q7-revision-strip">
        <span className="q7-live-dot" />
        <div>
          <strong>
            {scene === "draft" || scene === "empty"
              ? t("لا إصدار منشور بعد", "No published revision yet")
              : scene === "archived"
                ? t("للقراءة فقط · السجل محفوظ", "Read only · history retained")
                : t(
                    "الإصدار 3 منشور الآن",
                    "Revision 3 is currently published",
                  )}
          </strong>
          <small>
            {scene === "draft" || scene === "empty"
              ? t(
                  "احفظ المحتوى ثم راجع قبل أول نشر.",
                  "Save content, then review before first publication.",
                )
              : t(
                  "تعمل على المسودة. النشر وحده يغيّر ما تستخدمه المحاولات الجديدة.",
                  "You are editing the draft. Only publication changes what new attempts use.",
                )}
          </small>
        </div>
        <Tag tone="warm">{t("مسودة العمل", "Working draft")}</Tag>
      </div>
      <nav
        className="q7-steps"
        aria-label={t("أقسام بناء الاختبار", "Quiz authoring sections")}
      >
        {(
          [
            ["builder", "المحتوى", "Content"],
            ["policy", "السياسة والنشر", "Policy & publication"],
            ["review", "المعاينة والإصدارات", "Preview & revisions"],
          ] as const
        ).map(([id, ar, en], i) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            aria-current={section === id ? "page" : undefined}
            onClick={() => go(id)}
          >
            <b>0{i + 1}</b>
            {t(ar, en)}
          </button>
        ))}
      </nav>
    </>
  );
}

export function Quizzes() {
  const { t, scene, go, setScene, modal } = useDesign();
  const [scope, setScope] = useState("chapter"),
    [status, setStatus] = useState("all");
  return (
    <>
      <div className="q7-heading">
        <div>
          <span className="q7-eyebrow">
            {t("محتوى مرتبط بسياق التعلم", "AUTHOR IN THE LEARNING CONTEXT")}
          </span>
          <h1>{t("الاختبارات", "Quizzes")}</h1>
          <p>
            {t(
              "اختر المقرر والنطاق أولًا. تعرض القائمة اختبارات هذا النطاق فقط.",
              "Choose a course and parent first. The list shows quizzes attached directly to that parent.",
            )}
          </p>
        </div>
        <button
          className="q7-primary"
          onClick={() =>
            modal({
              title: t(
                "إنشاء اختبار في هذا النطاق؟",
                "Create a quiz in this scope?",
              ),
              body: (
                <>
                  <p>
                    {t(
                      "مقدمة في Java / الفصل الثاني · تدفق التحكم",
                      "Introduction to Java / Chapter 2 · Control flow",
                    )}
                  </p>
                  <Notice>
                    {t(
                      "الموقع ثابت من الإنشاء؛ لا يوجد نقل بين المقررات أو الفصول.",
                      "Attachment is fixed at creation. There is no course or parent move action.",
                    )}
                  </Notice>
                </>
              ),
              action: t("بدء المسودة · محاكاة", "Start draft · simulate"),
              onConfirm: () => go("builder"),
            })
          }
        >
          <Plus size={18} />
          {t("إنشاء اختبار", "Create quiz")}
        </button>
      </div>
      <Panel className="q7-scope-picker">
        <div className="q7-form-grid three">
          <Field label={t("المقرر", "Course")}>
            <select>
              <option>{t("مقدمة في Java", "Introduction to Java")}</option>
            </select>
          </Field>
          <Field label={t("النطاق", "Scope")}>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="course">{t("المقرر", "Course")}</option>
              <option value="chapter">{t("الفصل", "Chapter")}</option>
              <option value="lesson">{t("الدرس", "Lesson")}</option>
            </select>
          </Field>
          <Field label={t("الموضع", "Parent")}>
            <select key={scope}>
              <option>
                {scope === "lesson"
                  ? t("الدرس الثالث · الحلقات", "Lesson 3 · Loops")
                  : scope === "course"
                    ? t("مقدمة في Java", "Introduction to Java")
                    : t(
                        "الفصل الثاني · تدفق التحكم",
                        "Chapter 2 · Control flow",
                      )}
              </option>
            </select>
          </Field>
        </div>
      </Panel>
      <div className="q7-filter-bar">
        <Field label={t("الحالة", "Status")}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{t("الكل", "All")}</option>
            <option value="published">{t("منشور", "Published")}</option>
            <option value="draft">{t("مسودة", "Draft")}</option>
            <option value="archived">{t("مؤرشف", "Archived")}</option>
          </select>
        </Field>
        <Field label={t("النمط", "Mode")}>
          <select>
            <option>{t("كل الأنماط", "All modes")}</option>
            <option>{t("تدريب", "Practice")}</option>
            <option>{t("مقيّم", "Graded")}</option>
          </select>
        </Field>
        <Field label={t("الإلزام", "Requirement")}>
          <select>
            <option>{t("الكل", "All")}</option>
            <option>{t("اختياري", "Optional")}</option>
            <option>{t("مطلوب · معلوماتي", "Required · informational")}</option>
          </select>
        </Field>
        <Field label={t("اللغة المؤلفة", "Authored locale")}>
          <select>
            <option>{t("الكل", "All")}</option>
            <option>العربية</option>
            <option>English</option>
          </select>
        </Field>
      </div>
      {scene === "loading" || scene === "error" ? (
        <AsyncState />
      ) : scene === "empty" ? (
        <Empty
          title={t("لا اختبارات في هذا النطاق", "No quizzes in this scope")}
          body={t(
            "اختر نطاقًا آخر أو أنشئ اختبارًا هنا.",
            "Choose another scope, or create a quiz here.",
          )}
        />
      ) : (
        <Panel>
          {["published", "draft", "archived"]
            .filter((x) => status === "all" || x === status)
            .map((x, i) => (
              <div className="q7-quiz-row" key={x}>
                <span className="q7-type-icon">
                  <BookOpen size={22} />
                </span>
                <div>
                  <h2>
                    {i === 0
                      ? t("الحلقات وتدفق التحكم", "Loops & control flow")
                      : t(
                          "مراجعة مفاهيم البرمجة",
                          "Programming concepts review",
                        )}
                  </h2>
                  <p>
                    {t(
                      "العربية + English · مقيّم · اختياري",
                      "Arabic + English · Graded · Optional",
                    )}
                  </p>
                </div>
                <Tag
                  tone={
                    x === "published"
                      ? "good"
                      : x === "draft"
                        ? "warm"
                        : "neutral"
                  }
                >
                  {x === "published"
                    ? t("منشور", "Published")
                    : x === "draft"
                      ? t("مسودة", "Draft")
                      : t("مؤرشف", "Archived")}
                </Tag>
                <button
                  onClick={() => {
                    go("builder");
                    setScene(x === "published" ? "default" : x);
                  }}
                >
                  {t("فتح الاختبار", "Open quiz")}
                </button>
              </div>
            ))}
        </Panel>
      )}
    </>
  );
}

export function Builder() {
  const { en, t, scene, setScene, go, modal, notify } = useDesign();
  const [items, setItems] = useState<
    { key: number; type: QuestionType; points: number }[]
  >(types.map((type, key) => ({ key, type, points: 5 })));
  const [infoDirty, setInfoDirty] = useState(false),
    [itemsDirty, setItemsDirty] = useState(scene === "dirty"),
    [locale, setLocale] = useState("ar");
  const dirty = infoDirty || itemsDirty;
  const empty = scene === "empty",
    locked = scene === "archived";
  const visible = empty ? [] : items,
    total = visible.reduce((sum, x) => sum + x.points, 0);
  function picker() {
    modal({
      title: t("إضافة إصدار سؤال", "Add a question revision"),
      body: (
        <>
          <p>
            {t(
              "ابحث في البنك، افتح السؤال، ثم اختر إصدارًا مثبّتًا بعينه. لا إضافة للمسودات أو تكرار السؤال نفسه.",
              "Search the bank, open a question, then select an exact sealed revision. Drafts and duplicate question identities cannot be added.",
            )}
          </p>
          <Field label={t("البحث في البنك", "Search the bank")}>
            <input type="search" placeholder={t("الحلقات", "Loops")} />
          </Field>
          <div className="q7-picker-result">
            <Tag>{t("اختيار واحد", "Single choice")}</Tag>
            <h3>
              {t(
                "أي حلقة تناسب عددًا معلومًا من التكرارات؟",
                "Which loop suits a known number of iterations?",
              )}
            </h3>
            <p>
              {t(
                "Java / الحلقات · سهل · العربية + English",
                "Java / Loops · Easy · Arabic + English",
              )}
            </p>
            <Field label={t("الإصدار المثبّت", "Sealed revision")}>
              <select>
                <option>
                  {t(
                    "الإصدار 2 · 5 نقاط افتراضية",
                    "Revision 2 · 5 default points",
                  )}
                </option>
              </select>
            </Field>
          </div>
          <Notice>
            {t(
              "اختَر إصدارًا بعينه. لن تُستبدل هذه النسخة تلقائيًا عند تحديث البنك.",
              "Choose an exact revision. Later bank updates will not replace this selection automatically.",
            )}
          </Notice>
        </>
      ),
      action: t("إضافة الإصدار 2 · محاكاة", "Add revision 2 · simulate"),
      onConfirm: () => {
        setScene("default");
        setItems([...visible, { key: 99, type: "single_choice", points: 5 }]);
        setItemsDirty(true);
        notify(
          t("أضيف إلى المسودة المحلية فقط", "Added to the local draft only"),
        );
      },
    });
  }
  return (
    <>
      <QuizHeading section="builder" />
      {scene === "conflict" && (
        <Notice
          tone="error"
          title={t("تعارض في نسخة المسودة", "Draft version conflict")}
        >
          {t(
            "التعديل أو الترتيب لم يُحفظ. احتفظ بالتغييرات محليًا وراجع آخر نسخة قبل إعادة المحاولة. الإصدار المنشور باقٍ.",
            "The edit or reorder was not saved. Keep local changes and review the latest version before retrying. The publication remains intact.",
          )}
          <button
            onClick={() =>
              notify(
                t(
                  "مثال مرئي لمقارنة النسخة الحالية؛ لا استبدال تلقائي",
                  "Visual example of current-version comparison; no automatic overwrite",
                ),
              )
            }
          >
            {t("مراجعة النسخة الحالية", "Review current version")}
          </button>
        </Notice>
      )}
      <div className="q7-builder-layout">
        <div className="q7-stack">
          <details
            className="q7-info-disclosure"
            open={scene === "draft" || scene === "empty"}
          >
            <summary>
              <span>{t("معلومات الاختبار", "Quiz information")}</span>
              <small>
                {t(
                  "العنوان والتعليمات واللغات",
                  "Title, instructions and languages",
                )}
              </small>
              <Tag>{infoDirty ? t("غير محفوظ", "Unsaved") : "AR + EN"}</Tag>
            </summary>
            <Panel
              title={t("معلومات الاختبار", "Quiz information")}
              aside={
                <span className="q7-language-tabs">
                  <button
                    aria-pressed={locale === "ar"}
                    className={locale === "ar" ? "active" : ""}
                    onClick={() => setLocale("ar")}
                  >
                    العربية
                  </button>
                  <button
                    aria-pressed={locale === "en"}
                    className={locale === "en" ? "active" : ""}
                    onClick={() => setLocale("en")}
                  >
                    English
                  </button>
                </span>
              }
            >
              <fieldset disabled={locked} onChange={() => setInfoDirty(true)}>
                <Field label={t("العنوان", "Title")}>
                  <input
                    key={locale}
                    dir={locale === "ar" ? "rtl" : "ltr"}
                    maxLength={255}
                    defaultValue={
                      locale === "ar"
                        ? "الحلقات وتدفق التحكم"
                        : "Loops & control flow"
                    }
                  />
                </Field>
                <Field label={t("التعليمات", "Instructions")}>
                  <textarea
                    key={locale + "instructions"}
                    dir={locale === "ar" ? "rtl" : "ltr"}
                    rows={2}
                    maxLength={20000}
                    defaultValue={
                      locale === "ar"
                        ? "اقرأ كل سؤال بعناية. أجب عن جميع الأسئلة قبل إرسال المحاولة."
                        : "Read each question carefully. Answer all questions before submitting."
                    }
                  />
                </Field>
                <div className="q7-form-grid">
                  <Field label={t("اللغات المؤلفة", "Authored languages")}>
                    <select>
                      <option>العربية + English</option>
                      <option>العربية</option>
                      <option>English</option>
                    </select>
                  </Field>
                  <Field
                    label={t(
                      "لغة المحتوى الافتراضية",
                      "Default content locale",
                    )}
                  >
                    <select>
                      <option>العربية</option>
                      <option>English</option>
                    </select>
                  </Field>
                </div>
              </fieldset>
              <div className="q7-inline-save">
                <small>
                  {t(
                    "حفظ المعلومات منفصل عن حفظ ترتيب الأسئلة.",
                    "Information and question order have separate saves.",
                  )}
                </small>
                <button
                  disabled={locked}
                  onClick={() => {
                    setInfoDirty(false);
                    notify(
                      t(
                        "محاكاة حفظ المعلومات فقط",
                        "Information save simulated only",
                      ),
                    );
                  }}
                >
                  {t("حفظ المعلومات", "Save information")}
                </button>
              </div>
            </Panel>
          </details>
          <Panel
            title={t("تكوين الأسئلة", "Question composition")}
            kicker={<bdi dir="ltr">{visible.length} / 100</bdi>}
            aside={
              <button
                disabled={locked || items.some((x) => x.key === 99)}
                className="q7-primary"
                onClick={picker}
              >
                <Plus size={17} />
                {t("إضافة من البنك", "Add from bank")}
              </button>
            }
          >
            {empty || !visible.length ? (
              <Empty
                title={t("ابدأ بسؤال مثبّت", "Start with a sealed question")}
                body={t(
                  "يمكن حفظ اختبار بلا أسئلة؛ يلزم سؤال واحد على الأقل للمعاينة والنشر.",
                  "An empty quiz may be saved. Preview and publication require at least one question.",
                )}
                action={
                  <button onClick={picker}>
                    {t("اختيار من البنك", "Choose from bank")}
                  </button>
                }
              />
            ) : (
              <ol className="q7-composition">
                {visible.map((item, i) => (
                  <li key={item.key}>
                    <span className="q7-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="q7-item-copy">
                      <span className="q7-item-meta">
                        {typeLabel(item.type, en)} <b>·</b>{" "}
                        {t(
                          `إصدار السؤال ${item.key === 99 ? 2 : 3}`,
                          `Question revision ${item.key === 99 ? 2 : 3}`,
                        )}
                      </span>
                      <h3>{samples[item.type][en ? 1 : 0]}</h3>
                      <button
                        className="q7-inline-link"
                        disabled={locked}
                        onClick={() =>
                          modal({
                            title: t(
                              "اختيار إصدار السؤال",
                              "Select question revision",
                            ),
                            body: (
                              <>
                                <p>
                                  {t(
                                    "الإصدار 3 محدد حاليًا. اختيار إصدار آخر لا يغيّر الإصدار المنشور للاختبار.",
                                    "Revision 3 is selected. Choosing another does not change the published quiz.",
                                  )}
                                </p>
                                <Field label={t("الإصدار", "Revision")}>
                                  <select>
                                    <option>3</option>
                                    <option>2</option>
                                  </select>
                                </Field>
                              </>
                            ),
                            action: t("اختيار · محاكاة", "Select · simulate"),
                            onConfirm: () => {
                              setItemsDirty(true);
                              notify(
                                t(
                                  "اختيار صريح في المسودة فقط",
                                  "Explicit draft selection only",
                                ),
                              );
                            },
                          })
                        }
                      >
                        {t("عرض / اختيار إصدار", "Inspect / select revision")}
                      </button>
                    </div>
                    <Field className="q7-points" label={t("نقاط", "Points")}>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        step={1}
                        disabled={locked}
                        value={item.points}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isInteger(v) && v >= 1 && v <= 1000) {
                            setItems(
                              items.map((x) =>
                                x.key === item.key ? { ...x, points: v } : x,
                              ),
                            );
                            setItemsDirty(true);
                          }
                        }}
                      />
                    </Field>
                    <fieldset disabled={locked} className="q7-item-actions">
                      <Move
                        name={samples[item.type][en ? 1 : 0]}
                        index={i}
                        count={visible.length}
                        onMove={(d) => {
                          const next = [...items];
                          [next[i], next[i + d]] = [next[i + d]!, next[i]!];
                          setItems(next);
                          setItemsDirty(true);
                          notify(
                            t(
                              "تغيّر الترتيب محليًا؛ احفظ الأسئلة",
                              "Order changed locally; save questions",
                            ),
                          );
                        }}
                      />
                      <button
                        aria-label={`${t("إزالة من الاختبار", "Remove from quiz")}: ${typeLabel(item.type, en)}`}
                        onClick={() => {
                          setItems(items.filter((x) => x.key !== item.key));
                          setItemsDirty(true);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </fieldset>
                  </li>
                ))}
              </ol>
            )}
            <div className="q7-inline-save">
              <span>
                <strong>{total}</strong> {t("نقطة إجمالًا", "total points")}
              </span>
              <button
                disabled={locked}
                onClick={() => {
                  setItemsDirty(false);
                  notify(
                    t(
                      "محاكاة حفظ الأسئلة وترتيبها كوحدة واحدة",
                      "Atomic question/order save simulated",
                    ),
                  );
                }}
              >
                <Save size={15} />
                {t("حفظ الأسئلة", "Save questions")}
              </button>
            </div>
          </Panel>
        </div>
        <aside className="q7-stack q7-builder-aside">
          <Panel
            className="q7-summary"
            title={t("ملخص المسودة", "Draft at a glance")}
          >
            <div className="q7-total">
              <strong>{total}</strong>
              <span>{t("نقطة", "points")}</span>
            </div>
            <dl className="q7-facts">
              <div>
                <dt>{t("الأسئلة", "Questions")}</dt>
                <dd>
                  <bdi dir="ltr">{visible.length} / 100</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("النمط", "Mode")}</dt>
                <dd>{t("مقيّم", "Graded")}</dd>
              </div>
              <div>
                <dt>{t("المحاولات", "Attempts")}</dt>
                <dd>2</dd>
              </div>
              <div>
                <dt>{t("المدة", "Duration")}</dt>
                <dd>{t("30 دقيقة", "30 minutes")}</dd>
              </div>
              <div>
                <dt>{t("الحفظ", "Save state")}</dt>
                <dd>
                  {dirty
                    ? t("تغييرات غير محفوظة", "Unsaved changes")
                    : t("محفوظ", "Saved")}
                </dd>
              </div>
            </dl>
            <button className="q7-primary" onClick={() => go("policy")}>
              {t("السياسة والنشر", "Policy & publication")}
            </button>
            <button
              disabled={!visible.length || dirty}
              onClick={() => go("review")}
            >
              <Eye size={16} />
              {t("معاينة المسودة المحفوظة", "Preview saved draft")}
            </button>
          </Panel>
          <Notice
            title={t("كل اختيار ثابت وواضح", "Every selection is explicit")}
          >
            {t(
              "الأسئلة مرتبطة بإصدارات محددة. تحديث البنك لا يستبدل الأسئلة تلقائيًا. النقاط أعداد صحيحة فقط.",
              "Questions pin exact revisions. Bank updates never replace them automatically. Points are integers only.",
            )}
          </Notice>
          <p className="q7-muted-line">
            <Check size={16} />
            {t(
              "المطلوب لا يغيّر إكمال الدروس أو تقدم المقرر",
              "Required does not change lesson completion or course progress",
            )}
          </p>
        </aside>
      </div>
    </>
  );
}
