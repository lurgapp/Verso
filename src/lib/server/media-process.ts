import { spawn } from "node:child_process";
import { HttpError } from "./http";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
export const MAX_ANIMATION_FRAMES = 240;
export const MAX_ANIMATION_PIXELS = 24_000_000;
export const MAX_ANIMATION_FRAME_PIXELS = 4_000_000;
export const MAX_ANIMATION_DURATION_MS = 30_000;
let activeConversions = 0;
let activeUploads = 0;

// Admission starts before reading multipart bytes and lasts through storage/DB
// completion, so native decode and slow S3 requests cannot accumulate buffers.
export async function withMediaUpload<T>(work: () => Promise<T>): Promise<T> {
  if (activeUploads) throw new HttpError(503, "UNAVAILABLE", "Media processing is busy. Please try again in a moment.", { "Retry-After": "3" });
  activeUploads++;
  try { return await work(); } finally { activeUploads--; }
}

// One process-wide slot bounds the combined native Sharp/FFmpeg memory footprint
// in the 768 MiB app container; excess work is rejected rather than queued.
export async function withMediaConversion<T>(work: () => Promise<T>): Promise<T> {
  if (activeConversions) throw new HttpError(503, "UNAVAILABLE", "Media processing is busy. Please try again in a moment.", { "Retry-After": "3" });
  activeConversions++;
  try { return await work(); } finally { activeConversions--; }
}

export function mediaLimit(message: string): never { throw new HttpError(413, "PAYLOAD_TOO_LARGE", message); }
export function invalidMedia(message = "This file could not be decoded as safe media."): never { throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", message); }

/** No shell, no network protocols, bounded pipe output, CPU/allocation flags and
 * a hard wall-clock kill. Never return decoder diagnostics or temporary paths. */
export async function runMediaTool(tool: "ffmpeg" | "ffprobe", args: string[], maximumOutput = 1024 * 1024, timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, ["-hide_banner", "-loglevel", "error", "-max_alloc", "67108864", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", AV_LOG_FORCE_NOCOLOR: "1" } });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: HttpError | undefined;
    const stop = (error: HttpError) => { failure ??= error; child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop(new HttpError(422, "MEDIA_PROCESSING_TIMEOUT", "This media takes too long to process. Try a smaller file.")), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximumOutput) stop(new HttpError(413, "PAYLOAD_TOO_LARGE", "The decoded media exceeds the processing limit."));
      else chunks.push(chunk);
    });
    // Always drain stderr, but never accumulate attacker-controlled diagnostics.
    child.stderr.on("data", () => undefined);
    child.once("error", () => { failure ??= new HttpError(503, "UNAVAILABLE", "Media processing is temporarily unavailable."); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "This file could not be decoded as safe media."));
      else resolve(Buffer.concat(chunks));
    });
  });
}
