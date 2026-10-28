import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { IdentityModule } from "../src/modules/identity/identity.module.js";
import { IDENTITY_ADAPTER } from "../src/modules/identity/identity-adapter.js";
import { USER_DIRECTORY } from "../src/modules/users/user-directory.js";
import { MediaModule } from "../src/modules/media/media.module.js";
import { MediaLibraryService } from "../src/modules/media/library.service.js";
import { configureApp } from "../src/config/configure-app.js";
import { MediaRenditionService } from "../src/modules/media/rendition.service.js";
import { Readable } from "node:stream";

test("mounted foundation routes retain existing identity, role and MFA enforcement", async () => {
  let calls = 0;
  const methods = ["list", "createAsset", "updateAsset", "stage", "activate", "assetLifecycle",
    "attach", "move", "placementLifecycle", "reorder", "createCollection", "updateCollection", "collectionLifecycle"];
  const business = Object.fromEntries(methods.map(method => [method, async () => { calls++; return { mediaEditRevision: 1 }; }]));
  const profile = { id: randomUUID(), email: "synthetic@example.invalid", displayName: "synthetic", status: "active", preferredLocale: "ar", roles: ["student"] };
  const module = await Test.createTestingModule({ imports: [IdentityModule, MediaModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue({
      verifyAccessToken: async (token: string) => {
        if (token === "invalid") throw new UnauthorizedException("AUTHENTICATION_REQUIRED");
        return { emailVerified: token !== "unverified", mfaVerified: token === "admin-mfa" };
      },
    }).overrideProvider(USER_DIRECTORY).useValue({
      resolve: async (identity: { mfaVerified: boolean }) => ({ ...profile, roles: identity.mfaVerified ? ["admin"] : profile.roles }),
    }).overrideProvider(MediaLibraryService).useValue(business).compile();
  const app = module.createNestApplication(); configureApp(app); await app.init();
  try {
    const parent = randomUUID(), entity = randomUUID();
    const root = `/api/v1/admin/lessons/${parent}/media-library`;
    const routes: [string, string][] = [
      ["get", ""], ["post", "/assets"], ["patch", `/assets/${entity}`],
      ["post", `/assets/${entity}/revisions`], ["post", `/assets/${entity}/activate`],
      ["post", `/assets/${entity}/lifecycle`], ["post", "/placements"],
      ["patch", `/placements/${entity}`], ["post", `/placements/${entity}/lifecycle`],
      ["put", "/placement-order"], ["post", "/collections"], ["patch", `/collections/${entity}`],
      ["post", `/collections/${entity}/lifecycle`], ["put", "/collection-order"],
      ["get", `/revisions/${entity}/processing`],
      ["post", `/revisions/${entity}/processing/upload`],
      ["post", `/revisions/${entity}/processing/parts`],
      ["post", `/revisions/${entity}/processing/complete`],
      ["post", `/placements/${entity}/access`],
      ["post", `/placements/${entity}/video-preview`],
      ["get", `/placements/${entity}/content`],
    ];
    for (const [method, path] of routes) {
      const send = () => (request(app.getHttpServer()) as unknown as Record<string, (url: string) => request.Test>)[method](root + path);
      await send().send({}).expect(401);
      await send().set("Authorization", "Bearer student").send({}).expect(403);
      profile.roles = ["admin"];
      await send().set("Authorization", "Bearer admin-no-mfa").send({}).expect(403);
      profile.roles = ["student"];
    }
    assert.equal(calls, 0);
    const studentPlayback = `/api/v1/lessons/${parent}/media-library/placements/${entity}/playback`;
    await request(app.getHttpServer()).post(studentPlayback).send({ revisionId: entity }).expect(401);
    profile.roles = ["admin"];
    await request(app.getHttpServer()).post(studentPlayback).set("Authorization", "Bearer admin-mfa").send({ revisionId: entity }).expect(403);
    profile.roles = ["student"];
    const body = { expectedMediaRevision: 0, title: "synthetic", kind: "document", filename: "a.txt", mimeType: "text/plain", bytes: 12 };
    await request(app.getHttpServer()).post(root + "/assets").set("Authorization", "Bearer invalid").send(body).expect(401);
    await request(app.getHttpServer()).post(root + "/assets").set("Authorization", "Bearer unverified").send(body).expect(403);
    await request(app.getHttpServer()).post(root + "/assets").set("Authorization", "Bearer admin-mfa").send({ ...body, scanState: "clean" }).expect(400);
    await request(app.getHttpServer()).post(root + "/assets").set("Authorization", "Bearer admin-mfa").send(body).expect(201);
    await request(app.getHttpServer()).post(root + `/revisions/${entity}/processing/complete`)
      .set("Authorization", "Bearer admin-mfa").send({ scanState: "clean", ready: true }).expect(400);
    await request(app.getHttpServer()).get(`/api/v1/lessons/${parent}/media-library`).set("Authorization", "Bearer student").expect(200);
    await request(app.getHttpServer()).get(`/api/v1/arbitrary/${parent}/media-library`).set("Authorization", "Bearer student").expect(400);
    for (const method of ["get", "post"] as const) {
      const path = `/api/v1/lessons/${parent}/media-library/placements/${entity}/${method === "get" ? "content" : "access"}`;
      await request(app.getHttpServer())[method](path).send({ mode: "preview" }).expect(401);
      await request(app.getHttpServer())[method](path).set("Authorization", "Bearer invalid").send({ mode: "preview" }).expect(401);
      await request(app.getHttpServer())[method](path).set("Authorization", "Bearer unverified").send({ mode: "preview" }).expect(403);
    }
    assert.equal(calls, 2);
  } finally { await app.close(); }
});
test("mounted private content streams bytes with passive headers and no storage redirect", async () => {
  const text = "<script>synthetic text, not HTML</script>\nنص";
  const profile = { id: randomUUID(), email: "synthetic@example.invalid", displayName: "synthetic",
    status: "active", preferredLocale: "ar", roles: ["student"] };
  const module = await Test.createTestingModule({ imports: [IdentityModule, MediaModule] })
    .overrideProvider(IDENTITY_ADAPTER).useValue({
      verifyAccessToken: async () => ({ emailVerified: true, mfaVerified: false }),
    }).overrideProvider(USER_DIRECTORY).useValue({ resolve: async () => profile })
    .overrideProvider(MediaRenditionService).useValue({
      content: async () => ({ stream: Readable.from([Buffer.from(text)]), bytes: Buffer.byteLength(text),
        contentType: "text/plain; charset=utf-8", disposition: "inline" }),
    }).compile();
  const app = module.createNestApplication(); configureApp(app); await app.init();
  try {
    const response = await request(app.getHttpServer()).get(`/api/v1/lessons/${randomUUID()}/media-library/placements/${randomUUID()}/content`)
      .set("Authorization", "Bearer synthetic").set("X-Media-Capability", "synthetic").expect(200);
    assert.equal(response.text, text);
    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-disposition"], "inline");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(response.headers["content-security-policy"], /sandbox/);
    assert.equal(response.headers["location"], undefined);
  } finally { await app.close(); }
});
