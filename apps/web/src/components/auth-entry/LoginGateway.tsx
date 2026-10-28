import Link from "next/link";
import { Check, LockKeyhole, RotateCw, ShieldAlert, Settings2, LogOut } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { SignInLink } from "./SignInLink";
import { LearningPath } from "./LearningPath";

export type GatewayState = "entry" | "setup" | "forbidden" | "unavailable" | "failure" | "loading";
type Props = { locale: Locale; state?: GatewayState; area?: "student" | "admin"; onRetry?: () => void };

/** Presentation only. State comes from existing server guards or Next boundaries. */
export function LoginGateway({ locale, state = "entry", area = "student", onRetry }: Props) {
  const ar = locale === "ar";
  const t = getCatalog(locale);
  const other = ar ? "en" : "ar";
  const title = {
    entry: t.login.title, setup: t.login.setupTitle, forbidden: t.area.forbiddenTitle,
    unavailable: t.area.unavailableTitle,
    failure: ar ? "تعذّر إكمال تسجيل الدخول" : "Sign-in could not be completed",
    loading: ar ? "جارٍ فتح مساحة تعلّمك…" : "Opening your learning space…",
  }[state];
  const lead = {
    entry: ar ? "واصل رحلتك التعليمية." : "Continue your learning journey.",
    setup: t.login.setupBody, forbidden: t.area.forbiddenBody, unavailable: t.area.unavailableBody,
    failure: ar ? "تعذّر عرض صفحة الدخول. يمكنك المحاولة مرة أخرى." : "We couldn't show the sign-in page. You can try again.",
    loading: ar ? "يرجى الانتظار لحظة." : "Please wait a moment.",
  }[state];
  const issue = !["entry", "loading"].includes(state);
  return <div className={`sslg-gateway${issue ? " sslg-is-failure" : ""}`} lang={locale} dir={ar ? "rtl" : "ltr"}
    data-testid={state === "entry" ? "login-gateway" : state === "failure" ? "status-error" : state === "loading" ? "status-loading" : `status-${state}`}
    aria-busy={state === "loading" ? true : undefined}>
    <div className="sslg-shell">
      <header className="sslg-header">
        <Link href={`/${locale}/login`} className="sslg-brand" data-testid="link-home" aria-label={t.brand}>
          <span className="sslg-mark" aria-hidden="true"><span>س</span></span>
          <span className="sslg-brand-name"><strong>{t.brand}</strong><small lang={other}>{t.brandSub}</small></span>
        </Link>
        <Link href={`/${other}/login`} className="sslg-locale" hrefLang={other} lang={other}
          aria-label={t.switchAria} data-testid="link-language-switch">{t.switchLabel}</Link>
      </header>
      <section className="sslg-content" aria-labelledby="sslg-title">
        <div className="sslg-copy">
          <span className="sslg-eyebrow"><i aria-hidden="true" />{ar ? "مساحة تعلّمك" : "Your learning space"}</span>
          <h1 id="sslg-title">{title}</h1>
          <p className="sslg-lead">{lead}</p>
          {issue && <div className="sslg-error" role={state === "setup" ? "status" : "alert"}>
            <span className="sslg-error-icon">{state === "setup" ? <Settings2 size={20} aria-hidden="true" /> : <ShieldAlert size={20} aria-hidden="true" />}</span>
            <span className="sslg-error-message">{state === "setup" ? (ar ? "تسجيل الدخول غير متاح حتى يكتمل الإعداد." : "Sign-in is unavailable until setup is complete.")
              : state === "forbidden" ? (ar ? "لا تمنح إعادة المحاولة صلاحية الوصول." : "Trying again does not grant access.")
              : (ar ? "يمكنك المحاولة مرة أخرى." : "You can try again.")}</span>
          </div>}
          {state === "entry" && <>
            <div className="sslg-hosted-note"><LockKeyhole size={17} aria-hidden="true" /><span>{ar ? "سيتم إكمال تسجيل الدخول عبر صفحة مستضافة." : "Sign-in continues on a hosted page."}</span></div>
            <SignInLink locale={locale} />
            <p className="sslg-auth-boundary">{ar ? "تسجيل الدخول مستضاف خارج مساحة التعلّم" : "Sign-in is hosted outside your learning space"}</p>
          </>}
          {state === "setup" && <button className="sslg-primary" type="button" disabled data-testid="button-login-disabled">{t.login.setupCta}</button>}
          {state === "loading" && <p className="sslg-loading" role="status"><span className="sslg-progress-mark" aria-hidden="true" />{lead}</p>}
          {state === "failure" && (onRetry
            ? <button type="button" className="sslg-primary" onClick={onRetry} data-testid="button-retry"><span>{t.area.retry}</span><RotateCw size={18} aria-hidden="true" /></button>
            : <Link className="sslg-primary" href={`/${locale}/login`} data-testid="link-back-login">{t.area.back}</Link>)}
          {state === "unavailable" && <a className="sslg-primary" href={`/${locale}/${area}`} data-testid="button-retry"><span>{t.area.retry}</span><RotateCw size={18} aria-hidden="true" /></a>}
          {state === "forbidden" && <Link className="sslg-primary" href={`/${locale}/login`} data-testid="link-back-login">{t.area.back}</Link>}
          {state === "forbidden" && <a className="sslg-secondary" href={`/auth/logout?returnTo=/${locale}/login`} data-testid="link-logout"><LogOut size={16} aria-hidden="true" />{t.login.signOut}</a>}
          {state === "unavailable" && <Link className="sslg-secondary" href={`/${locale}/login`} data-testid="link-back-login">{t.area.back}</Link>}
        </div>
        <aside className="sslg-visual">
          <LearningPath locale={locale} />
          <div className="sslg-visual-caption"><span className="sslg-caption-seal"><Check size={14} aria-hidden="true" /></span><span>{ar ? "رحلتك تبدأ من هنا" : "Your journey starts here"}</span></div>
        </aside>
      </section>
      <footer className="sslg-footer"><span>{t.brand}</span><span className="sslg-footer-separator" aria-hidden="true" /><span>{t.footer}</span></footer>
    </div>
  </div>;
}
