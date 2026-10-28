import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBffRoute } from "../src/lib/bff-policy";
test("new media paths are explicitly allowlisted without widening the BFF", () => {
  const id = "00000000-0000-4000-8000-000000000000";
  for (const route of [
    `POST admin/lessons/${id}/media/uploads`, `GET admin/lessons/${id}/media`,
    `POST admin/media/uploads/${id}/parts`, `POST admin/media/uploads/${id}/complete`,
    `POST admin/media/${id}/scan`, `POST admin/media/${id}/publish`,
    `GET lessons/${id}/media`, `POST media/${id}/access`,
  ]) {
    const [method, path] = route.split(" ");
    assert.ok(matchBffRoute(method, path!.split("/")));
  }
  assert.equal(matchBffRoute("DELETE", ["admin", "media", id]), false);
  assert.equal(matchBffRoute("GET", ["media", id, "access"]), false);
  assert.equal(matchBffRoute("POST", ["media", id, "clean"]), false);
  assert.equal(matchBffRoute("POST", ["admin", "media", "..", "scan"]), false);
});
