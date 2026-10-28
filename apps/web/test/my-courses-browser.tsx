/* Isolated actual-component interactive fixture; never an application route. */
import { createRoot } from "react-dom/client";
import { MyCourses } from "../src/components/lms/my-courses/MyCourses";
import { myCoursesFixture } from "./my-courses-data";
import "../src/app/globals.css";

const params = new URLSearchParams(location.search);
const locale = params.get("lang") === "en" ? "en" : "ar";
const count = Number(params.get("count") ?? 3);
const fixture = myCoursesFixture(count, params.has("long"));
// Supply all 16 fixtures for paginated browser assertions, not only the first 12.
if (count > 12) fixture.items = [...fixture.items, ...myCoursesFixture(4, params.has("long")).items.map((c, i) => ({ ...c, id: `fixture-last-${i}`, title: `${c.title} last-page` }))];
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname !== "/lms-api/courses") return realFetch(input, init);
  const search = (url.searchParams.get("search") ?? "").toLowerCase();
  const page = Number(url.searchParams.get("page") ?? 1);
  const items = fixture.items.filter(c => `${c.title} ${c.description}`.toLowerCase().includes(search));
  await new Promise(r => setTimeout(r, 30));
  return new Response(JSON.stringify({ page, pageSize: 12, total: items.length, items: items.slice((page - 1) * 12, page * 12) }), { headers: { "Content-Type": "application/json" } });
};
createRoot(document.getElementById("fixture-root")!).render(<MyCourses locale={locale} />);
