"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Languages } from "lucide-react";
import type { Locale } from "@/i18n/config";

export function LanguageSwitch({ locale, label, aria }: { locale: Locale; label: string; aria: string }) {
  const pathname = usePathname() || `/${locale}/login`;
  const target: Locale = locale === "ar" ? "en" : "ar";
  const href = pathname.replace(/^\/(ar|en)(?=\/|$)/, `/${target}`);
  return (
    <Link href={href} className="lang" hrefLang={target} lang={target} aria-label={aria} data-testid="link-language-switch">
      <Languages size={16} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
