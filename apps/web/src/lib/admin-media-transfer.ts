"use client";
import type { ProcessingPart, ProcessingStatus, ProcessingUpload, RenditionAccess } from "@workspace/saudisensei-api-client";
import { lms } from "./lms-client";
const failed = () => new Error("MEDIA_TRANSFER_FAILED");
const formats: Record<string, { mimeType: string; kind: "document" | "image" | "video"; max: number }> = {
  pdf: { mimeType: "application/pdf", kind: "document", max: 100 * 1024 * 1024 },
  txt: { mimeType: "text/plain", kind: "document", max: 100 * 1024 * 1024 },
  jpg: { mimeType: "image/jpeg", kind: "image", max: 20 * 1024 * 1024 },
  jpeg: { mimeType: "image/jpeg", kind: "image", max: 20 * 1024 * 1024 },
  png: { mimeType: "image/png", kind: "image", max: 20 * 1024 * 1024 },
  webp: { mimeType: "image/webp", kind: "image", max: 20 * 1024 * 1024 },
  mp4: { mimeType: "video/mp4", kind: "video", max: 2147483648 },
  mov: { mimeType: "video/quicktime", kind: "video", max: 2147483648 },
  webm: { mimeType: "video/webm", kind: "video", max: 2147483648 },
};
export function mediaFileMetadata(file: Pick<File, "name" | "size" | "type">) {
  const format = formats[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!format || file.size < 1 || file.size > format.max || /[\\/\u0000-\u001f\u007f]/.test(file.name) ||
      file.name.length > 255 || (file.type && file.type !== "application/octet-stream" && file.type !== format.mimeType)) throw failed();
  return { filename: file.name, bytes: file.size, mimeType: format.mimeType, kind: format.kind };
}
function uploadTarget(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.hash || (u.port && u.port !== "443")) throw 0;
    return u.toString();
  } catch { throw failed(); }
}
function put(url: string, body: Blob, headers: Record<string, string>, progress: (bytes: number) => void, signal?: AbortSignal) {
  return new Promise<string | null>((resolve, reject) => {
    if (signal?.aborted) { reject(failed()); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const clean = () => signal?.removeEventListener("abort", abort);
    xhr.open("PUT", uploadTarget(url));
    xhr.withCredentials = false; xhr.timeout = 300000;
    for (const [name, value] of Object.entries(headers)) {
      if (!["content-type", "x-amz-server-side-encryption"].includes(name.toLowerCase())) { reject(failed()); return; }
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = event => progress(event.loaded);
    xhr.onload = () => { clean(); xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.getResponseHeader("ETag")) : reject(failed()); };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => { clean(); reject(failed()); };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}
export async function uploadMediaFile(root: string, revisionId: string, file: File,
  onProgress: (percent: number) => void, signal?: AbortSignal) {
  mediaFileMetadata(file);
  const base = `${root}/revisions/${revisionId}/processing`;
  const check = await lms<ProcessingStatus>(base);
  if (!check.ok || signal?.aborted) throw failed();
  if (["quarantined", "processing", "ready"].includes(check.data.revisionState)) { onProgress(100); return; }
  if (check.data.revisionState !== "pending") throw failed();
  const issued = await lms<ProcessingUpload>(`${base}/upload`, { method: "POST",
    body: { method: file.size <= 8388608 ? "single" : "multipart" } });
  if (!issued.ok || signal?.aborted) throw failed();
  const parts: { partNumber: number; etag: string }[] = [];
  if (issued.data.method === "single") {
    if (!issued.data.uploadUrl) throw failed();
    await put(issued.data.uploadUrl, file, issued.data.headers, bytes => onProgress(Math.min(95, bytes / file.size * 95)), signal);
  } else {
    if (issued.data.partSize !== 8388608) throw failed();
    for (let offset = 0, partNumber = 1; offset < file.size; offset += issued.data.partSize, partNumber++) {
      if (signal?.aborted) throw failed();
      const part = await lms<ProcessingPart>(`${base}/parts`, { method: "POST", body: { partNumber } });
      const bytes = Math.min(issued.data.partSize, file.size - offset);
      if (!part.ok || part.data.bytes !== bytes) throw failed();
      const etag = await put(part.data.uploadUrl, file.slice(offset, offset + bytes), {},
        sent => onProgress(Math.min(95, (offset + sent) / file.size * 95)), signal);
      if (!etag) throw failed();
      parts.push({ partNumber, etag });
    }
  }
  if (signal?.aborted) throw failed();
  const completed = await lms(`${base}/complete`, { method: "POST", body: parts.length ? { parts } : {} });
  if (!completed.ok) throw failed();
  onProgress(100);
}
export function privatePreviewPath(url: string) {
  if (!/^\/lms-api\/admin\/(courses|chapters|lessons)\/[a-f0-9-]{36}\/media-library\/placements\/[a-f0-9-]{36}\/content$/.test(url)) throw failed();
  return url;
}
export async function fetchMediaPreview(access: RenditionAccess, signal?: AbortSignal): Promise<Blob> {
  if (Date.parse(access.expiresAt) <= Date.now() || !/^[A-Za-z0-9_-]{40,2048}$/.test(access.capability)) throw failed();
  const response = await fetch(privatePreviewPath(access.url), {
    headers: { "X-Media-Capability": access.capability }, credentials: "same-origin",
    cache: "no-store", redirect: "error", signal,
  });
  if (!response.ok || response.headers.get("content-type") !== access.contentType) throw failed();
  const value = await response.blob();
  if (value.size > 100 * 1024 * 1024) throw failed();
  return value;
}
