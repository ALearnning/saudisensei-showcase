import type { Locale } from "@/i18n/config";

export const paths = {
  student: (l: Locale) => `/${l}/student`,
  myCourses: (l: Locale) => `/${l}/student/courses`,
  course: (l: Locale, c: string) => `/${l}/student/courses/${encodeURIComponent(c)}`,
  lesson: (l: Locale, c: string, s: string) => `/${l}/student/courses/${encodeURIComponent(c)}/lessons/${encodeURIComponent(s)}`,
  admin: (l: Locale) => `/${l}/admin`,
  adminCourses: (l: Locale) => `/${l}/admin/courses`,
  newCourse: (l: Locale) => `/${l}/admin/courses/new`,
  adminCourse: (l: Locale, c: string) => `/${l}/admin/courses/${encodeURIComponent(c)}`,
  adminChapter: (l: Locale, c: string, ch: string) => `/${l}/admin/courses/${encodeURIComponent(c)}/chapters/${encodeURIComponent(ch)}`,
  newLesson: (l: Locale, c: string, ch: string) => `/${l}/admin/courses/${encodeURIComponent(c)}/chapters/${encodeURIComponent(ch)}/lessons/new`,
  adminLesson: (l: Locale, c: string, ch: string, s: string) => `/${l}/admin/courses/${encodeURIComponent(c)}/chapters/${encodeURIComponent(ch)}/lessons/${encodeURIComponent(s)}`,
  courseStudents: (l: Locale, c: string) => `/${l}/admin/courses/${encodeURIComponent(c)}/students`,
  adminStudents: (l: Locale) => `/${l}/admin/students`,
  adminStudent: (l: Locale, s: string) => `/${l}/admin/students/${encodeURIComponent(s)}`,
};

/** Display percentage never rounds an incomplete course up to 100. */
export function displayPercent(percentage: number, isCompleted: boolean): number {
  if (isCompleted) return 100;
  const p = Math.floor(Number.isFinite(percentage) ? percentage : 0);
  return Math.max(0, Math.min(99, p));
}

/** Move an id within the complete non-archived sibling list. */
export function moveId(ids: readonly string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Which top-level area a localized path belongs to. */
export function areaOf(pathname: string): "student" | "admin" | null {
  const m = /^\/(ar|en)\/(student|admin)(\/|$)/.exec(pathname);
  return m ? (m[2] as "student" | "admin") : null;
}

export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
