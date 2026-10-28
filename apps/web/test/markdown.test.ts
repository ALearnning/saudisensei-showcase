import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, safeHref } from "../src/lib/markdown";

test("headings, lists and fenced code parse", () => {
  const b = parseMarkdown("# عنوان\n\n- أ\n- ب\n\n1. one\n2. two\n\n```ts\nconst a = 1;\n```\nفقرة `code` هنا");
  assert.deepEqual(b.map((x) => x.t), ["h", "ul", "ol", "code", "p"]);
  assert.equal(b[0].t === "h" && b[0].level, 2);
  assert.equal(b[3].t === "code" && b[3].v, "const a = 1;");
  const p = b[4];
  assert.ok(p.t === "p" && p.c.some((n) => n.t === "code" && n.v === "code"));
});
test("raw HTML is skipped and never becomes markup", () => {
  const b = parseMarkdown("<script>alert(1)</script>\nhello <b>world</b> <img src=x onerror=y>");
  const text = JSON.stringify(b);
  assert.ok(!text.includes("<script>") && !text.includes("<img") && !text.includes("<b>"));
});
test("images degrade to alt text; unsafe links become plain text", () => {
  const n = parseInline("![alt](https://x/y.png) [bad](javascript:alert(1)) [ok](https://example.invalid)");
  assert.ok(!n.some((x) => x.t === "link" && x.href.startsWith("javascript")));
  assert.ok(n.some((x) => x.t === "link" && x.href === "https://example.invalid"));
  assert.ok(JSON.stringify(n).includes("alt"));
  assert.equal(safeHref("data:text/html,x"), null);
  assert.equal(safeHref("vbscript:x"), null);
  assert.equal(safeHref("mailto:a@b.invalid"), "mailto:a@b.invalid");
});
test("code content is preserved verbatim, including HTML-like text", () => {
  const b = parseMarkdown("```\n<div>x</div>\n```");
  assert.equal(b[0].t === "code" && b[0].v, "<div>x</div>");
});
