"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { ErrorState, Pager, Skeleton } from "../ui";
import { Field } from "../admin-common";
import type { Locale } from "./model";
import { AssessmentTransport, type Failure } from "./transport";
export { Field, Pager, Skeleton };
export type T = (ar: string, en: string) => string;
export const Context = createContext<{
  locale: Locale;
  t: T;
  api: AssessmentTransport;
}>(null!);
export const useAssessment = () => useContext(Context);
export const uncertain = (error?: Failure | null) =>
  !!error && (error.status === 0 || error.status >= 500);
export function UncertainCreate() {
  const { t } = useAssessment();
  return (
    <Note error>
      {t(
        "قد يكون الإنشاء اكتمل. احتفظ بتعديلاتك، وافتح القائمة في علامة تبويب أخرى للتحقق قبل إنشاء نسخة أخرى. لا توجد إعادة تلقائية.",
        "Creation may have completed. Keep your edits and inspect the list in another tab before creating another copy. There is no automatic retry.",
      )}
    </Note>
  );
}
export function useRead<T>(path: string | null, refresh = 0) {
  const { api } = useAssessment();
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: Failure;
    loading: boolean;
  }>({ key: path, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ key: path, loading: !!path });
    if (path)
      void api.request<T>(path).then((r) => {
        if (live)
          setState(
            r.ok
              ? { key: path, data: r.data, loading: false }
              : { key: path, error: r.error, loading: false },
          );
      });
    return () => {
      live = false;
    };
  }, [api, path, tick, refresh]);
  return {
    ...(state.key === path
      ? state
      : { loading: !!path, data: undefined, error: undefined }),
    reload: () => setTick((n) => n + 1),
  };
}
export function useLeaving(dirty: boolean) {
  const { t } = useAssessment();
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]");
      if (
        !a ||
        a.getAttribute("href")?.startsWith("#") ||
        a.getAttribute("target") === "_blank" ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0
      )
        return;
      if (
        !window.confirm(
          t(
            "لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟",
            "You have unsaved changes. Leave this page?",
          ),
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const currentUrl = window.location.href;
    const currentHistory = window.history.state;
    const back = (e: PopStateEvent) => {
      if (window.location.href === currentUrl) return;
      if (
        !window.confirm(
          t(
            "لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟",
            "You have unsaved changes. Leave this page?",
          ),
        )
      ) {
        // Capture before the router consumes the event, restoring this editor without remounting it.
        e.stopImmediatePropagation();
        window.history.pushState(currentHistory, "", currentUrl);
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("popstate", back, true);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("popstate", back, true);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, t]);
}
export function Head({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="aa-heading">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {actions && <div className="aa-actions">{actions}</div>}
    </header>
  );
}
export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`aa-panel ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Note({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`aa-note${error ? " error" : ""}`}
      role={error ? "alert" : "note"}
    >
      {children}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="aa-empty">{children}</div>;
}
export function Status({ value }: { value: string }) {
  const { t } = useAssessment();
  return <span className={`aa-tag ${value}`}>{label(value, t)}</span>;
}
export function label(v: string, t: T): string {
  const map: Record<string, [string, string]> = {
    ar: ["العربية", "Arabic"],
    en: ["الإنجليزية", "English"],
    active: ["نشط", "Active"],
    archived: ["مؤرشف", "Archived"],
    draft: ["مسودة", "Draft"],
    published: ["منشور", "Published"],
    single_choice: ["اختيار واحد", "Single choice"],
    multiple_choice: ["اختيارات متعددة", "Multiple choice"],
    true_false: ["صح أو خطأ", "True / false"],
    ordering: ["ترتيب", "Ordering"],
    short_text: ["إجابة نصية قصيرة", "Short text"],
    easy: ["سهل", "Easy"],
    medium: ["متوسط", "Medium"],
    hard: ["صعب", "Hard"],
    concept: ["مفاهيم", "Concept"],
    code_tracing: ["تتبّع الكود", "Code tracing"],
    debugging: ["تصحيح الأخطاء", "Debugging"],
    problem_solving: ["حل المشكلات", "Problem solving"],
    implementation: ["تنفيذ", "Implementation"],
    after_grading: ["بعد التصحيح", "After grading"],
    after_attempt_limit: ["بعد استنفاد المحاولات", "After attempt limit"],
    manual_release: ["إتاحة يدوية", "Manual release"],
    never: ["لا تُتاح", "Never"],
    practice: ["تدريب", "Practice"],
    graded: ["مقيّم", "Graded"],
    courses: ["مقرر", "Course"],
    chapters: ["فصل", "Chapter"],
    lessons: ["درس", "Lesson"],
  };
  return map[v] ? t(...map[v]) : v;
}
export function FailureView({
  error,
  retry,
}: {
  error?: Failure | null;
  retry?: () => void;
}) {
  const { locale, t } = useAssessment();
  if (!error) return null;
  if ([401, 403, 404].includes(error.status))
    return <ErrorState error={error} locale={locale} onRetry={retry} />;
  const message =
    error.status === 429
      ? t(
          `طلبات كثيرة. انتظر ${error.retryAfter ?? 60} ثانية ثم أعد المحاولة.`,
          `Too many requests. Wait ${error.retryAfter ?? 60} seconds, then retry.`,
        )
      : error.status === 409
        ? t(
            "تعارض أو تغيّر في الحالة. لم تُستبدل تعديلاتك؛ راجع النسخة الحالية قبل إعادة الحفظ.",
            "Conflict or state change. Your edits were retained; review the current version before saving again.",
          )
        : error.status === 400 || error.status === 422 || error.status === 413
          ? t(
              "تعذّر قبول البيانات. راجع المحتوى والسياسة والحدود وأهلية العناصر.",
              "The data could not be accepted. Check content, policy, limits and item eligibility.",
            )
          : t(
              "تعذّر تأكيد العملية. تحقق من الحالة المحفوظة قبل إعادة المحاولة.",
              "The operation could not be confirmed. Check saved state before retrying.",
            );
  return (
    <Note error>
      <p>{message}</p>
      {error.requestId && (
        <p>
          {t("مرجع الطلب", "Request reference")}: <bdi>{error.requestId}</bdi>
        </p>
      )}
      {retry && <button onClick={retry}>{t("إعادة المحاولة", "Retry")}</button>}
    </Note>
  );
}
export function Issues({ issues }: { issues: string[] }) {
  const { t } = useAssessment();
  if (!issues.length) return null;
  const names: Record<string, [string, string]> = {
    visibility: [
      "لا تسبق المراجعة الدرجة ولا يسبق التفسير المراجعة.",
      "Review cannot precede score; explanation cannot precede review.",
    ],
    finite: [
      "الإتاحة بعد المحاولات تتطلب حدًا محدودًا.",
      "Attempt-limit visibility requires a finite allowance.",
    ],
    attempts: [
      "عدد المحاولات: عدد صحيح موجب.",
      "Attempts must be a positive integer.",
    ],
    threshold: [
      "نسبة الاجتياز من 0 إلى 100 بدقة منزلتين.",
      "Pass percentage must be 0–100 with up to two decimals.",
    ],
    duration: [
      "المدة من 60 إلى 10800 ثانية أو بلا حد.",
      "Duration must be 60–10800 seconds or untimed.",
    ],
    window: [
      "وقت الإغلاق يجب أن يلي وقت الفتح.",
      "Closing time must follow opening time.",
    ],
    content: [
      "أكمل المحتوى دون روابط أو صور أو HTML.",
      "Complete content without links, images or HTML.",
    ],
    locales: [
      "يجب تأليف اللغة الافتراضية.",
      "The default language must be authored.",
    ],
    options: [
      "من خيارين إلى 20؛ النصوص مكتملة والهويات فريدة.",
      "Use 2–20 complete choices with unique identities.",
    ],
    parity: [
      "هويات الخيارات يجب أن تتطابق بين اللغات.",
      "Option identities must match across languages.",
    ],
    key: [
      "أكمل مفتاح الإجابة المتوافق مع النوع.",
      "Complete the answer key for the selected type.",
    ],
    variants: [
      "من 1 إلى 20 إجابة غير فارغة وفريدة بعد التطبيع لكل لغة.",
      "Each locale needs 1–20 nonempty answers unique after normalization.",
    ],
    skills: [
      "المهارات فريدة؛ حد المهارات الثانوية 20.",
      "Skills must be unique; at most 20 secondary skills.",
    ],
    points: [
      "النقاط عدد صحيح من 1 إلى 1000.",
      "Points must be integers from 1 to 1000.",
    ],
    explanation: [
      "راجع نص التفسير وحدوده.",
      "Check explanation content and limits.",
    ],
    size: [
      "المحتوى يتجاوز حد الحجم المسموح.",
      "Content exceeds the supported size budget.",
    ],
  };
  return (
    <Note error>
      <strong>{t("راجع قبل الحفظ", "Review before saving")}</strong>
      <ul>
        {issues.map((x) => (
          <li key={x}>
            {names[x]
              ? t(...names[x])
              : t("راجع الحقول المطلوبة.", "Review required fields.")}
          </li>
        ))}
      </ul>
    </Note>
  );
}
type ModalBranch = {
  parent: ModalBranch | null;
  children: Set<ModalBranch>;
  dialog: HTMLDialogElement | null;
  busy: boolean;
};
const ModalParent = createContext<ModalBranch | null>(null);
function modalBusy(branch: ModalBranch): boolean {
  return (
    !!branch.dialog?.isConnected &&
    (branch.busy || [...branch.children].some(modalBusy))
  );
}
function syncModalBranch(branch: ModalBranch) {
  while (branch.parent) branch = branch.parent;
  function visit(node: ModalBranch, raisedAncestor = false) {
    const d = node.dialog;
    if (!d?.isConnected) return;
    const protectedBranch = modalBusy(node);
    // A busy descendant protects every ancestor's native close watcher too.
    d.setAttribute("closedby", protectedBranch ? "none" : "closerequest");
    let raised = false;
    if ((!d.open && protectedBranch) || (d.open && raisedAncestor)) {
      // Recover ancestors first, then raise their still-open children above them.
      // This also covers browsers without closedby and explicit native close().
      if (d.open) d.close();
      d.showModal();
      raised = true;
    }
    const active = document.activeElement;
    if (
      protectedBranch &&
      ((!d.contains(active) &&
        (active === document.body || branch.dialog?.contains(active))) ||
        (d.contains(active) && active?.matches(":disabled")))
    )
      d.focus();
    for (const child of node.children) visit(child, raised);
  }
  visit(branch);
}
export function Modal({
  title,
  children,
  onClose,
  action,
  onConfirm,
  busy = false,
  confirmDisabled = false,
  danger = false,
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  action?: string;
  onConfirm?: () => void;
  busy?: boolean;
  confirmDisabled?: boolean;
  danger?: boolean;
  returnFocus?: () => HTMLElement | null;
}) {
  const { t } = useAssessment();
  const parent = useContext(ModalParent);
  const [branch] = useState<ModalBranch>(() => ({
    parent,
    children: new Set(),
    dialog: null,
    busy,
  }));
  const ref = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    focusTarget = useRef(returnFocus),
    id = useId();
  useLayoutEffect(() => {
    focusTarget.current = returnFocus;
    branch.busy = busy;
    syncModalBranch(branch);
  }, [branch, busy, returnFocus]);
  useEffect(() => {
    const d = ref.current!;
    const trigger = document.activeElement as HTMLElement;
    branch.dialog = d;
    parent?.children.add(branch);
    d.showModal();
    cancel.current?.focus();
    syncModalBranch(branch);
    const observer = new MutationObserver(() => syncModalBranch(branch));
    observer.observe(d, { attributes: true, attributeFilter: ["open"] });
    return () => {
      observer.disconnect();
      branch.dialog = null;
      parent?.children.delete(branch);
      if (parent) syncModalBranch(parent);
      const active = document.activeElement;
      const restore =
        active === document.body || active === trigger || d.contains(active);
      d.close();
      const target = focusTarget.current?.() ?? trigger;
      // No delayed callback: respect a later user focus and authorization teardown.
      if (restore && trigger?.isConnected && target?.isConnected)
        target.focus();
    };
  }, [branch, parent]);
  function requestClose() {
    if (!modalBusy(branch)) onClose();
  }
  return (
    <ModalParent.Provider value={branch}>
      <dialog
        ref={ref}
        className="aa-dialog"
        aria-labelledby={id}
        onCancel={(e) => {
          e.preventDefault();
          // React propagates cancel events through nested dialogs, even while busy.
          e.stopPropagation();
          requestClose();
        }}
        onClose={(e) => {
          e.stopPropagation();
          const d = e.currentTarget;
          if (branch.dialog !== d || !d.isConnected || d.open) return;
          if (modalBusy(branch)) syncModalBranch(branch);
          else requestClose();
        }}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button
            disabled={busy}
            onClick={requestClose}
            aria-label={t("إغلاق", "Close")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="aa-dialog-body">{children}</div>
        <footer>
          <button ref={cancel} disabled={busy} onClick={requestClose}>
            {t("إلغاء / رجوع", "Cancel / back")}
          </button>
          {action && (
            <button
              className={danger ? "danger" : "primary"}
              disabled={busy || confirmDisabled}
              onClick={onConfirm}
            >
              {busy ? t("جارٍ التنفيذ…", "Working…") : action}
            </button>
          )}
        </footer>
      </dialog>
    </ModalParent.Provider>
  );
}
export function Move({
  index,
  count,
  onMove,
  disabled = false,
  name,
}: {
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  disabled?: boolean;
  name: string;
}) {
  const { t } = useAssessment();
  return (
    <span className="aa-actions">
      <button
        aria-label={`${t("تحريك لأعلى", "Move up")}: ${name}`}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp size={16} />
      </button>
      <button
        aria-label={`${t("تحريك لأسفل", "Move down")}: ${name}`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown size={16} />
      </button>
    </span>
  );
}
export function LocaleTabs({
  value,
  onChange,
  locales,
}: {
  value: Locale;
  onChange: (l: Locale) => void;
  locales: Locale[];
}) {
  const { t } = useAssessment();
  return (
    <div
      className="aa-actions"
      role="group"
      aria-label={t("لغة المحتوى", "Content language")}
    >
      {locales.map((l) => (
        <button key={l} aria-pressed={value === l} onClick={() => onChange(l)}>
          {l === "ar" ? "العربية" : "English"}
        </button>
      ))}
    </div>
  );
}
export function useAction() {
  const { api } = useAssessment();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Failure | null>(null),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const runResult = useCallback(
    async <T,>(
      path: string,
      method: "POST" | "PATCH" | "PUT",
      body: unknown,
    ) => {
      if (lock.current) return null;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await api.request<T>(path, method, body);
        if (!r.ok) setError(r.error);
        return r;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [api],
  );
  // Existing callers keep their data-or-null API. Section saves need the actual outcome.
  const run = useCallback(
    async <T,>(
      path: string,
      method: "POST" | "PATCH" | "PUT",
      body: unknown,
    ) => {
      const result = await runResult<T>(path, method, body);
      return result?.ok ? result.data : null;
    },
    [runResult],
  );
  return { busy, error, setError, message, setMessage, run, runResult };
}
