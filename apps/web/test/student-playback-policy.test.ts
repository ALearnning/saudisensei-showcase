import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { matchBffRoute } from "../src/lib/bff-policy";

test("Student playback BFF allowlist stays parent-scoped and POST-only", () => {
  for (const scope of ["courses", "chapters", "lessons"]) {
    const path = [scope, randomUUID(), "media-library", "placements", randomUUID(), "playback"];
    assert.equal(matchBffRoute("POST", path), true);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) assert.equal(matchBffRoute(method, path), false);
    assert.equal(matchBffRoute("POST", ["admin", ...path]), false);
    assert.equal(matchBffRoute("POST", [...path, "other"]), false);
  }
});
