import { test } from "node:test";
import assert from "node:assert/strict";
import { VideoPilotService } from "../src/modules/media/video-pilot.service.js";
import type { LmsStore } from "../src/modules/courses/lms.store.js";
import type { AuthenticatedRequest } from "../src/modules/authorization/authenticated-request.js";

test("Video fixture guard fails closed across fresh account/enrollment/ancestry checks", async () => {
  const previous = process.env.VIDEO_PILOT_ENABLED;
  process.env.VIDEO_PILOT_ENABLED = "true";
  try {
    const state = { active: true, role: "student", enrollment: "active", expired: false,
      course: "published", chapter: "published", lesson: "published", markdown: "Required lesson" };
    let signs = 0, reads = 0;
    const tx = {
      lesson: { findUnique: async () => ({ courseId: "course" }),
        findUniqueOrThrow: async () => ({ status: state.lesson, body: state.markdown,
          chapter: { status: state.chapter } }) },
      user: { findUnique: async () => ({ status: state.active ? "active" : "suspended",
        roles: [{ role: { name: state.role } }] }) },
      enrollment: { findUnique: async () => { reads++; return { status: state.enrollment,
        expiresAt: state.expired ? new Date(0) : null }; } },
      videoPilotAsset: { findMany: async () => [] },
    };
    const store = { transaction: async (fn: (t: unknown) => unknown) => fn(tx),
      courseLock: async () => ({ id: "course", status: state.course }) } as unknown as LmsStore;
    const service = new VideoPilotService(store, { playback: () => { signs++; throw Error(); } });
    const req = { user: { id: "actor" }, mfaVerified: false } as AuthenticatedRequest;
    assert.deepEqual(await service.list(req, "lesson"), { items: [] });
    const cases = [
      ["active", false], ["role", "admin"], ["enrollment", "revoked"], ["enrollment", "expired"],
      ["expired", true], ["course", "draft"], ["course", "archived"], ["chapter", "draft"],
      ["lesson", "draft"], ["markdown", ""],
    ] as const;
    for (const [key, bad] of cases) {
      const original = state[key];
      (state as Record<string, unknown>)[key] = bad;
      await assert.rejects(service.list(req, "lesson"));
      (state as Record<string, unknown>)[key] = original;
    }
    assert.ok(reads >= 3);
    assert.equal(signs, 0);
  } finally {
    if (previous === undefined) delete process.env.VIDEO_PILOT_ENABLED;
    else process.env.VIDEO_PILOT_ENABLED = previous;
  }
});

test("Video pilot is disabled by default", async () => {
  const previous = process.env.VIDEO_PILOT_ENABLED;
  delete process.env.VIDEO_PILOT_ENABLED;
  try {
    const service = new VideoPilotService({} as LmsStore, { playback: () => { throw Error(); } });
    await assert.rejects(service.list({} as AuthenticatedRequest, "lesson"), /VIDEO_UNAVAILABLE/);
  } finally { if (previous !== undefined) process.env.VIDEO_PILOT_ENABLED = previous; }
});
