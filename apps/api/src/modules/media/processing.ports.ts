import type { Readable } from "node:stream";
export class ProcessingError extends Error {
  constructor(readonly code: string, readonly retryable = true) { super(code); }
}
export const PROCESSING_STORAGE = Symbol("PROCESSING_STORAGE");
export interface ProcessingStorage {
  upload(key: string, bytes: number, mime: string): Promise<string>;
  initiate(key: string, mime: string): Promise<string>;
  part(key: string, ref: string, number: number, bytes: number): Promise<string>;
  complete(key: string, ref: string, bytes: number, parts: { partNumber: number; etag: string }[]): Promise<void>;
  head(key: string): Promise<{ bytes: number; etag: string; mime: string }>;
  commit(staging: string, source: string, etag: string, mime: string): Promise<void>;
  stream(key: string, etag: string, signal: AbortSignal): Promise<Readable>;
  sourceAccess(key: string): Promise<string>;
}
export const PROCESSING_SCANNER = Symbol("PROCESSING_SCANNER");
export interface ProcessingScanner {
  scanFile(path: string, bytes: number, signal: AbortSignal): Promise<{ clean: boolean; engine: string }>;
}
export const PROCESSING_VIDEO = Symbol("PROCESSING_VIDEO");
export interface ProcessingVideo {
  ingest(sourceUrl: string, revisionId: string, signal: AbortSignal): Promise<string>;
  inspect(reference: string, signal: AbortSignal): Promise<{
    ready: boolean; failed: boolean; privatePlayback: boolean; downloadsDisabled: boolean;
    originsMatch: boolean; duration: number; playbackHost: string | null;
  }>;
}
// No callable converter until the isolation/security gate is independently met.
export const OFFICE_PROCESSING_ERROR = "OFFICE_ISOLATION_REQUIRED";
export function safeProcessingError(error: unknown): ProcessingError {
  const known = new Set([
    "MEDIA_STORAGE_UNAVAILABLE", "SCANNER_UNAVAILABLE", "SCANNER_STALE", "SCANNER_TIMEOUT",
    "MALWARE_REJECTED", "SOURCE_INVALID", "CONTENT_TYPE_MISMATCH", "TEXT_INVALID",
    "VIDEO_PROVIDER_UNAVAILABLE", "VIDEO_PROVIDER_FAILED", "VIDEO_NOT_PRIVATE",
    "VIDEO_DURATION_INVALID", "INGEST_OUTCOME_UNKNOWN", "JOB_TIMEOUT", "WORKER_INTERRUPTED",
    "OFFICE_ISOLATION_REQUIRED", "PREVIEW_PROCESSOR_REQUIRED", "PARENT_READ_ONLY", "LEASE_LOST",
    "DOCUMENT_INVALID", "DOCUMENT_LIMIT", "PDF_ACTIVE_CONTENT",
  ]);
  return error instanceof ProcessingError && known.has(error.code)
    ? error : new ProcessingError("PROCESSING_UNAVAILABLE");
}
