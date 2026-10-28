import { Injectable } from "@nestjs/common";
import { mediaObjectRoot } from "@workspace/saudisensei-runtime-config";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { ProcessingError, type ProcessingStorage } from "./processing.ports.js";
const unavailable = () => new ProcessingError("MEDIA_STORAGE_UNAVAILABLE");
// The namespace is environment-specific; legacy development keys stay unchanged.
export function processingKey(key: string) {
  if (!/^(?:pilot|production)\/library\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/(staging|source)$/.test(key) ||
      !key.startsWith(`${mediaObjectRoot()}/library/`)) throw unavailable();
  return key;
}
@Injectable()
export class ProcessingS3Store implements ProcessingStorage {
  private client?: S3Client;
  private config() {
    try {
      const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket,
        S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
      if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) throw unavailable();
      const u = new URL(endpoint);
      if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
          !/^[a-z0-9.-]{3,63}$/.test(bucket)) throw unavailable();
      this.client ??= new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
        maxAttempts: 2, requestHandler: { connectionTimeout: 3000, requestTimeout: 30000 } });
      return { client: this.client, bucket };
    } catch { throw unavailable(); }
  }
  private async safe<T>(f: () => Promise<T>): Promise<T> { try { return await f(); } catch { throw unavailable(); } }
  async upload(key: string, bytes: number, mime: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: processingKey(key),
        ContentLength: bytes, ContentType: mime, ServerSideEncryption: "AES256" }), { expiresIn: 120 });
    });
  }
  async initiate(key: string, mime: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: processingKey(key),
        ContentType: mime, ServerSideEncryption: "AES256" }));
      if (!r.UploadId) throw unavailable();
      return r.UploadId;
    });
  }
  async part(key: string, ref: string, number: number, bytes: number) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      return getSignedUrl(client, new UploadPartCommand({ Bucket: bucket, Key: processingKey(key),
        UploadId: ref, PartNumber: number, ContentLength: bytes }), { expiresIn: 120 });
    });
  }
  async complete(key: string, ref: string, bytes: number, parts: { partNumber: number; etag: string }[]) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new ListPartsCommand({ Bucket: bucket, Key: processingKey(key), UploadId: ref, MaxParts: 300 }));
      if (r.IsTruncated || !r.Parts || r.Parts.length !== parts.length ||
          r.Parts.reduce((s, p) => s + (p.Size ?? 0), 0) !== bytes ||
          r.Parts.some((p, i) => p.PartNumber !== i + 1 || p.PartNumber !== parts[i]?.partNumber || p.ETag !== parts[i]?.etag ||
            (i < parts.length - 1 && (p.Size ?? 0) < 5 * 1024 * 1024))) throw unavailable();
      await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: processingKey(key), UploadId: ref,
        MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) } }));
    });
  }
  async head(key: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: processingKey(key) }));
      if (!r.ContentLength || !r.ETag || !r.ContentType || r.ServerSideEncryption !== "AES256") throw unavailable();
      return { bytes: r.ContentLength, etag: r.ETag, mime: r.ContentType };
    });
  }
  async commit(staging: string, source: string, etag: string, mime: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      await client.send(new CopyObjectCommand({ Bucket: bucket, Key: processingKey(source),
        CopySource: `${bucket}/${processingKey(staging)}`, CopySourceIfMatch: etag,
        ContentType: mime, MetadataDirective: "REPLACE", ServerSideEncryption: "AES256" }));
    });
  }
  async stream(key: string, etag: string, signal: AbortSignal) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: processingKey(key), IfMatch: etag }), { abortSignal: signal });
      if (!r.Body || !("pipe" in r.Body)) throw unavailable();
      return r.Body as Readable;
    });
  }
  async sourceAccess(key: string) {
    return this.safe(async () => {
      const { client, bucket } = this.config();
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: processingKey(key) }), { expiresIn: 120 });
    });
  }
}
