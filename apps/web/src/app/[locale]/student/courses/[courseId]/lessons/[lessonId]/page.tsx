import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { getCatalog } from "@/i18n/catalogs";
import { gate } from "@/components/gate";
import { LessonReader } from "@/components/lms/student";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; courseId: string; lessonId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${getLms(locale).student.lessonOf} — ${getCatalog(locale).brand}`, robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale, courseId, lessonId } = await params;
  if (!isLocale(locale)) notFound();
  const blocked = await gate(locale, "student");
  if (blocked) return blocked;
  return <LessonReader locale={locale} courseId={decodeURIComponent(courseId)} lessonId={decodeURIComponent(lessonId)} />;
}
