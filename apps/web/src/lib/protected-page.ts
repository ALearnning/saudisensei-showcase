import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getAuth0 } from "./auth0";
import type { ProtectedPage } from "@workspace/saudisensei-api-client";

export type AuthPageState =
  | { kind: "authorized"; data: ProtectedPage }
  | { kind: "setup" | "forbidden" | "unavailable" };

// Deduplicate layout/page checks within ONE server render only. React's cache
// is request-scoped; no identity, role or MFA result survives across requests.
export const getProtectedPage = cache(async (locale: "ar" | "en", area: "student" | "admin"): Promise<AuthPageState> => {
  const auth0 = getAuth0();
  if (!auth0) return { kind: "setup" };
  const session = await auth0.getSession();
  if (!session) redirect(`/${locale}/login`);
  let token: string;
  try {
    token = (await auth0.getAccessToken()).token;
  } catch {
    redirect(`/${locale}/login`);
  }
  const origin = process.env.API_BASE_URL ?? new URL("/api/v1/", process.env.APP_BASE_URL!).toString();
  try {
    const response = await fetch(`${origin.replace(/\/$/, "")}/${area}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) redirect(`/${locale}/login`);
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };
    return { kind: "authorized", data: await response.json() as ProtectedPage };
  } catch (error) {
    // Preserve Next.js redirect control flow; never turn it into a success state.
    if (error && typeof error === "object" && "digest" in error &&
        String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
    return { kind: "unavailable" };
  }
});
