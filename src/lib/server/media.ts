import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "./db";
import { HttpError } from "./http";
import { processImage } from "./media-image";
import { isVideoBytes, processVideo } from "./media-video";
export { processImage } from "./media-image";
export { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "./media-process";

let storageClient: S3Client | undefined;
function storage(): { client: S3Client; bucket: string } {
  const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) throw new Error("Media storage is not configured.");
  storageClient ??= new S3Client({ endpoint: S3_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: true, credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 15000, throwOnRequestTimeout: true, httpAgent: { maxSockets: 10 } } });
  return { client: storageClient, bucket: S3_BUCKET };
}
export type UploadedMedia = { url: string; kind: "image" | "video"; animated: boolean; posterUrl?: string; thumbnailUrl?: string; thumbnailWidth?: number; width: number; height: number; frames: number; durationMs?: number };

export async function uploadMedia(bytes: Uint8Array, imageOnly = false): Promise<UploadedMedia> {
  // Detection uses container bytes; a filename or multipart MIME declaration
  // never decides which decoders are allowed or what readers receive.
  const kind = !imageOnly && isVideoBytes(bytes) ? "video" : "image";
  const processed = kind === "video" ? await processVideo(bytes) : await processImage(bytes);
  const id = randomBytes(24).toString("base64url");
  const objectKey = `${id}.${kind === "video" ? "mp4" : "webp"}`;
  const posterId = processed.poster ? randomBytes(24).toString("base64url") : undefined;
  const posterKey = posterId ? `${posterId}.webp` : undefined;
  const thumbnail = await sharp(processed.poster ?? processed.bytes, { limitInputPixels: 40_000_000 }).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 76, effort: 2 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
  const thumbnailId = randomBytes(24).toString("base64url");
  const thumbnailKey = `${thumbnailId}.webp`;
  const mimeType = kind === "video" ? "video/mp4" : "image/webp";
  const { client, bucket } = storage();
  const uploaded: string[] = [];
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: processed.bytes, ContentType: mimeType, CacheControl: "public, max-age=31536000, immutable" }));
    uploaded.push(objectKey);
    if (posterKey && processed.poster) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: posterKey, Body: processed.poster, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
      uploaded.push(posterKey);
    }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbnailKey, Body: thumbnail.data, ContentType: "image/webp", CacheControl: "public, max-age=31536000, immutable" }));
    uploaded.push(thumbnailKey);
    await db.media.createMany({ data: [
      { id, objectKey, mimeType, bytes: processed.bytes.length, width: processed.width, height: processed.height, animated: processed.animated, frames: processed.frames, durationMs: processed.durationMs, posterKey, thumbnailKey },
      { id: thumbnailId, objectKey: thumbnailKey, mimeType: "image/webp", bytes: thumbnail.data.length, width: thumbnail.info.width, height: thumbnail.info.height, animated: false, frames: 1 },
      ...(posterKey && posterId && processed.poster ? [{ id: posterId, objectKey: posterKey, mimeType: "image/webp", bytes: processed.poster.length, width: processed.width, height: processed.height, animated: false, frames: 1 }] : []),
    ] });
  } catch (error) {
    await Promise.all(uploaded.map((key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)));
    throw error;
  }
  return { url: `/api/v1/media/${objectKey}`, kind, animated: processed.animated, thumbnailUrl: `/api/v1/media/${thumbnailKey}`, thumbnailWidth: thumbnail.info.width, ...(posterKey ? { posterUrl: `/api/v1/media/${posterKey}` } : {}), width: processed.width, height: processed.height, frames: processed.frames, ...(processed.durationMs ? { durationMs: processed.durationMs } : {}) };
}

// Compatibility for existing integrations which expect only a relative URL.
export async function uploadImage(bytes: Uint8Array): Promise<string> { return (await uploadMedia(bytes, true)).url; }

export function parseMediaRange(value: string, size: number): { start: number; end: number } {
  const match = value.length <= 128 ? /^bytes=(\d*)-(\d*)$/u.exec(value) : null;
  const invalid = () => new HttpError(416, "RANGE_NOT_SATISFIABLE", "This byte range is not available.", { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) throw invalid();
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalid(); start = Math.max(0, size - suffix); end = size - 1; }
  else {
    start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(requestedEnd)) throw invalid();
    end = Math.min(requestedEnd, size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw invalid();
  return { start, end };
}

export async function imageResponse(request: Request, key: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{32}\.(?:webp|mp4)$/u.test(key)) throw new HttpError(404, "NOT_FOUND", "This media could not be found.");
  const record = await db.media.findUnique({ where: { objectKey: key } });
  if (!record || (key.endsWith(".mp4") ? record.mimeType !== "video/mp4" : record.mimeType !== "image/webp")) throw new HttpError(404, "NOT_FOUND", "This media could not be found.");
  const headers: Record<string, string> = { "Content-Type": record.mimeType, "Content-Length": String(record.bytes), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${key}"`, ETag: `"${record.id}"`, "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "bytes" };
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
  const requestedRange = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const range = requestedRange && (!ifRange || ifRange === headers.ETag) ? parseMediaRange(requestedRange, record.bytes) : undefined;
  if (range) { headers["Content-Range"] = `bytes ${range.start}-${range.end}/${record.bytes}`; headers["Content-Length"] = String(range.end - range.start + 1); }
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const { client, bucket } = storage();
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
  if (!object.Body) throw new HttpError(404, "NOT_FOUND", "This media could not be found.");
  return new Response(object.Body.transformToWebStream(), { status: range ? 206 : 200, headers });
}
