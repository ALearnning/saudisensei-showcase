import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const script = `import config from "./next.config.ts";
const createConfig = typeof config === "function" ? config : config.default;
try { createConfig(process.env.TEST_NEXT_PHASE); process.stdout.write("accepted"); }
catch { process.stdout.write("rejected"); process.exitCode=1; }`;
function run(env: Record<string, string> & { NODE_ENV: "production" | "development" }) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd, env: { TEST_NEXT_PHASE: "phase-production-server", ...env }, encoding: "utf8", timeout: 15000,
  });
}
test("web startup refuses unconfigured production without logging input", () => {
  const result = run({ NODE_ENV: "production", AUTH0_SECRET: "DO_NOT_PRINT" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "rejected");
  assert.equal(result.stderr, "");
});
test("production build does not require or embed runtime secrets", () => {
  const result = run({ NODE_ENV: "production", TEST_NEXT_PHASE: "phase-production-build" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "accepted");
});
test("development startup remains unchanged", () => {
  const result = run({ NODE_ENV: "development", TEST_NEXT_PHASE: "phase-development-server" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "accepted");
});
test("development startup refuses a production configuration marker", () => {
  const result = run({ NODE_ENV: "development", TEST_NEXT_PHASE: "phase-development-server", SAUDISENSEI_ENVIRONMENT: "production" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "rejected");
});
test("development server cannot be used with production mode", () => {
  const result = run({ NODE_ENV: "production", TEST_NEXT_PHASE: "phase-development-server" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "rejected");
});
test("production server cannot run under development mode", () => {
  const result = run({ NODE_ENV: "development" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "rejected");
});
