import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LoginGateway, type GatewayState } from "../src/components/auth-entry/LoginGateway";

const render = (locale: "ar" | "en", state: GatewayState = "entry") =>
  renderToStaticMarkup(createElement(LoginGateway, { locale, state, area: "admin" }));
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

for (const locale of ["ar", "en"] as const) {
  test(`${locale}: real gateway preserves exact Auth0 destination and approved CTA`, () => {
    const html = render(locale);
    assert.match(html, new RegExp(`href="/auth/login\\?returnTo=/${locale}/student"`));
    assert.match(html, locale === "ar" ? /تسجيل الدخول/ : />Sign in</);
    assert.match(html, new RegExp(`dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.match(html, new RegExp(`href="/${locale === "ar" ? "en" : "ar"}/login"`));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<input|<form|preview|محاكاة|معاينة تصميمية|صفحة اختبار/i);
  });
  test(`${locale}: missing configuration stays disabled with no auth entry link`, () => {
    const html = render(locale, "setup");
    assert.match(html, /disabled=""[^>]*data-testid="button-login-disabled"/);
    assert.doesNotMatch(html, /href="\/auth\/login/);
  });
  test(`${locale}: denied access retains real logout and back actions, never sign-in permission`, () => {
    const html = render(locale, "forbidden");
    assert.match(html, /data-testid="status-forbidden"/);
    assert.match(html, new RegExp(`href="/auth/logout\\?returnTo=/${locale}/login"`));
    assert.match(html, /data-testid="link-back-login"/);
    assert.doesNotMatch(html, /data-testid="link-login"/);
  });
  test(`${locale}: unavailable retries existing area; loading never initiates auth`, () => {
    const unavailable = render(locale, "unavailable");
    assert.match(unavailable, new RegExp(`href="/${locale}/admin"[^>]*data-testid="button-retry"`));
    const loading = render(locale, "loading");
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /role="status"/);
    assert.doesNotMatch(loading, /href="\/auth\//);
  });
}
test("SSR output is stable, artwork identifiers deterministic and error diagnostics absent", () => {
  const element = createElement(LoginGateway, { locale: "ar" });
  assert.equal(renderToString(element), renderToString(element));
  const html = render("en", "failure");
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /stack|digest|AUTH0_|access_token|id_token|AUTH_CALLBACK_FAILED/);
});
test("sign-in feedback does not intercept navigation, delay auth, or handle credentials/tokens", () => {
  const text = source("../src/components/auth-entry/SignInLink.tsx");
  assert.doesNotMatch(text, /preventDefault\(|setTimeout\(|fetch\(|password|access_token|localStorage/);
  assert.match(text, /window\.addEventListener\("pageshow"/);
  assert.match(text, /!event\.metaKey/);
});
test("responsive scope, safe areas, focus and reduced-motion support are isolated", () => {
  const css = source("../src/components/auth-entry/login.css");
  assert.match(css, /\.shell:has\(\.sslg-gateway\)/);
  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /suppressHydrationWarning|display:\s*none.*ss-workspace/);
});
