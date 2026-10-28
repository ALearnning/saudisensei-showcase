import type { Locale } from "./config";

// UI strings only. Course content is never translated.
const ar = {
  brand: "ساوديسنسي",
  brandSub: "SaudiSensei",
  switchLabel: "English",
  switchAria: "Switch to English",
  nav: { login: "تسجيل الدخول", student: "صفحة الطالب", admin: "صفحة الإدارة" },
  login: {
    metaTitle: "تسجيل الدخول — ساوديسنسي",
    metaDesc: "سجّل الدخول إلى منصة ساوديسنسي التعليمية.",
    eyebrow: "بوابة الدخول",
    title: "أهلاً بك من جديد",
    lead: "يتم تسجيل الدخول عبر صفحة آمنة مستضافة. لا نطلب كلمة المرور على هذه الصفحة.",
    cta: "المتابعة إلى تسجيل الدخول الآمن",
    signOut: "تسجيل الخروج",
    checkTitle: "التحقق من الصلاحيات",
    checkLead: "بعد الدخول، افتح إحدى صفحتي الاختبار للتأكد من دورك.",
    setupTitle: "تسجيل الدخول غير مُهيّأ بعد",
    setupBody: "لم تُضبط إعدادات مزوّد الهوية على هذا الخادم، لذلك تم تعطيل تسجيل الدخول. لا يمكن لأي حساب الدخول حتى يكمل المسؤول الإعداد.",
    setupCta: "تسجيل الدخول معطّل",
  },
  area: {
    student: { metaTitle: "صفحة الطالب — ساوديسنسي", title: "صفحة اختبار الطالب", lead: "تم التحقق من صلاحية الطالب لهذا الحساب." },
    admin: { metaTitle: "صفحة الإدارة — ساوديسنسي", title: "صفحة اختبار الإدارة", lead: "تم التحقق من صلاحية المسؤول لهذا الحساب." },
    verified: "تم التحقق",
    fields: { name: "الاسم", email: "البريد الإلكتروني", status: "الحالة", locale: "اللغة المفضلة", roles: "الأدوار", id: "المعرّف" },
    setupTitle: "المصادقة غير مُهيّأة",
    setupBody: "لا يمكن التحقق من الهوية قبل إكمال إعداد مزوّد الهوية.",
    forbiddenTitle: "ليس لديك صلاحية",
    forbiddenBody: "لم يستوفِ حسابك متطلبات الدور أو حالة الحساب أو التحقق الأمني اللازمة لهذه الصفحة.",
    unavailableTitle: "الخدمة غير متاحة مؤقتاً",
    unavailableBody: "تعذّر الوصول إلى خدمة التحقق. حاول مرة أخرى بعد قليل.",
    retry: "إعادة المحاولة",
    back: "العودة إلى تسجيل الدخول",
  },
  footer: "منصة تعليمية بالعربية أولاً",
};

type Catalog = typeof ar;

const en: Catalog = {
  brand: "SaudiSensei",
  brandSub: "ساوديسنسي",
  switchLabel: "العربية",
  switchAria: "التبديل إلى العربية",
  nav: { login: "Sign in", student: "Student page", admin: "Admin page" },
  login: {
    metaTitle: "Sign in — SaudiSensei",
    metaDesc: "Sign in to the SaudiSensei learning platform.",
    eyebrow: "Sign-in gateway",
    title: "Welcome back",
    lead: "Sign-in happens on a secure hosted page. This page never asks for your password.",
    cta: "Continue to secure sign-in",
    signOut: "Sign out",
    checkTitle: "Verify your access",
    checkLead: "After signing in, open a test page to confirm your role.",
    setupTitle: "Sign-in is not configured yet",
    setupBody: "The identity provider settings are missing on this server, so sign-in is disabled. No account can sign in until an administrator completes setup.",
    setupCta: "Sign-in disabled",
  },
  area: {
    student: { metaTitle: "Student page — SaudiSensei", title: "Student test page", lead: "Student access is verified for this account." },
    admin: { metaTitle: "Admin page — SaudiSensei", title: "Admin test page", lead: "Administrator access is verified for this account." },
    verified: "Verified",
    fields: { name: "Name", email: "Email", status: "Status", locale: "Preferred language", roles: "Roles", id: "ID" },
    setupTitle: "Authentication not configured",
    setupBody: "Identity cannot be verified until the identity provider is set up.",
    forbiddenTitle: "You don't have access",
    forbiddenBody: "Your account does not meet this page's role, account-status, or security-verification requirements.",
    unavailableTitle: "Service temporarily unavailable",
    unavailableBody: "We couldn't reach the verification service. Please try again shortly.",
    retry: "Try again",
    back: "Back to sign in",
  },
  footer: "An Arabic-first learning platform",
};

const catalogs: Record<Locale, Catalog> = { ar, en };
export function getCatalog(locale: Locale): Catalog {
  return catalogs[locale];
}
export type { Catalog };
