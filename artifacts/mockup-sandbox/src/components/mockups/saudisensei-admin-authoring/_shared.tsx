import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, LockKeyhole } from "lucide-react";

export type Screen =
  | "home"
  | "bank"
  | "editor"
  | "skills"
  | "quizzes"
  | "builder"
  | "policy"
  | "review";
export type ModalSpec = {
  title: string;
  body: ReactNode;
  action?: string;
  onConfirm?: () => void;
  danger?: boolean;
};
export type Design = {
  en: boolean;
  t: (ar: string, en: string) => string;
  scene: string;
  setScene: (scene: string) => void;
  go: (screen: Screen) => void;
  notify: (message: string) => void;
  modal: (spec: ModalSpec) => void;
};
export const DesignContext = createContext<Design>(null!);
export const useDesign = () => useContext(DesignContext);
export function Panel({
  title,
  kicker,
  children,
  className = "",
  aside,
}: {
  title?: string;
  kicker?: ReactNode;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={`q7-panel ${className}`}>
      {(title || kicker) && (
        <header className="q7-panel-head">
          <div>
            {kicker && <small className="q7-eyebrow">{kicker}</small>}
            {title && <h2>{title}</h2>}
          </div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  function attachLabel(node: ReactNode): ReactNode {
    if (
      !isValidElement<{
        id?: string;
        "aria-describedby"?: string;
        children?: ReactNode;
      }>(node)
    )
      return node;
    if (
      typeof node.type === "string" &&
      ["input", "select", "textarea"].includes(node.type)
    ) {
      return cloneElement(node, {
        id,
        "aria-describedby":
          [node.props["aria-describedby"], hint ? `${id}-help` : ""]
            .filter(Boolean)
            .join(" ") || undefined,
      });
    }
    return node.props.children
      ? cloneElement(node, {
          children: Children.map(node.props.children, attachLabel),
        })
      : node;
  }
  return (
    <div className={`q7-field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {Children.map(children, attachLabel)}
      {hint && <small id={`${id}-help`}>{hint}</small>}
    </div>
  );
}
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warm" | "bad";
}) {
  return <span className={`q7-tag ${tone}`}>{children}</span>;
}
export function Notice({
  title,
  children,
  tone = "info",
}: {
  title?: string;
  children: ReactNode;
  tone?: "info" | "warning" | "error";
}) {
  return (
    <div
      className={`q7-notice ${tone}`}
      role={tone === "error" ? "alert" : "note"}
    >
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}
export function PrivateLabel() {
  const { t } = useDesign();
  return (
    <span className="q7-private">
      <LockKeyhole size={14} aria-hidden="true" />
      {t("خاص بالمشرف · مفتاح الإجابة", "ADMIN ONLY · ANSWER KEY")}
    </span>
  );
}
export function Move({
  index,
  count,
  onMove,
  name,
}: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  name: string;
}) {
  const { t } = useDesign();
  return (
    <span className="q7-move">
      <button
        disabled={index === 0}
        aria-label={`${t("تحريك لأعلى", "Move up")}: ${name}`}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={15} />
      </button>
      <button
        disabled={index === count - 1}
        aria-label={`${t("تحريك لأسفل", "Move down")}: ${name}`}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={15} />
      </button>
    </span>
  );
}
export const types = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "ordering",
  "short_text",
] as const;
export type QuestionType = (typeof types)[number];
export const typeLabels: Record<QuestionType, [string, string]> = {
  single_choice: ["اختيار واحد", "Single choice"],
  multiple_choice: ["اختيارات متعددة", "Multiple choice"],
  true_false: ["صح / خطأ", "True / false"],
  ordering: ["ترتيب", "Ordering"],
  short_text: ["إجابة قصيرة", "Short text"],
};
export const samples: Record<QuestionType, [string, string]> = {
  single_choice: [
    "أي حلقة تختبر الشرط قبل التكرار ولا تضم قسمًا للتهيئة أو التحديث؟",
    "Which loop checks its condition before each iteration, without an initialization or update section?",
  ],
  multiple_choice: [
    "اختر جميع أنواع الحلقات في Java.",
    "Select all loop structures in Java.",
  ],
  true_false: [
    "تُنفّذ حلقة do-while مرة واحدة على الأقل.",
    "A do-while loop executes at least once.",
  ],
  ordering: [
    "رتّب خطوات تنفيذ حلقة for.",
    "Arrange the execution steps of a for loop.",
  ],
  short_text: [
    "اكتب الكلمة المحجوزة التي تنهي الحلقة مباشرة.",
    "Enter the keyword that exits a loop immediately.",
  ],
};
export function typeLabel(type: QuestionType, en: boolean) {
  return typeLabels[type][en ? 1 : 0];
}
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="q7-empty">
      <span className="q7-empty-mark" aria-hidden="true">
        س
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function AsyncState() {
  const { scene, t, setScene } = useDesign();
  if (scene === "loading")
    return (
      <div className="q7-loading" aria-busy="true" role="status">
        <p>{t("جارٍ التحميل…", "Loading…")}</p>
        {[1, 2, 3, 4].map((x) => (
          <div key={x} />
        ))}
      </div>
    );
  if (scene === "error")
    return (
      <Empty
        title={t("تعذّر تحميل المحتوى", "Content could not be loaded")}
        body={t(
          "حاول مرة أخرى. لن يتغير المحتوى المحفوظ.",
          "Try again. Saved content remains unchanged.",
        )}
        action={
          <button className="q7-primary" onClick={() => setScene("default")}>
            {t("إعادة المحاولة", "Try again")}
          </button>
        }
      />
    );
  return null;
}
