import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { MyCoursesView, myCourseHref, type MyCoursesViewProps } from "../src/components/lms/my-courses/MyCoursesView";
import { myCoursesFixture } from "./my-courses-data";

const props = (locale: "ar" | "en", count: number): MyCoursesViewProps => ({
  locale, data: myCoursesFixture(count, true), loading: false, search: "",
  onSearch() {}, onPage() {}, onRetry() {},
});
const render = (p: MyCoursesViewProps) => renderToStaticMarkup(createElement(MyCoursesView, p));
for (const locale of ["ar", "en"] as const) for (const count of [0, 1, 3, 16]) {
  test(`My Courses ${locale}: ${count} enrolled / deterministic long-title rendering`, () => {
    const p = props(locale, count);
    const html = render(p);
    assert.ok(html.includes(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.equal((html.match(/<h1>/g) ?? []).length, 1);
    assert.equal((html.match(/data-testid="card-course-/g) ?? []).length, Math.min(count, 12));
    assert.equal(html.includes("mc-course-list"), count > 3);
    assert.equal(html.includes('data-testid="status-no-courses"'), count === 0);
    if (count > 0) {
      assert.ok(html.includes(p.data!.items[0].title));
      assert.ok(html.includes("Review") || html.includes("مراجعة"));
      assert.ok(html.includes('aria-valuenow="100"'));
    }
    assert.ok(!html.includes("Design preview") && !html.includes("شراء") && !html.includes("Buy"));
    assert.equal(renderToString(createElement(MyCoursesView, p)), renderToString(createElement(MyCoursesView, p)));
  });
}
test("Continue, Review and Open preserve exact routes with URL-encoded identifiers", () => {
  const c = myCoursesFixture(2).items[1];
  c.id = "course / unicode";
  c.progress!.continueLessonId = "lesson / unicode";
  assert.equal(myCourseHref("ar", c), "/ar/student/courses/course%20%2F%20unicode/lessons/lesson%20%2F%20unicode");
  c.progress!.isCompleted = true;
  assert.equal(myCourseHref("en", c), "/en/student/courses/course%20%2F%20unicode");
  c.progress = undefined;
  assert.equal(myCourseHref("en", c), "/en/student/courses/course%20%2F%20unicode");
});
test("Progress uses approved percentage policy, required counts, zero-required and missing progress", () => {
  const p = props("en", 3);
  p.data!.items[0].progress = { ...p.data!.items[0].progress!, isCompleted: false, percentage: 99.9 };
  p.data!.items[1].progress = { ...p.data!.items[1].progress!, totalRequired: 0, completedRequired: 0 };
  p.data!.items[2].progress = undefined;
  const html = render(p);
  assert.match(html, /aria-valuenow="99"/);
  assert.match(html, /No required lessons/i);
  assert.ok(html.includes("Open course"));
});
test("Search zero results is distinct from Admin-enrollment empty state", () => {
  const html = render({ ...props("en", 0), search: "no match" });
  assert.match(html, /status-no-results/);
  assert.doesNotMatch(html, /status-no-courses/);
  assert.match(html, /input-search/);
});
test("Loading, retry and authorization denial use existing safe states without courses", () => {
  assert.match(render({ ...props("en", 0), data: undefined, loading: true }), /status-loading/);
  for (const status of [401, 403, 503]) {
    const html = render({ ...props("en", 3), error: { status, code: "TEST" } });
    assert.doesNotMatch(html, /data-testid="card-course-/);
    assert.match(html, /status-(session|forbidden|unavailable)/);
  }
});
test("Page 2 preserves server pagination and course indexing", () => {
  const p = props("en", 16);
  p.data = { ...p.data!, page: 2, items: p.data!.items.slice(0, 4) };
  const html = render(p);
  assert.match(html, /13–16/);
  assert.match(html, /button-page-prev/);
  assert.match(html, /button-page-next/);
  assert.equal((html.match(/mc-course-compact/g) ?? []).length, 4);
});
test("Accessible workspace navigation, language, skip and no completion controls", () => {
  const html = render(props("ar", 3));
  assert.match(html, /href="#my-courses-content"/);
  assert.match(html, /id="my-courses-content" tabindex="-1"/);
  assert.match(html, /href="\/en\/student\/courses"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /ssv2-mobile-nav/);
  assert.doesNotMatch(html, /button-complete-lesson/);
});
test("Wrapper keeps original read-only API contract and shared debounced search", () => {
  const wrapper = readFileSync(new URL("../src/components/lms/my-courses/MyCourses.tsx", import.meta.url), "utf8");
  assert.ok(wrapper.includes('pageSize: "12"') && wrapper.includes("setPage(1)"));
  assert.ok(wrapper.includes("useLms<LmsCoursePage>(`courses?${qs}`)"));
  assert.doesNotMatch(wrapper, /method:|POST|PUT|PATCH/);
  const css = readFileSync(new URL("../src/components/lms/my-courses/my-courses.css", import.meta.url), "utf8");
  assert.ok(css.includes("prefers-reduced-motion:reduce") && css.includes("min-height:44px"));
});
