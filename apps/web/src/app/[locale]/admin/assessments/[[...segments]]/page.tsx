import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { gate } from "@/components/gate";
import { AssessmentWorkspace } from "@/components/lms/assessments/workspace";
import { parseRoute } from "@/components/lms/assessments/model";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; segments?: string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: `${locale === "ar" ? "تأليف التقييمات" : "Assessment authoring"} — SaudiSensei`,
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }: Props) {
  const { locale, segments } = await params;
  if (!isLocale(locale)) notFound();
  const route = parseRoute(segments ?? []);
  if (!route) notFound();
  // The enclosing Admin layout verifies active Admin identity and signed MFA with Nest.
  const blocked = await gate(locale, "admin");
  if (blocked) return blocked;
  return <AssessmentWorkspace key={locale} locale={locale} route={route} />;
}
