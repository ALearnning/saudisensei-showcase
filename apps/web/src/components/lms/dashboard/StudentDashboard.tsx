"use client";

import type { LmsStudentDashboard, ProtectedPage } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { useLms } from "@/lib/lms-client";
import { DashboardView } from "./DashboardView";
import "./dashboard.css";

/** Same protected identity and fresh, read-only BFF query as the original dashboard. */
export function StudentDashboard({ locale, identity }: { locale: Locale; identity: ProtectedPage }) {
  const query = useLms<LmsStudentDashboard>("me/dashboard");
  return <DashboardView locale={locale} identity={identity} data={query.data}
    loading={query.loading} error={query.error} onRetry={query.reload} />;
}
