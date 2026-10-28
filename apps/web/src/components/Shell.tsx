import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { LanguageSwitch } from "./LanguageSwitch";
import { AreaNav } from "./AreaNav";

export function Shell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = getCatalog(locale);
  return (
    <div className="shell">
      <header className="topbar">
        <Link href={`/${locale}/login`} className="brand" data-testid="link-home">
          <span className="mark" aria-hidden="true">س</span>
          <span className="brand-text">
            <strong>{t.brand}</strong>
            <small lang={locale === "ar" ? "en" : "ar"}>{t.brandSub}</small>
          </span>
        </Link>
        <LanguageSwitch locale={locale} label={t.switchLabel} aria={t.switchAria} />
      </header>
      <AreaNav locale={locale} />
      <main className="main">{children}</main>
      <footer className="footer">{t.footer}</footer>
    </div>
  );
}
