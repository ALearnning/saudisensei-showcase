/**
 * Portable pilot contracts only. No production provider is selected or mounted.
 * Locators are internal; public DTOs must never expose these structures.
 */
export interface ObjectLocator {
  store: string;
  key: string;
  version?: string;
}

export interface PrivateObjectStore {
  beginUpload(input: {
    locator: ObjectLocator; maximumBytes: number; contentType: string; expiresAt: number;
  }): Promise<{ sessionRef: string; uploadUrl: string }>;
  authorizePart(input: {
    sessionRef: string; partNumber: number; expiresAt: number;
  }): Promise<{ uploadUrl: string }>;
  completeUpload(input: {
    sessionRef: string; parts: ReadonlyArray<{ partNumber: number; etag: string }>;
  }): Promise<void>;
  inspect(locator: ObjectLocator): Promise<{
    bytes: number; contentType: string; checksum?: string;
  }>;
  abortUpload(sessionRef: string): Promise<void>;
  // Intentionally no deleteCommittedMedia operation in the Phase 1C contract.
}

export interface PrivateVideoProvider {
  ingest(input: {
    source: ObjectLocator; idempotencyKey: string; requirePrivatePlayback: true;
  }): Promise<{ providerRef: string }>;
  inspect(providerRef: string): Promise<{
    state: "processing" | "ready" | "failed"; privatePlayback: boolean; duration?: number;
  }>;
  verifyWebhook(input: {
    rawBody: Uint8Array; signature: string; receivedAt: number;
  }): Promise<{ eventRef: string; providerRef: string }>;
}

export type MediaAccessMode = "preview" | "download" | "playback";
export interface DeliveryResource {
  revisionRef: string;
  kind: "converted-preview" | "original" | "stream";
  private: boolean;
  locator: ObjectLocator;
}
export interface MediaCapability {
  url: string;
  expiresAt: number; // Unix seconds, not milliseconds.
  revisionRef: string;
}
export interface PrivateMediaSigner {
  readonly allowedDeliveryHosts: ReadonlySet<string>;
  sign(input: {
    mode: MediaAccessMode; resource: DeliveryResource; expiresAt: number;
  }): Promise<MediaCapability>;
}
