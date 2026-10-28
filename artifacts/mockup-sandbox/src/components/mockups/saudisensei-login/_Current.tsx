// Source extraction: apps/web/src/app/[locale]/login/page.tsx.
// JSX preserved; server locale/config/routing boundaries stubbed for design only.
// This reference is not a real auth screen and cannot initiate authentication.
import { ArrowUpRight, Lock, Settings2, GraduationCap, ShieldHalf } from "lucide-react";
import "./_current.css";
type Locale = "ar" | "en";
const catalogs = {
  ar: {
    nav: { student: "صفحة الطالب", admin: "صفحة الإدارة" },
    login: { eyebrow: "بوابة الدخول", title: "أهلاً بك من جديد", lead: "يتم تسجيل الدخول عبر صفحة آمنة مستضافة. لا نطلب كلمة المرور على هذه الصفحة.",
      cta: "المتابعة إلى تسجيل الدخول الآمن", setupTitle: "تسجيل الدخول غير مُهيّأ بعد",
      setupBody: "لم تُضبط إعدادات مزوّد الهوية على هذا الخادم، لذلك تم تعطيل تسجيل الدخول. لا يمكن لأي حساب الدخول حتى يكمل المسؤول الإعداد.",
      setupCta: "تسجيل الدخول معطّل", checkTitle: "التحقق من الصلاحيات", checkLead: "بعد الدخول، افتح إحدى صفحتي الاختبار للتأكد من دورك." },
  },
  en: {
    nav: { student: "Student page", admin: "Admin page" },
    login: { eyebrow: "Sign-in gateway", title: "Welcome back", lead: "Sign-in happens on a secure hosted page. This page never asks for your password.",
      cta: "Continue to secure sign-in", setupTitle: "Sign-in is not configured yet",
      setupBody: "The identity provider settings are missing on this server, so sign-in is disabled. No account can sign in until an administrator completes setup.",
      setupCta: "Sign-in disabled", checkTitle: "Verify your access", checkLead: "After signing in, open a test page to confirm your role." },
  },
};
const Link = ({ children, ...props }: React.ComponentProps<"a">) => <a {...props} onClick={e => e.preventDefault()}>{children}</a>;
export function CurrentLogin({ locale = "ar", configured = true }: { locale?: Locale; configured?: boolean }) {
  const t = catalogs[locale];
  return <div className="ss-login-current" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
    <div className="login-grid">
      <section className="card rise">
        <span className="eyebrow">{t.login.eyebrow}</span>
        <h1>{t.login.title}</h1>
        <p className="lead">{t.login.lead}</p>
        {configured ? (
          <a href={`/auth/login?returnTo=/${locale}/student`} onClick={e => e.preventDefault()} className="btn primary big" data-testid="link-login">
            <Lock size={18} aria-hidden="true" /><span>{t.login.cta}</span>
            <ArrowUpRight size={18} aria-hidden="true" className="flip" />
          </a>
        ) : <>
          <div className="notice warn" role="status" data-testid="status-setup-required">
            <Settings2 size={20} aria-hidden="true" /><div><strong>{t.login.setupTitle}</strong><p>{t.login.setupBody}</p></div>
          </div>
          <button type="button" className="btn primary big" disabled aria-disabled="true" data-testid="button-login-disabled">
            <Lock size={18} aria-hidden="true" /><span>{t.login.setupCta}</span>
          </button>
        </>}
      </section>
      <aside className="card side rise delay">
        <h2>{t.login.checkTitle}</h2><p>{t.login.checkLead}</p>
        <nav className="checks">
          <Link href={`/${locale}/student`} className="check" data-testid="link-student"><GraduationCap size={18} aria-hidden="true" />{t.nav.student}</Link>
          <Link href={`/${locale}/admin`} className="check" data-testid="link-admin"><ShieldHalf size={18} aria-hidden="true" />{t.nav.admin}</Link>
        </nav>
      </aside>
    </div>
  </div>;
}
