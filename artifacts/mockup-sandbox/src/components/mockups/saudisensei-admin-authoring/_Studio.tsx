import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  FolderTree,
  GraduationCap,
  Layers3,
  LogOut,
  X,
} from "lucide-react";
import { DesignContext, type ModalSpec, type Screen } from "./_shared";
import { Landing, QuestionBank, Skills } from "./_Library";
import { QuestionEditor } from "./_Editor";
import { Builder, Quizzes } from "./_Builder";
import { PolicyPublication, PreviewRelease } from "./_Publication";
import "./_styles.css";

const screens: [Screen, string, string][] = [
  ["home", "البداية", "Overview"],
  ["bank", "بنك الأسئلة", "Question Bank"],
  ["editor", "محرر السؤال", "Question editor"],
  ["skills", "المهارات", "Skills"],
  ["quizzes", "قائمة الاختبارات", "Quiz list"],
  ["builder", "بناء الاختبار", "Quiz Builder"],
  ["policy", "السياسة والنشر", "Policy / publication"],
  ["review", "المعاينة والإتاحة", "Preview / release"],
];
const scenes: Record<Screen, [string, string, string][]> = {
  home: [],
  bank: [
    ["empty", "بنك فارغ", "Empty bank"],
    ["no-results", "لا نتائج", "No results"],
    ["archived", "مؤرشف", "Archived"],
    ["loading", "تحميل", "Loading"],
    ["error", "خطأ خادم", "Server error"],
  ],
  editor: [
    ["archived", "مؤرشف", "Archived"],
    ["validation", "خطأ تحقق", "Validation error"],
    ["conflict", "تعارض تحرير", "Edit conflict"],
  ],
  skills: [
    ["archived", "مؤرشفة", "Archived"],
    ["validation", "نقل غير صالح", "Invalid move"],
    ["loading", "تحميل", "Loading"],
    ["error", "خطأ خادم", "Server error"],
  ],
  quizzes: [
    ["empty", "قائمة فارغة", "Empty list"],
    ["loading", "تحميل", "Loading"],
    ["error", "خطأ خادم", "Server error"],
  ],
  builder: [
    ["draft", "مسودة أولى", "Draft"],
    ["dirty", "منشور مع تعديلات", "Published + edits"],
    ["empty", "بلا أسئلة", "No questions"],
    ["conflict", "تعارض تحرير", "Edit conflict"],
    ["archived", "مؤرشف", "Archived"],
    ["long", "عنوان طويل", "Long title"],
  ],
  policy: [
    ["failed-publication", "فشل النشر", "Failed publication"],
    ["invalid-policy", "سياسة غير صالحة", "Invalid policy"],
    ["archived", "مؤرشف", "Archived"],
  ],
  review: [
    ["released", "أُتيح مسبقًا", "Already released"],
    ["release-na", "الإتاحة لا تنطبق", "Release not applicable"],
    ["archived", "مؤرشف", "Archived"],
  ],
};
const Views = {
  home: Landing,
  bank: QuestionBank,
  editor: QuestionEditor,
  skills: Skills,
  quizzes: Quizzes,
  builder: Builder,
  policy: PolicyPublication,
  review: PreviewRelease,
};
export function Studio({ initial = "home" }: { initial?: Screen }) {
  const params = new URLSearchParams(window.location.search);
  const [en, setEn] = useState(params.get("lang") === "en"),
    [screen, setScreen] = useState<Screen>(initial),
    [scene, setScene] = useState(params.get("state") || "default"),
    [message, setMessage] = useState("");
  const [modal, setModal] = useState<ModalSpec | null>(null),
    dialog = useRef<HTMLDialogElement>(null),
    main = useRef<HTMLElement>(null);
  const t = (ar: string, english: string) => (en ? english : ar);
  useEffect(() => {
    if (modal && !dialog.current?.open) {
      dialog.current?.showModal();
      dialog.current
        ?.querySelector<HTMLButtonElement>("[data-q7-cancel]")
        ?.focus();
    } else if (!modal && dialog.current?.open) dialog.current.close();
  }, [modal]);
  useEffect(() => {
    document.title = en
      ? "SaudiSensei · Q7A design preview"
      : "سعودي سنسي · استكشاف تصميم Q7A";
    document.documentElement.lang = en ? "en" : "ar";
    document.documentElement.dir = en ? "ltr" : "rtl";
  }, [en]);
  const go = (next: Screen) => {
    setScreen(next);
    setScene("default");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => main.current?.focus());
  };
  const View = Views[screen],
    active =
      screen === "editor"
        ? "bank"
        : ["builder", "policy", "review"].includes(screen)
          ? "quizzes"
          : screen;
  return (
    <DesignContext.Provider
      value={{
        en,
        t,
        scene,
        setScene,
        go,
        notify: setMessage,
        modal: setModal,
      }}
    >
      <div
        className="q7-studio"
        lang={en ? "en" : "ar"}
        dir={en ? "ltr" : "rtl"}
      >
        <a className="q7-skip" href="#q7-main">
          {t("تجاوز إلى المحتوى", "Skip to content")}
        </a>
        <div className="q7-review-tools">
          <strong>
            Q7A{" "}
            <span>
              {t(
                "استكشاف تصميم فقط · بيانات توضيحية",
                "DESIGN ONLY · SYNTHETIC DATA",
              )}
            </span>
          </strong>
          <label>
            {t("العرض", "View")}
            <select
              value={screen}
              onChange={(e) => go(e.target.value as Screen)}
            >
              {screens.map(([id, ar, english]) => (
                <option key={id} value={id}>
                  {t(ar, english)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("الحالة", "State")}
            <select
              value={scene}
              onChange={(e) => {
                setScene(e.target.value);
                setMessage("");
              }}
            >
              <option value="default">{t("الحالة الأساسية", "Default")}</option>
              {scenes[screen].map(([id, ar, english]) => (
                <option key={id} value={id}>
                  {t(ar, english)}
                </option>
              ))}
            </select>
          </label>
          <span className="q7-tools-note">
            {t(
              "لا اتصال بالتطبيق أو البيانات الفعلية",
              "No app or API connection",
            )}
          </span>
        </div>
        <div className="q7-shell">
          <header className="q7-topbar">
            <button className="q7-brand" onClick={() => go("home")}>
              <span className="q7-mark" aria-hidden="true">
                س
              </span>
              <span>
                <strong>{t("سعودي سنسي", "SaudiSensei")}</strong>
                <small>{t("مساحة المشرف", "ADMIN WORKSPACE")}</small>
              </span>
            </button>
            <div className="q7-top-actions">
              <button onClick={() => setEn(!en)} lang={en ? "ar" : "en"}>
                {en ? "العربية" : "English"}
              </button>
              <span className="q7-admin-avatar" aria-hidden="true">
                م
              </span>
            </div>
          </header>
          <nav
            className="q7-global-nav"
            aria-label={t("التنقل الرئيسي", "Main navigation")}
          >
            <div>
              {[
                t("لوحة التحكم", "Dashboard"),
                t("المقررات", "Courses"),
                t("الطلاب", "Students"),
              ].map((label) => (
                <button
                  key={label}
                  onClick={() =>
                    setMessage(
                      t(
                        "وجهة قائمة في التطبيق؛ هذا العرض معزول",
                        "Existing application destination; this preview stays isolated",
                      ),
                    )
                  }
                >
                  {label}
                </button>
              ))}
              <button
                className="active"
                onClick={() => go("home")}
                aria-current="page"
              >
                <GraduationCap size={18} />
                {t("التقييمات", "Assessments")}
              </button>
            </div>
            <button
              className="q7-signout"
              onClick={() =>
                setMessage(
                  t(
                    "هذا عرض فقط؛ لا يغيّر جلسة الدخول",
                    "Preview only; your sign-in session is unchanged",
                  ),
                )
              }
            >
              <LogOut size={16} />
              {t("خروج", "Sign out")}
            </button>
          </nav>
          <nav
            className="q7-area-nav"
            aria-label={t("تأليف التقييمات", "Assessment authoring")}
          >
            {(
              [
                ["bank", BookOpen, "بنك الأسئلة", "Question Bank"],
                ["skills", FolderTree, "المهارات", "Skills"],
                ["quizzes", Layers3, "الاختبارات", "Quizzes"],
              ] as const
            ).map(([id, Icon, ar, english]) => (
              <button
                key={id}
                className={active === id ? "active" : ""}
                aria-current={active === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                <Icon size={17} />
                {t(ar, english)}
              </button>
            ))}
            <span>
              {t(
                "تأليف دقيق. نشر مقصود.",
                "Thoughtful authoring. Deliberate publishing.",
              )}
            </span>
          </nav>
          <main id="q7-main" tabIndex={-1} ref={main}>
            <View key={`${screen}-${scene}-${en}`} />
          </main>
          <footer className="q7-footer">
            <span>
              {t(
                "سعودي سنسي · مساحة التأليف",
                "SaudiSensei · Authoring workspace",
              )}
            </span>
            <span>
              {t(
                "نموذج مرئي للمراجعة · لا تغييرات فعلية",
                "Visual review prototype · no real changes",
              )}
            </span>
          </footer>
        </div>
        <div className="q7-toast" role="status" aria-live="polite">
          {message && (
            <>
              <span>{message}</span>
              <button
                aria-label={t("إغلاق التنبيه", "Dismiss message")}
                onClick={() => setMessage("")}
              >
                <X size={18} />
              </button>
            </>
          )}
        </div>
        <dialog
          ref={dialog}
          className="q7-modal"
          aria-labelledby="q7-modal-title"
          onClose={() => setModal(null)}
          onCancel={() => setModal(null)}
        >
          {modal && (
            <>
              <header>
                <h2 id="q7-modal-title">{modal.title}</h2>
                <button
                  aria-label={t("إغلاق", "Close")}
                  onClick={() => setModal(null)}
                >
                  <X size={20} />
                </button>
              </header>
              <div className="q7-modal-body">{modal.body}</div>
              <footer>
                <button data-q7-cancel onClick={() => setModal(null)}>
                  {t("إلغاء / رجوع", "Cancel / back")}
                </button>
                {modal.action && (
                  <button
                    className={modal.danger ? "q7-danger" : "q7-primary"}
                    onClick={() => {
                      modal.onConfirm?.();
                      setModal(null);
                    }}
                  >
                    {modal.action}
                  </button>
                )}
              </footer>
            </>
          )}
        </dialog>
      </div>
    </DesignContext.Provider>
  );
}
