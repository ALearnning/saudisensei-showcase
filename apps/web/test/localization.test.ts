import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLocale, dirFor, isLocale } from "../src/i18n/config";
import { getCatalog } from "../src/i18n/catalogs";
import { authIsConfigured } from "../src/lib/auth-config";

test("Arabic is the default interface with RTL; English uses LTR", () => {
  assert.equal(defaultLocale, "ar");
  assert.equal(dirFor("ar"), "rtl");
  assert.equal(dirFor("en"), "ltr");
});
test("unsupported locales are rejected", () => {
  assert.equal(isLocale("ar"), true);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("fr"), false);
});
test("Arabic and English interface catalogs have identical keys", () => {
  function paths(value: object, prefix = ""): string[] {
    return Object.entries(value).flatMap(([key, item]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof item === "object" && item !== null ? paths(item, path) : [path];
    }).sort();
  }
  assert.deepEqual(paths(getCatalog("ar")), paths(getCatalog("en")));
});
test("missing Auth0 configuration leaves live sign-in disabled", () => {
  assert.equal(authIsConfigured({}), false);
});
