import { useEffect, useState } from "react";
import { ArrowUpLeft, ArrowUpRight, Check, LockKeyhole, RotateCw, ShieldAlert } from "lucide-react";
import "./_styles.css";

type Locale = "ar" | "en";
type GatewayProps = {
  locale: Locale;
  layout?: "desktop" | "mobile";
  state?: "entry" | "failure" | "denied";
  allowStateReview?: boolean;
};

const copy = {
  ar: {
    locale: "English",
    welcome: "أهلاً بك من جديد",
    eyebrow: "مساحة تعلّمك",
    lead: "واصل رحلتك التعليمية.",
    cta: "تسجيل الدخول",
    hosted: "سيتم إكمال تسجيل الدخول عبر صفحة مستضافة.",
    preview: "معاينة تصميمية فقط",
    loading: "جارٍ تجهيز المعاينة…",
    idlePreview: "محاكاة محلية فقط — لن يتم فتح صفحة أو بدء تسجيل الدخول.",
    pathLabel: "خطوة بعد خطوة",
    pathSub: "رحلتك تبدأ من هنا",
    failureTitle: "تعذّر إكمال تسجيل الدخول",
    failureBody: "قد تكون هناك مشكلة مؤقتة أثناء عملية الدخول.",
    failureAction: "يمكنك إعادة المحاولة.",
    deniedTitle: "لا يمكنك الوصول إلى هذه الصفحة",
    deniedBody: "لم يستوفِ حسابك متطلبات الدور أو حالة الحساب أو التحقق الأمني اللازمة لهذه الصفحة.",
    deniedAction: "يمكنك العودة إلى تسجيل الدخول.",
    retry: "إعادة المحاولة",
    back: "العودة إلى تسجيل الدخول",
    retrying: "جارٍ تجهيز المعاينة…",
    retryPreview: "إعادة المحاولة في هذه المعاينة محلية فقط.",
    backPreview: "معاينة محلية فقط — لا يتم التنقل إلى صفحة أخرى.",
    reviewer: "حالة للمراجعة — معاينة محلية فقط",
    callback: "فشل إكمال الدخول",
    accountAccess: "تعذّر الوصول",
    secureNote: "تسجيل الدخول مستضاف خارج مساحة التعلّم",
  },
  en: {
    locale: "العربية",
    welcome: "Welcome back",
    eyebrow: "Your learning space",
    lead: "Continue your learning journey.",
    cta: "Sign in",
    hosted: "Sign-in continues on a hosted page.",
    preview: "Design preview only",
    loading: "Preparing preview…",
    idlePreview: "Local simulation only — no page will open and sign-in will not start.",
    pathLabel: "One step at a time",
    pathSub: "Your journey starts here",
    failureTitle: "Sign-in could not be completed",
    failureBody: "There may have been a temporary issue during sign-in.",
    failureAction: "You can try again.",
    deniedTitle: "You don’t have access to this page",
    deniedBody: "Your account does not meet this page’s role, account-status, or security-verification requirements.",
    deniedAction: "You can return to sign in.",
    retry: "Try again",
    back: "Back to sign in",
    retrying: "Preparing preview…",
    retryPreview: "Retry in this preview is local only.",
    backPreview: "Local preview only — no navigation takes place.",
    reviewer: "Review state — local preview only",
    callback: "Sign-in callback failure",
    accountAccess: "Account access denied",
    secureNote: "Sign-in is hosted outside your learning space",
  },
} as const;

