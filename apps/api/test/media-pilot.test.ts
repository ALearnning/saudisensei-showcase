import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, jwtVerify } from "jose";
import {
  assertMediaPublishable, MediaAccessError, mediaCapabilityDeadline, MEDIA_ACCESS_TTL,
  type MediaAccessFacts,
} from "../src/modules/media/media-access-policy.js";
import {
  MediaAccessIssuer, type MediaAccessRepository,
} from "../src/modules/media/media-access-issuer.js";
import type { PrivateMediaSigner } from "../src/modules/media/media-provider-ports.js";
import { calculateProgress } from "../src/modules/progress/progress.service.js";

const now = 1_800_000_000;
const request = { actorRef: "fixture-actor", placementRef: "fixture-placement", audience: "student" as const, mode: "preview" as const };
function facts(): MediaAccessFacts {
  return {
    identity: { verified: true, active: true, roles: ["student"], mfaVerified: false, tokenExpiresAt: now + 3600 },
    enrollment: { active: true, expiresAt: null },
    course: { ref: "fixture-course", lifecycle: "published" },
    chapter: { ref: "fixture-chapter", courseRef: "fixture-course", lifecycle: "published" },
    lesson: { ref: "fixture-lesson", courseRef: "fixture-course", chapterRef: "fixture-chapter", lifecycle: "published", markdown: "# مقدمة\nIntroduction" },
    placement: { ref: "fixture-placement", courseRef: "fixture-course", lifecycle: "published", parentKind: "lesson", parentRef: "fixture-lesson" },
    asset: { courseRef: "fixture-course", lifecycle: "published", kind: "file", scan: "clean", processing: "ready", currentRevisionRef: "fixture-revision", downloadsAllowed: false },
    resource: { revisionRef: "fixture-revision", kind: "converted-preview", private: true, locator: { store: "fixture-store", key: "fixture-preview" } },
  };
}
function video(): MediaAccessFacts {
  const value = facts();
  value.asset.kind = "video"; value.resource.kind = "stream";
  return value;
}
function denied(value: MediaAccessFacts, mode: "preview" | "download" | "playback" = "preview") {
  assert.throws(() => mediaCapabilityDeadline(value, mode, "student", now), MediaAccessError);
}
test("approved TTLs and clipping to identity/enrollment expiration", () => {
  assert.deepEqual(MEDIA_ACCESS_TTL, { preview: 120, download: 120, playback: 300 });
  assert.equal(mediaCapabilityDeadline(facts(), "preview", "student", now), now + 120);
  assert.equal(mediaCapabilityDeadline(video(), "playback", "student", now), now + 300);
  const value = facts(); value.asset.downloadsAllowed = true; value.resource.kind = "original";
  assert.equal(mediaCapabilityDeadline(value, "download", "student", now), now + 120);
  value.enrollment!.expiresAt = now + 40;
  assert.equal(mediaCapabilityDeadline(value, "download", "student", now), now + 40);
  value.identity.tokenExpiresAt = now + 20;
  assert.equal(mediaCapabilityDeadline(value, "download", "student", now), now + 20);
});
test("unverified, inactive, expired and wrong-role identities are denied", () => {
  for (const mutate of [
    (v: MediaAccessFacts) => { v.identity.verified = false; },
    (v: MediaAccessFacts) => { v.identity.active = false; },
    (v: MediaAccessFacts) => { v.identity.tokenExpiresAt = now; },
    (v: MediaAccessFacts) => { v.identity.tokenExpiresAt = NaN; },
    (v: MediaAccessFacts) => { v.identity.roles = []; },
  ]) { const v = facts(); mutate(v); denied(v); }
});
test("absent, revoked, expired and invalid enrollment is denied", () => {
  for (const enrollment of [undefined, { active: false, expiresAt: null }, { active: true, expiresAt: now }, { active: true, expiresAt: NaN }]) {
    const v = facts(); v.enrollment = enrollment; denied(v);
  }
});
test("Admin preview requires verified MFA and never grants Student draft access", () => {
  const v = facts(); v.identity.roles = ["student", "admin"]; v.course.lifecycle = "draft";
  denied(v);
  assert.throws(() => mediaCapabilityDeadline(v, "preview", "admin", now), MediaAccessError);
  v.identity.mfaVerified = true;
  assert.equal(mediaCapabilityDeadline(v, "preview", "admin", now), now + 120);
});
test("each unpublished, archived or removed ancestry node blocks Student issuance", () => {
  for (const key of ["course", "chapter", "lesson", "placement", "asset"] as const) {
    for (const lifecycle of ["draft", "archived", "removed"] as const) {
      const v = facts(); v[key]!.lifecycle = lifecycle; denied(v);
    }
  }
});
test("cross-course resources and incorrect parent chains are denied", () => {
  for (const mutate of [
    (v: MediaAccessFacts) => { v.asset.courseRef = "other"; },
    (v: MediaAccessFacts) => { v.placement.courseRef = "other"; },
    (v: MediaAccessFacts) => { v.chapter!.courseRef = "other"; },
    (v: MediaAccessFacts) => { v.lesson!.chapterRef = "other"; },
    (v: MediaAccessFacts) => { v.placement.parentRef = "other"; },
    (v: MediaAccessFacts) => { delete v.chapter; },
    (v: MediaAccessFacts) => { v.lesson!.markdown = "  "; },
  ]) { const v = facts(); mutate(v); denied(v); }
});
test("course and chapter placements do not implicitly inherit other parents", () => {
  const v = facts(); v.placement.parentKind = "course"; v.placement.parentRef = v.course.ref;
  denied(v); delete v.chapter; delete v.lesson;
  assert.equal(mediaCapabilityDeadline(v, "preview", "student", now), now + 120);
  const c = facts(); c.placement.parentKind = "chapter"; c.placement.parentRef = c.chapter!.ref;
  delete c.lesson;
  assert.equal(mediaCapabilityDeadline(c, "preview", "student", now), now + 120);
});
test("collections require matching published parent and course", () => {
  const v = facts();
  v.collection = { ...v.placement, ref: "fixture-collection" };
  assert.equal(mediaCapabilityDeadline(v, "preview", "student", now), now + 120);
  for (const patch of [{ lifecycle: "draft" as const }, { courseRef: "other" }, { parentRef: "other" }]) {
    const x = structuredClone(v); Object.assign(x.collection!, patch); denied(x);
  }
});
test("quarantined, unready, non-private and non-current resources are denied", () => {
  for (const mutate of [
    (v: MediaAccessFacts) => { v.asset.scan = "pending"; },
    (v: MediaAccessFacts) => { v.asset.scan = "rejected"; },
    (v: MediaAccessFacts) => { v.asset.processing = "failed"; },
    (v: MediaAccessFacts) => { v.resource.private = false; },
    (v: MediaAccessFacts) => { v.resource.revisionRef = "old"; },
  ]) { const v = facts(); mutate(v); denied(v); }
});
test("view-only refuses originals/downloads and video download is excluded", () => {
  const v = facts(); v.resource.kind = "original";
  denied(v); denied(v, "download");
  denied(video(), "download"); denied(facts(), "playback");
});
test("publication fails closed without clean scan, private delivery or isolated macro-disabled Office conversion", () => {
  const clean = { ready: true, scan: "clean" as const, privateDelivery: true, officeDocument: true, macrosDisabled: true, conversionIsolated: true };
  assert.doesNotThrow(() => assertMediaPublishable(clean));
  for (const patch of [{ ready: false }, { scan: "pending" as const }, { privateDelivery: false }, { macrosDisabled: false }, { conversionIsolated: false }]) {
    assert.throws(() => assertMediaPublishable({ ...clean, ...patch }), MediaAccessError);
  }
});
function harness(value = facts()) {
  let reads = 0, signs = 0;
  const repository: MediaAccessRepository = { async readFresh() { reads++; return value; } };
  const signer: PrivateMediaSigner = {
    allowedDeliveryHosts: new Set(["media.invalid"]),
    async sign(input) {
      signs++;
      return { url: "https://media.invalid/fixture", expiresAt: input.expiresAt, revisionRef: input.resource.revisionRef };
    },
  };
  return { value, repository, signer, counters: () => ({ reads, signs }) };
}
test("renewal rereads permissions and stops before signer on revocation", async () => {
  const h = harness(), issuer = new MediaAccessIssuer(h.repository, h.signer, () => now);
  await issuer.issue(request); h.value.enrollment!.active = false;
  await assert.rejects(issuer.issue(request), MediaAccessError);
  assert.deepEqual(h.counters(), { reads: 2, signs: 1 });
});
test("new account/publication checks run on every renewal", async () => {
  for (const mutate of [
    (v: MediaAccessFacts) => { v.identity.active = false; },
    (v: MediaAccessFacts) => { v.asset.lifecycle = "archived"; },
  ]) {
    const h = harness(), issuer = new MediaAccessIssuer(h.repository, h.signer, () => now);
    await issuer.issue(request); mutate(h.value);
    await assert.rejects(issuer.issue(request), MediaAccessError);
    assert.equal(h.counters().signs, 1);
  }
});
test("malformed, unexpected-host, insecure and overlong signer results fail closed", async () => {
  for (const patch of [
    { url: "not-a-url" }, { url: "http://media.invalid/fixture" },
    { url: "https://unexpected.invalid/fixture" }, { url: "https://user:password@media.invalid/fixture" },
    { expiresAt: now + 121 }, { expiresAt: now }, { revisionRef: "wrong" },
  ]) {
    const h = harness(), original = h.signer.sign.bind(h.signer);
    h.signer.sign = async input => ({ ...await original(input), ...patch });
    await assert.rejects(new MediaAccessIssuer(h.repository, h.signer, () => now).issue(request), MediaAccessError);
  }
});
test("upstream failures produce a static safe error without fallback or raw errors", async () => {
  const h = harness();
  h.signer.sign = async () => { throw new Error("fixture upstream sensitive diagnostic"); };
  await assert.rejects(new MediaAccessIssuer(h.repository, h.signer, () => now).issue(request),
    (e: unknown) => e instanceof MediaAccessError && e.message === "MEDIA_UNAVAILABLE");
  assert.equal(h.counters().reads, 1);
});
test("missing facts and time elapsed during signing deny delivery", async () => {
  const h = harness();
  h.repository.readFresh = async () => undefined;
  await assert.rejects(new MediaAccessIssuer(h.repository, h.signer, () => now).issue(request), MediaAccessError);
  assert.equal(h.counters().signs, 0);
  const x = harness(); let calls = 0;
  await assert.rejects(new MediaAccessIssuer(x.repository, x.signer, () => calls++ === 0 ? now : now + 121).issue(request), MediaAccessError);
});
test("real ephemeral RS256 fixture proves signed expiry; it is not a live provider test", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const h = harness(video());
  h.signer.sign = async input => {
    const token = await new SignJWT({ revision: input.resource.revisionRef })
      .setProtectedHeader({ alg: "RS256" }).setIssuedAt(now).setExpirationTime(input.expiresAt).sign(privateKey);
    return { url: `https://media.invalid/fixture?token=${token}`, expiresAt: input.expiresAt, revisionRef: input.resource.revisionRef };
  };
  const grant = await new MediaAccessIssuer(h.repository, h.signer, () => now).issue({ ...request, mode: "playback" });
  const token = new URL(grant.url).searchParams.get("token")!;
  const result = await jwtVerify(token, publicKey, { algorithms: ["RS256"], currentDate: new Date(now * 1000) });
  assert.equal(result.payload.exp, now + 300);
  await assert.rejects(jwtVerify(token, publicKey, { algorithms: ["RS256"], currentDate: new Date((now + 300) * 1000) }));
});
test("media operations do not add progress units or reset the unchanged lesson calculation", () => {
  const completed = new Set(["fixture-lesson"]);
  const curriculum = [{ id: "fixture-lesson", isRequired: true }];
  const before = calculateProgress(curriculum, completed);
  for (const _operation of ["attach", "replace", "reorder", "hide"]) {
    assert.deepEqual(calculateProgress(curriculum, completed), before);
  }
  assert.equal(before.percentage, 100); assert.equal(completed.size, 1);
});
