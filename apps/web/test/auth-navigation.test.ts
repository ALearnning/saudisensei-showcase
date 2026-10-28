import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportedAuthReturnPath, resolveCallbackReturnTo, resolveLogoutReturnTo } from "../src/lib/auth-navigation";

const fixtureOrigin = "https://application.example.invalid";
test("Arabic logout return is absolute and preserves locale", () => {
  assert.equal(resolveLogoutReturnTo("/ar/login", fixtureOrigin), `${fixtureOrigin}/ar/login`);
});
test("English logout return is absolute and preserves locale", () => {
  assert.equal(resolveLogoutReturnTo("/en/login", fixtureOrigin), `${fixtureOrigin}/en/login`);
});
test("default logout returns to the allowlisted Arabic login page", () => {
  assert.equal(resolveLogoutReturnTo(null, fixtureOrigin), `${fixtureOrigin}/ar/login`);
});
test("logout does not accept external or unsupported redirect targets", () => {
  for (const target of ["https://attacker.example.invalid", "//attacker.example.invalid", "/fr/login", "/ar/login?next=external", ""]) {
    assert.equal(isSupportedAuthReturnPath(target), false);
    assert.throws(() => resolveLogoutReturnTo(target, fixtureOrigin), /INVALID_RETURN_TARGET/);
  }
});
test("callback allows supported local targets and otherwise defaults to Student", () => {
  assert.equal(resolveCallbackReturnTo("/en/student", fixtureOrigin), `${fixtureOrigin}/en/student`);
  assert.equal(resolveCallbackReturnTo("https://attacker.example.invalid", fixtureOrigin), `${fixtureOrigin}/ar/student`);
  assert.equal(resolveCallbackReturnTo(undefined, fixtureOrigin), `${fixtureOrigin}/ar/student`);
});
