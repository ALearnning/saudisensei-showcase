import "server-only";
import { redirect } from "next/navigation";
import { getAuth0 } from "./auth0";

/** Nested LMS pages: require a session (Nest enforces roles/enrollment on every data call). */
export async function requireSession(locale: "ar" | "en"): Promise<"ok" | "setup"> {
  const auth0 = getAuth0();
  if (!auth0) return "setup";
  const session = await auth0.getSession();
  if (!session) redirect(`/${locale}/login`);
  return "ok";
}
