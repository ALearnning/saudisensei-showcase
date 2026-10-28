import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Layers3,
  Plus,
  Search,
} from "lucide-react";
import {
  AsyncState,
  Empty,
  Field,
  Notice,
  Panel,
  Tag,
  samples,
  typeLabel,
  types,
  useDesign,
} from "./_shared";

export function Landing() {
  const { t, go } = useDesign();
  return (
    <>
      <div className="q7-intro">
        <div>
          <span className="q7-eyebrow">
            {t(
              "من الفكرة إلى تقييم واضح",
              "FROM AN IDEA TO A CLEAR ASSESSMENT",
            )}
          </span>
          <h1>
            {t("مساحة تأليف التقييمات", "Make room for better questions.")}
          </h1>
          <p>
            {t(
              "ابنِ أسئلة قابلة لإعادة الاستخدام، ونظّم مهاراتها، ثم اجمعها في اختبار داخل مقررك.",
              "Build reusable questions, organize their skills, then compose a quiz in its course context.",
            )}
          </p>
        </div>
        <div className="q7-path-art" aria-hidden="true">
          <span>01</span>
          <i />
          <span>02</span>
          <i />
          <span>03</span>
        </div>
      </div>
      <div className="q7-landing-grid">
        {(
          [
            [
              "bank",
              BookOpen,
              "بنك الأسئلة",
              "Question Bank",
              "محتوى مشترك على مستوى المنصة. حرّر المسودة وثبّت إصدارًا جاهزًا للاستخدام.",
              "Shared across the platform. Edit a draft and seal a revision for reuse.",
            ],
            [
              "skills",
              FolderTree,
              "المهارات",
              "Skills",
              "مسارات واضحة للتصنيف. مهارة أساسية واحدة وسياق إضافي عند الحاجة.",
              "Clear classification paths. One primary skill, with optional supporting context.",
            ],
            [
              "quizzes",
              Layers3,
              "الاختبارات",
              "Quizzes",
              "ابدأ بالمقرر والنطاق، ثم رتّب الأسئلة واضبط السياسة قبل النشر.",
              "Choose a course and scope, then compose questions and review the policy.",
            ],
          ] as const
        ).map(([screen, Icon, ar, en, bodyAr, bodyEn], i) => (
          <button
            className="q7-landing-card"
            key={screen}
            onClick={() => go(screen)}
          >
            <span className="q7-card-index">0{i + 1}</span>
            <Icon size={30} aria-hidden="true" />
            <h2>{t(ar, en)}</h2>
            <p>{t(bodyAr, bodyEn)}</p>
            <span>
              {t("فتح المساحة", "Open workspace")} <ArrowUpRight size={17} />
            </span>
          </button>
        ))}
      </div>
      <Notice>
        {t(
          "النشر خطوة مستقلة عن الحفظ. تعديلات المسودة لا تغيّر الإصدار المنشور أو المحاولات السابقة.",
          "Publishing is separate from saving. Draft changes do not alter the published revision or earlier attempts.",
        )}
      </Notice>
    </>
  );
}

