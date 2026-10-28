import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { getCatalog } from "@/i18n/catalogs";
import { gate } from "@/components/gate";
import { CourseEditor } from "@/components/lms/admin-courses";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; courseId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${getLms(locale).admin.details} — ${getCatalog(locale).brand}`, robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale, courseId } = await params;
  if (!isLocale(locale)) notFound();
  const blocked = await gate(locale, "admin");
  if (blocked) return blocked;
  return <CourseEditor locale={locale} courseId={decodeURIComponent(courseId)} />;
}
