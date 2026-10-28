import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedBody } from "../src/lib/bff-policy";

const chunks = (...values: Uint8Array[]) => new ReadableStream<Uint8Array>({
  start(controller) { values.forEach((value) => controller.enqueue(value)); controller.close(); },
});
test("streamed Arabic UTF-8 is decoded correctly across chunk boundaries", async () => {
  const bytes = new TextEncoder().encode('{"body":"نص الدرس"}');
  assert.deepEqual(await readBoundedBody(chunks(bytes.slice(0, 10), bytes.slice(10)), 100), { ok: true, text: '{"body":"نص الدرس"}' });
});
test("chunked oversized bodies are stopped without trusting Content-Length", async () => {
  assert.deepEqual(await readBoundedBody(chunks(new Uint8Array(60), new Uint8Array(60)), 100),
    { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" });
});
test("invalid UTF-8 and interrupted streams return only a generic error", async () => {
  const bad = { ok: false, status: 400, code: "VALIDATION_FAILED" };
  assert.deepEqual(await readBoundedBody(chunks(new Uint8Array([0xff])), 100), bad);
  assert.deepEqual(await readBoundedBody(new ReadableStream({ start(c) { c.error(new Error("private upstream detail")); } }), 100), bad);
});
