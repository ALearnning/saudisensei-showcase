import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import type { LmsCourse, LmsStudentDashboard, ProtectedPage } from "@workspace/saudisensei-api-client";
import { DashboardView, dashboardCourseHref } from "../src/components/lms/dashboard/DashboardView";

// Isolated render fixtures only; never seeded or shipped to the application.
export const dashboardTestIdentity: ProtectedPage = {
  area: "student", user: { id: "fixture-student", displayName: "اسم طويل للطالب Student Name ".repeat(4),
    email: `${"long.".repeat(15)}student@example.invalid`, status: "active", preferredLocale: "ar", roles: ["student"] },
};
export function dashboardTestData(count: number): LmsStudentDashboard {
  const courses: LmsCourse[] = Array.from({ length: count }, (_, i) => ({
    id: `fixture-${i}`, slug: `fixture-${i}`, status: "published", editRevision: 1,
    title: i % 2 ? "Designing Accessible Interfaces for Modern Web Applications ".repeat(3)
      : "أساسيات البرمجة وتصميم تجارب التعلم الرقمية المتقدمة ".repeat(3),
    description: "وصف عربي English description",
    progress: { totalRequired: 10, completedRequired: 3, remainingRequired: 7, percentage: 30,
      isCompleted: false, continueLessonId: `fixture-lesson-${i}` },
  }));
  return { courses, totalCourses: count, completedRequired: count * 3, remainingRequired: count * 7 };
}
const render = (data: LmsStudentDashboard, locale: "ar" | "en" = "ar") => renderToStaticMarkup(createElement(DashboardView, {
  locale, identity: dashboardTestIdentity, data, loading: false, onRetry() {},
}));

for (const locale of ["ar", "en"] as const) {
  for (const count of [0, 1, 12]) {
    test(`dashboard ${locale}: ${count} real-contract course rows, long names/content, API-owned totals`, () => {
      const data = dashboardTestData(count);
      const html = render(data, locale);
      assert.match(html, new RegExp(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      assert.equal((html.match(/data-testid="card-course-/g) ?? []).length, count);
      assert.ok(html.includes(dashboardTestIdentity.user.displayName));
      assert.ok(html.includes(dashboardTestIdentity.user.email));
      assert.match(html, new RegExp(`data-testid="text-total-courses"><bdi>${count}</bdi>`));
      assert.match(html, new RegExp(`data-testid="text-completed-required"><bdi>${count * 3}</bdi>`));
      assert.match(html, new RegExp(`data-testid="text-remaining-required"><bdi>${count * 7}</bdi>`));
      assert.equal((html.match(/<h1 /g) ?? []).length, 1);
      assert.ok(!html.includes("ScenarioTools") && !html.includes("Illustrative data"));
      assert.ok(!html.includes("button-complete-lesson"));
      if (count) {
        assert.ok(html.includes(data.courses[0].title));
        assert.ok(html.includes(`/${locale}/student/courses/fixture-0/lessons/fixture-lesson-0`));
        if (count > 1) assert.ok(html.includes(data.courses[1].title));
      } else assert.ok(html.includes("dashboard-empty-title") && !html.includes("dashboard-next-title"));
    });
  }
}

test("dashboard actions preserve continuation, completion review, no-progress and URL encoding", () => {
  const course = dashboardTestData(1).courses[0];
  assert.equal(dashboardCourseHref("ar", course), "/ar/student/courses/fixture-0/lessons/fixture-lesson-0");
  course.progress!.isCompleted = true;
  assert.equal(dashboardCourseHref("en", course), "/en/student/courses/fixture-0");
  course.progress = undefined; course.id = "course/encoded";
  assert.equal(dashboardCourseHref("en", course), "/en/student/courses/course%2Fencoded");
});

test("server totals remain authoritative and incomplete progress never rounds to 100", () => {
  const data = dashboardTestData(1);
  data.totalCourses = 9; data.completedRequired = 81; data.remainingRequired = 27;
  data.courses[0].progress!.percentage = 99.9;
  const html = render(data);
  assert.match(html, /text-total-courses"><bdi>9/);
  assert.match(html, /text-completed-required"><bdi>81/);
  assert.match(html, /aria-valuenow="99"/);
  assert.match(html, /--ssv2-progress-final:0.99/);
});

test("navigation, localized logout, landmarks and mobile accessible names are preserved", () => {
  const html = render(dashboardTestData(1), "en");
  assert.match(html, /href="\/auth\/logout\?returnTo=\/en\/login"/);
  assert.match(html, /href="\/ar\/student"/);
  assert.match(html, /href="\/en\/student\/courses"/);
  assert.match(html, /href="#dashboard-content"/);
  assert.match(html, /id="dashboard-content" tabindex="-1"/);
  assert.match(html, /aria-label="Continue learning: /);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /data-testid="nav-courses-mobile"/);
});

test("loading and denied/error responses do not leak stale course content", () => {
  const props = { locale: "ar" as const, identity: dashboardTestIdentity, loading: true, onRetry() {} };
  const loading = renderToStaticMarkup(createElement(DashboardView, props));
  assert.match(loading, /aria-busy="true"/);
  assert.ok(!loading.includes("card-course-"));
  const denied = renderToStaticMarkup(createElement(DashboardView, {
    ...props, data: dashboardTestData(1), loading: false, error: { status: 403, code: "FORBIDDEN" },
  }));
  assert.ok(!denied.includes("card-course-") && !denied.includes("dashboard-next-title"));
});

test("SSR output is deterministic; stylesheet scopes shell changes and respects reduced motion/safe area", () => {
  const props = { locale: "ar" as const, identity: dashboardTestIdentity, data: dashboardTestData(12), loading: false, onRetry() {} };
  assert.equal(renderToString(createElement(DashboardView, props)), renderToString(createElement(DashboardView, props)));
  const css = readFileSync(new URL("../src/components/lms/dashboard/dashboard.css", import.meta.url), "utf8");
  assert.match(css, /\.shell:has\(> \.main > \.ss-workspace-v2\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /max-width: 370px/);
});
