import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getProtectedPage } from "@/lib/protected-page";
import { AreaView } from "@/components/AreaView";

// NestJS remains the role/MFA authority, including direct nested-page visits.
export default async function AdminLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const state = await getProtectedPage(locale, "admin");
  return state.kind === "authorized" ? children : <AreaView locale={locale} area="admin" state={state} />;
}
