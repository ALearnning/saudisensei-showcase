import { useState } from "react";

// Design-only adapter for the existing me/dashboard and per-course progress
// contract. No live accounts, private media URLs, API calls or mutations.
export type Locale = "ar" | "en";
export type PreviewState = "ready" | "loading" | "empty";
export interface Progress {
  completedRequired: number;
  totalRequired: number;
  percentage: number;
  isCompleted: boolean;
  continueLessonId?: string;
}
export interface Course {
  id: string;
  title: string;
  description: string;
  progress: Progress;
}
export const courses: Course[] = [
  { id: "sample-foundations", title: "أساسيات تصميم واجهات المستخدم",
    description: "من الفكرة إلى واجهة واضحة. تعلّم مبادئ التصميم وبناء تجارب رقمية أفضل.",
    progress: { completedRequired: 7, totalRequired: 12, percentage: 58, isCompleted: false, continueLessonId: "sample-next" } },
  { id: "sample-web", title: "Modern Web Development",
    description: "Build a strong foundation in the tools and principles of the modern web.",
    progress: { completedRequired: 3, totalRequired: 10, percentage: 30, isCompleted: false, continueLessonId: "sample-next" } },
  { id: "sample-thinking", title: "مهارات التفكير وحل المشكلات",
    description: "خطوات عملية لفهم التحديات، وتنظيم الأفكار، والوصول إلى حلول أفضل.",
    progress: { completedRequired: 8, totalRequired: 8, percentage: 100, isCompleted: true } },
];
export const dashboard = {
  totalCourses: courses.length,
  completedRequired: courses.reduce((n,c) => n+c.progress.completedRequired, 0),
  remainingRequired: courses.reduce((n,c) => n+c.progress.totalRequired-c.progress.completedRequired, 0),
  courses,
};
export const words = {
  ar: {
    brand: "سعودي سنسي", dashboard: "لوحة المتابعة", myCourses: "دوراتي",
    greeting: "أهلاً بك،", name: "متعلّم", lead: "خطوتك التالية تبدأ هنا.",
    courses: "دورات مفعّلة", done: "دروس إلزامية مكتملة", remaining: "دروس إلزامية متبقية",
    continue: "تابع التعلّم", review: "مراجعة الدورة", open: "فتح الدورة",
    required: "دروس إلزامية", of: "من", completed: "مكتملة",
    emptyTitle: "لا توجد دورات متاحة بعد",
    emptyBody: "عندما يسجّلك المسؤول في دورة منشورة ستظهر هنا مباشرة.",
    loading: "جارٍ تحميل دوراتك", verified: "هوية الطالب مُتحقق منها",
    progressNote: "يُحسب التقدّم من الدروس الإلزامية المنشورة حالياً.",
    preview: "معاينة تصميم · بيانات توضيحية وليست حساباً حياً",
    ready: "البيانات", loadingOption: "التحميل", empty: "بدون دورات",
    logout: "تسجيل الخروج", navigation: "التنقل الرئيسي",
    notice: "هذه معاينة بصرية فقط. لا يحدث تنقّل أو تسجيل خروج حقيقي.",
  },
  en: {
    brand: "SaudiSensei", dashboard: "Dashboard", myCourses: "My courses",
    greeting: "Welcome back,", name: "Learner", lead: "Your next step starts here.",
    courses: "Active courses", done: "Required lessons done", remaining: "Required lessons left",
    continue: "Continue learning", review: "Review course", open: "Open course",
    required: "required lessons", of: "of", completed: "Completed",
    emptyTitle: "No courses available yet",
    emptyBody: "When an administrator enrolls you in a published course, it appears here right away.",
    loading: "Loading your courses", verified: "Student identity verified",
    progressNote: "Progress counts the required lessons published right now.",
    preview: "Design preview · illustrative data, not a live account",
    ready: "Loaded", loadingOption: "Loading", empty: "No courses",
    logout: "Sign out", navigation: "Main navigation",
    notice: "Visual preview only. No real navigation or sign-out is performed.",
  },
} as const;
export function usePreview() {
  const params = new URLSearchParams(window.location.search);
  const [locale, setLocale] = useState<Locale>(params.get("lang") === "en" ? "en" : "ar");
  const initial = params.get("state");
  const [state, setState] = useState<PreviewState>(initial === "empty" || initial === "loading" ? initial : "ready");
  const [notice, setNotice] = useState("");
  const t = words[locale];
  return { locale, setLocale, state, setState, t, data: state === "empty" ? { ...dashboard, totalCourses:0, completedRequired:0, remainingRequired:0, courses:[] } : dashboard,
    notice, dismiss: () => setNotice(""), act: () => setNotice(t.notice) };
}
export function PreviewTools({ preview }: { preview: ReturnType<typeof usePreview> }) {
  const p = preview;
  return <aside className="ss-preview-tools" aria-label={p.locale === "ar" ? "أدوات معاينة التصميم" : "Design preview controls"}>
    <span>{p.t.preview}</span>
    <div>
      <button type="button" onClick={() => p.setLocale(p.locale === "ar" ? "en" : "ar")}>{p.locale === "ar" ? "English" : "العربية"}</button>
      <select aria-label={p.locale === "ar" ? "حالة المعاينة" : "Preview state"} value={p.state} onChange={e => p.setState(e.target.value as PreviewState)}>
        <option value="ready">{p.t.ready}</option><option value="loading">{p.t.loadingOption}</option><option value="empty">{p.t.empty}</option>
      </select>
    </div>
    {p.notice && <p role="status">{p.notice} <button onClick={p.dismiss} aria-label={p.locale === "ar" ? "إغلاق" : "Dismiss"}>×</button></p>}
  </aside>;
}
