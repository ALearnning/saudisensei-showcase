import "server-only";
import type { Locale } from "@/i18n/config";
import { requireSession } from "@/lib/page-guard";
import { AreaView } from "./AreaView";

/** Returns a setup-state view when auth isn't configured; redirects anonymous users to login. */
export async function gate(locale: Locale, area: "student" | "admin"): Promise<React.ReactNode | null> {
  const state = await requireSession(locale);
  return state === "setup" ? <AreaView locale={locale} area={area} state={{ kind: "setup" }} /> : null;
}
