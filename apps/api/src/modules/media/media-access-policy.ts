import type { DeliveryResource, MediaAccessMode } from "./media-provider-ports.js";

export const MEDIA_ACCESS_TTL = Object.freeze({ preview: 120, download: 120, playback: 300 });
export type MediaAudience = "student" | "admin";
type Lifecycle = "draft" | "published" | "archived" | "removed";
type ParentKind = "course" | "chapter" | "lesson";
interface ContentNode {
  ref: string; courseRef: string; lifecycle: Lifecycle;
}
/**
 * Trusted facts read freshly by a server repository after existing identity guards.
 * Never accept this object, identity verification, roles or scan evidence from a client.
 */
export interface MediaAccessFacts {
  identity: {
    verified: boolean; active: boolean; roles: ReadonlyArray<"student" | "admin">;
    mfaVerified: boolean; tokenExpiresAt: number;
  };
  enrollment?: { active: boolean; expiresAt: number | null };
  course: { ref: string; lifecycle: Lifecycle };
  placement: ContentNode & { parentKind: ParentKind; parentRef: string };
  chapter?: ContentNode;
  lesson?: ContentNode & { chapterRef: string; markdown: string };
  collection?: ContentNode & { parentKind: ParentKind; parentRef: string };
  asset: {
    courseRef: string; lifecycle: Lifecycle; kind: "video" | "file";
    scan: "pending" | "clean" | "rejected"; processing: "pending" | "ready" | "failed";
    currentRevisionRef: string; downloadsAllowed: boolean;
  };
  resource: DeliveryResource;
}

export class MediaAccessError extends Error {
  constructor() { super("MEDIA_UNAVAILABLE"); this.name = "MediaAccessError"; }
}

export function mediaCapabilityDeadline(
  facts: MediaAccessFacts, mode: MediaAccessMode, audience: MediaAudience, now: number,
): number {
  const deny = () => { throw new MediaAccessError(); };
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(facts.identity.tokenExpiresAt) ||
      facts.identity.tokenExpiresAt <= now ||
      !facts.identity.verified || !facts.identity.active) deny();
  if (audience === "admin") {
    if (!facts.identity.roles.includes("admin") || !facts.identity.mfaVerified) deny();
  } else if (audience === "student") {
    if (!facts.identity.roles.includes("student") || !facts.enrollment?.active) deny();
    const expires = facts.enrollment?.expiresAt;
    if (expires !== null && (!Number.isSafeInteger(expires) || expires! <= now)) deny();
  } else deny();

  const courseRef = facts.course.ref;
  if (!courseRef || facts.placement.courseRef !== courseRef || facts.asset.courseRef !== courseRef) deny();
  const nodes: Array<{ lifecycle: Lifecycle }> = [facts.course, facts.placement, facts.asset];
  const placement = facts.placement;
  if (placement.parentKind === "course") {
    if (placement.parentRef !== courseRef || facts.chapter || facts.lesson) deny();
  } else if (placement.parentKind === "chapter") {
    if (!facts.chapter || facts.chapter.courseRef !== courseRef ||
        placement.parentRef !== facts.chapter.ref || facts.lesson) deny();
    nodes.push(facts.chapter!);
  } else if (placement.parentKind === "lesson") {
    if (!facts.chapter || !facts.lesson || facts.chapter.courseRef !== courseRef ||
        facts.lesson.courseRef !== courseRef || facts.lesson.chapterRef !== facts.chapter.ref ||
        placement.parentRef !== facts.lesson.ref || !facts.lesson.markdown.trim()) deny();
    nodes.push(facts.chapter!, facts.lesson!);
  } else deny();
  if (facts.collection) {
    if (facts.collection.courseRef !== courseRef ||
        facts.collection.parentKind !== placement.parentKind ||
        facts.collection.parentRef !== placement.parentRef) deny();
    nodes.push(facts.collection);
  }
  if (nodes.some(node => !["draft", "published", "archived", "removed"].includes(node.lifecycle))) deny();
  if (audience === "student" && nodes.some(node => node.lifecycle !== "published")) deny();
  if (audience === "admin" && nodes.some(node => node.lifecycle === "removed")) deny();
  if (facts.asset.scan !== "clean" || facts.asset.processing !== "ready" ||
      !facts.resource.private || !facts.asset.currentRevisionRef ||
      facts.resource.revisionRef !== facts.asset.currentRevisionRef) deny();
  if (mode === "playback") {
    if (facts.asset.kind !== "video" || facts.resource.kind !== "stream") deny();
  } else if (mode === "preview") {
    if (facts.asset.kind !== "file" || facts.resource.kind !== "converted-preview") deny();
  } else if (mode === "download") {
    // Video downloads are deliberately excluded from this delivery contract.
    if (facts.asset.kind !== "file" || !facts.asset.downloadsAllowed ||
        facts.resource.kind !== "original") deny();
  } else deny();

  let deadline = Math.min(now + MEDIA_ACCESS_TTL[mode], facts.identity.tokenExpiresAt);
  if (audience === "student" && facts.enrollment?.expiresAt !== null) {
    deadline = Math.min(deadline, facts.enrollment!.expiresAt!);
  }
  if (!Number.isSafeInteger(deadline) || deadline <= now) deny();
  return deadline;
}

export function assertMediaPublishable(input: {
  ready: boolean; scan: "pending" | "clean" | "rejected";
  privateDelivery: boolean; officeDocument: boolean;
  macrosDisabled: boolean; conversionIsolated: boolean;
}): void {
  if (!input.ready || input.scan !== "clean" || !input.privateDelivery ||
      (input.officeDocument && (!input.macrosDisabled || !input.conversionIsolated))) {
    throw new MediaAccessError();
  }
}
