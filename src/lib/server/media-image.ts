import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { HttpError } from "./http";
import { invalidMedia, mediaLimit, MAX_IMAGE_BYTES, MAX_ANIMATION_FRAMES, MAX_ANIMATION_PIXELS, MAX_ANIMATION_FRAME_PIXELS, MAX_ANIMATION_DURATION_MS, runMediaTool, withMediaConversion } from "./media-process";

export type ProcessedImage = { bytes: Buffer; width: number; height: number; animated: boolean; frames: number; durationMs?: number; poster?: Buffer };
type Apng = { width: number; height: number; frames: number; delay: number[]; loop: number };

function knownImageContainer(bytes: Buffer): boolean {
  return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
    || (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    || (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(bytes.toString("ascii", 8, 12)));
}

function animationLimits(width: number, height: number, frames: number, delay: number[]): void {
  if (!Number.isSafeInteger(frames) || frames < 2 || frames > MAX_ANIMATION_FRAMES) mediaLimit(`Animations must contain between 2 and ${MAX_ANIMATION_FRAMES} frames.`);
  if (width * height > MAX_ANIMATION_FRAME_PIXELS || width * height * frames > MAX_ANIMATION_PIXELS) mediaLimit("This animation has too many decoded pixels. Reduce its resolution or number of frames.");
  if (delay.length !== frames) invalidMedia("This animation has inconsistent frame metadata.");
  if (delay.some((value) => !Number.isFinite(value) || value < 10 || value > 10_000) || delay.reduce((sum, value) => sum + value, 0) > MAX_ANIMATION_DURATION_MS) mediaLimit("Animations must last at most 30 seconds, with a frame delay of at least 10 ms.");
}

// libvips' PNG loader can expose only APNG's default frame. Parse animation
// control before handing PNG to Sharp, so animation can never silently flatten.
function readApng(bytes: Buffer): Apng | undefined {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
  let offset = 8;
  let width = 0, height = 0, frames = 0, loop = 0;
  let ended = false;
  const delay: number[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalidMedia("This PNG is truncated.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    if (type === "IHDR" && length === 13) { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "acTL") {
      if (length !== 8 || frames) invalidMedia("This APNG has invalid animation metadata.");
      frames = data.readUInt32BE(0); loop = data.readUInt32BE(4);
      if (!width || !height || frames < 2) invalidMedia("This APNG has invalid animation metadata.");
      if (frames > MAX_ANIMATION_FRAMES || width * height > MAX_ANIMATION_FRAME_PIXELS || width * height * frames > MAX_ANIMATION_PIXELS) mediaLimit("This animation has too many frames or decoded pixels.");
    }
    if (type === "fcTL" && frames) {
      if (length !== 26) invalidMedia("This APNG has invalid frame metadata.");
      const frameWidth = data.readUInt32BE(4), frameHeight = data.readUInt32BE(8);
      if (!frameWidth || !frameHeight || data.readUInt32BE(12) + frameWidth > width || data.readUInt32BE(16) + frameHeight > height) invalidMedia("This APNG has invalid frame dimensions.");
      delay.push(Math.round(1000 * data.readUInt16BE(20) / (data.readUInt16BE(22) || 100)));
    }
    offset = end;
    if (type === "IEND") {
      if (length !== 0) invalidMedia("This PNG has invalid end metadata.");
      ended = true;
      break;
    }
  }
  if (!frames) return;
  if (!ended) invalidMedia("This APNG is truncated.");
  animationLimits(width, height, frames, delay);
  return { width, height, frames, delay, loop };
}

async function apngToWebp(bytes: Buffer, meta: Apng): Promise<ProcessedImage> {
  const directory = await mkdtemp(join(tmpdir(), "verso-apng-"));
  try {
    const input = join(directory, "input.png");
    await writeFile(input, bytes, { mode: 0o600 });
    const expected = meta.width * meta.height * meta.frames * 4;
    const pixels = await runMediaTool("ffmpeg", ["-nostdin", "-xerror", "-threads", "1", "-filter_threads", "1", "-timelimit", "20", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-f", "apng", "-ignore_loop", "1", "-i", input, "-an", "-sn", "-dn", "-frames:v", String(meta.frames + 1), "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], expected + 1, 25_000);
    if (pixels.length !== expected) invalidMedia("This APNG contains an inconsistent number of frames.");
    const result = await sharp(pixels, { raw: { width: meta.width, height: meta.height * meta.frames, channels: 4, pageHeight: meta.height }, animated: true, limitInputPixels: MAX_ANIMATION_PIXELS }).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 3, loop: meta.loop, delay: meta.delay }).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
    const encoded = await sharp(result.data, { animated: true }).metadata();
    if ((encoded.pages ?? 1) !== meta.frames) invalidMedia("This animation could not be preserved.");
    if (result.data.length > MAX_IMAGE_BYTES) mediaLimit("The processed animation exceeds 8 MB.");
    const poster = await sharp(result.data).webp({ quality: 84 }).timeout({ seconds: 10 }).toBuffer();
    return { bytes: result.data, width: encoded.width!, height: encoded.pageHeight ?? encoded.height!, animated: true, frames: meta.frames, durationMs: meta.delay.reduce((a, b) => a + b, 0), poster };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) mediaLimit("Images must be no larger than 8 MB.");
  return withMediaConversion(async () => {
    try {
      const input = Buffer.from(bytes);
      // Do not invoke vector/document loaders at all for untrusted uploads.
      if (!knownImageContainer(input)) invalidMedia("Upload a valid JPEG, PNG, WebP, GIF or AVIF image.");
      const apng = readApng(input);
      if (apng) return await apngToWebp(input, apng);
      const metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" }).metadata();
      if (!metadata.format || !["jpeg", "png", "webp", "gif", "avif", "heif"].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) invalidMedia("Upload a valid JPEG, PNG, WebP, GIF or AVIF image.");
      const frames = metadata.pages ?? 1;
      const animated = frames > 1;
      const delay = metadata.delay ?? [];
      if (animated) {
        // Multi-page AVIF/HEIF sequences need a different decoder; explicitly
        // reject these rather than accidentally publishing a still picture.
        if (!["gif", "webp"].includes(metadata.format)) invalidMedia("Upload animations as GIF, animated WebP or APNG.");
        animationLimits(metadata.width, metadata.pageHeight ?? metadata.height, frames, delay);
      }
      const pipeline = sharp(input, { limitInputPixels: animated ? MAX_ANIMATION_PIXELS : 40_000_000, animated, failOn: "warning" });
      if (!animated) pipeline.rotate();
      const result = await pipeline.resize({ width: animated ? 1600 : 2400, height: animated ? 1600 : 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: animated ? 82 : 84, effort: 3, ...(animated ? { loop: metadata.loop ?? 0, delay } : {}) }).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
      if (result.data.length > MAX_IMAGE_BYTES) mediaLimit("The processed image exceeds 8 MB.");
      const encoded = await sharp(result.data, { animated: true }).metadata();
      if (animated && (encoded.pages ?? 1) !== frames) invalidMedia("This animation could not be preserved.");
      return { bytes: result.data, width: encoded.width!, height: encoded.pageHeight ?? encoded.height!, animated, frames, ...(animated ? { durationMs: delay.reduce((a, b) => a + b, 0), poster: await sharp(result.data).webp({ quality: 84 }).timeout({ seconds: 10 }).toBuffer() } : {}) };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      invalidMedia("This file could not be decoded as a safe image.");
    }
  });
}
