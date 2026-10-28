"use client";
import { baseType, isCapability, MAX_FILE_BYTES, studentContentPath, type StudentScope } from "./helpers";
import type { RenditionAccess } from "./types";

export class ContentError extends Error { constructor(public status: number) { super("CONTENT"); } }

/** Fetches private bytes only through the exact validated Student BFF path.
 *  The capability travels solely in the X-Media-Capability header. */
export async function fetchStudentContent(access: RenditionAccess, expected: { scope: StudentScope; parentId: string; placementId: string }, signal?: AbortSignal): Promise<Blob> {
  const path = studentContentPath(access.url, window.location.origin, expected);
  if (!path || !isCapability(access.capability) || !(Date.parse(access.expiresAt) > Date.now())) throw new ContentError(-1);
  let res: Response;
  try {
    res = await fetch(path, { headers: { "X-Media-Capability": access.capability }, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal });
  } catch { throw new ContentError(0); }
  if (!res.ok) throw new ContentError(res.status);
  if (baseType(res.headers.get("content-type")) !== baseType(access.contentType)) throw new ContentError(-1);
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_FILE_BYTES) throw new ContentError(-1);
  const blob = await res.blob();
  if (blob.size > MAX_FILE_BYTES) throw new ContentError(-1);
  return blob;
}
