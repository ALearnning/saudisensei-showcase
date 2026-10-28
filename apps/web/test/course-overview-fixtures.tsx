// Isolated browser layout documents, never routes, seeded data or app fallbacks.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseOverviewView } from "../src/components/lms/course-overview/CourseOverviewView";
import { courseOverviewFixture } from "./course-overview-data";

async function generate() {
  const root = resolve(import.meta.dirname, "../../..");
  const output = resolve(root, "generated-artifacts/course-overview/fixtures");
  const css = ":root{--font-body:Arial}" + await readFile(resolve(root, "apps/web/src/app/globals.css"), "utf8")
    + await readFile(resolve(root, "apps/web/src/components/lms/dashboard/dashboard.css"), "utf8")
    + await readFile(resolve(root, "apps/web/src/components/lms/course-overview/course-overview.css"), "utf8");
  await mkdir(output, { recursive: true });
  for (const locale of ["ar", "en"] as const) for (const [name, chapters, lessons, long] of [
    ["empty", 0, 0, false], ["one", 1, 1, false], ["active", 3, 5, false], ["many-long", 8, 16, true],
  ] as const) {
    const course = courseOverviewFixture(chapters, lessons, long);
    const html = renderToStaticMarkup(createElement(CourseOverviewView, {
      locale, course, progress: course.progress,
      resources: createElement("section", { "data-testid": "isolated-resource-slot" },
        createElement("h2", {}, locale === "ar" ? "موارد الدورة" : "Course resources"),
        createElement("p", {}, locale === "ar" ? "منطقة الموارد الخاصة الحالية" : "Existing private resource area")),
    }));
    await writeFile(resolve(output, `${locale}-${name}.html`), `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="shell"><header class="topbar">Legacy header</header><nav class="areanav">Legacy navigation</nav><main class="main">${html}</main><footer class="footer">Legacy footer</footer></div></body></html>`);
  }
  console.log("ISOLATED_COURSE_OVERVIEW_FIXTURES_READY");
}
void generate();
