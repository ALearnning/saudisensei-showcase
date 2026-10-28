import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  ListPartsCommand, AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_PILOT_BYTES } from "./media.schemas.js";

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");
export interface MediaStorage {
  upload(key: string, bytes: number, seconds: number): Promise<string>;
  initiate(key: string): Promise<string>;
  part(key: string, uploadId: string, number: number, bytes: number, seconds: number): Promise<string>;
  complete(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abort(key: string, uploadId: string): Promise<void>;
  head(key: string): Promise<{ bytes: number; etag: string }>;
  commit(staging: string, destination: string, etag: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  preview(key: string, bytes: Buffer): Promise<void>;
  access(key: string, mode: "preview" | "download", expiresAt: number): Promise<string>;
}
@Injectable()
export class S3MediaStore implements MediaStorage {
  private client?: S3Client;
  private config() {
    // Legacy pilot fixtures must never resolve through production storage.
    if (process.env.NODE_ENV === "production") throw new ServiceUnavailableException("MEDIA_STORAGE_UNAVAILABLE");
    const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket,
      S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
    if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) throw new ServiceUnavailableException("MEDIA_STORAGE_UNAVAILABLE");
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
      bucket !== "saudisensei-dev-media-pilot-2026" || region !== "eu-north-1" ||
      u.hostname !== "s3.eu-north-1.amazonaws.com") throw new ServiceUnavailableException("MEDIA_STORAGE_UNAVAILABLE");
    this.client ??= new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 2, requestHandler: { connectionTimeout: 3000, requestTimeout: 8000 } });
    return { client: this.client, bucket };
  }
  private key(key: string) {
    if (!/^pilot\/media\/[a-f0-9/-]+\/(?:source|staging|preview)\.txt$/.test(key)) throw new ServiceUnavailableException("MEDIA_STORAGE_UNAVAILABLE");
    return key;
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch { throw new ServiceUnavailableException("MEDIA_STORAGE_UNAVAILABLE"); }
  }
  async upload(key: string, bytes: number, seconds: number) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: this.key(key),
        ContentLength: bytes, ContentType: "text/plain" }), { expiresIn: seconds });
    });
  }
  async initiate(key: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: this.key(key),
        ContentType: "text/plain", ServerSideEncryption: "AES256" }));
      if (!r.UploadId) throw new Error("MISSING_UPLOAD");
      return r.UploadId;
    });
  }
  async part(key: string, uploadId: string, number: number, bytes: number, seconds: number) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      return getSignedUrl(client, new UploadPartCommand({
        Bucket: bucket, Key: this.key(key), UploadId: uploadId, PartNumber: number, ContentLength: bytes,
      }), { expiresIn: seconds });
    });
  }
  async complete(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const found = await client.send(new ListPartsCommand({ Bucket: bucket, Key: this.key(key), UploadId: uploadId }));
      if (found.IsTruncated || !found.Parts || found.Parts.length !== parts.length ||
        found.Parts.reduce((sum, part) => sum + (part.Size ?? 0), 0) > MAX_PILOT_BYTES ||
        found.Parts.some((part, i) => part.PartNumber !== parts[i]?.partNumber || part.ETag !== parts[i]?.etag)) {
        throw new Error("PARTS_INVALID");
      }
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: bucket, Key: this.key(key), UploadId: uploadId,
        MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) },
      }));
    });
  }
  async abort(key: string, uploadId: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: this.key(key), UploadId: uploadId }));
    });
  }
  async head(key: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: this.key(key) }));
      if (!r.ETag || !r.ContentLength || r.ServerSideEncryption !== "AES256") throw new Error("METADATA_INVALID");
      return { bytes: r.ContentLength, etag: r.ETag };
    });
  }
  async commit(staging: string, destination: string, etag: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      // Browser capabilities address only staging. Never sign writes to committed keys.
      await client.send(new CopyObjectCommand({ Bucket: bucket, Key: this.key(destination),
        CopySource: `${bucket}/${this.key(staging)}`, CopySourceIfMatch: etag,
        ServerSideEncryption: "AES256", ContentType: "text/plain", MetadataDirective: "REPLACE" }));
    });
  }
  async read(key: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: this.key(key) }));
      if (!r.Body || !r.ContentLength || r.ContentLength > MAX_PILOT_BYTES) throw new Error("BODY_INVALID");
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > MAX_PILOT_BYTES) {
          (r.Body as { destroy?: () => void }).destroy?.();
          throw new Error("BODY_TOO_LARGE");
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    });
  }
  async preview(key: string, bytes: Buffer) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: this.key(key), Body: bytes,
        ContentType: "text/plain; charset=utf-8", ServerSideEncryption: "AES256", IfNoneMatch: "*" }));
    });
  }
  async access(key: string, mode: "preview" | "download", expiresAt: number) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const signingDate = new Date();
      const seconds = expiresAt - Math.floor(signingDate.getTime() / 1000);
      if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 120) throw new Error("ACCESS_EXPIRED");
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: this.key(key),
        ResponseContentType: "text/plain; charset=utf-8",
        ResponseContentDisposition: mode === "preview" ? "inline" : 'attachment; filename="lesson-material.txt"',
        ResponseCacheControl: "private, no-store",
      }), { expiresIn: seconds, signingDate });
    });
  }
}
