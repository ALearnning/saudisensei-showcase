import test from "node:test";
import assert from "node:assert/strict";
import { matchBffRoute, isRenditionContentRoute, privateContentHeaders, sanitizeQuery } from "../src/lib/bff-policy";
import { readFile } from "node:fs/promises";
test("general media foundation BFF is additive and exact across all three parent scopes", () => {
  for (const scope of ["courses", "chapters", "lessons"]) {
    const root = ["admin", scope, "parent", "media-library"];
    for (const [method, tail] of [
      ["GET", []], ["POST", ["assets"]], ["PATCH", ["assets", "asset"]],
      ["POST", ["assets", "asset", "revisions"]], ["POST", ["assets", "asset", "activate"]],
      ["POST", ["assets", "asset", "lifecycle"]], ["POST", ["placements"]],
      ["PATCH", ["placements", "placement"]], ["POST", ["placements", "placement", "lifecycle"]],
      ["PUT", ["placement-order"]], ["POST", ["collections"]],
      ["PATCH", ["collections", "collection"]], ["POST", ["collections", "collection", "lifecycle"]],
      ["PUT", ["collection-order"]],
    ] as const) assert.equal(matchBffRoute(method, [...root, ...tail]), true);
    assert.equal(matchBffRoute("GET", [scope, "parent", "media-library"]), true);
    assert.equal(matchBffRoute("POST", [scope, "parent", "media-library", "assets"]), false);
    assert.equal(matchBffRoute("DELETE", [...root, "assets", "asset"]), false);
    assert.equal(matchBffRoute("POST", [...root, "assets", "asset", "set-ready"]), false);
    assert.equal(matchBffRoute("GET", ["admin", scope, "..", "media-library"]), false);
  }
  assert.equal(matchBffRoute("GET", ["admin", "users", "parent", "media-library"]), false);
  assert.equal(matchBffRoute("POST", ["admin", "media", "asset", "publish"]), true);
  assert.equal(matchBffRoute("POST", ["video-pilot", "asset", "playback"]), true);
});
test("both generated clients include every registered media-library operation", async () => {
  const react = await readFile(new URL("../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");
  const zod = await readFile(new URL("../../../lib/api-zod/src/generated/api.ts", import.meta.url), "utf8");
  for (const operation of [
    "mediaLibraryAdminList", "mediaLibraryStudentList", "mediaLibraryAssetCreate",
    "mediaLibraryAssetUpdate", "mediaLibraryRevisionStage", "mediaLibraryRevisionActivate",
    "mediaLibraryAssetLifecycle", "mediaLibraryPlacementCreate", "mediaLibraryPlacementUpdate",
    "mediaLibraryPlacementLifecycle", "mediaLibraryPlacementOrder", "mediaLibraryCollectionCreate",
    "mediaLibraryCollectionUpdate", "mediaLibraryCollectionLifecycle", "mediaLibraryCollectionOrder",
    "mediaProcessingStatus", "mediaProcessingUpload", "mediaProcessingPart", "mediaProcessingComplete",
    "mediaRenditionAdminAccess", "mediaRenditionStudentAccess", "mediaRenditionAdminContent", "mediaRenditionStudentContent",
  ]) {
    assert.match(react, new RegExp(operation, "i"));
    assert.match(zod, new RegExp(operation, "i"));
  }
});
test("private rendition BFF only permits scoped access/content and fixed safe streaming headers", () => {
  for (const scope of ["courses", "chapters", "lessons"]) for (const prefix of [[], ["admin"]]) {
    const path = [...prefix, scope, "parent", "media-library", "placements", "placement"];
    assert.equal(matchBffRoute("POST", [...path, "access"]), true);
    assert.equal(matchBffRoute("GET", [...path, "content"]), true);
    assert.equal(isRenditionContentRoute("GET", [...path, "content"]), true);
    assert.equal(matchBffRoute("POST", [...path, "content"]), false);
    assert.equal(matchBffRoute("GET", [...path, "public"]), false);
    assert.equal(isRenditionContentRoute("GET", [...path, "..", "content"]), false);
  }
  for (const type of ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain; charset=utf-8"]) {
    const headers = privateContentHeaders(new Headers({ "Content-Type": type, "Content-Length": "500", "Content-Disposition": "inline", Location: "https://synthetic.invalid/private" }));
    assert.ok(headers); assert.equal(headers.get("cache-control"), "no-store");
    assert.equal(headers.get("location"), null); assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.match(headers.get("content-security-policy")!, /sandbox/);
  }
  assert.ok(privateContentHeaders(new Headers({ "Content-Type": "application/octet-stream", "Content-Length": "50", "Content-Disposition": "attachment; filename=\"resource\"" })));
  assert.equal(privateContentHeaders(new Headers({ "Content-Type": "text/html", "Content-Length": "50", "Content-Disposition": "inline" })), null);
  assert.equal(privateContentHeaders(new Headers({ "Content-Type": "application/pdf", "Content-Length": "999999999", "Content-Disposition": "inline" })), null);
  assert.equal(privateContentHeaders(new Headers({ "Content-Type": "application/octet-stream", "Content-Length": "50", "Content-Disposition": "inline" })), null);
  assert.equal(sanitizeQuery(new URLSearchParams("ticket=synthetic-secret&capability=synthetic-secret")), "");
});
test("durable processing BFF permits only scoped Admin status/upload/parts/complete", () => {
  for (const scope of ["courses", "chapters", "lessons"]) {
    const root = ["admin", scope, "parent", "media-library", "revisions", "revision", "processing"];
    assert.equal(matchBffRoute("GET", root), true);
    for (const action of ["upload", "parts", "complete"]) assert.equal(matchBffRoute("POST", [...root, action]), true);
    for (const action of ["ready", "clean", "callback", "retry", "delete"]) assert.equal(matchBffRoute("POST", [...root, action]), false);
    assert.equal(matchBffRoute("POST", [...root.slice(1), "complete"]), false);
  }
});
