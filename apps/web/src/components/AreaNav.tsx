"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookOpen, Users, LogOut, ListChecks } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { areaOf, paths } from "@/lib/lms-paths";

export function AreaNav({ locale }: { locale: Locale }) {
  const pathname = usePathname() || "";
  const area = areaOf(pathname);
  if (!area) return null;
  const t = getLms(locale).nav;
  const items = area === "student"
    ? [{ href: paths.student(locale), label: t.dashboard, Icon: LayoutDashboard, exact: true, id: "dashboard" },
       { href: paths.myCourses(locale), label: t.myCourses, Icon: BookOpen, exact: false, id: "courses" }]
    : [{ href: paths.admin(locale), label: t.dashboard, Icon: LayoutDashboard, exact: true, id: "dashboard" },
       { href: paths.adminCourses(locale), label: t.courses, Icon: BookOpen, exact: false, id: "courses" },
       { href: `/${locale}/admin/assessments`, label: locale === "ar" ? "التقييمات" : "Assessments", Icon: ListChecks, exact: false, id: "assessments" },
       { href: paths.adminStudents(locale), label: t.students, Icon: Users, exact: false, id: "students" }];
  return (
    <nav className="areanav" aria-label={t.main}>
      <span className="area-tag">{area === "student" ? t.student : t.admin}</span>
      <ul>
        {items.map(({ href, label, Icon, exact, id }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined} className={active ? "on" : ""} data-testid={`nav-${id}`}>
                <Icon size={16} aria-hidden="true" />{label}
              </Link>
            </li>
          );
        })}
      </ul>
      <a href={`/auth/logout?returnTo=/${locale}/login`} className="nav-out" data-testid="link-nav-logout"><LogOut size={15} aria-hidden="true" />{t.signOut}</a>
    </nav>
  );
}
