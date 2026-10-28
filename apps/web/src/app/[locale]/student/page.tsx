import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getCatalog } from "@/i18n/catalogs";
import { getProtectedPage } from "@/lib/protected-page";
import { AreaView } from "@/components/AreaView";
import { StudentDashboard } from "@/components/lms/student";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getCatalog(locale).area.student.metaTitle, robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Protected identity check is retained: only a verified Student sees the dashboard.
  const state = await getProtectedPage(locale, "student");
  if (state.kind !== "authorized") return <AreaView locale={locale} area="student" state={state} />;
  return <StudentDashboard locale={locale} identity={state.data} />;
}
