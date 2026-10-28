// Synthetic browser integration, not genuine login/MFA or database acceptance.
// Uses existing Vite and an externally supplied Playwright install; never loads env files.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  ids,
  quiz,
  revision,
  preview,
  timestamp,
  base,
} from "./fixtures/q7-authoring/data.ts";
import {
  assessmentTimestamp,
  emptyQuestion,
} from "../src/components/lms/assessments/model.ts";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = fileURLToPath(
  new URL("./fixtures/q7-authoring/", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(
    require.resolve("vite", {
      paths: [path.join(repo, "artifacts/mockup-sandbox")],
    }),
  ).href
);
const { chromium } = await import(
  process.env.Q7_PLAYWRIGHT_MODULE || "playwright"
);
const output = process.env.Q7_BROWSER_OUTPUT || "/tmp/saudisensei-q7b-browser";
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: false,
  envFile: false,
  envDir: false,
  cacheDir: process.env.Q7_VITE_CACHE || "/tmp/saudisensei-q7b-vite-cache",
  logLevel: "error",
  resolve: {
    alias: [
      {
        find: /^next\/(link|navigation)$/,
        replacement: path.join(root, "next.tsx"),
      },
      { find: "@", replacement: path.join(repo, "apps/web/src") },
    ],
    dedupe: ["react", "react-dom"],
  },
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 4181,
    strictPort: true,
    fs: { allow: [repo, path.join(repo, "node_modules")] },
  },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
let activePage;
function dataPage(items, params) {
  return {
    items,
    total: items.length,
    page: Number(params.get("page") || 1),
    pageSize: Number(params.get("pageSize") || 20),
  };
}
async function setup(
  suffix = `quizzes/courses/${ids.course}/${ids.quiz}`,
  options = {},
) {
  const page = await browser.newPage({
    viewport: { width: options.width || 1440, height: 1000 },
    timezoneId: "America/Los_Angeles",
  });
  activePage = page;
  if (options.clock) {
    const time = new Date("2026-10-24T12:00:00.000Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.e2Errors = errors;
  const q = quiz(),
    history = revision(q),
    requests = [];
  const skill = {
    id: ids.skill,
    slug: "synthetic-skill",
    parentId: null,
    status: "active",
    editRevision: 0,
    translations: {
      en: { label: "Synthetic skill", description: "" },
      ar: { label: "مهارة تجريبية", description: "" },
    },
    ancestors: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const questionDraft = emptyQuestion(
    "single_choice",
    "en",
    (() => {
      let n = 0;
      return () => [ids.option, ids.secondOption][n++];
    })(),
  );
  questionDraft.content.en.prompt = "Synthetic saved question";
  questionDraft.content.en.options.forEach((v, i) => {
    v.label = `Option ${i + 1}`;
  });
  questionDraft.primarySkillId = ids.skill;
  let question = {
    id: ids.question,
    status: "active",
    editRevision: 1,
    currentRevisionId: ids.questionRevision,
    createdAt: timestamp,
    updatedAt: timestamp,
    draft: questionDraft,
  };
  const sealedQuestion = () => ({
    id: ids.questionRevision,
    questionId: ids.question,
    number: 1,
    type: "single_choice",
    defaultContentLocale: "en",
    content: { ...questionDraft.content, defaultPoints: 2 },
    gradingDefinition: questionDraft.gradingDefinition,
    explanation: {},
    difficulty: "medium",
    skillSnapshot: [
      {
        skillId: ids.skill,
        role: "primary",
        slug: skill.slug,
        parentId: null,
        labels: { en: "Synthetic skill" },
        path: [
          {
            skillId: ids.skill,
            slug: skill.slug,
            labels: { en: "Synthetic skill" },
          },
        ],
        ancestorIds: [],
      },
    ],
    cognitiveTags: [],
    schemaVersion: 1,
    graderVersion: "deterministic-v1",
    checksum: "0".repeat(64),
    createdAt: timestamp,
  });
  const state = {
    q,
    history,
    requests,
    errors,
    deny: null,
    failSave: false,
    saveFailure: null,
    failPublish: false,
    publishFailure: null,
    archivedSkill: false,
    skill,
    failRelease: false,
    uncertainCreate: false,
    release: null,
    emptyBank: false,
    archivedQuestion: false,
    questionReadGate: null,
    publishGate: null,
    historyReadGate: null,
    skillReadGate: null,
  };
  if (options.setup) options.setup(state);
  await page.route("**/lms-api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname.slice("/lms-api/".length),
      method = request.method(),
      body = request.postDataJSON();
    requests.push({ path: p, query: url.search, method, body });
    const send = (value, status = 200, headers = {}) =>
      route.fulfill({
        status:
          method === "GET" && p === state.badReadPath
            ? (state.badReadStatus ?? status)
            : status,
        contentType: "application/json",
        body: JSON.stringify(
          method !== "GET" && p === state.badPath
            ? state.badResponse(value)
            : method === "GET" && p === state.badReadPath
              ? state.badReadResponse(value)
              : value,
        ),
        headers:
          method === "GET" &&
          p === state.badReadPath &&
          state.badReadStatus === 429
            ? { ...headers, "retry-after": "1" }
            : headers,
      });
    if (state.deny)
      return send(
        { code: state.deny === 429 ? "RATE_LIMITED" : "FORBIDDEN" },
        state.deny,
        state.deny === 429 ? { "retry-after": "2" } : {},
      );
    if (
      method === "GET" &&
      p.startsWith(`${base}/revisions`) &&
      state.historyReadGate
    )
      await state.historyReadGate;
    if (
      method === "GET" &&
      p === `admin/skills/${ids.skill}` &&
      state.skillReadGate
    )
      await state.skillReadGate;
    if (p === `admin/courses/${ids.course}`)
      return send({
        id: ids.course,
        title: "Synthetic course",
        status: options.archivedParent ? "archived" : "published",
        chapters: [],
      });
    if (p === "admin/courses")
      return send(
        dataPage(
          [{ id: ids.course, title: "Synthetic course", status: "published" }],
          url.searchParams,
        ),
      );
    if (p === base && method === "GET")
      return send(state.readResponse ? state.readResponse(q) : q);
    if ((p === base && method === "PATCH") || p === `${base}/items`) {
      if (state.saveFailure) {
        if (state.saveFailure.status === 0) return route.abort("failed");
        return send(
          { code: state.saveFailure.code || "SAVE_REJECTED" },
          state.saveFailure.status,
          state.saveFailure.status === 429 ? { "retry-after": "3" } : {},
        );
      }
      if (state.failSave || body.expectedRevision !== q.editRevision)
        return send({ code: "QUIZ_CHANGED" }, 409);
      if (body.draft) q.draft = body.draft;
      if (body.items)
        q.items = body.items.map((i) => ({ id: i.questionId, ...i }));
      q.editRevision++;
      return send(state.saveResponse ? state.saveResponse(q) : q);
    }
    if (p === `${base}/preview`) return send(preview(q, body.locale));
    if (p === `${base}/answer-preview`)
      return send({
        quizId: q.id,
        editRevision: q.editRevision,
        questions: preview(q, body.locale).questions.map((i) => ({
          questionId: i.questionId,
          questionRevisionId: i.questionRevisionId,
          position: i.position,
          locale: i.locale,
          gradingDefinition: {
            type: "single_choice",
            correctOptionId: ids.option,
          },
          explanation: "Synthetic private explanation",
        })),
      });
    if (p === `${base}/revisions`)
      return send(
        dataPage(
          [
            {
              id: history.id,
              quizId: q.id,
              number: 1,
              totalPoints: 2,
              createdAt: timestamp,
            },
          ],
          url.searchParams,
        ),
      );
    if (p === `${base}/revisions/${ids.revision}`)
      return send({ ...history, reviewRelease: state.release });
    if (p === `${base}/revisions/${ids.revision}/review-release`) {
      if (state.failRelease) return send({ code: "UNAVAILABLE" }, 503);
      state.release = { quizRevisionId: ids.revision, releasedAt: timestamp };
      return send(state.release, 201);
    }
    if (p === `${base}/publish`) {
      if (state.publishGate) await state.publishGate;
      if (state.deny) return send({ code: "FORBIDDEN" }, state.deny);
      if (state.publishFailure)
        return send({ code: "RATE_LIMITED" }, 429, { "retry-after": "3" });
      if (state.failPublish) return send({ code: "QUESTION_NOT_ACTIVE" }, 400);
      q.editRevision++;
      return send(
        {
          editRevision: q.editRevision,
          revision: { ...revision(q), number: 2 },
        },
        201,
      );
    }
    if (p === `${base}/unpublish` || p === `${base}/archive`) {
      q.status = p.endsWith("archive") ? "archived" : "draft";
      q.currentRevisionId = null;
      q.editRevision++;
      return send(q, 201);
    }
    if (p === `admin/courses/${ids.course}/quizzes`) {
      if (method === "POST")
        return state.uncertainCreate
          ? send({ code: "UNAVAILABLE" }, 503)
          : send(
              {
                ...q,
                status: "draft",
                currentRevisionId: null,
                editRevision: 0,
                items: [],
                draft: body.draft,
              },
              201,
            );
      return send(dataPage([q], url.searchParams));
    }
    if (p === "admin/skills") {
      if (method === "POST") {
        if (state.uncertainCreate) return send({ code: "UNAVAILABLE" }, 503);
        Object.assign(skill, body);
        return send(skill, 201);
      }
      return send(dataPage([skill], url.searchParams));
    }
    if (p === `admin/skills/${ids.skill}` && method === "PATCH") {
      if (body.expectedRevision !== skill.editRevision)
        return send({ code: "SKILL_CHANGED" }, 409);
      Object.assign(skill, body, { editRevision: skill.editRevision + 1 });
      delete skill.expectedRevision;
    }
    if (
      p === `admin/skills/${ids.skill}/move` ||
      p === `admin/skills/${ids.skill}/archive`
    ) {
      if (p.endsWith("move")) skill.parentId = body.parentId;
      else state.archivedSkill = true;
      skill.editRevision++;
      return send(
        { ...skill, status: state.archivedSkill ? "archived" : "active" },
        201,
      );
    }
    if (p === `admin/skills/${ids.skill}`)
      return send({
        ...skill,
        status: state.archivedSkill ? "archived" : "active",
      });
    if (p === "admin/question-bank/questions") {
      if (method === "POST") {
        if (state.uncertainCreate) return send({ code: "UNAVAILABLE" }, 503);
        question = {
          ...question,
          editRevision: 0,
          currentRevisionId: null,
          draft: body.draft,
        };
        return send(question, 201);
      }
      return send(
        dataPage(
          state.emptyBank
            ? []
            : [
                {
                  ...question,
                  draft: undefined,
                  type: question.draft.type,
                  difficulty: "medium",
                  defaultContentLocale: "en",
                  locales: ["en"],
                  primarySkillId: ids.skill,
                  cognitiveTags: [],
                  status: state.archivedQuestion ? "archived" : "active",
                },
              ],
          url.searchParams,
        ),
      );
    }
    if (p === `admin/question-bank/questions/${ids.question}`) {
      if (method === "GET" && state.questionReadGate)
        await state.questionReadGate;
      if (method === "PATCH") {
        question.draft = body.draft;
        question.editRevision++;
      }
      return send({
        ...question,
        status: state.archivedQuestion ? "archived" : "active",
      });
    }
    if (p === `admin/question-bank/questions/${ids.question}/archive`) {
      state.archivedQuestion = true;
      question.editRevision++;
      return send({ ...question, status: "archived" }, 201);
    }
    if (
      p === `admin/question-bank/questions/${ids.question}/revisions` &&
      method === "POST"
    ) {
      question.editRevision++;
      question.currentRevisionId = ids.questionRevision;
      return send(
        { revision: sealedQuestion(), editRevision: question.editRevision },
        201,
      );
    }
    if (p === `admin/question-bank/questions/${ids.question}/revisions`)
      return send(
        dataPage(
          [
            {
              id: ids.questionRevision,
              questionId: ids.question,
              number: 1,
              type: "single_choice",
              defaultContentLocale: "en",
              createdAt: timestamp,
            },
          ],
          url.searchParams,
        ),
      );
    if (
      p ===
      `admin/question-bank/questions/${ids.question}/revisions/${ids.questionRevision}`
    )
      return send(sealedQuestion());
    errors.push(`Unexpected ${method} ${p}`);
    return send({ code: "NOT_FOUND" }, 404);
  });
  await page.goto(
    `http://127.0.0.1:4181/${options.locale || "en"}/admin/assessments/${suffix}`,
  );
  await page.locator(".assessment-workspace h1").waitFor();
  return { page, state };
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function run(name, fn) {
  if (
    process.env.Q7_BROWSER_FILTER &&
    !name.includes(process.env.Q7_BROWSER_FILTER)
  )
    return;
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (activePage) {
      await activePage.screenshot({
        path: path.join(output, "failure.png"),
        fullPage: true,
      });
      console.error(
        await activePage.evaluate(() =>
          [...document.querySelectorAll(".assessment-workspace *")]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
            })
            .slice(0, 20)
            .map((e) => `${e.tagName}.${e.className}#${e.id}`),
        ),
      );
    }
  } finally {
    if (activePage) {
      if (name.startsWith("E2 "))
        results.at(-1).pageErrors = activePage.e2Errors;
      const nativeDialogEvents = await activePage.evaluate(
        () => window.__q7NativeDialogEvents,
      );
      if (nativeDialogEvents)
        results.at(-1).nativeDialogEvents = nativeDialogEvents;
      const reviewObservations = await activePage.evaluate(
        () => window.__q7ReviewObservations,
      );
      if (reviewObservations)
        results.at(-1).reviewObservations = reviewObservations;
    }
    await activePage?.close();
    activePage = null;
  }
}
const checkErrors = (state) => assert.deepEqual(state.errors, []);
const saveNames = {
  info: "Save information",
  items: "Save questions",
  policy: "Save policy",
};
async function sectionView(page, section) {
  await button(
    page,
    section === "policy" ? "02 Policy & publication" : "01 Content",
  ).click();
  if (
    section === "info" &&
    !(await page.locator(".aa-info").evaluate((e) => e.open))
  )
    await page.locator(".aa-info summary").click();
}
async function editSections(page, corrected = false) {
  await sectionView(page, "info");
  await page
    .locator("#quiz-title")
    .fill(corrected ? "Corrected information" : "Local information");
  await page
    .locator("#quiz-instructions")
    .fill(corrected ? "Corrected instructions" : "Local instructions");
  await page
    .locator(`[id='points-${ids.question}']`)
    .fill(corrected ? "9" : "7");
  await sectionView(page, "policy");
  await page.locator("#quiz-max-attempts").fill(corrected ? "4" : "3");
  await page.locator("#quiz-pass").fill(corrected ? "81.25" : "66.67");
}
async function assertSections(
  page,
  { corrected = false, saved = [], cooldown = false } = {},
) {
  await sectionView(page, "info");
  for (const [selector, value] of [
    ["#quiz-title", corrected ? "Corrected information" : "Local information"],
    [
      "#quiz-instructions",
      corrected ? "Corrected instructions" : "Local instructions",
    ],
    [`[id='points-${ids.question}']`, corrected ? "9" : "7"],
  ]) {
    assert.equal(await page.locator(selector).inputValue(), value);
    assert.equal(
      await page.locator(selector).isDisabled(),
      false,
      `${selector} must remain editable`,
    );
  }
  for (const section of ["info", "items"])
    assert.equal(
      await button(page, saveNames[section]).isDisabled(),
      cooldown || saved.includes(section),
    );
  assert.equal(
    await button(page, "Preview saved draft").isDisabled(),
    saved.length !== 3,
  );
  await sectionView(page, "policy");
  assert.equal(
    await page.locator("#quiz-max-attempts").inputValue(),
    corrected ? "4" : "3",
  );
  assert.equal(
    await page.locator("#quiz-pass").inputValue(),
    corrected ? "81.25" : "66.67",
  );
  assert.equal(await page.locator("#quiz-max-attempts").isDisabled(), false);
  assert.equal(await page.locator("#quiz-pass").isDisabled(), false);
  assert.equal(
    await button(page, saveNames.policy).isDisabled(),
    cooldown || saved.includes("policy"),
  );
  assert.equal(
    await button(page, "Review and confirm publication").isDisabled(),
    saved.length !== 3,
  );
  assert.equal(
    await button(page, "Review current state").count(),
    0,
    "definite rejection must not require reload",
  );
}
async function saveSection(page, section) {
  await sectionView(page, section);
  await button(page, saveNames[section]).click();
}
const writes = (state) =>
  state.requests.filter((r) => ["PATCH", "PUT"].includes(r.method));
