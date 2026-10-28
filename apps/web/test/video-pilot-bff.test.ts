import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBffRoute } from "../src/lib/bff-policy";

test("Video pilot BFF permits only the three exact guarded routes", () => {
  assert.equal(matchBffRoute("POST", ["admin", "video-pilot", "fixture", "attach"]), true);
  assert.equal(matchBffRoute("GET", ["lessons", "lesson", "video-pilot"]), true);
  assert.equal(matchBffRoute("POST", ["video-pilot", "fixture", "playback"]), true);
  for (const [method, segments] of [
    ["GET", ["video-pilot", "fixture", "playback"]],
    ["DELETE", ["video-pilot", "fixture"]],
    ["POST", ["video-pilot", "fixture", "downloads"]],
    ["POST", ["admin", "video-pilot", "fixture", "delete"]],
    ["POST", ["video-pilot", "..", "playback"]],
  ] as const) assert.equal(matchBffRoute(method, segments), false);
});
