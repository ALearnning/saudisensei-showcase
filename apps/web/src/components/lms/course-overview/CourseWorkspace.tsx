import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, LogOut, PanelRight } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { getLms } from "@/i18n/lms";
import { paths } from "@/lib/lms-paths";

/** Uses the accepted Dashboard chrome without modifying the Dashboard itself. */
export function CourseWorkspace({ locale, courseId, children }: { locale: Locale; courseId: string; children: ReactNode }) {
  const ar = locale === "ar";
  const catalog = getCatalog(locale);
  const { nav, student } = getLms(locale);
  const language = (mobile: boolean) => <Link className="ssv2-language" href={paths.course(ar ? "en" : "ar", courseId)}
    hrefLang={ar ? "en" : "ar"} lang={ar ? "en" : "ar"} aria-label={catalog.switchAria}
    data-testid={mobile ? "link-language-switch-mobile" : "link-language-switch"}>
    <span aria-hidden="true">{ar ? "EN" : "ع"}</span>{catalog.switchLabel}
  </Link>;
  const logout = `/auth/logout?returnTo=/${locale}/login`;
  return <div className="ss-workspace-v2 ss-course-overview" lang={locale} dir={ar ? "rtl" : "ltr"}>
    <a className="ssv2-skip" href="#course-content">{ar ? "انتقل إلى محتوى الدورة" : "Skip to course content"}</a>
    <div className="ssv2-layout">
      <aside className="ssv2-rail" aria-label={nav.student}>
        <Link className="ssv2-brand" href={paths.student(locale)} aria-label={catalog.brand} data-testid="link-home">
          <span className="ssv2-brand-mark" aria-hidden="true">س</span><span className="ssv2-brand-name"><strong>{catalog.brand}</strong><small lang="en">LEARN WITH PURPOSE</small></span>
        </Link>
        <div className="ssv2-mobile-header-actions">{language(true)}
          <a className="ssv2-mobile-logout" href={logout} aria-label={nav.signOut} data-testid="link-nav-logout-mobile"><LogOut size={17} aria-hidden="true" /></a>
        </div>
        <div className="ssv2-rail-rule" /><span className="ssv2-rail-caption">{nav.student}</span>
        <nav className="ssv2-nav" aria-label={nav.main}>
          <Link href={paths.student(locale)} className="ssv2-nav-item" data-testid="nav-dashboard"><PanelRight size={18} aria-hidden="true" /><span>{nav.dashboard}</span></Link>
          <Link href={paths.myCourses(locale)} className="ssv2-nav-item is-current" aria-current="location" data-testid="nav-courses"><BookOpen size={18} aria-hidden="true" /><span>{nav.myCourses}</span><i className="ssv2-nav-indicator" /></Link>
        </nav>
        <div className="ssv2-rail-bottom"><p><span aria-hidden="true">س</span>{ar ? "تعلّمك، على طريقتك" : "Learning, your way"}</p>
          <a href={logout} className="ssv2-logout" data-testid="link-nav-logout"><LogOut size={16} aria-hidden="true" /><span>{nav.signOut}</span></a>
        </div>
      </aside>
      <div className="ssv2-main-column">
        <header className="ssv2-topbar"><nav className="ssv2-breadcrumb" aria-label={ar ? "مسار التنقّل" : "Breadcrumb"}>
          <Link href={paths.myCourses(locale)} data-testid="link-back">{nav.myCourses}</Link><span aria-hidden="true">/</span><strong>{student.outline}</strong>
        </nav>{language(false)}</header>
        <div className="ssv2-content" id="course-content" tabIndex={-1}>
          {children}
          <footer className="ssv2-footer"><span>{catalog.brand}</span><i aria-hidden="true">·</i><span>{ar ? "تعلّم بثقة" : "Learn with confidence"}</span></footer>
        </div>
      </div>
    </div>
    <nav className="ssv2-mobile-nav" aria-label={nav.main}>
      <Link href={paths.student(locale)} className="ssv2-mobile-nav-item" data-testid="nav-dashboard-mobile"><PanelRight size={18} aria-hidden="true" /><span>{nav.dashboard}</span></Link>
      <Link href={paths.myCourses(locale)} className="ssv2-mobile-nav-item is-current" aria-current="location" data-testid="nav-courses-mobile"><BookOpen size={18} aria-hidden="true" /><span>{nav.myCourses}</span></Link>
    </nav>
  </div>;
}
