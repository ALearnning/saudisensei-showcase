import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getLms } from "@/i18n/lms";
import { getCatalog } from "@/i18n/catalogs";
import { gate } from "@/components/gate";
import { LessonEditor } from "@/components/lms/admin-curriculum";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; courseId: string; chapterId: string; lessonId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: `${getLms(locale).admin.lessonTitle} — ${getCatalog(locale).brand}`, robots: { index: false } };
}

export default async function Page({ params }: Props) {
  const { locale, courseId, chapterId, lessonId } = await params;
  if (!isLocale(locale)) notFound();
  const blocked = await gate(locale, "admin");
  if (blocked) return blocked;
  return <LessonEditor locale={locale} courseId={decodeURIComponent(courseId)} chapterId={decodeURIComponent(chapterId)} lessonId={decodeURIComponent(lessonId)} />;
}
