import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import type { LmsProgress } from "@workspace/saudisensei-api-client";
import { CourseOverviewView, courseContinueHref } from "../src/components/lms/course-overview/CourseOverviewView";
import { courseOverviewFixture, overviewProgress } from "./course-overview-data";

const render = (locale: "ar" | "en", chapters = 3, lessons = 5, long = false, progress?: LmsProgress) => {
  const course = courseOverviewFixture(chapters, lessons, long);
  return renderToStaticMarkup(createElement(CourseOverviewView, {
    locale, course, progress: progress ?? course.progress,
    resources: createElement("section", { "data-testid": "existing-resource-slot" }, "Existing private resource component"),
  }));
};

for (const locale of ["ar", "en"] as const) for (const [chapters, lessons] of [[0, 0], [1, 0], [1, 1], [8, 16]]) {
  test(`Course Overview ${locale}: ${chapters} chapters / ${lessons} lessons, long content`, () => {
    const html = render(locale, chapters, lessons, true);
    const course = courseOverviewFixture(chapters, lessons, true);
    assert.match(html, new RegExp(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.ok(html.includes(course.title) && html.includes(course.description));
    assert.equal((html.match(/data-testid="course-chapter-/g) ?? []).length, chapters);
    assert.equal((html.match(/data-testid="link-lesson-/g) ?? []).length, chapters * lessons);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    assert.ok(html.includes("existing-resource-slot"));
    assert.ok(!html.includes("button-complete-lesson") && !html.includes("<details"));
    assert.ok(!html.includes("aria-disabled") && !html.includes("locked"));
    if (lessons && chapters) assert.ok(html.includes(course.chapters![0].lessons[0].title));
  });
}

test("Course Overview uses progress response as authoritative; never recalculates from outline", () => {
  const html = render("ar", 1, 1, false, overviewProgress);
  assert.match(html, /aria-valuenow="35"/);
  assert.ok(html.includes("7") && html.includes("20"));
  assert.match(html, /href="\/ar\/student\/courses\/fixture-course\/lessons\/lesson-0-1"/);
});

test("Course Overview continues/reviews/opens with unchanged encoded route semantics", () => {
  const course = courseOverviewFixture();
  course.id = "course/encoded";
  assert.equal(courseContinueHref("ar", course, { ...overviewProgress, continueLessonId: "lesson/encoded" }),
    "/ar/student/courses/course%2Fencoded/lessons/lesson%2Fencoded");
  assert.equal(courseContinueHref("en", course, { ...overviewProgress, isCompleted: true }),
    "/en/student/courses/course%2Fencoded");
  assert.equal(courseContinueHref("en", course, undefined), "/en/student/courses/course%2Fencoded");
});

test("Course Overview preserves server completion and distinguishes current from other unfinished lessons", () => {
  const html = render("en", 1, 5, false, overviewProgress);
  assert.match(html, /data-state="completed"/);
  assert.match(html, /data-state="current"/);
  assert.match(html, /data-state="remaining"/);
  assert.ok(html.includes("Required") && html.includes("Optional"));
  for (let i = 0; i < 5; i++) assert.ok(html.includes(`/en/student/courses/fixture-course/lessons/lesson-0-${i}`));
});

test("Course Overview sorts position without mutating server input or completion history", () => {
  const course = courseOverviewFixture(3, 5);
  course.chapters!.reverse();
  for (const ch of course.chapters!) ch.lessons.reverse();
  const before = JSON.stringify(course);
  const html = renderToStaticMarkup(createElement(CourseOverviewView, { locale: "en", course, progress: course.progress }));
  assert.ok(html.indexOf('data-testid="course-chapter-chapter-0"') < html.indexOf('data-testid="course-chapter-chapter-1"'));
  assert.ok(html.indexOf('data-testid="link-lesson-lesson-0-0"') < html.indexOf('data-testid="link-lesson-lesson-0-1"'));
  assert.equal(JSON.stringify(course), before);
});

test("Course Overview handles missing description/progress, zero required and completed honestly", () => {
  const course = courseOverviewFixture(1, 1);
  course.description = "";
  const html = renderToStaticMarkup(createElement(CourseOverviewView, { locale: "en", course }));
  assert.ok(!html.includes('role="progressbar"') && !html.includes("undefined"));
  const zero = render("en", 0, 0);
  assert.ok(zero.includes("No required") || zero.includes("no required"));
  const done = render("en", 1, 1);
  assert.ok(done.includes("Review") && done.includes("completed"));
  const almost = render("en", 1, 1, false, { ...overviewProgress, percentage: 99.9 });
  assert.match(almost, /aria-valuenow="99"/);
  assert.doesNotMatch(almost, /aria-valuenow="100"/);
});

test("Course Overview navigation, skip link, language and deterministic SSR", () => {
  const course = courseOverviewFixture();
  const el = createElement(CourseOverviewView, { locale: "ar", course, progress: course.progress });
  const html = renderToString(el);
  assert.equal(renderToString(el), html);
  assert.match(html, /href="#course-content"/);
  assert.match(html, /id="course-content" tabindex="-1"/);
  assert.match(html, /href="\/en\/student\/courses\/fixture-course"/);
  assert.match(html, /\/auth\/logout\?returnTo=\/ar\/login/);
  assert.match(html, /aria-current="location"/);
});

test("Course Overview wrapper preserves course/progress reads and existing course resource scope", () => {
  const wrapper = readFileSync(new URL("../src/components/lms/course-overview/StudentCourse.tsx", import.meta.url), "utf8");
  assert.ok(wrapper.includes("pr.data ?? course.progress"));
  assert.ok(wrapper.includes('scope: "courses", parentId: course.id'));
  assert.ok(wrapper.includes("q.error") && wrapper.includes("q.reload") && wrapper.includes("Skeleton"));
  assert.ok(!wrapper.includes('method: "PUT"') && !wrapper.includes('method: "POST"'));
});

test("Course Overview expands compact resource actions without changing shared viewer styling", () => {
  const css = readFileSync(new URL("../src/components/lms/course-overview/course-overview.css", import.meta.url), "utf8");
  assert.match(css, /\.ss-course-overview \.ssco-resources \.sm-actions \.btn \{ min-width: 44px; min-height: 44px; \}/);
});
