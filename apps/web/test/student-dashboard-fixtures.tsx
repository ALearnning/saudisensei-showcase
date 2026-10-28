// Isolated HTML render fixtures for browser layout checks, not application routes.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { LmsCourse, ProtectedPage } from "@workspace/saudisensei-api-client";
import { DashboardView } from "../src/components/lms/dashboard/DashboardView";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, "generated-artifacts/student-dashboard/fixtures");
const identity: ProtectedPage = { area: "student", user: {
  id: "isolated-render", displayName: "عبدالرحمن Student طويل الاسم ".repeat(4),
  email: `${"long-student-name.".repeat(6)}@example.invalid`,
  roles: ["student"], status: "active", preferredLocale: "ar",
} };
async function generate() {
const css = ":root{--font-body:Arial}" + await readFile(resolve(root, "apps/web/src/app/globals.css"), "utf8")
  + await readFile(resolve(root, "apps/web/src/components/lms/dashboard/dashboard.css"), "utf8");
await mkdir(output, { recursive: true });
for (const locale of ["ar", "en"] as const) for (const count of [0, 1, 12]) {
  const courses: LmsCourse[] = Array.from({ length: count }, (_, i) => ({
    id: `isolated-${i}`, slug: `isolated-${i}`, title: i % 2
      ? "Designing Accessible Interfaces for Modern Web Applications ".repeat(3)
      : "أساسيات البرمجة وتجارب التعلم الرقمية المتقدمة ".repeat(3),
    description: "وصف الدورة Course description", status: "published", editRevision: 1,
    progress: { totalRequired: 10, completedRequired: 3, remainingRequired: 7,
      percentage: 30, isCompleted: false, continueLessonId: `lesson-${i}` },
  }));
  const markup = renderToStaticMarkup(createElement(DashboardView, {
    locale, identity, loading: false,
    data: { courses, totalCourses: count, completedRequired: count * 3, remainingRequired: count * 7 }, onRetry() {},
  }));
  await writeFile(resolve(output, `${locale}-${count}.html`), `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="shell"><header class="topbar">Legacy header</header><nav class="areanav">Legacy navigation</nav><main class="main">${markup}</main><footer class="footer">Legacy footer</footer></div></body></html>`);
}
console.log("ISOLATED_DASHBOARD_RENDER_FIXTURES_READY");
}
void generate();
