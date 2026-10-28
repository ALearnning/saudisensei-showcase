import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { getCatalog } from "@/i18n/catalogs";
import { gate } from "@/components/gate";
import { AdminStudent } from "@/components/lms/admin-people";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; studentId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${getLms(locale).admin.student} — ${getCatalog(locale).brand}`, robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale, studentId } = await params;
  if (!isLocale(locale)) notFound();
  const blocked = await gate(locale, "admin");
  if (blocked) return blocked;
  return <AdminStudent locale={locale} studentId={decodeURIComponent(studentId)} />;
}
