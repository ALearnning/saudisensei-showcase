"use client";
import { useState } from "react";
import type { LmsCoursePage } from "@workspace/saudisensei-api-client";
import type { Locale } from "@/i18n/config";
import { useLms } from "@/lib/lms-client";
import { MyCoursesView } from "./MyCoursesView";
import "../dashboard/dashboard.css";
import "./my-courses.css";

/** Same server-owned listing/search/pagination and freshness as before redesign. */
export function MyCourses({ locale }: { locale: Locale }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const qs = new URLSearchParams({ page: String(page), pageSize: "12", ...(search ? { search } : {}) });
  const q = useLms<LmsCoursePage>(`courses?${qs}`);
  return <MyCoursesView locale={locale} data={q.data} loading={q.loading} error={q.error}
    search={search} onSearch={value => { setSearch(value); setPage(1); }}
    onPage={setPage} onRetry={q.reload} />;
}