function LearningPath({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <div className="sslg-art" aria-label={ar ? "مسار تعلّم متدرّج" : "A learning path with milestones"} role="img">
      <div className="sslg-art-topline">
        <span className="sslg-art-kicker">{ar ? "مسار التعلّم" : "LEARNING PATH"}</span>
        <span className="sslg-art-index">01 — 03</span>
      </div>
      <svg className="sslg-path-svg" viewBox="0 0 500 330" fill="none" aria-hidden="true">
        <path d="M74 248H173V174H291V100H420" stroke="rgba(241,220,184,.68)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M74 248H173V174H291V100H420" stroke="url(#pathAccent)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 16" />
        <circle cx="74" cy="248" r="28" fill="#174F4A" stroke="#E8AE7A" strokeWidth="2" />
        <circle cx="74" cy="248" r="8" fill="#E8AE7A" />
        <circle cx="173" cy="174" r="28" fill="#E8AE7A" />
        <path d="M166 174h14M173 167v14" stroke="#174F4A" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="291" cy="100" r="28" fill="#174F4A" stroke="rgba(246,236,212,.72)" strokeWidth="2" />
        <path d="m284 100 5 5 10-11" stroke="#E8AE7A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="420" cy="100" r="35" fill="#F4E5D5" />
        <circle cx="420" cy="100" r="24" fill="#D57A43" />
        <path d="m414 100 5 5 10-11" stroke="#FFF8EA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35 72h75M395 260h55M344 42h35" stroke="rgba(241,220,184,.23)" strokeWidth="1" />
        <path d="m115 68 6 4-6 4M383 38l6 4-6 4" stroke="#E8AE7A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="137" y="265" width="6" height="6" rx="1.5" transform="rotate(45 137 265)" fill="#D57A43" />
        <rect x="347" y="148" width="6" height="6" rx="1.5" transform="rotate(45 347 148)" fill="#A8B8A8" />
        <defs>
          <linearGradient id="pathAccent" x1="74" y1="248" x2="420" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E8AE7A" />
            <stop offset="1" stopColor="#E8AE7A" stopOpacity=".15" />
          </linearGradient>
        </defs>
      </svg>
      <div className="sslg-art-foot">
        <span className="sslg-art-diamond" />
        <span>{ar ? "تقدّمك يصنع طريقك" : "Progress makes your path"}</span>
      </div>
      <span className="sslg-art-label sslg-art-label-start">{ar ? "البداية" : "BEGIN"}</span>
      <span className="sslg-art-label sslg-art-label-end">{ar ? "إنجاز جديد" : "NEXT MILESTONE"}</span>
    </div>
  );
}

