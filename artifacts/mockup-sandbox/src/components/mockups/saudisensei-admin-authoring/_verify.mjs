// Scoped visual-prototype checks only. Requires a running _serve.mjs and an
// explicitly supplied temporary Playwright installation; no app/API credentials.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const toolRoot = process.argv[2];
const interactionsOnly = process.argv.includes("--interactions-only");
if (!toolRoot)
  throw new Error(
    "Pass the temporary Playwright package directory as the first argument.",
  );
const { chromium } = await import(
  pathToFileURL(path.join(toolRoot, "index.mjs")).href
);
const repo = fileURLToPath(new URL("../../../../../../", import.meta.url));
const out = path.join(repo, "docs/design/q7-admin-authoring");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const results = [],
  errors = [],
  unexpected = [],
  failedResources = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("request", (r) => {
  const u = new URL(r.url());
  if (
    (u.origin !== "http://127.0.0.1:4177" &&
      !["fonts.googleapis.com", "fonts.gstatic.com"].includes(u.hostname)) ||
    /\/(api|lms-api|auth)\//.test(u.pathname)
  )
    unexpected.push(u.origin + u.pathname);
});
page.on("requestfailed", (r) =>
  failedResources.push(new URL(r.url()).hostname),
);
function check(name, condition, detail) {
  results.push({
    name,
    passed: !!condition,
    ...(!condition ? { detail } : {}),
  });
  if (!condition) console.log("FAIL", name, JSON.stringify(detail));
}
async function load(entry, query = "", width = 1440) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1080 });
  await page.goto(
    `http://127.0.0.1:4177/preview/saudisensei-admin-authoring/${entry}${query}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.locator(".q7-studio h1").waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}
async function snap(name, fullPage = true) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage });
}
const entries = [
  "Overview",
  "QuestionBank",
  "QuestionEditor",
  "Skills",
  "Quizzes",
  "QuizBuilder",
  "PolicyPublication",
  "PreviewRelease",
];
try {
  if (!interactionsOnly) {
    for (const lang of ["ar", "en"])
      for (const width of [1440, 820, 390, 320]) {
        for (const entry of entries) {
          await load(entry, `?lang=${lang}`, width);
          const metrics = await page.evaluate(() => ({
            headings: document.querySelectorAll("h1").length,
            dir: document.querySelector(".q7-studio").getAttribute("dir"),
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            small: [
              ...document.querySelectorAll(
                ".q7-studio button,.q7-studio select,.q7-studio summary",
              ),
            ]
              .filter(
                (e) =>
                  !e.closest(".q7-review-tools") &&
                  !e.disabled &&
                  e.getBoundingClientRect().width > 0 &&
                  e.getBoundingClientRect().height > 0 &&
                  e.getBoundingClientRect().height < 43,
              )
              .map((e) => ({
                text: e.textContent?.trim().slice(0, 55),
                height: e.getBoundingClientRect().height,
              })),
          }));
          const label = `${entry}/${lang}/${width}`;
          check(
            `${label}: one heading`,
            metrics.headings === 1,
            metrics.headings,
          );
          check(
            `${label}: direction`,
            metrics.dir === (lang === "ar" ? "rtl" : "ltr"),
            metrics.dir,
          );
          check(
            `${label}: no page overflow`,
            metrics.scroll <= metrics.width + 1,
            metrics,
          );
          check(
            `${label}: control height`,
            metrics.small.length === 0,
            metrics.small,
          );
          if (lang === "ar" && width === 1440)
            await snap(
              `${String(entries.indexOf(entry) + 1).padStart(2, "0")}-${entry.toLowerCase()}-ar`,
            );
          if (entry === "QuizBuilder" && lang === "en" && width === 1440)
            await snap("09-quizbuilder-en");
          if (entry === "QuizBuilder" && width === 390)
            await snap(`10-quizbuilder-mobile-${lang}`);
        }
        console.log(`Rendered ${lang} ${width}: ${entries.length} frames`);
      }
    const scenarios = {
      QuestionBank: ["empty", "no-results", "loading", "error", "archived"],
      QuestionEditor: ["validation", "conflict", "archived"],
      Skills: ["validation", "archived"],
      Quizzes: ["empty", "error"],
      QuizBuilder: ["draft", "dirty", "empty", "conflict", "archived", "long"],
      PolicyPublication: ["failed-publication", "invalid-policy", "archived"],
      PreviewRelease: ["released", "release-na", "archived"],
    };
    for (const [entry, states] of Object.entries(scenarios))
      for (const state of states) {
        await load(entry, `?lang=en&state=${state}`, 390);
        check(
          `${entry}: ${state} render`,
          await page
            .locator(".q7-studio main")
            .innerText()
            .then((t) => t.trim().length > 30),
        );
        check(
          `${entry}: ${state} overflow`,
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
    for (const type of [
      "single_choice",
      "multiple_choice",
      "ordering",
      "short_text",
      "true_false",
    ]) {
      await load("QuestionEditor", `?lang=en&type=${type}`);
      check(
        `Editor ${type}: private key visible`,
        await page.locator(".q7-key-panel").isVisible(),
      );
      await page
        .locator(".q7-language-tabs")
        .getByRole("button", { name: "English", exact: true })
        .click();
      if (type !== "single_choice" && type !== "true_false")
        await snap(`11-editor-${type}-en`);
    }
  }
  await load("QuestionBank", "?lang=en");
  await page.getByRole("searchbox").fill("an-unmatched-phrase");
  check(
    "Bank: search miss differs from empty bank",
    await page
      .getByRole("heading", { name: "No matching questions" })
      .isVisible(),
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  check(
    "Bank: pagination changes visible identities",
    await page
      .locator(".q7-bank-row")
      .first()
      .innerText()
      .then((x) => x.includes("…a447")),
  );
  await load("QuizBuilder", "?lang=en");
  await page
    .locator(".q7-composition li")
    .first()
    .getByRole("button", { name: /Move down/ })
    .click();
  check(
    "Builder: keyboard reorder changes sequence",
    await page
      .locator(".q7-composition li")
      .first()
      .innerText()
      .then((x) => x.includes("Multiple choice")),
  );
  await page.locator(".q7-info-disclosure summary").click();
  await page.getByLabel("Title", { exact: true }).fill("Locally edited title");
  await page
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  check(
    "Builder: info save retains composition dirty state",
    await page
      .locator(".q7-summary")
      .innerText()
      .then((x) => x.includes("Unsaved changes")),
  );
  await page
    .getByRole("button", { name: "Save questions", exact: true })
    .click();
  check(
    "Builder: independent question save clears remaining dirty state",
    await page
      .locator(".q7-summary")
      .innerText()
      .then((x) => !x.includes("Unsaved changes")),
  );
  await load("PolicyPublication", "?lang=en");
  const gates = page.locator(".q7-visibility-stack select");
  await gates.nth(0).selectOption("never");
  check(
    "Policy: upstream change asks before dependent normalization",
    await page.getByRole("dialog").isVisible(),
  );
  await page
    .getByRole("button", { name: "Apply selections", exact: true })
    .click();
  check(
    "Policy: Never score cannot expose review/explanation",
    await gates.evaluateAll((es) => es.every((e) => e.value === "never")),
  );
  await gates.nth(0).selectOption("after_grading");
  await page
    .getByLabel("Attempt allowance", { exact: true })
    .selectOption("unlimited");
  check(
    "Policy: unlimited disables every exhaustion choice",
    await gates.evaluateAll((es) =>
      es.every(
        (e) => e.querySelector('[value="after_attempt_limit"]').disabled,
      ),
    ),
  );
  await load("PolicyPublication", "?lang=en&state=failed-publication");
  check(
    "Failed publication preserves old publication copy",
    await page
      .getByRole("alert")
      .innerText()
      .then((t) => t.includes("Revision 3 is still published unchanged")),
  );
  await snap("12-failed-publication-en");
  await load("PreviewRelease", "?lang=en");
  check(
    "Safe preview omits correct marker/explanation",
    (await page
      .locator(".q7-answer-explanation,.q7-preview-choice.answer")
      .count()) === 0,
  );
  await page
    .getByRole("button", { name: "Admin answers", exact: true })
    .click();
  check(
    "Private preview is clearly labeled",
    await page
      .locator(".q7-answer-explanation")
      .innerText()
      .then((t) => t.includes("ADMIN ONLY")),
  );
  await page
    .getByLabel("Requested preview language", { exact: true })
    .selectOption("en");
  await snap("13-private-preview-en");
  await page.locator(".q7-revision-list button").nth(1).click();
  const release = page.getByRole("button", {
    name: "Release revision 2",
    exact: true,
  });
  await release.click();
  check(
    "Release dialog names exact revision",
    await page
      .getByRole("dialog")
      .innerText()
      .then(
        (t) =>
          t.includes("Quiz revision 2 only") && t.includes("Cannot be undone"),
      ),
  );
  check(
    "Release dialog initial focus is cancel",
    await page.evaluate(() =>
      document.activeElement.textContent.includes("Cancel / back"),
    ),
  );
  await page.keyboard.press("Escape");
  check(
    "Release dialog Escape returns trigger focus",
    await release.evaluate((e) => e === document.activeElement),
  );
  await release.click();
  await snap("14-release-confirmation-en", false);
  await page
    .getByRole("button", { name: "Release revision 2 · simulate", exact: true })
    .click();
  check(
    "Release receipt shown for selected revision",
    await page
      .locator(".q7-release-panel")
      .innerText()
      .then((t) => t.includes("Already released")),
  );
  await page.locator(".q7-revision-list button").nth(0).click();
  check(
    "Release does not apply to another revision",
    await page
      .getByRole("button", { name: "Release revision 3", exact: true })
      .isVisible(),
  );
  await page.locator(".q7-revision-list button").nth(1).click();
  check(
    "Release receipt persists when returning to exact revision",
    await page
      .locator(".q7-release-panel")
      .innerText()
      .then((t) => t.includes("Already released")),
  );
  await load("Overview", "?lang=en");
  await page.keyboard.press("Tab");
  check(
    "Keyboard skip link is reachable",
    await page.evaluate(() =>
      document.activeElement.classList.contains("q7-skip"),
    ),
  );
  await page.keyboard.press("Enter");
  check(
    "Skip link targets main",
    await page.evaluate(() => document.activeElement.id === "q7-main"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "Reduced motion removes control transitions",
    await page
      .locator(".q7-brand")
      .evaluate((e) => getComputedStyle(e).transitionDuration === "0s"),
  );
  check("No browser runtime or console errors", errors.length === 0, errors);
  check(
    "No application/API/auth requests",
    unexpected.length === 0,
    unexpected,
  );
  check(
    "No failed preview resources",
    failedResources.length === 0,
    failedResources,
  );
} catch (e) {
  check("Browser runner completed", false, e.message);
} finally {
  await browser.close();
}
const report = {
  scope: "Q7A isolated synthetic previews only; no production acceptance",
  mode: interactionsOnly ? "interactions-only" : "full",
  passed: results.filter((x) => x.passed).length,
  failed: results.filter((x) => !x.passed).length,
  results,
};
await writeFile(
  path.join(
    out,
    interactionsOnly
      ? "preview-checks-interactions.json"
      : "preview-checks.json",
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ passed: report.passed, failed: report.failed }));
if (report.failed) process.exitCode = 1;
