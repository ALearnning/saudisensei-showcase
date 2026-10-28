import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanWorkerScratch, runWorkerLoop, writeWorkerHeartbeat } from "../src/config/worker-runtime.js";

test("worker fails closed before DB/provider import with missing production config", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../src/media-worker-main.js", import.meta.url))], {
    env: { NODE_ENV: "production", AUTH0_SECRET: "DO_NOT_DISCLOSE" }, encoding: "utf8", timeout: 15000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /MEDIA_WORKER_UNAVAILABLE/);
  assert.doesNotMatch(r.stdout + r.stderr, /DO_NOT_DISCLOSE/);
});
test("unhealthy startup never claims a durable job", async () => {
  let claims = 0;
  await assert.rejects(runWorkerLoop({
    runOne: async () => { claims++; }, probe: async () => { throw new Error("unavailable"); },
    abort: () => {}, stopped: () => false,
  }));
  assert.equal(claims, 0);
});
test("hung readiness has a bounded deadline before any claim", async () => {
  await assert.rejects(runWorkerLoop({
    runOne: async () => { assert.fail("must not claim"); },
    probe: () => new Promise(() => {}), abort: () => {}, stopped: () => false,
    probeTimeoutMs: 5,
  }), { message: "MEDIA_WORKER_UNAVAILABLE" });
});
test("readiness loss aborts processing and exits, rather than silently remaining healthy", async () => {
  let stopped = false, probes = 0, aborted = false;
  await assert.rejects(runWorkerLoop({
    probe: async () => { if (++probes > 1) throw new Error("unavailable"); },
    runOne: async () => { await new Promise(r => setTimeout(r, 30)); },
    abort: () => { aborted = true; stopped = true; }, stopped: () => stopped,
    probeMs: 5, delayMs: 1,
  }), { message: "MEDIA_WORKER_UNAVAILABLE" });
  assert.equal(aborted, true);
});
test("supervised restart begins probing and claiming again", async () => {
  let claims = 0;
  for (let restart = 0; restart < 2; restart++) {
    let stopped = false;
    await runWorkerLoop({
      probe: async () => {}, runOne: async () => { claims++; stopped = true; },
      stopped: () => stopped, abort: () => { stopped = true; }, delayMs: 1,
    });
  }
  assert.equal(claims, 2);
});
test("scratch cleanup preserves unrelated content and heartbeat contains no identity or source data", async () => {
  const root = await mkdtemp(join(tmpdir(), "worker-runtime-test-"));
  try {
    await mkdir(join(root, "saudisensei-media-job-interrupted"));
    await writeFile(join(root, "unrelated"), "preserve");
    await cleanWorkerScratch(root);
    assert.deepEqual(await readdir(root), ["unrelated"]);
    await writeWorkerHeartbeat(join(root, "worker-heartbeat"));
    assert.match(await readFile(join(root, "worker-heartbeat"), "utf8"), /^\d+$/);
    assert.equal((await readdir(root)).includes("worker-heartbeat.tmp"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
