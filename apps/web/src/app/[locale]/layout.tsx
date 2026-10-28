import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IBM_Plex_Sans_Arabic, Fraunces } from "next/font/google";
import { isLocale, dirFor, locales } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { Shell } from "@/components/Shell";
import "../globals.css";

const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const fraunces = Fraunces({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getCatalog(locale);
  return { title: t.brand, description: t.login.metaDesc };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={dirFor(locale)} className={`${plex.variable} ${fraunces.variable}`}>
      <body>
        <Shell locale={locale}>{children}</Shell>
      </body>
    </html>
  );
}