export function Gateway({ locale, layout = "desktop", state = "entry", allowStateReview = false }: GatewayProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeState, setActiveState] = useState(state);
  const t = copy[locale];
  const isArabic = locale === "ar";
  const failed = activeState === "failure";
  const denied = activeState === "denied";
  const hasIssue = failed || denied;

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setTimeout(() => {
      setIsLoading(false);
      setNotice(failed ? t.retryPreview : t.idlePreview);
    }, 1150);
    return () => window.clearTimeout(timer);
  }, [failed, isLoading, t.idlePreview, t.retryPreview]);

  const simulate = () => {
    if (isLoading) return;
    setNotice("");
    setIsLoading(true);
  };
  const returnToSignInPreview = () => setNotice(t.backPreview);

  return (
    <main
      className={`sslg-gateway sslg-${layout}${hasIssue ? " sslg-is-failure" : ""}`}
      lang={locale}
      dir={isArabic ? "rtl" : "ltr"}
    >
      <div className="sslg-shell">
        <header className="sslg-header">
          <div className="sslg-brand" aria-label={isArabic ? "ساوديسنسي" : "SaudiSensei"}>
            <span className="sslg-mark" aria-hidden="true"><span>س</span></span>
            <span className="sslg-brand-name">
              <strong>{isArabic ? "ساوديسنسي" : "SaudiSensei"}</strong>
              <small>{isArabic ? "SAUDISENSEI" : "ساوديسنسي"}</small>
            </span>
          </div>
          <button
            type="button"
            className="sslg-locale"
            onClick={() => window.dispatchEvent(new CustomEvent("sslg-locale-toggle"))}
            aria-label={isArabic ? "Switch to English" : "التبديل إلى العربية"}
            data-testid="button-language"
          >
            {t.locale}
          </button>
        </header>

        {allowStateReview && (
          <div className="sslg-reviewer" role="group" aria-label={t.reviewer}>
            <span className="sslg-reviewer-label">{t.reviewer}</span>
            <button
              type="button"
              className={failed ? "is-selected" : ""}
              aria-pressed={failed}
              onClick={() => { setActiveState("failure"); setNotice(""); setIsLoading(false); }}
              data-testid="button-state-callback-failure"
            >{t.callback}</button>
            <button
              type="button"
              className={denied ? "is-selected" : ""}
              aria-pressed={denied}
              onClick={() => { setActiveState("denied"); setNotice(""); setIsLoading(false); }}
              data-testid="button-state-account-access"
            >{t.accountAccess}</button>
          </div>
        )}
        <section className="sslg-content" aria-labelledby="sslg-title">
          <div className="sslg-copy">
            <span className="sslg-eyebrow"><i aria-hidden="true" />{hasIssue ? t.preview : t.eyebrow}</span>
            <h1 id="sslg-title">{failed ? t.failureTitle : denied ? t.deniedTitle : t.welcome}</h1>
            <p className="sslg-lead">{failed ? t.failureBody : denied ? t.deniedBody : t.lead}</p>

            {hasIssue ? (
              <div className="sslg-error" role="alert" data-testid={denied ? "status-account-access-denied" : "status-auth-callback-failed"}>
                <span className="sslg-error-icon"><ShieldAlert size={20} aria-hidden="true" /></span>
                <span className="sslg-error-message">{denied ? t.deniedAction : t.failureAction}</span>
              </div>
            ) : (
              <div className="sslg-hosted-note">
                <LockKeyhole size={17} aria-hidden="true" />
                <span>{t.hosted}</span>
              </div>
            )}

            <button
              type="button"
              className="sslg-primary"
              onClick={denied ? returnToSignInPreview : simulate}
              disabled={isLoading && !denied}
              aria-busy={isLoading && !denied}
              data-testid={denied ? "button-back-to-sign-in-preview" : failed ? "button-retry-preview" : "button-sign-in-preview"}
            >
              <span className="sslg-button-label">{denied ? t.back : failed ? t.retry : t.cta}</span>
              {isLoading && !denied ? <span className="sslg-progress-mark" aria-hidden="true" /> : denied ? (isArabic ? <ArrowUpRight size={19} aria-hidden="true" /> : <ArrowUpLeft size={19} aria-hidden="true" />) : failed ? <RotateCw size={18} aria-hidden="true" /> : (isArabic ? <ArrowUpLeft size={19} aria-hidden="true" /> : <ArrowUpRight size={19} aria-hidden="true" />)}
            </button>

            <div className={`sslg-preview-caption${notice ? " is-active" : ""}`} role="status" aria-live="polite" data-testid="status-preview-only">
              <span className="sslg-preview-dot" />
              <span>{isLoading ? t.loading : notice || t.preview}</span>
            </div>
            {notice && <p className="sslg-local-note" data-testid="text-preview-result">{notice}</p>}
            {!hasIssue && <p className="sslg-auth-boundary">{t.secureNote}</p>}
          </div>

          <aside className="sslg-visual">
            <LearningPath locale={locale} />
            <div className="sslg-visual-caption">
              <span className="sslg-caption-seal"><Check size={14} aria-hidden="true" /></span>
              <span>{t.pathSub}</span>
            </div>
          </aside>
        </section>

        <footer className="sslg-footer">
          <span>{isArabic ? "ساوديسنسي" : "SaudiSensei"}</span>
          <span className="sslg-footer-separator" aria-hidden="true" />
          <span>{isArabic ? "منصة تعليمية بالعربية أولاً" : "An Arabic-first learning workspace"}</span>
        </footer>
      </div>
    </main>
  );
}

export function useGatewayLocale(initial: Locale) {
  const [locale, setLocale] = useState<Locale>(initial);
  useEffect(() => {
    const toggle = () => setLocale(current => current === "ar" ? "en" : "ar");
    window.addEventListener("sslg-locale-toggle", toggle);
    return () => window.removeEventListener("sslg-locale-toggle", toggle);
  }, []);
  return locale;
}

