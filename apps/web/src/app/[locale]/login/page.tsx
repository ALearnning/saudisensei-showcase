import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { authIsConfigured } from "@/lib/auth-config";
import { LoginGateway } from "@/components/auth-entry/LoginGateway";
import "@/components/auth-entry/login.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getCatalog(locale);
  return { title: t.login.metaTitle, description: t.login.metaDesc, alternates: { languages: { ar: "/ar/login", en: "/en/login" } } };
}

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const configured = authIsConfigured();
  return <LoginGateway locale={locale} state={configured ? "entry" : "setup"} />;
}
