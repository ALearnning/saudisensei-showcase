import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { pdfTaskCleanup } from "../src/components/lms/student-media/pdf-lifecycle";

test("PDF cleanup disposes the current loading owner exactly once", () => {
  let calls = 0;
  let owner: { destroy(): void } | null = null;
  const cleanup = pdfTaskCleanup(() => owner);
  owner = { destroy() { calls++; } };
  cleanup(); cleanup();
  assert.equal(calls, 1);
});

test("PDF cleanup before loading has an owner is safe", () => {
  const cleanup = pdfTaskCleanup(() => null);
  assert.doesNotThrow(cleanup);
  assert.doesNotThrow(cleanup);
});

test("PDF cleanup accepts an asynchronous loading owner", async () => {
  let disposed = false;
  const cleanup = pdfTaskCleanup(() => ({ async destroy() { await tick(); disposed = true; } }));
  cleanup(); await tick(); await tick();
  assert.equal(disposed, true);
});

test("PDF cleanup contains worker disposal rejections", async () => {
  const cleanup = pdfTaskCleanup(() => ({ destroy() { return Promise.reject(new Error("SYNTHETIC_DISPOSAL")); } }));
  assert.doesNotThrow(cleanup);
  await tick();
});

test("PDF cleanup contains synchronous disposal errors", () => {
  const cleanup = pdfTaskCleanup(() => ({ destroy() { throw new Error("SYNTHETIC_DISPOSAL"); } }));
  assert.doesNotThrow(cleanup);
});