async function openNestedInspector(page) {
  await sectionView(page, "items");
  await button(page, "Add from bank").click();
  await page.locator("#bank-search").fill("retained picker search");
  await button(page, "Search").click();
  await page.locator(".aa-bank-row").click();
  await page.getByRole("button", { name: /Revision 1 ·/ }).click();
  await button(page, "Check question and skill eligibility").waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 2);
}
async function assertPickerRetained(page) {
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(
    await page.locator("#bank-search").inputValue(),
    "retained picker search",
  );
  assert.equal(
    await page
      .getByRole("button", { name: /Revision 1 ·/ })
      .evaluate((e) => document.activeElement === e),
    true,
    "the inner trigger must regain focus inside the retained picker",
  );
}
async function observeNativeDialog(dialog) {
  await dialog.evaluate((element) => {
    window.__q7NativeDialogEvents = [];
    for (const type of ["cancel", "close"])
      element.addEventListener(type, (event) => {
        window.__q7NativeDialogEvents.push({
          type,
          trusted: event.isTrusted,
          cancelable: event.cancelable,
          open: element.open,
        });
      });
  });
}
async function settleDialogEvents(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function repeatedNativeEscape(page) {
  for (let n = 0; n < 3; n++) await page.keyboard.press("Escape");
  await settleDialogEvents(page);
}
try {
  for (const spacing of [0, 120])
    for (const picker of ["inspector", "skill"])
      await run(
        `R-1 ${picker} 12 native Escapes spacing=${spacing}`,
        async () => {
          const { page, state } = await setup();
          await editSections(page);
          if (picker === "inspector") await openNestedInspector(page);
          else {
            await sectionView(page, "items");
            await button(page, "Add from bank").click();
            await page.locator("#bank-search").fill("retained picker search");
            await page.getByText("More filters", { exact: true }).click();
            await button(page, "Choose skill").click();
            await page
              .getByLabel("Search skills", { exact: true })
              .fill("retained skill search");
          }
          const inner = page.locator("dialog").last();
          await observeNativeDialog(inner);
          let release;
          const gate = new Promise((resolve) => {
            release = resolve;
          });
          if (picker === "inspector") state.questionReadGate = gate;
          else state.skillReadGate = gate;
          try {
            await button(
              page,
              picker === "inspector"
                ? "Check question and skill eligibility"
                : "Synthetic skill",
            ).click();
            await page.waitForFunction(() => {
              const d = [...document.querySelectorAll("dialog")].at(-1);
              return d?.querySelector("header button")?.disabled;
            });
            await page.evaluate(() => {
              window.__q7ReviewObservations = [];
            });
            for (let n = 0; n < 12; n++) {
              await page.keyboard.press("Escape");
              if (spacing) await page.waitForTimeout(spacing);
            }
            await settleDialogEvents(page);
            const observation = await page.evaluate(() => {
              const dialogs = [...document.querySelectorAll("dialog")],
                top = dialogs.at(-1);
              const value = {
                open: dialogs.filter((d) => d.open).length,
                mounted: dialogs.length,
                innerFocused: !!top?.contains(document.activeElement),
                activeTag: document.activeElement?.tagName,
                activeId: document.activeElement?.id,
                nativeClosePolicies: dialogs.map((d) =>
                  d.getAttribute("closedby"),
                ),
                search: document.querySelector("#bank-search")?.value,
              };
              window.__q7ReviewObservations.push(value);
              return value;
            });
            assert.equal(
              observation.open,
              2,
              "both nested dialogs must survive the full sequence",
            );
            assert.equal(
              observation.innerFocused,
              true,
              "busy child must stay on top with focus",
            );
            assert.equal(observation.search, "retained picker search");
            if (picker === "skill")
              assert.equal(
                await page
                  .getByLabel("Search skills", { exact: true })
                  .inputValue(),
                "retained skill search",
              );
            for (let n = 0; n < 4; n++) {
              await page.keyboard.press("Tab");
              assert.equal(
                await inner.evaluate(
                  (d) =>
                    document.activeElement === document.body ||
                    d.contains(document.activeElement),
                ),
                true,
              );
            }
          } finally {
            release();
            state.questionReadGate = null;
            state.skillReadGate = null;
          }
          if (picker === "inspector") {
            await button(page, "Add this revision").waitFor();
            await page.keyboard.press("Escape");
            await assertPickerRetained(page);
            await page.getByRole("button", { name: /Revision 1 ·/ }).click();
            await button(
              page,
              "Check question and skill eligibility",
            ).waitFor();
          } else {
            await page
              .getByRole("button", { name: "Synthetic skill", exact: true })
              .waitFor();
            await page.waitForFunction(
              () => document.querySelectorAll("dialog").length === 1,
            );
            assert.equal(
              await button(page, "Synthetic skill").evaluate(
                (e) => document.activeElement === e,
              ),
              true,
            );
            await button(page, "Synthetic skill").click();
            await page.getByLabel("Search skills", { exact: true }).waitFor();
          }
          assert.equal(await page.locator("dialog[open]").count(), 2);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("dialog[open]").count(), 1);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("dialog").count(), 0);
          assert.equal(
            await button(page, "Add from bank").evaluate(
              (e) => document.activeElement === e,
            ),
            true,
          );
          await assertSections(page);
          assert.equal(writes(state).length, 0);
          checkErrors(state);
        },
      );
  for (const mode of ["none", "rapid", "spaced", "later interaction"])
    await run(`R-2 publication stable completion focus ${mode}`, async () => {
      const { page, state } = await setup();
      await sectionView(page, "policy");
      const trigger = button(page, "Review and confirm publication");
      await trigger.click();
      let publish, history;
      state.publishGate = new Promise((resolve) => {
        publish = resolve;
      });
      state.historyReadGate = new Promise((resolve) => {
        history = resolve;
      });
      try {
        await button(page, "Confirm").click();
        await button(page, "Working…").waitFor();
        if (mode === "rapid" || mode === "spaced")
          for (let n = 0; n < 12; n++) {
            await page.keyboard.press("Escape");
            if (mode === "spaced") await page.waitForTimeout(120);
          }
        publish();
        state.publishGate = null;
        await page
          .getByText("Server confirmed the new state", { exact: true })
          .waitFor();
        await page.waitForFunction(() => !document.querySelector("dialog"));
        await settleDialogEvents(page);
        assert.equal(
          await trigger.isDisabled(),
          true,
          "history refresh must be held pending",
        );
        await page.evaluate(() => {
          window.__q7ReviewObservations = [
            {
              phase: "history pending",
              active: document.activeElement?.tagName,
              id: document.activeElement?.id,
            },
          ];
        });
        if (mode === "later interaction")
          await page.locator("#quiz-pass").focus();
        history();
        state.historyReadGate = null;
        await page.waitForFunction(() =>
          [...document.querySelectorAll("button")].some(
            (e) =>
              e.textContent === "Review and confirm publication" && !e.disabled,
          ),
        );
        await settleDialogEvents(page);
        const target = page.locator(
          mode === "later interaction" ? "#quiz-pass" : ".aa-publication",
        );
        const focused = await target.evaluate((e) => {
          window.__q7ReviewObservations.push({
            phase: "history settled",
            active: document.activeElement?.tagName,
            id: document.activeElement?.id,
            expectedFocused: document.activeElement === e,
          });
          return document.activeElement === e;
        });
        assert.equal(
          focused,
          true,
          "one stable focus target after publication and history settle",
        );
        assert.equal(
          state.requests.filter((r) => r.path.endsWith("/publish")).length,
          1,
        );
        assert.equal(await page.locator("dialog").count(), 0);
        checkErrors(state);
      } finally {
        publish();
        history();
        state.publishGate = null;
        state.historyReadGate = null;
      }
    });
  await run(
    "N-1 explicit native ancestor close retains busy child, edits and reopening",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      await openNestedInspector(page);
      await observeNativeDialog(page.locator("dialog").last());
      let release;
      state.questionReadGate = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await button(page, "Check question and skill eligibility").click();
        await button(page, "Checking eligibility…").waitFor();
        await repeatedNativeEscape(page);
        // Explicit native closure exercises the recovery fallback independently
        // of closedby support and must keep the busy child above its ancestor.
        await page
          .locator("dialog")
          .first()
          .evaluate((e) => e.close());
        await settleDialogEvents(page);
        assert.equal(
          await page
            .locator("dialog")
            .last()
            .evaluate((e) => e.contains(document.activeElement)),
          true,
        );
        assert.equal(
          await page.locator("dialog[open]").count(),
          2,
          "busy inspector and outer picker must remain open",
        );
        assert.equal(
          await page.locator("#bank-search").inputValue(),
          "retained picker search",
        );
      } finally {
        release();
        state.questionReadGate = null;
      }
      await button(page, "Add this revision").waitFor();
      await page.keyboard.press("Escape");
      await assertPickerRetained(page);
      await page.getByRole("button", { name: /Revision 1 ·/ }).click();
      await button(page, "Check question and skill eligibility").waitFor();
      assert.equal(await page.locator("dialog[open]").count(), 2);
      await page.keyboard.press("Escape");
      await assertPickerRetained(page);
      await page.keyboard.press("Escape");
      await assertSections(page);
      assert.equal(writes(state).length, 0);
      checkErrors(state);
    },
  );
  await run(
    "N-1 explicit native publication close preserves one write and completion focus",
    async () => {
      const { page, state } = await setup();
      await sectionView(page, "policy");
      const trigger = button(page, "Review and confirm publication");
      await trigger.click();
      await observeNativeDialog(page.locator("dialog"));
      let release;
      state.publishGate = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await button(page, "Confirm").click();
        await button(page, "Working…").waitFor();
        await repeatedNativeEscape(page);
        await page.locator("dialog").evaluate((e) => e.close());
        await settleDialogEvents(page);
        assert.equal(
          await page.locator("dialog[open]").count(),
          1,
          "pending publication must stay visible",
        );
        assert.equal(await button(page, "Working…").isDisabled(), true);
        await page.keyboard.press("Enter");
        assert.equal(
          state.requests.filter((r) => r.path.endsWith("/publish")).length,
          1,
        );
      } finally {
        release();
        state.publishGate = null;
      }
      await page
        .getByText("Server confirmed the new state", { exact: true })
        .waitFor();
      await settleDialogEvents(page);
      assert.equal(await page.locator("dialog").count(), 0);
      assert.equal(
        await page
          .locator(".aa-publication")
          .evaluate((e) => document.activeElement === e),
        true,
        "completion focuses only the stable publication summary",
      );
      assert.equal(
        state.requests.filter((r) => r.path.endsWith("/publish")).length,
        1,
      );
      await trigger.click();
      await button(page, "Confirm").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog").count(), 0);
      assert.equal(
        await trigger.evaluate((e) => document.activeElement === e),
        true,
      );
      checkErrors(state);
    },
  );
  await run(
    "N-1 idle native close synchronizes nested state and focus",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      await openNestedInspector(page);
      await page
        .locator("dialog")
        .last()
        .evaluate((e) => e.close());
      await settleDialogEvents(page);
      await assertPickerRetained(page);
      assert.equal(
        await page.locator("dialog").count(),
        1,
        "closed inspector must unmount from React state",
      );
      await page.getByRole("button", { name: /Revision 1 ·/ }).click();
      await button(page, "Check question and skill eligibility").waitFor();
      assert.equal(await page.locator("dialog[open]").count(), 2);
      await page.keyboard.press("Escape");
      await page.locator("dialog").evaluate((e) => e.close());
      await settleDialogEvents(page);
      assert.equal(await page.locator("dialog").count(), 0);
      assert.equal(
        await button(page, "Add from bank").evaluate(
          (e) => document.activeElement === e,
        ),
        true,
      );
      await assertSections(page);
      checkErrors(state);
    },
  );
  for (const status of [401, 403])
    await run(
      `R-3 ${status} teardown regression: cannot resurrect a natively closed busy modal`,
      async () => {
        const { page, state } = await setup();
        await sectionView(page, "policy");
        await button(page, "Review and confirm publication").click();
        const dialog = await page.locator("dialog").elementHandle();
        await observeNativeDialog(page.locator("dialog"));
        let release;
        state.publishGate = new Promise((resolve) => {
          release = resolve;
        });
        try {
          await button(page, "Confirm").click();
          await button(page, "Working…").waitFor();
          await repeatedNativeEscape(page);
          state.deny = status;
          // Queue another native close just before the authorization response.
          await dialog.evaluate((e) => e.close());
        } finally {
          release();
          state.publishGate = null;
        }
        await page
          .getByTestId(status === 401 ? "status-session" : "status-forbidden")
          .waitFor();
        await settleDialogEvents(page);
        assert.equal(await page.locator("dialog").count(), 0);
        assert.deepEqual(
          await dialog.evaluate((e) => ({
            connected: e.isConnected,
            open: e.open,
          })),
          { connected: false, open: false },
        );
        assert.equal(
          state.requests.filter((r) => r.path.endsWith("/publish")).length,
          1,
        );
        checkErrors(state);
      },
    );
  await run(
    "P-1 nested Escape retains picker, trigger focus and every builder edit",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      await openNestedInspector(page);
      await page.keyboard.press("Escape");
      await assertPickerRetained(page);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(
        await button(page, "Add from bank").evaluate(
          (e) => document.activeElement === e,
        ),
        true,
      );
      await assertSections(page);
      assert.equal(writes(state).length, 0);
      checkErrors(state);
    },
  );
  await run(
    "P-1 busy inner dialog cannot cancel through its idle ancestor",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      await openNestedInspector(page);
      let release;
      state.questionReadGate = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await button(page, "Check question and skill eligibility").click();
        await button(page, "Checking eligibility…").waitFor();
        assert.equal(
          await button(page, "Checking eligibility…").isDisabled(),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator("dialog[open]").count(),
          2,
          "busy inner cancellation must neither dismiss itself nor its ancestor",
        );
        assert.equal(
          await page.locator("#bank-search").inputValue(),
          "retained picker search",
        );
      } finally {
        release();
        state.questionReadGate = null;
      }
      await button(page, "Add this revision").waitFor();
      await page.keyboard.press("Escape");
      await assertPickerRetained(page);
      await page.keyboard.press("Escape");
      await assertSections(page);
      assert.equal(writes(state).length, 0);
      checkErrors(state);
    },
  );
  await run(
    "P-1 ordinary single-dialog native cancellation retains edits and focus",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      await sectionView(page, "items");
      await button(page, "Inspect revision and eligibility").click();
      await button(page, "Check question and skill eligibility").waitFor();
      assert.equal(await page.locator("dialog[open]").count(), 1);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(
        await button(page, "Inspect revision and eligibility").evaluate(
          (e) => document.activeElement === e,
        ),
        true,
      );
      await assertSections(page);
      assert.equal(writes(state).length, 0);
      checkErrors(state);
    },
  );
  for (const locale of ["ar", "en"])
    for (const form of ["question", "quiz"]) {
      await run(
        `L2 add-language ${form} ${locale} uses a localized language name`,
        async () => {
          const suffix =
            form === "question"
              ? "question-bank/new"
              : `quizzes/courses/${ids.course}/new`;
          const { page, state } = await setup(suffix, { locale });
          const field = page.locator(
            form === "question" ? "#question-prompt" : "#quiz-title",
          );
          await field.waitFor();
          const name =
            locale === "ar"
              ? "إضافة لغة · الإنجليزية"
              : "Add language · Arabic";
          const add = button(page, name);
          assert.equal(
            await add.count(),
            1,
            "Add language must name the language in the UI locale",
          );
          assert.equal(
            await page
              .getByRole("button", {
                name: /^(إضافة لغة|Add language) · (ar|en)$/,
              })
              .count(),
            0,
          );
          await add.click();
          assert.equal(
            await field.evaluate((e) => e.closest("[lang]").lang),
            locale === "ar" ? "en" : "ar",
          );
          assert.equal(
            await page
              .locator(
                form === "question"
                  ? "#question-default-locale"
                  : "#quiz-default-language",
              )
              .inputValue(),
            locale,
          );
          assert.equal(
            await add.count(),
            0,
            "An authored language cannot be added twice",
          );
          assert.equal(writes(state).length, 0);
          assert.equal(
            state.requests.filter((r) => r.method === "POST").length,
            0,
          );
          checkErrors(state);
        },
      );
    }
  await run(
    "L1 loaded archive metadata marks only matching composition items without row fetches",
    async () => {
      const { page, state } = await setup();
      await button(page, "Add from bank").click();
      await page.locator(".aa-bank-row").waitFor();
      state.archivedQuestion = true;
      await page.locator("#bank-status").selectOption("archived");
      await page.locator(".aa-bank-row .aa-tag.archived").waitFor();
      await button(page, "Close").click();
      await page.getByText(/Known ineligible from archive data/).waitFor();
      assert.equal(await page.locator(".aa-composition li").count(), 1);
      assert.equal(
        state.requests.filter((r) => /question-bank\/questions\//.test(r.path))
          .length,
        0,
      );
      assert.equal(writes(state).length, 0);
      assert.equal(
        await button(page, "Preview saved draft").isDisabled(),
        true,
      );
      await sectionView(page, "policy");
      assert.equal(
        await button(page, "Review and confirm publication").isDisabled(),
        true,
      );
      checkErrors(state);
    },
  );
  await run(
    "L1 explicit archived-skill eligibility check retains and marks the exact item",
    async () => {
      const { page, state } = await setup();
      state.archivedSkill = true;
      await button(page, "Inspect revision and eligibility").click();
      await button(page, "Check question and skill eligibility").click();
      await page
        .getByText(
          "Ineligible — remove or replace. History remains preserved.",
          { exact: true },
        )
        .waitFor();
      await button(page, "Close").click();
      await page.getByText(/Known ineligible from archive data/).waitFor();
      assert.equal(await page.locator(".aa-composition li").count(), 1);
      assert.equal(
        state.requests.filter((r) => r.path === `admin/skills/${ids.skill}`)
          .length,
        1,
      );
      assert.equal(writes(state).length, 0);
      checkErrors(state);
    },
  );
  await run(
    "L1 eligibility rejection without row evidence preserves every edit and blames no row",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      state.saveFailure = { status: 400, code: "QUESTION_NOT_ACTIVE" };
      await saveSection(page, "items");
      await page.getByText(/No row is blamed/).waitFor();
      await assertSections(page);
      assert.equal(
        await page.getByText(/Known ineligible from archive data/).count(),
        0,
      );
      assert.equal(
        state.requests.filter((r) => /question-bank\/questions\//.test(r.path))
          .length,
        0,
      );
      checkErrors(state);
    },
  );
  await run(
    "L1 skill archive confirmation explains affected pinned draft items without inventing counts",
    async () => {
      const { page, state } = await setup("skills");
      await button(page, "Synthetic skill").click();
      await page.getByLabel("Label · English", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Label · English", { exact: true }).count(),
        1,
      );
      assert.equal(
        await page.getByLabel("Description · Arabic", { exact: true }).count(),
        1,
      );
      await button(page, "Archive").click();
      await page.getByText(/Draft quiz items pinning revisions/).waitFor();
      assert.match(
        await page.locator("dialog").innerText(),
        /not removed or replaced automatically/,
      );
      assert.match(
        await page.locator("dialog").innerText(),
        /cannot list or count affected drafts/,
      );
      await button(page, "Cancel / back").click();
      assert.equal(writes(state).length, 0);
      checkErrors(state);
    },
  );
  await run(
    "L3 unsaved pinned row survives information and policy preview refreshes with its known revision number",
    async () => {
      const { page, state } = await setup(undefined, {
        setup: (s) => {
          s.q.items[0].questionId = ids.secondOption;
          s.q.items[0].questionRevisionId = ids.option;
        },
      });
      await button(page, "Add from bank").click();
      await page.locator(".aa-bank-row").click();
      await page.getByRole("button", { name: /Revision 1 ·/ }).click();
      await button(page, "Check question and skill eligibility").click();
      await button(page, "Add this revision").click();
      const row = page.locator(`[data-question-id='${ids.question}']`);
      await sectionView(page, "info");
      await page.locator("#quiz-title").fill("New information only");
      const before = state.requests.length;
      for (const section of ["info", "policy"]) {
        if (section === "policy") {
          await sectionView(page, "policy");
          await page.locator("#quiz-max-attempts").fill("3");
        }
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/preview"),
        );
        await saveSection(page, section);
        await response;
        await sectionView(page, "items");
        assert.match(await row.innerText(), /Synthetic saved question/);
        assert.match(await row.innerText(), /Revision 1/);
        assert.equal(await button(page, "Save questions").isDisabled(), false);
        assert.equal(state.q.items.length, 1);
      }
      assert.equal(
        state.requests
          .slice(before)
          .some((r) => r.path.includes("question-bank")),
        false,
      );
      await row
        .getByRole("button", { name: "Remove question 2", exact: true })
        .click();
      assert.equal(await row.count(), 0);
      checkErrors(state);
    },
  );
  for (const locale of ["ar", "en"]) {
    await run(
      `L2 ${locale} revision and release timestamps use Riyadh and language labels use names`,
      async () => {
        const { page, state } = await setup(undefined, {
          locale,
          setup: (s) => {
            s.release = { quizRevisionId: ids.revision, releasedAt: timestamp };
          },
        });
        await button(
          page,
          locale === "ar" ? "03 المعاينة والإصدارات" : "03 Preview & revisions",
        ).click();
        await page
          .getByText(assessmentTimestamp(timestamp, locale), { exact: true })
          .first()
          .waitFor();
        assert.equal(
          await page
            .getByText(assessmentTimestamp(timestamp, locale), { exact: true })
            .count(),
          2,
        );
        assert.equal(await page.getByText("EN", { exact: true }).count(), 0);
        await page.goto(
          `http://127.0.0.1:4181/${locale}/admin/assessments/question-bank`,
        );
        await page.locator(".aa-bank-row").click();
        assert.match(
          await page.locator(".aa-bank-row").innerText(),
          locale === "ar" ? /الإنجليزية/ : /English/,
        );
        await button(
          page,
          locale === "ar" ? "الإصدارات المثبّتة" : "Sealed revisions",
        ).click();
        await page
          .getByText(assessmentTimestamp(timestamp, locale), { exact: true })
          .waitFor();
        checkErrors(state);
      },
    );
  }
  await run(
    "L4 archived quiz pointer remains historical and cannot be mistaken for active publication",
    async () => {
      const { page, state } = await setup(undefined, {
        setup: (s) => {
          s.q.status = "archived";
        },
      });
      await button(page, "03 Preview & revisions").click();
      await page
        .getByText("Last revision before archive — historical", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByText("Currently published", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByText("Current revision", { exact: true }).count(),
        0,
      );
      assert.equal(await button(page, "Release revision 1").isDisabled(), true);
      assert.equal(state.q.currentRevisionId, ids.revision);
      checkErrors(state);
    },
  );
  for (const source of ["server", "client"]) {
    await run(
      `L5 ${source} publication 429 preserves state, permits edits and requires cooldown then manual confirmation`,
      async () => {
        const { page, state } = await setup(undefined, { clock: true });
        if (source === "client") {
          await button(page, "03 Preview & revisions").click();
          await page
            .getByText("Which option matches the description?", { exact: true })
            .waitFor();
          while (state.requests.length < 40) {
            const next =
              (await page.locator("#quiz-preview-locale").inputValue()) === "en"
                ? "ar"
                : "en";
            const response = page.waitForResponse((r) =>
              r.url().endsWith("/preview"),
            );
            await page.locator("#quiz-preview-locale").selectOption(next);
            await response;
          }
        } else state.publishFailure = true;
        await sectionView(page, "policy");
        await button(page, "Review and confirm publication").click();
        await button(page, "Confirm").click();
        await page.getByText(/Publication was throttled/).waitFor();
        assert.equal(state.q.currentRevisionId, ids.revision);
        assert.equal(state.q.editRevision, 4);
        assert.equal(
          await page.getByText(/The server rejected publication/).count(),
          0,
        );
        const publications = () =>
          state.requests.filter((r) => r.path.endsWith("/publish"));
        assert.equal(publications().length, source === "client" ? 0 : 1);
        await editSections(page);
        await assertSections(page, { cooldown: true });
        await page.clock.runFor(source === "client" ? 59999 : 2999);
        await sectionView(page, "policy");
        assert.equal(
          await button(page, "Review and confirm publication").isDisabled(),
          true,
        );
        assert.equal(publications().length, source === "client" ? 0 : 1);
        await page.clock.runFor(1001);
        await page.getByText(/The cooldown has ended/).waitFor();
        await assertSections(page);
        state.publishFailure = false;
        for (const section of ["info", "items", "policy"]) {
          await saveSection(page, section);
          await page.waitForFunction(() =>
            document
              .querySelector(".aa-live")
              ?.textContent.includes("Section saved"),
          );
        }
        assert.equal(publications().length, source === "client" ? 0 : 1);
        await button(page, "Review and confirm publication").click();
        await button(page, "Confirm").click();
        await page.waitForFunction(() =>
          document
            .querySelector(".aa-live")
            ?.textContent.includes("Server confirmed"),
        );
        assert.equal(publications().at(-1).body.expectedRevision, 7);
        assert.equal(state.q.editRevision, 8);
        assert.equal(state.q.draft.content.en.title, "Local information");
        assert.equal(state.q.items[0].points, 7);
        assert.equal(state.q.draft.policy.passBasisPoints, 6667);
        checkErrors(state);
      },
    );
  }
  for (const failure of ["400", "server429", "client429"])
    for (const section of ["info", "items", "policy"]) {
      await run(
        `F1 ${failure} ${section} retains all edits and retries the isolated section`,
        async () => {
          const { page, state } = await setup(undefined, { clock: true });
          if (failure === "client429") {
            await button(page, "03 Preview & revisions").click();
            await page
              .getByText("Which option matches the description?", {
                exact: true,
              })
              .waitFor();
            // Consume the real workspace limiter using real UI preview requests, not a mocked limiter.
            while (state.requests.length < 40) {
              const next =
                (await page.locator("#quiz-preview-locale").inputValue()) ===
                "en"
                  ? "ar"
                  : "en";
              const response = page.waitForResponse((r) =>
                r.url().endsWith("/preview"),
              );
              await page.locator("#quiz-preview-locale").selectOption(next);
              await response;
            }
            assert.equal(state.requests.length, 40);
          } else state.saveFailure = { status: failure === "400" ? 400 : 429 };
          await editSections(page);
          await saveSection(page, section);
          const limited = failure !== "400";
          await page
            .getByText(
              limited ? /Too many requests/ : /The data could not be accepted/,
            )
            .waitFor();
          assert.equal(writes(state).length, failure === "client429" ? 0 : 1);
          assert.equal(state.q.editRevision, 4);
          assert.equal(state.q.draft.content.en.title, "Q7 synthetic quiz");
          assert.equal(state.q.draft.policy.maxAttempts, 1);
          assert.equal(state.q.items[0].points, 2);
          await assertSections(page, { cooldown: limited });
          await editSections(page, true);
          await assertSections(page, { corrected: true, cooldown: limited });
          if (limited) {
            const before = state.requests.length;
            await page.clock.runFor(failure === "server429" ? 2999 : 59999);
            await sectionView(page, section);
            assert.equal(
              await button(page, saveNames[section]).isDisabled(),
              true,
            );
            await button(page, saveNames[section]).evaluate((e) => e.click());
            assert.equal(
              state.requests.length,
              before,
              "cooldown must not send or automatically retry a request",
            );
            await page.clock.runFor(1001);
          }
          state.saveFailure = null;
          const saved = [];
          for (const target of [
            section,
            ...["info", "items", "policy"].filter((s) => s !== section),
          ]) {
            const before = structuredClone(state.q);
            await saveSection(page, target);
            await page.waitForFunction(() =>
              document
                .querySelector(".aa-live")
                ?.textContent.includes("Section saved"),
            );
            saved.push(target);
            await assertSections(page, { corrected: true, saved });
            const request = writes(state).at(-1);
            assert.equal(request.body.expectedRevision, before.editRevision);
            assert.equal(
              request.path,
              target === "items" ? `${base}/items` : base,
            );
            if (target === "items") {
              assert.equal(request.method, "PUT");
              assert.equal(request.body.items[0].points, 9);
              assert.equal(request.body.draft, undefined);
            } else {
              assert.equal(request.method, "PATCH");
              assert.equal(request.body.items, undefined);
              if (target === "info")
                assert.deepEqual(
                  request.body.draft.policy,
                  before.draft.policy,
                );
              else
                assert.deepEqual(
                  request.body.draft.content,
                  before.draft.content,
                );
              assert.equal(request.body.draft.policy.aiAnalysisEnabled, true);
              assert.equal(request.body.draft.policy.timeLimitSeconds, 125);
            }
          }
          assert.equal(state.q.draft.content.en.title, "Corrected information");
          assert.equal(
            state.q.draft.content.en.instructions,
            "Corrected instructions",
          );
          assert.equal(state.q.items[0].points, 9);
          assert.equal(state.q.draft.policy.maxAttempts, 4);
          assert.equal(state.q.draft.policy.passBasisPoints, 8125);
          assert.equal(state.q.editRevision, 7);
          checkErrors(state);
        },
      );
    }
  await run(
    "safe/private requests, teardown and exact manual release replay",
    async () => {
      const { page, state } = await setup();
      await button(page, "03 Preview & revisions").click();
      await page
        .getByText("Which option matches the description?", { exact: true })
        .waitFor();
      assert.equal(
        state.requests.filter((r) => r.path.endsWith("answer-preview")).length,
        0,
      );
      assert.equal(await page.locator("[data-private-answer]").count(), 0);
      await button(page, "Admin answers — private").click();
      await page
        .getByText("Synthetic private explanation", { exact: true })
        .waitFor();
      await button(page, "Student-safe preview").click();
      assert.equal(
        await page
          .getByText("Synthetic private explanation", { exact: true })
          .count(),
        0,
      );
      await button(page, "Release revision 1").click();
      assert.match(await page.locator(":focus").innerText(), /Cancel/);
      await page.keyboard.press("Escape");
      assert.equal(
        state.requests.filter((r) => r.path.endsWith("review-release")).length,
        0,
      );
      state.failRelease = true;
      await button(page, "Release revision 1").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Release revision 1", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      state.failRelease = false;
      await button(page, "Check release status").click();
      await button(page, "Check release status").waitFor({ state: "detached" });
      await button(page, "Release revision 1").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Release revision 1", exact: true })
        .click();
      await page.getByText(/This revision is already released/).waitFor();
      const releases = state.requests.filter((r) =>
        r.path.endsWith("review-release"),
      );
      assert.equal(releases.length, 2);
      assert.deepEqual(releases[0].body, releases[1].body);
      checkErrors(state);
    },
  );
  await run(
    "separate saves retain other dirty sections and exact policy values",
    async () => {
      const { page, state } = await setup();
      await page.locator(".aa-info summary").click();
      await page.locator("#quiz-title").fill("Local metadata");
      await page.locator(`[id='points-${ids.question}']`).fill("9");
      await button(page, "02 Policy & publication").click();
      await page.locator("#quiz-max-attempts").fill("3");
      await button(page, "Save policy").click();
      await page.waitForFunction(() =>
        document
          .querySelector(".aa-live")
          ?.textContent?.includes("Section saved"),
      );
      const write = state.requests.find((r) => r.method === "PATCH");
      assert.equal(write.body.draft.content.en.title, "Q7 synthetic quiz");
      assert.equal(write.body.draft.policy.aiAnalysisEnabled, true);
      assert.equal(write.body.draft.policy.timeLimitSeconds, 125);
      await button(page, "01 Content").click();
      await page.locator(".aa-info summary").click();
      assert.equal(
        await page.locator("#quiz-title").inputValue(),
        "Local metadata",
      );
      assert.equal(
        await page.locator(`[id='points-${ids.question}']`).inputValue(),
        "9",
      );
      await button(page, "Save information").click();
      await button(page, "Save information").waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "Save information",
          )?.disabled,
      );
      await button(page, "Save questions").click();
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "Save questions",
          )?.disabled,
      );
      assert.deepEqual(
        state.requests
          .filter((r) => ["PATCH", "PUT"].includes(r.method))
          .map((r) => r.body.expectedRevision),
        [4, 5, 6],
      );
      checkErrors(state);
    },
  );
  await run(
    "save conflict retains edits until explicit reload and refreshes policy input",
    async () => {
      const { page, state } = await setup();
      await editSections(page);
      state.failSave = true;
      await button(page, "Save policy").click();
      await button(page, "Review current state").waitFor();
      assert.equal(await page.locator("#quiz-pass").inputValue(), "66.67");
      assert.equal(await page.locator("#quiz-pass").isDisabled(), true);
      await sectionView(page, "info");
      assert.equal(
        await page.locator("#quiz-title").inputValue(),
        "Local information",
      );
      assert.equal(await page.locator("#quiz-title").isDisabled(), true);
      assert.equal(
        await page.locator(`[id='points-${ids.question}']`).inputValue(),
        "7",
      );
      assert.equal(await button(page, "Save questions").isDisabled(), true);
      await sectionView(page, "policy");
      state.q.draft.policy.passBasisPoints = 8100;
      state.q.editRevision = 10;
      await button(page, "Review current state").click();
      await button(page, "Replace my edits with current state").click();
      await page.waitForFunction(
        () => document.querySelector("#quiz-pass")?.value === "81",
      );
      assert.equal(
        state.requests.filter((r) => r.method === "PATCH").length,
        1,
      );
      checkErrors(state);
    },
  );
  for (const operation of ["unpublish", "archive"]) {
    await run(
      `E2 lifecycle ${operation} ignores an unrelated publication receipt`,
      async () => {
        const { page, state } = await setup();
        await sectionView(page, "policy");
        state.badPath = `${base}/${operation}`;
        state.badResponse = (value) => ({
          ...value,
          revision: revision(value),
        });
        await button(
          page,
          operation === "unpublish" ? "Unpublish" : "Archive quiz",
        ).click();
        await button(page, "Confirm").click();
        await page
          .getByText("Server confirmed the new state", { exact: true })
          .waitFor();
        assert.equal(
          await button(page, "Unpublish").count(),
          0,
          "a publication-shaped extension must not change the requested operation",
        );
        if (operation === "archive")
          assert.equal(await button(page, "Archive quiz").count(), 0);
        assert.equal(
          state.requests.filter(
            (r) => r.path === `${base}/${operation}` && r.method === "POST",
          ).length,
          1,
        );
        checkErrors(state);
      },
    );
  }
  const e2Operations = [
    "question save",
    "question create",
    "question seal",
    "question archive",
    "quiz create",
    "publish",
    "unpublish",
    "quiz archive",
    "skill save",
    "skill create",
    "skill move",
    "skill archive",
    "release",
  ];
  for (const malformed of [true, false])
    for (const operation of e2Operations) {
      await run(
        `E2 ${malformed ? "empty" : "valid"} ${operation} acknowledgement`,
        async () => {
          const questionOperation = operation.startsWith("question"),
            skillOperation = operation.startsWith("skill");
          const create = operation.endsWith("create");
          const suffix = questionOperation
            ? `question-bank/${create ? "new" : ids.question}`
            : skillOperation
              ? "skills"
              : create
                ? `quizzes/courses/${ids.course}/new`
                : undefined;
          const { page, state } = await setup(suffix, {
            clock: operation === "question save" || operation === "skill save",
            setup: (s) => {
              if (operation === "skill move") s.skill.parentId = ids.course;
            },
          });
          let target, retained, recovery;
          if (questionOperation) {
            target = `admin/question-bank/questions${create ? "" : `/${ids.question}`}${operation.endsWith("seal") ? "/revisions" : operation.endsWith("archive") ? "/archive" : ""}`;
            if (create) {
              await page.locator("#question-type").selectOption("true_false");
              await button(page, "Change type").click();
            }
            if (operation.endsWith("save") || create)
              await page
                .locator("#question-prompt")
                .fill("E2 retained question prompt");
            retained = [
              "#question-prompt",
              await page.locator("#question-prompt").inputValue(),
            ];
            recovery = "Review current version";
          } else if (skillOperation) {
            await button(
              page,
              create ? "Create skill" : "Synthetic skill",
            ).click();
            await page.locator("#skill-slug").waitFor();
            target = `admin/skills${create ? "" : `/${ids.skill}`}${operation.endsWith("move") ? "/move" : operation.endsWith("archive") ? "/archive" : ""}`;
            if (create)
              await page.locator("#skill-label-ar").fill("مهارة تجريبية");
            if (create || operation.endsWith("save"))
              await page.locator("#skill-slug").fill("e2-retained-skill");
            retained = [
              "#skill-slug",
              await page.locator("#skill-slug").inputValue(),
            ];
            recovery = "Reload current version";
          } else if (create) {
            target = `admin/courses/${ids.course}/quizzes`;
            await page.locator("#quiz-title").fill("E2 retained quiz title");
            await page
              .locator("#quiz-instructions")
              .fill("E2 retained instructions");
            retained = ["#quiz-title", "E2 retained quiz title"];
          } else if (operation === "release") {
            target = `${base}/revisions/${ids.revision}/review-release`;
            await button(page, "03 Preview & revisions").click();
          } else {
            target = `${base}/${operation === "quiz archive" ? "archive" : operation}`;
            await sectionView(page, "policy");
            retained = [
              "#quiz-pass",
              await page.locator("#quiz-pass").inputValue(),
            ];
            recovery = "Review current state";
          }
          if (malformed) {
            state.badPath = target;
            state.badResponse = () => ({});
          }
          const skillRefresh =
            skillOperation && !malformed
              ? page.waitForResponse(
                  (r) =>
                    r.url().endsWith(`/lms-api/admin/skills/${ids.skill}`) &&
                    r.request().method() === "GET",
                )
              : null;
          const response = page.waitForResponse(
            (r) =>
              r.url().endsWith(`/lms-api/${target}`) &&
              r.request().method() !== "GET",
          );
          if (questionOperation) {
            if (create || operation.endsWith("save"))
              await button(page, "Save draft").click();
            else {
              await button(
                page,
                operation.endsWith("seal")
                  ? "Seal revision"
                  : "Archive question",
              ).click();
              await button(page, "Confirm").click();
            }
          } else if (skillOperation) {
            if (create || operation.endsWith("save"))
              await button(page, "Save details").click();
            else {
              await button(
                page,
                operation.endsWith("move") ? "Move to root" : "Archive",
              ).click();
              await button(page, "Confirm").click();
            }
          } else if (create) {
            await button(page, "Create draft").click();
            await button(page, "Create").click();
          } else if (operation === "release") {
            await button(page, "Release revision 1").click();
            await page
              .getByRole("dialog")
              .getByRole("button", { name: "Release revision 1", exact: true })
              .click();
          } else {
            await button(
              page,
              operation === "publish"
                ? "Review and confirm publication"
                : operation === "unpublish"
                  ? "Unpublish"
                  : "Archive quiz",
            ).click();
            await button(page, "Confirm").click();
          }
          await response;
          const mutations = () =>
            state.requests.filter(
              (r) => r.path === target && r.method !== "GET",
            );
          if (malformed) {
            if (create) {
              await page
                .getByText(/Creation may have completed/)
                .waitFor({ timeout: 5000 });
              assert.equal(
                await page.locator(retained[0]).inputValue(),
                retained[1],
              );
              assert.equal(
                await button(
                  page,
                  skillOperation
                    ? "Save details"
                    : questionOperation
                      ? "Save draft"
                      : "Create draft",
                ).isDisabled(),
                true,
              );
              assert.equal(page.url().includes("undefined"), false);
            } else if (operation === "release") {
              await button(page, "Check release status").waitFor({
                timeout: 5000,
              });
              assert.equal(
                await button(page, "Release revision 1").isDisabled(),
                true,
              );
              state.badReadPath = `${base}/revisions/${ids.revision}`;
              state.badReadResponse = () => ({});
              await button(page, "Check release status").click();
              await page
                .getByText(/The operation could not be confirmed/)
                .waitFor();
              assert.equal(
                await button(page, "Release revision 1").isDisabled(),
                true,
              );
              state.badReadPath = null;
              await button(page, "Check release status").click();
              await page
                .getByText(/This revision is already released/)
                .waitFor();
            } else {
              await button(page, recovery).waitFor({ timeout: 5000 });
              await page
                .getByText(/The operation could not be confirmed/)
                .waitFor();
              assert.equal(
                await page.locator(retained[0]).inputValue(),
                retained[1],
              );
              if (questionOperation || skillOperation) {
                state.badReadPath = questionOperation
                  ? `admin/question-bank/questions/${ids.question}`
                  : `admin/skills/${ids.skill}`;
                state.badReadResponse = () => ({});
                await button(page, recovery).click();
                await page
                  .getByText(/The operation could not be confirmed/)
                  .waitFor();
                assert.equal(await page.locator("dialog[open]").count(), 0);
                assert.equal(
                  await page.locator(retained[0]).inputValue(),
                  retained[1],
                );
                if (
                  operation === "question save" ||
                  operation === "skill save"
                ) {
                  state.badReadStatus = 429;
                  const rejected = page.waitForResponse(
                    (r) => r.status() === 429 && r.request().method() === "GET",
                  );
                  await button(page, recovery).click();
                  await rejected;
                  await page
                    .getByText(/Too many requests/)
                    .first()
                    .waitFor();
                  assert.equal(
                    await button(
                      page,
                      operation === "question save"
                        ? "Save draft"
                        : "Save details",
                    ).isDisabled(),
                    true,
                  );
                  assert.equal(
                    await page.locator(retained[0]).inputValue(),
                    retained[1],
                  );
                  await page.clock.runFor(1001);
                  state.badReadStatus = null;
                }
                state.badReadPath = null;
              }
              await button(page, recovery).click();
              await page.getByRole("dialog").waitFor();
              await button(page, "Cancel / back").click();
              assert.equal(
                await page.locator(retained[0]).inputValue(),
                retained[1],
              );
              await button(page, recovery).click();
              await button(
                page,
                questionOperation
                  ? "Replace my edits with current version"
                  : skillOperation
                    ? "Confirm"
                    : "Replace my edits with current state",
              ).click();
              await page.getByRole("dialog").waitFor({ state: "hidden" });
              assert.equal(await button(page, recovery).count(), 0);
              if (operation === "question save" || operation === "skill save") {
                state.badPath = null;
                await page
                  .locator(retained[0])
                  .fill(
                    operation === "question save"
                      ? "E2 manual corrected prompt"
                      : "e2-manual-corrected-skill",
                  );
                await button(
                  page,
                  operation === "question save" ? "Save draft" : "Save details",
                ).click();
                await page.waitForFunction(() =>
                  [...document.querySelectorAll("button")].some(
                    (b) =>
                      ["Save draft", "Save details"].includes(b.textContent) &&
                      b.disabled,
                  ),
                );
                assert.equal(mutations().length, 2);
                checkErrors(state);
                return;
              }
            }
          } else if (create && !skillOperation) {
            await page.waitForURL(
              `**/${questionOperation ? `question-bank/${ids.question}` : `quizzes/courses/${ids.course}/${ids.quiz}`}`,
            );
          } else if (questionOperation)
            await page
              .getByText(
                operation.endsWith("save")
                  ? "Draft saved"
                  : "Operation confirmed",
                { exact: true },
              )
              .waitFor();
          else if (skillOperation) {
            await skillRefresh;
            await page.locator("#skill-slug").waitFor();
            if (create || operation.endsWith("save"))
              assert.equal(
                await page.locator("#skill-slug").inputValue(),
                "e2-retained-skill",
              );
            await page.waitForFunction(
              () =>
                ![...document.querySelectorAll('[role="alert"]')].some((e) =>
                  e.textContent.includes("could not"),
                ),
            );
          } else if (operation === "release")
            await page.getByText(/This revision is already released/).waitFor();
          else
            await page
              .getByText("Server confirmed the new state", { exact: true })
              .waitFor();
          assert.equal(mutations().length, 1, "no automatic mutation retry");
          checkErrors(state);
        },
      );
    }
  for (const section of ["info", "items", "policy"]) {
    for (const [shape, response] of [
      ["empty", () => ({})],
      [
        "missing policy",
        (q) => ({ ...q, draft: { ...q.draft, policy: null } }),
      ],
      ["stale revision", (q) => ({ ...q, editRevision: q.editRevision - 1 })],
    ]) {
      await run(
        `E1 ${section} ${shape} acknowledgement retains edits and recovers explicitly`,
        async () => {
          const { page, state } = await setup();
          await editSections(page);
          state.saveResponse = response;
          await saveSection(page, section);
          await button(page, "Review current state").waitFor({ timeout: 5000 });
          const assertRetained = async () => {
            await sectionView(page, "info");
            assert.equal(
              await page.locator("#quiz-title").inputValue(),
              "Local information",
            );
            assert.equal(
              await page.locator("#quiz-instructions").inputValue(),
              "Local instructions",
            );
            assert.equal(
              await page.locator(`[id='points-${ids.question}']`).inputValue(),
              "7",
            );
            assert.equal(
              await button(page, "Save information").isDisabled(),
              true,
            );
            assert.equal(
              await button(page, "Save questions").isDisabled(),
              true,
            );
            assert.equal(
              await button(page, "Preview saved draft").isDisabled(),
              true,
            );
            await sectionView(page, "policy");
            assert.equal(
              await page.locator("#quiz-max-attempts").inputValue(),
              "3",
            );
            assert.equal(
              await page.locator("#quiz-pass").inputValue(),
              "66.67",
            );
            assert.equal(await button(page, "Save policy").isDisabled(), true);
            assert.equal(
              await button(page, "Review and confirm publication").isDisabled(),
              true,
            );
            for (const name of ["Information", "Questions", "Policy"])
              assert.equal(
                await page
                  .getByText(`${name}: Unsaved`, { exact: true })
                  .count(),
                1,
              );
            assert.equal(
              await page
                .getByText(
                  "Section saved; other sections retain their edits.",
                  { exact: true },
                )
                .count(),
              0,
            );
            assert.equal(
              writes(state).length,
              1,
              "an uncertain write must never retry automatically",
            );
            checkErrors(state);
          };
          await page
            .getByText(/The operation could not be confirmed/)
            .waitFor();
          await assertRetained();
          // A successful-status recovery read also needs validation, before a
          // confirmation can offer to replace any editor state.
          state.readResponse = () => ({});
          const read = page.waitForResponse(
            (r) =>
              r.url().endsWith(`/lms-api/${base}`) &&
              r.request().method() === "GET",
          );
          await button(page, "Review current state").click();
          await read;
          await page
            .getByText(/The operation could not be confirmed/)
            .waitFor();
          assert.equal(
            await button(page, "Replace my edits with current state").count(),
            0,
          );
          await assertRetained();
          state.readResponse = null;
          await button(page, "Review current state").click();
          await button(page, "Replace my edits with current state").waitFor();
          await button(page, "Cancel / back").click();
          await assertRetained();
          await button(page, "Review current state").click();
          await button(page, "Replace my edits with current state").click();
          await button(page, "Review current state").waitFor({
            state: "detached",
          });
          // The fixture committed exactly the requested section before sending
          // the malformed response. Recovery reads its revision 5 explicitly.
          assert.equal(state.q.editRevision, 5);
          assert.equal(writes(state).length, 1);
          state.saveResponse = null;
          await editSections(page, true);
          await saveSection(page, section);
          await page
            .getByText("Section saved; other sections retain their edits.", {
              exact: true,
            })
            .waitFor();
          await assertSections(page, { corrected: true, saved: [section] });
          assert.deepEqual(
            writes(state).map((r) => r.body.expectedRevision),
            [4, 5],
          );
          const sent = writes(state)[1].body;
          if (section === "items") assert.equal(sent.draft, undefined);
          if (section === "info")
            assert.deepEqual(sent.draft.policy, quiz().draft.policy);
          if (section === "policy")
            assert.deepEqual(sent.draft.content, quiz().draft.content);
          checkErrors(state);
        },
      );
    }
  }
  for (const status of [413, 422]) {
    await run(
      `F1 ${status} preserves corrections and retry without discarding other sections`,
      async () => {
        const { page, state } = await setup();
        await editSections(page);
        state.saveFailure = { status };
        await saveSection(page, "info");
        await page.getByText(/The data could not be accepted/).waitFor();
        await assertSections(page);
        await editSections(page, true);
        state.saveFailure = null;
        await saveSection(page, "info");
        await page.waitForFunction(() =>
          document
            .querySelector(".aa-live")
            ?.textContent.includes("Section saved"),
        );
        await assertSections(page, { corrected: true, saved: ["info"] });
        assert.deepEqual(
          writes(state).map((r) => r.body.expectedRevision),
          [4, 4],
        );
        checkErrors(state);
      },
    );
  }
  for (const status of [0, 503]) {
    await run(
      `F1 uncertain ${status} write retains conflict protection and all local edits`,
      async () => {
        const { page, state } = await setup();
        await editSections(page);
        state.saveFailure = { status };
        await saveSection(page, "items");
        await button(page, "Review current state").waitFor();
        assert.equal(
          await page.locator("#quiz-title").inputValue(),
          "Local information",
        );
        assert.equal(await page.locator("#quiz-title").isDisabled(), true);
        assert.equal(
          await page.locator(`[id='points-${ids.question}']`).inputValue(),
          "7",
        );
        assert.equal(await button(page, "Save questions").isDisabled(), true);
        await sectionView(page, "policy");
        assert.equal(
          await page.locator("#quiz-max-attempts").inputValue(),
          "3",
        );
        assert.equal(await page.locator("#quiz-pass").inputValue(), "66.67");
        assert.equal(await button(page, "Save policy").isDisabled(), true);
        assert.equal(
          await button(page, "Review and confirm publication").isDisabled(),
          true,
        );
        assert.equal(writes(state).length, 1);
        checkErrors(state);
      },
    );
  }
  for (const status of [401, 403]) {
    await run(
      `F1 ${status} during a section save still removes the authoring workspace`,
      async () => {
        const { page, state } = await setup();
        await editSections(page);
        state.saveFailure = { status };
        await saveSection(page, "policy");
        await page
          .getByTestId(status === 401 ? "status-session" : "status-forbidden")
          .waitFor();
        assert.equal(
          await page
            .locator("#quiz-title, #quiz-pass, .aa-composition")
            .count(),
          0,
        );
        assert.equal(writes(state).length, 1);
        checkErrors(state);
      },
    );
  }
  await run(
    "failed publication retains current revision and unpublished history is distinct",
    async () => {
      const { page, state } = await setup();
      state.failPublish = true;
      await button(page, "02 Policy & publication").click();
      await button(page, "Review and confirm publication").click();
      assert.match(await page.locator(":focus").innerText(), /Cancel/);
      await button(page, "Confirm").click();
      await page.getByText(/The server rejected publication/).waitFor();
      assert.match(
        await page.locator(".aa-publication").innerText(),
        /Revision 1 is currently published/,
      );
      await button(page, "Unpublish").click();
      await button(page, "Confirm").click();
      await page
        .getByText("Unpublished, has publication history", { exact: true })
        .waitFor();
      assert.equal(state.q.currentRevisionId, null);
      checkErrors(state);
    },
  );
  await run(
    "policy dependency change requires confirmation and preserves current settings on cancel",
    async () => {
      const { page, state } = await setup();
      await button(page, "02 Policy & publication").click();
      await page.locator("#quiz-scoreVisibility").selectOption("never");
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#quiz-scoreVisibility").inputValue(),
        "after_grading",
      );
      await page.locator("#quiz-scoreVisibility").selectOption("never");
      await button(page, "Apply selections").click();
      assert.equal(
        await page.locator("#quiz-reviewVisibility").inputValue(),
        "never",
      );
      assert.equal(
        await page.locator("#quiz-explanationVisibility").inputValue(),
        "never",
      );
      checkErrors(state);
    },
  );
  for (const type of [
    "single_choice",
    "multiple_choice",
    "true_false",
    "ordering",
    "short_text",
  ]) {
    await run(`author and save ${type}`, async () => {
      const { page, state } = await setup("question-bank/new");
      if (type === "multiple_choice") {
        await page
          .getByText("Inert Java snippet (optional)", { exact: true })
          .click();
        await page.locator("#question-code").fill("System.out.println(4);");
      }
      if (type !== "single_choice") {
        await page.locator("#question-type").selectOption(type);
        await button(page, "Change type").click();
      }
      await page.locator("#question-prompt").fill(`Synthetic ${type} prompt`);
      const options = page.locator("textarea[id^='option-']");
      for (let i = 0; i < (await options.count()); i++)
        await options.nth(i).fill(`Synthetic choice ${i + 1}`);
      if (type === "multiple_choice")
        await page.locator(".aa-key-options input").first().check();
      if (type === "short_text")
        await page.locator("#accepted-en-0").fill("exact\nanswer");
      await button(page, "Save draft").click();
      await page.waitForURL(`**/question-bank/${ids.question}`);
      assert.equal(
        state.requests.find(
          (r) =>
            r.path === "admin/question-bank/questions" && r.method === "POST",
        ).body.draft.type,
        type,
      );
      if (type === "multiple_choice")
        assert.equal(
          state.requests.find(
            (r) =>
              r.path === "admin/question-bank/questions" && r.method === "POST",
          ).body.draft.content.en.code.source,
          "System.out.println(4);",
        );
      checkErrors(state);
    });
  }
  await run(
    "uncertain creation cannot retry or request a nonexistent detail identity",
    async () => {
      const { page, state } = await setup("skills");
      state.uncertainCreate = true;
      await button(page, "Create skill").click();
      await page.locator("#skill-label-ar").fill("مهارة");
      await page.locator("#skill-slug").fill("synthetic");
      await button(page, "Save details").click();
      await page.getByText(/Creation may have completed/).waitFor();
      assert.equal(await button(page, "Save details").isDisabled(), true);
      assert.equal(await button(page, "Reload current version").count(), 0);
      checkErrors(state);
    },
  );
  await run("uncertain quiz creation blocks a duplicate request", async () => {
    const { page, state } = await setup(`quizzes/courses/${ids.course}/new`);
    state.uncertainCreate = true;
    await page.locator("#quiz-title").fill("New synthetic quiz");
    await button(page, "Create draft").click();
    await button(page, "Create").click();
    await page.getByText(/Creation may have completed/).waitFor();
    assert.equal(await button(page, "Create draft").isDisabled(), true);
    assert.equal(state.requests.filter((r) => r.method === "POST").length, 1);
    checkErrors(state);
  });
  await run(
    "exact revision picker, eligibility and explicit item save",
    async () => {
      const { page, state } = await setup(undefined, {
        setup: (s) => {
          s.q.items = [];
        },
      });
      await button(page, "Add from bank").click();
      await page.locator(".aa-bank-row").click();
      await page.getByRole("button", { name: /Revision 1 ·/ }).click();
      await button(page, "Check question and skill eligibility").click();
      await button(page, "Add this revision").click();
      assert.equal(
        await page.locator(`[id='points-${ids.question}']`).inputValue(),
        "2",
      );
      await button(page, "Save questions").click();
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "Save questions",
          )?.disabled,
      );
      const items = state.requests.find((r) => r.method === "PUT").body.items;
      assert.deepEqual(items, [
        {
          questionId: ids.question,
          questionRevisionId: ids.questionRevision,
          position: 0,
          points: 2,
        },
      ]);
      checkErrors(state);
    },
  );
  await run(
    "unsaved link, language and browser-back cancellation retain edits",
    async () => {
      const { page, state } = await setup();
      await page.evaluate(() =>
        history.pushState(history.state, "", location.href + "?editor=1"),
      );
      await page.locator(".aa-info summary").click();
      await page.locator("#quiz-title").fill("Keep these edits");
      let prompts = 0;
      page.on("dialog", async (d) => {
        prompts++;
        await d.dismiss();
      });
      await page.locator(".aa-subnav a").first().click();
      await page.locator("[data-testid='link-language-switch']").click();
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => location.search === "?editor=1");
      assert.equal(
        await page.locator("#quiz-title").inputValue(),
        "Keep these edits",
      );
      assert.equal(prompts, 3);
      checkErrors(state);
    },
  );
  await run("skill picker has distinct labels and excludes self", async () => {
    const { page, state } = await setup("skills");
    await button(page, "Synthetic skill").click();
    await button(page, "Move").click();
    assert.equal(
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Synthetic skill", exact: true })
        .isDisabled(),
      true,
    );
    const duplicates = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    assert.deepEqual(duplicates, []);
    await page.keyboard.press("Escape");
    checkErrors(state);
  });
  await run(
    "bank is metadata-only until selection, filters are explicit, and nested skill labels are unique",
    async () => {
      const { page, state } = await setup("question-bank");
      await page.locator(".aa-bank-row").waitFor();
      assert.equal(
        state.requests.some((r) => r.path.endsWith(ids.question)),
        false,
      );
      await page.locator(".aa-bank-row").click();
      await page
        .getByText("Synthetic saved question", { exact: true })
        .waitFor();
      await page.locator("#bank-search").fill("term");
      await button(page, "Search").click();
      await button(page, "Clear filters").click();
      assert.equal(await page.locator("#bank-search").inputValue(), "");
      checkErrors(state);
    },
  );
  await run(
    "archived parent permits reading and disables authoring and manual release",
    async () => {
      const { page, state } = await setup(undefined, { archivedParent: true });
      assert.equal(await button(page, "Add from bank").isDisabled(), true);
      await button(page, "03 Preview & revisions").click();
      await button(page, "Release revision 1").waitFor();
      assert.equal(await button(page, "Release revision 1").isDisabled(), true);
      checkErrors(state);
    },
  );
  await run(
    "authorization denial unmounts private authoring state",
    async () => {
      const { page, state } = await setup();
      await button(page, "03 Preview & revisions").click();
      await button(page, "Admin answers — private").click();
      await page
        .getByText("Synthetic private explanation", { exact: true })
        .waitFor();
      state.deny = 403;
      await page.locator("#quiz-preview-locale").selectOption("ar");
      await page.locator("[data-testid='status-forbidden']").waitFor();
      assert.equal(await page.locator("[data-private-answer]").count(), 0);
      checkErrors(state);
    },
  );
  for (const [status, target] of [
    [401, "status-session"],
    [403, "status-forbidden"],
    [404, "status-notfound"],
    [429, null],
  ]) {
    await run(
      `HTTP ${status} is visible and does not trigger request loops`,
      async () => {
        const { page, state } = await setup("question-bank", {
          setup: (s) => {
            s.deny = status;
          },
        });
        if (target) await page.getByTestId(target).waitFor();
        else await page.getByText(/Too many requests/).waitFor();
        assert.equal(state.requests.length, 1);
        checkErrors(state);
      },
    );
  }
  for (const locale of ["ar", "en"])
    for (const width of [320, 390, 820, 1440]) {
      await run(
        `${locale} ${width}px layout, labels and reduced motion`,
        async () => {
          const { page, state } = await setup(undefined, { locale, width });
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.locator(".aa-composition li").waitFor();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          );
          assert.equal(overflow, false, "horizontal viewport overflow");
          assert.equal(
            await page.locator(".assessment-workspace").getAttribute("dir"),
            locale === "ar" ? "rtl" : "ltr",
          );
          assert.equal(
            await page
              .locator(".aa-skip")
              .evaluate((e) => e.getBoundingClientRect().bottom < 0),
            true,
          );
          await page.screenshot({
            path: path.join(output, `builder-${locale}-${width}.png`),
            fullPage: true,
          });
          for (const name of locale === "ar"
            ? ["02 السياسة والنشر", "03 المعاينة والإصدارات"]
            : ["02 Policy & publication", "03 Preview & revisions"]) {
            await button(page, name).click();
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1,
              ),
              false,
            );
          }
          checkErrors(state);
        },
      );
    }
  for (const [name, suffix] of [
    ["bank", "question-bank"],
    ["skills", "skills"],
    ["editor", `question-bank/${ids.question}`],
    ["quizzes", "quizzes"],
  ]) {
    await run(`${name} Arabic 390px view and keyboard skip link`, async () => {
      const { page, state } = await setup(suffix, { locale: "ar", width: 390 });
      await page.locator(".aa-skip").focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator(":focus").getAttribute("id"),
        "assessment-content",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(output, `${name}-ar-390.png`),
        fullPage: true,
      });
      checkErrors(state);
    });
  }
} finally {
  await browser.close();
  await server.close();
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        evidence:
          "Synthetic API responses; real authoring components. Not genuine MFA or live data acceptance.",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(
  `${results.filter((r) => r.passed).length}/${results.length} browser checks passed`,
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
