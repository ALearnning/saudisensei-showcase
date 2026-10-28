import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getProtectedPage } from "@/lib/protected-page";
import { AreaView } from "@/components/AreaView";

export default async function StudentLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const state = await getProtectedPage(locale, "student");
  return state.kind === "authorized" ? children : <AreaView locale={locale} area="student" state={state} />;
}