export function QuestionBank() {
  const { t, en, scene, go, setScene, modal, notify } = useDesign();
  const [selected, select] = useState(0),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [page, setPage] = useState(1);
  const [difficulty, setDifficulty] = useState(""),
    [status, setStatus] = useState("active"),
    [locale, setLocale] = useState("");
  const items = Array.from({ length: 50 }, (_, i) => ({
    id: `…${(0xa43f + i).toString(16)}`,
    type: types[i % 5]!,
    level: i % 3,
    sealed: i % 4 !== 3,
    archived: i > 44,
  }));
  const filtered = items.filter(
    (x) =>
      (!kind || x.type === kind) &&
      (!difficulty || String(x.level) === difficulty) &&
      (!status || (status === "archived") === x.archived) &&
      (!search ||
        samples[x.type]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!locale || locale === "ar" || x.sealed),
  );
  const noResults = scene === "no-results" || !filtered.length;
  const chosen = items[selected]!;
  return (
    <>
      <div className="q7-heading">
        <div>
          <span className="q7-eyebrow">
            {t("مكتبة مشتركة · لجميع المقررات", "SHARED LIBRARY · ALL COURSES")}
          </span>
          <h1>{t("بنك الأسئلة", "Question Bank")}</h1>
          <p>
            {t(
              "ابحث في المحتوى. اختر سؤالًا لقراءة المسودة وإصداراته.",
              "Search question content. Select a question to inspect its draft and revisions.",
            )}
          </p>
        </div>
        <button className="q7-primary" onClick={() => go("editor")}>
          <Plus size={18} />
          {t("إنشاء سؤال", "Create question")}
        </button>
      </div>
      <div className="q7-search-row">
        <Field label={t("البحث في نص السؤال", "Search question text")}>
          <span className="q7-search">
            <Search size={18} />
            <input
              type="search"
              maxLength={200}
              placeholder={t(
                "مثال: الحلقات أو المتغيرات",
                "Try loops or variables",
              )}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </span>
        </Field>
        <Field label={t("نوع الإجابة", "Answer type")}>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("جميع الأنواع", "All types")}</option>
            {types.map((x) => (
              <option key={x} value={x}>
                {typeLabel(x, en)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("الحالة", "Status")}>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="active">{t("نشط", "Active")}</option>
            <option value="archived">{t("مؤرشف", "Archived")}</option>
            <option value="">{t("الكل", "All")}</option>
          </select>
        </Field>
      </div>
      <details className="q7-filters">
        <summary>
          {t("تصفية إضافية", "More filters")} <ChevronDown size={16} />
        </summary>
        <div className="q7-form-grid">
          <Field label={t("الصعوبة", "Difficulty")}>
            <select
              value={difficulty}
              onChange={(e) => {
                setDifficulty(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("الكل", "All")}</option>
              {[t("سهل", "Easy"), t("متوسط", "Medium"), t("صعب", "Hard")].map(
                (x, i) => (
                  <option value={i} key={x}>
                    {x}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label={t("اللغة المؤلفة", "Authored locale")}>
            <select
              value={locale}
              onChange={(e) => {
                setLocale(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("الكل", "All")}</option>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={t("المهارة الأساسية", "Primary skill")}>
            <select>
              <option>{t("الحلقات · ضمن Java", "Loops · under Java")}</option>
            </select>
          </Field>
          <Field label={t("وسم معرفي", "Cognitive tag")}>
            <select>
              <option>{t("الكل", "All")}</option>
              <option>{t("المفاهيم", "Concept")}</option>
              <option>{t("تتبّع الكود", "Code tracing")}</option>
              <option>{t("تصحيح الأخطاء", "Debugging")}</option>
              <option>{t("حل المشكلات", "Problem solving")}</option>
              <option>{t("التنفيذ", "Implementation")}</option>
            </select>
          </Field>
        </div>
      </details>
      {scene === "loading" || scene === "error" ? (
        <AsyncState />
      ) : scene === "empty" ? (
        <Empty
          title={t("ابدأ بسؤال واحد جيد", "Start with one good question")}
          body={t(
            "أضف محتوى السؤال ومفتاح الإجابة. يمكنك تصنيفه قبل تثبيت الإصدار.",
            "Add question content and its answer key. Complete classification before sealing.",
          )}
          action={
            <button className="q7-primary" onClick={() => go("editor")}>
              {t("إنشاء أول سؤال", "Create your first question")}
            </button>
          }
        />
      ) : noResults ? (
        <Empty
          title={t("لا توجد نتائج مطابقة", "No matching questions")}
          body={t(
            "جرّب كلمات أو فلاتر أخرى.",
            "Try another phrase or fewer filters.",
          )}
          action={
            <button
              onClick={() => {
                setSearch("");
                setKind("");
                setDifficulty("");
                setLocale("");
                setStatus("active");
                setScene("default");
              }}
            >
              {t("مسح الفلاتر", "Clear filters")}
            </button>
          }
        />
      ) : (
        <div className="q7-bank-layout">
          <Panel
            className="q7-bank-list"
            title={t("الأسئلة", "Questions")}
            aside={
              <Tag>
                {filtered.length} {t("نتيجة", "results")}
              </Tag>
            }
          >
            <div className="q7-list-head">
              <span>{t("النوع / المعرّف", "TYPE / ID")}</span>
              <span>{t("التصنيف", "CLASSIFICATION")}</span>
              <span>{t("المحتوى", "CONTENT")}</span>
            </div>
            {filtered.slice((page - 1) * 8, page * 8).map((x) => (
              <button
                key={x.id}
                className={`q7-bank-row ${items.indexOf(x) === selected ? "selected" : ""}`}
                aria-pressed={items.indexOf(x) === selected}
                onClick={() => select(items.indexOf(x))}
              >
                <span>
                  <strong>{typeLabel(x.type, en)}</strong>
                  <small className="q7-mono" dir="ltr">
                    {x.id}
                  </small>
                </span>
                <span>
                  {t("الحلقات", "Loops")}
                  <small>
                    {
                      [
                        t("سهل", "Easy"),
                        t("متوسط", "Medium"),
                        t("صعب", "Hard"),
                      ][x.level]
                    }
                  </small>
                </span>
                <span>
                  <Tag
                    tone={x.archived ? "neutral" : x.sealed ? "good" : "warm"}
                  >
                    {x.archived
                      ? t("مؤرشف", "Archived")
                      : x.sealed
                        ? t("إصدار مثبّت", "Sealed revision")
                        : t("مسودة فقط", "Draft only")}
                  </Tag>
                  <small>{x.sealed ? "AR · EN" : "AR"}</small>
                </span>
              </button>
            ))}
            <div className="q7-pager">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                {t("السابق", "Previous")}
              </button>
              <span>
                <bdi dir="ltr">
                  {page} / {Math.max(1, Math.ceil(filtered.length / 8))}
                </bdi>
              </span>
              <button
                disabled={page * 8 >= filtered.length}
                onClick={() => setPage(page + 1)}
              >
                {t("التالي", "Next")}
              </button>
            </div>
          </Panel>
          <Panel
            className="q7-selected"
            kicker={t("السؤال المحدد · مسودة", "SELECTED QUESTION · DRAFT")}
            title={typeLabel(chosen.type, en)}
            aside={
              <Tag>
                <bdi dir="ltr">{chosen.id}</bdi>
              </Tag>
            }
          >
            <p className="q7-question-copy">
              {samples[chosen.type][en ? 1 : 0]}
            </p>
            {chosen.type === "short_text" ? (
              <div className="q7-preview-choice">
                {t("إجابة نصية قصيرة", "Short text response")}
              </div>
            ) : chosen.type === "true_false" ? (
              <div className="q7-preview-choice">
                {t("صح / خطأ", "True / false")}
              </div>
            ) : (
              (chosen.type === "ordering"
                ? [
                    t("التهيئة", "Initialize"),
                    t("اختبار الشرط", "Check condition"),
                    t("تنفيذ الجسم", "Execute body"),
                    t("التحديث", "Update"),
                  ]
                : ["for", "while", "do-while", "if"]
              ).map((label) => (
                <div className="q7-preview-choice" key={label}>
                  {label}
                </div>
              ))
            )}
            <p className="q7-help">
              {t(
                "معاينة محتوى السؤال المحدد. افتح المحرر لمراجعة مفتاح الإجابة الخاص.",
                "Preview of the selected question. Open the editor to inspect its private answer key.",
              )}
            </p>
            <dl className="q7-facts">
              <div>
                <dt>{t("المهارة الأساسية", "Primary skill")}</dt>
                <dd>
                  {t(
                    "Java ← تدفق التحكم ← الحلقات",
                    "Java → Control flow → Loops",
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("مهارة ثانوية", "Secondary skill")}</dt>
                <dd>{t("التعبيرات المنطقية", "Boolean expressions")}</dd>
              </div>
              <div>
                <dt>{t("الحالة", "Status")}</dt>
                <dd>
                  {chosen.archived || scene === "archived"
                    ? t("مؤرشف · للقراءة فقط", "Archived · read only")
                    : t("نشط · مسودة قابلة للتحرير", "Active · editable draft")}
                </dd>
              </div>
            </dl>
            <div className="q7-actions">
              <button
                className="q7-primary"
                onClick={() => {
                  go("editor");
                  if (chosen.archived || scene === "archived")
                    setScene("archived");
                }}
              >
                {chosen.archived || scene === "archived"
                  ? t("عرض السؤال", "View question")
                  : t("تحرير السؤال", "Edit question")}
              </button>
              <button
                onClick={() =>
                  modal({
                    title: t("إصدارات السؤال", "Question revisions"),
                    body: (
                      <>
                        <p>
                          {t(
                            "الإصدار 3 · 18 أكتوبر 2026 · للقراءة فقط",
                            "Revision 3 · 18 Oct 2026 · read only",
                          )}
                        </p>
                        <p>
                          {t(
                            "اختيار إصدار أحدث داخل اختبار يكون صريحًا؛ لا يُحدّث الاختبارات السابقة.",
                            "Selecting a newer revision in a quiz is explicit; earlier quizzes are unchanged.",
                          )}
                        </p>
                      </>
                    ),
                  })
                }
              >
                {t("الإصدارات", "Revisions")}
              </button>
            </div>
            <button
              className="q7-text-button"
              disabled={chosen.archived || scene === "archived"}
              onClick={() =>
                modal({
                  title: t("أرشفة السؤال؟", "Archive this question?"),
                  body: t(
                    "لن يُستخدم في إضافة أو نشر جديد. تبقى الإصدارات السابقة. لا توجد استعادة حاليًا.",
                    "It cannot be added or republished. Existing revisions remain. Restore is unavailable.",
                  ),
                  action: t("أرشفة السؤال", "Archive question"),
                  danger: true,
                  onConfirm: () => {
                    setScene("archived");
                    notify(t("محاكاة الأرشفة فقط", "Archive simulated only"));
                  },
                })
              }
            >
              {t("أرشفة السؤال", "Archive question")}
            </button>
          </Panel>
        </div>
      )}
    </>
  );
}

export function Skills() {
  const { t, scene, modal, notify } = useDesign();
  const [branch, setBranch] = useState(true),
    [selected, setSelected] = useState("loops"),
    [search, setSearch] = useState("");
  return (
    <>
      <div className="q7-heading">
        <div>
          <span className="q7-eyebrow">
            {t(
              "لغة مشتركة لتصنيف الأسئلة",
              "A SHARED LANGUAGE FOR CLASSIFICATION",
            )}
          </span>
          <h1>{t("المهارات", "Skills")}</h1>
          <p>
            {t(
              "هيكل واضح اليوم. سياق محفوظ للإصدارات السابقة.",
              "A clear hierarchy today. Preserved context for earlier revisions.",
            )}
          </p>
        </div>
        <button
          className="q7-primary"
          onClick={() =>
            modal({
              title: t("مهارة جديدة", "New skill"),
              body: (
                <>
                  <Field label={t("الاسم بالعربية", "Arabic label")}>
                    <input dir="rtl" placeholder="اسم المهارة" />
                  </Field>
                  <Field label="English label">
                    <input dir="ltr" placeholder="Skill label" />
                  </Field>
                  <Field
                    label={t("المعرّف النصي", "Slug")}
                    hint={t(
                      "أحرف لاتينية صغيرة وأرقام وشرطات؛ حتى 160 حرفًا.",
                      "Lowercase ASCII letters, numbers and hyphens; up to 160 characters.",
                    )}
                  >
                    <input dir="ltr" placeholder="loop-conditions" />
                  </Field>
                  <p>
                    {t(
                      "مهارة جذرية، أو اختر أصلًا نشطًا. يلزم اسم بلغة واحدة على الأقل.",
                      "Create a root, or choose an active parent. At least one authored label is required.",
                    )}
                  </p>
                </>
              ),
              action: t("إنشاء · محاكاة", "Create · simulate"),
              onConfirm: () =>
                notify(
                  t(
                    "نموذج مرئي فقط؛ لم تُنشأ مهارة",
                    "Visual example only; no skill created",
                  ),
                ),
            })
          }
        >
          <Plus size={18} />
          {t("إنشاء مهارة", "Create skill")}
        </button>
      </div>
      {scene === "loading" || scene === "error" ? (
        <AsyncState />
      ) : (
        <div className="q7-taxonomy">
          <Panel title={t("شجرة المهارات", "Skill hierarchy")}>
            <Field label={t("البحث في المهارات", "Search skills")}>
              <span className="q7-search">
                <Search size={16} />
                <input
                  type="search"
                  maxLength={120}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("الاسم أو المعرّف النصي", "Label or slug")}
                />
              </span>
            </Field>
            <div
              className="q7-tree"
              aria-label={t("تصفح التسلسل الهرمي", "Browse hierarchy")}
            >
              <button onClick={() => setBranch(!branch)} aria-expanded={branch}>
                <ChevronDown size={16} />
                Java
              </button>
              {branch && (
                <ul>
                  <li>
                    <button
                      className={selected === "control" ? "selected" : ""}
                      onClick={() => setSelected("control")}
                    >
                      <FolderTree size={16} />
                      {t("تدفق التحكم", "Control flow")}
                    </button>
                    <ul>
                      {[
                        ["selection", t("الاختيار", "Selection")],
                        ["loops", t("الحلقات", "Loops")],
                        ["branching", t("التفرّع", "Branching")],
                      ]
                        .filter(
                          ([, label]) =>
                            !search ||
                            label.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map(([id, label]) => (
                          <li key={id}>
                            <button
                              className={selected === id ? "selected" : ""}
                              onClick={() => setSelected(id!)}
                              aria-current={
                                selected === id ? "true" : undefined
                              }
                            >
                              {label}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                  <li>
                    <button onClick={() => setSelected("oop")}>
                      <ChevronRight size={16} />
                      {t("البرمجة الكائنية", "Object-oriented programming")}
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() =>
                        notify(
                          t(
                            "في التكامل: تحميل الصفحة التالية من أبناء هذه المهارة",
                            "Integration: load the next page of this parent's children",
                          ),
                        )
                      }
                    >
                      {t("تحميل المزيد", "Load more")}
                    </button>
                  </li>
                </ul>
              )}
            </div>
            <p className="q7-help">
              {t(
                "تُحمّل الفروع عند فتحها، مع صفحات لكل مستوى. حتى 8 مستويات.",
                "Expand branches on demand, with pagination at each level. Up to 8 levels.",
              )}
            </p>
          </Panel>
          <Panel
            title={
              selected === "loops"
                ? t("الحلقات", "Loops")
                : t("المهارة المحددة", "Selected skill")
            }
            kicker={t("Java / تدفق التحكم", "JAVA / CONTROL FLOW")}
            aside={
              <Tag tone={scene === "archived" ? "neutral" : "good"}>
                {scene === "archived"
                  ? t("مؤرشفة", "Archived")
                  : t("نشطة", "Active")}
              </Tag>
            }
          >
            {scene === "validation" && (
              <Notice
                tone="error"
                title={t("تعذّر نقل المهارة", "Skill cannot be moved")}
              >
                {t(
                  "لا يمكن نقل المهارة تحت نفسها أو أحد فروعها، أو تجاوز 8 مستويات، أو اختيار أصل مؤرشف.",
                  "Choose a parent outside this skill's subtree, within 8 levels and with active ancestors.",
                )}
              </Notice>
            )}
            <fieldset disabled={scene === "archived"}>
              <div className="q7-form-grid">
                <Field label={t("الاسم بالعربية", "Arabic label")}>
                  <input dir="rtl" defaultValue="الحلقات" maxLength={255} />
                </Field>
                <Field label="English label">
                  <input dir="ltr" defaultValue="Loops" maxLength={255} />
                </Field>
              </div>
              <Field label={t("المعرّف النصي", "Slug")}>
                <input dir="ltr" defaultValue="java-loops" maxLength={160} />
              </Field>
              <Field label={t("الوصف بالعربية", "Arabic description")}>
                <textarea
                  dir="rtl"
                  rows={3}
                  defaultValue="تكرار التعليمات والتحكم في شروط استمرار الحلقة."
                  maxLength={2000}
                />
              </Field>
              <Field label="English description">
                <textarea
                  dir="ltr"
                  rows={2}
                  defaultValue="Repeating instructions and controlling loop conditions."
                  maxLength={2000}
                />
              </Field>
            </fieldset>
            <Notice>
              {t(
                "التعديل لا يعيد تصنيف الأسئلة أو الأدلة التاريخية. تبقى المهارة الأساسية والثانوية في كل إصدار كما ثُبّتتا.",
                "Edits do not reclassify historical questions or evidence. Primary and secondary roles remain as sealed in each revision.",
              )}
            </Notice>
            <div className="q7-actions">
              <button
                disabled={scene === "archived"}
                className="q7-primary"
                onClick={() =>
                  notify(
                    t("محاكاة حفظ التفاصيل فقط", "Detail save simulated only"),
                  )
                }
              >
                {t("حفظ التفاصيل", "Save details")}
              </button>
              <button
                disabled={scene === "archived"}
                onClick={() =>
                  modal({
                    title: t("نقل المهارة", "Move skill"),
                    body: (
                      <>
                        <Field label={t("الأصل الجديد", "New parent")}>
                          <select>
                            <option>Java</option>
                            <option>
                              {t("الجذر · بلا أصل", "Root · no parent")}
                            </option>
                            <option disabled>
                              {t(
                                "الحلقات · لا يمكن اختيار نفسها أو فروعها",
                                "Loops · self and descendants unavailable",
                              )}
                            </option>
                          </select>
                        </Field>
                        <Notice>
                          {t(
                            "تُفحص دورة التسلسل وعمق الفرع كاملًا على الخادم قبل النقل.",
                            "The server checks cycles and the full subtree depth before moving.",
                          )}
                        </Notice>
                      </>
                    ),
                    action: t(
                      "تأكيد النقل · محاكاة",
                      "Confirm move · simulate",
                    ),
                    onConfirm: () =>
                      notify(
                        t(
                          "محاكاة فقط؛ لم يتغير الهيكل",
                          "Simulation only; hierarchy unchanged",
                        ),
                      ),
                  })
                }
              >
                {t("نقل", "Move")}
              </button>
              <button
                disabled={scene === "archived"}
                className="q7-text-button"
                onClick={() =>
                  modal({
                    title: t("أرشفة مهارة", "Archive skill"),
                    body: t(
                      "يجب أرشفة الأبناء النشطين أولًا. لا أرشفة جماعية أو إعادة تعيين تلقائية. لا استعادة في هذا الإصدار.",
                      "Archive active children first. There is no cascading archive, automatic reassignment or restore.",
                    ),
                    action: t("أرشفة · محاكاة", "Archive · simulate"),
                    danger: true,
                    onConfirm: () =>
                      notify(
                        t(
                          "مثال تأكيد الأرشفة فقط",
                          "Archive confirmation example only",
                        ),
                      ),
                  })
                }
              >
                {t("أرشفة", "Archive")}
              </button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
