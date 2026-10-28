import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LessonView } from "../src/components/lms/lesson-viewer/LessonView";
import { lessonFixture } from "./lesson-viewer-data";

const base = { resources: null, outlineLoading: false, outlineError: null, onRetryOutline: () => {}, busy: false, error: null, onComplete: () => {} };
function render(locale: "ar" | "en", mode: Parameters<typeof lessonFixture>[1] = "text") {
  const data = lessonFixture(locale, mode);
  return renderToStaticMarkup(createElement(LessonView, { ...base, locale, ...data }));
}
for (const locale of ["ar", "en"] as const) {
  for (const mode of ["text", "code", "long", "completed", "empty"] as const) {
    test(`Lesson Viewer ${locale} ${mode}: real contracts, deterministic SSR, safe content`, () => {
      const data = lessonFixture(locale, mode);
      const before = JSON.stringify(data);
      const el = createElement(LessonView, { ...base, locale, ...data });
      const html = renderToString(el);
      assert.equal(renderToString(el), html);
      assert.equal(JSON.stringify(data), before);
      assert.match(html, new RegExp(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
      assert.ok(html.includes(data.lesson.title));
      assert.match(html, /data-testid="link-back-course"/);
      assert.match(html, /aria-current="page"/);
      assert.match(html, /data-testid="progress-reader"/);
      assert.match(html, /aria-valuenow="35"/);
      assert.match(html, /data-testid="link-prev-lesson"/);
      assert.match(html, /data-testid="link-next-lesson"/);
      assert.match(html, new RegExp(`href="/${locale === "ar" ? "en" : "ar"}/student/courses/fixture-course/lessons/lesson-0-1"`));
      if (mode === "completed") {
        assert.ok(html.includes("status-lesson-completed") && !html.includes('data-testid="button-complete-lesson"'));
      } else assert.match(html, /data-testid="button-complete-lesson"/);
      if (mode === "code") {
        assert.match(html, /<pre[^>]*dir="ltr"/);
        assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
        assert.match(html, /<code[^>]*dir="ltr"[^>]*class="icode"/);
      }
      if (mode === "empty") assert.ok(!html.includes('data-testid="text-lesson-body"'));
    });
  }
}
test("Lesson Viewer: missing course/progress cannot invent outline, chapter metrics or destinations", () => {
  const { lesson } = lessonFixture("en");
  const html = renderToStaticMarkup(createElement(LessonView, { ...base, locale: "en", lesson, course: undefined }));
  assert.ok(!html.includes('role="progressbar"'));
  assert.ok(!html.includes('data-testid="link-next-lesson"') && !html.includes('data-testid="link-prev-lesson"'));
  assert.ok(!html.includes('class="sslv-chapter-progress"'));
  assert.ok(html.includes(`/en/student/courses/${lesson.courseId}`));
});
test("Lesson Viewer: empty outline, loading, course-read error and mutation error are accessible", () => {
  const data = lessonFixture("en");
  const course = { ...data.course, chapters: [] };
  const empty = renderToStaticMarkup(createElement(LessonView, { ...base, ...data, locale: "en", course }));
  assert.ok(empty.includes("chapters") || empty.includes("content"));
  const loading = renderToStaticMarkup(createElement(LessonView, { ...base, lesson: data.lesson, course: undefined, locale: "en", outlineLoading: true }));
  assert.match(loading, /aria-busy="true"/);
  const denied = renderToStaticMarkup(createElement(LessonView, { ...base, ...data, locale: "en",
    outlineError: { status: 403, code: "FORBIDDEN" }, error: { status: 409, code: "CONFLICT" } }));
  assert.ok(denied.includes("status-forbidden") || denied.includes('role="alert"'));
});
test("Lesson Viewer: busy disables only manual action; resources remain one unchanged slot", () => {
  const html = renderToStaticMarkup(createElement(LessonView, { ...base, ...lessonFixture("en"), locale: "en", busy: true,
    resources: createElement("section", { "data-testid": "unchanged-media-slot" }, "Private resources") }));
  assert.match(html, /disabled="" data-testid="button-complete-lesson"/);
  assert.equal((html.match(/data-testid="unchanged-media-slot"/g) ?? []).length, 1);
});
test("Lesson Viewer: outline order copies input; completion flags and optional labels are retained", () => {
  const data = lessonFixture("en");
  data.course.chapters!.reverse();
  for (const chapter of data.course.chapters!) chapter.lessons.reverse();
  const before = JSON.stringify(data);
  const html = renderToStaticMarkup(createElement(LessonView, { ...base, ...data, locale: "en" }));
  assert.ok(html.indexOf('link-lesson-lesson-0-0') < html.indexOf('link-lesson-lesson-0-1'));
  assert.ok(html.indexOf('link-lesson-lesson-0-1') < html.indexOf('link-lesson-lesson-1-0'));
  assert.ok(html.includes("Required") && html.includes("Optional"));
  assert.equal(JSON.stringify(data), before);
});
test("Lesson Viewer: adapter retains original request, guards, precedence and completion cache updates", () => {
  const wrapper = readFileSync(new URL("../src/components/lms/lesson-viewer/LessonReader.tsx", import.meta.url), "utf8");
  assert.ok(wrapper.includes('`lessons/${encodeURIComponent(lessonId)}`'));
  assert.ok(wrapper.includes('`courses/${encodeURIComponent(courseId)}`'));
  assert.ok(wrapper.includes('`me/lessons/${encodeURIComponent(lessonId)}/completion`'));
  assert.ok(wrapper.includes('method: "PUT", body: {}'));
  assert.ok(wrapper.includes("lesson.progress ?? cq.data?.progress"));
  assert.ok(wrapper.includes("lesson.courseId !== courseId") && wrapper.includes("[403, 404]"));
  assert.ok(wrapper.includes("lq.setData") && wrapper.includes("cq.setData"));
  assert.equal((wrapper.match(/<StudentResources/g) ?? []).length, 1);
  assert.ok(wrapper.includes('scope: "lessons", parentId: lesson.id') && wrapper.includes('scope: "chapters", parentId: lesson.chapterId')
    && wrapper.includes('scope: "courses", parentId: courseId'));
  assert.ok(!wrapper.includes("setTimeout") && !wrapper.includes("timeupdate") && !wrapper.includes("ended"));
});
test("Lesson Viewer: focused styling isolates accepted pages and honors reduced motion", () => {
  const css = readFileSync(new URL("../src/components/lms/lesson-viewer/lesson-viewer.css", import.meta.url), "utf8");
  assert.ok(css.includes("prefers-reduced-motion: reduce") && css.includes("safe-area-inset-bottom"));
  assert.ok(css.includes("min-width: 44px; min-height: 44px"));
  assert.ok(css.includes("focus-visible"));
  assert.ok(!css.includes(".ssco-") && !css.includes(".ssv2-next"));
});

test("Lesson Viewer: drawer keyboard wrapping excludes hidden desktop controls", () => {
  const source = readFileSync(new URL("../src/components/lms/lesson-viewer/LessonView.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('element.getClientRects().length > 0'));
  assert.ok(source.includes('getComputedStyle(element).visibility !== "hidden"'));
  assert.ok(source.includes("shell.inert = true") && source.includes("shell.inert = previousInert"));
  assert.ok(source.includes('event.key === "Escape"') && source.includes('event.shiftKey'));
});

test("Approved Hybrid: focused initial layout, grouped outline, explicit completion and no mock-only reflection", () => {
  for (const locale of ["ar", "en"] as const) {
    const html = render(locale);
    assert.ok(html.includes('class="sslv-layout is-focused"'));
    assert.ok(html.includes('<details open="" class="sslv-chapter-group">'));
    assert.ok(html.includes(locale === "ar" ? "إكمال الدرس" : "Mark lesson complete"));
    assert.ok(!html.includes('sslv-global-nav') && !html.includes('sslv-title-seal'));
    assert.ok(!html.includes("reflection") && !html.includes("sslv-toolbar"));
  }
});

test("Approved Hybrid: content slot retains exactly one Markdown owner for media-first composition", () => {
  const html = renderToStaticMarkup(createElement(LessonView, {
    ...base, ...lessonFixture("en"), locale: "en",
    resources: content => createElement("section", { "data-testid": "media-first-slot" },
      createElement("div", { "data-testid": "primary-video" }), content),
  }));
  assert.equal((html.match(/class="sslv-reading"/g) ?? []).length, 1);
  assert.ok(html.indexOf('data-testid="primary-video"') < html.indexOf('class="sslv-reading"'));
  const media = readFileSync(new URL("../src/components/lms/student-media/StudentResources.tsx", import.meta.url), "utf8");
  assert.ok(media.includes('data-testid="details-lesson-resources"') && !media.includes('<details open'));
  assert.ok(media.includes('!open ? <VideoPlayer') && media.includes('it.placement.id !== featured.placement.id'));
});

test("Hybrid polish: one completion message/action, no duplicate header or explanatory messaging", () => {
  for (const locale of ["ar", "en"] as const) {
    const incomplete = render(locale);
    const completed = render(locale, "completed");
    const action = locale === "ar" ? "إكمال الدرس" : "Mark lesson complete";
    const done = locale === "ar" ? "تم إكمال الدرس" : "Lesson completed";
    assert.equal((incomplete.match(new RegExp(`>${action}<`, "g")) ?? []).length, 1);
    assert.equal((completed.match(new RegExp(`>${done}<`, "g")) ?? []).length, 1);
    assert.ok(!incomplete.includes("sslv-completion-copy") && !completed.includes("sslv-completion-copy"));
    assert.ok(!incomplete.includes("status-lesson-progress") && !completed.includes("status-lesson-progress"));
    assert.ok(!completed.includes('data-testid="button-complete-lesson"'));
    assert.match(completed, /role="status" data-testid="status-lesson-completed"/);
  }
});

test("Hybrid polish: lesson presentation scopes start collapsed without changing other resource defaults", () => {
  const media = readFileSync(new URL("../src/components/lms/student-media/StudentResources.tsx", import.meta.url), "utf8");
  assert.ok(media.includes("useState(!collapsible && !immersive)"));
  assert.ok(media.includes('collapsible={valid.length > 1 && i > 0}'));
  assert.ok(media.includes('immersive.secondary.map'));
});
