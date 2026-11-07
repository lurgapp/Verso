import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { HttpError } from "./http";
import { invalidMedia, mediaLimit, MAX_VIDEO_BYTES, runMediaTool, withMediaConversion } from "./media-process";

export const MAX_VIDEO_DURATION_MS = 60_000;
export const MAX_VIDEO_FRAMES = 3600;
export const MAX_VIDEO_FRAME_PIXELS = 8_294_400;
export const MAX_VIDEO_DECODED_PIXELS = 4_000_000_000;
export type ProcessedVideo = { bytes: Buffer; poster: Buffer; width: number; height: number; durationMs: number; frames: number; animated: false };
type ProbeStream = { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; nb_frames?: string; channels?: number; sample_rate?: string };
type Probe = { streams?: ProbeStream[]; format?: { format_name?: string; duration?: string }; frames?: { best_effort_timestamp_time?: string; pkt_duration_time?: string; width?: number; height?: number }[] };

export function isVideoBytes(bytes: Uint8Array): boolean {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length >= 12 && data.toString("ascii", 4, 8) === "ftyp") {
    // AVIF/HEIF use ISO-BMFF too; retain the existing still-image decoder path.
    return !["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(data.toString("ascii", 8, 12));
  }
  return data.length >= 4 && data.readUInt32BE(0) === 0x1a45dfa3;
}
function dimensions(width: unknown, height: unknown): asserts width is number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || (width as number) < 2 || (height as number) < 2 || (width as number) > 4096 || (height as number) > 4096 || (width as number) * (height as number) > MAX_VIDEO_FRAME_PIXELS) mediaLimit("Video resolution must not exceed 4096 pixels per side or 8.3 million pixels per frame.");
}
function jsonProbe(bytes: Buffer): Probe {
  try { return JSON.parse(bytes.toString("utf8")) as Probe; } catch { return invalidMedia(); }
}

export async function processVideo(bytes: Uint8Array): Promise<ProcessedVideo> {
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) mediaLimit("Videos must be no larger than 32 MB.");
  if (!isVideoBytes(bytes)) invalidMedia("Upload a valid MP4 or WebM video.");
  return withMediaConversion(async () => {
    const directory = await mkdtemp(join(tmpdir(), "verso-video-"));
    try {
      const input = join(directory, "input");
      const output = join(directory, "video.mp4");
      const posterPath = join(directory, "poster.png");
      await writeFile(input, bytes, { mode: 0o600 });
      const inputArgs = ["-threads", "1", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm", "-probesize", String(MAX_VIDEO_BYTES), "-analyzeduration", "2000000"];
      const header = jsonProbe(await runMediaTool("ffprobe", [...inputArgs, "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,channels,sample_rate:format=format_name,duration", "-of", "json", input], 128 * 1024, 10_000));
      const streams = header.streams ?? [];
      const videos = streams.filter((value) => value.codec_type === "video");
      const audio = streams.filter((value) => value.codec_type === "audio");
      // Streaming WebM (including MediaRecorder captures) can legitimately omit
      // container duration; actual decoded timestamps remain authoritative.
      const durationMs = header.format?.duration === undefined ? undefined : Math.round(Number(header.format.duration) * 1000);
      if (videos.length !== 1 || audio.length > 1 || streams.length !== videos.length + audio.length || !["h264", "hevc", "vp8", "vp9", "av1"].includes(videos[0]?.codec_name ?? "")) invalidMedia("Use an MP4 or WebM with one H.264, HEVC, VP8, VP9 or AV1 video stream.");
      if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_VIDEO_DURATION_MS)) mediaLimit("Videos must last at most 60 seconds.");
      const source = videos[0];
      dimensions(source.width, source.height);
      const [numerator, denominator] = (source.avg_frame_rate ?? "0/1").split("/").map(Number);
      const fps = numerator / denominator;
      if (!Number.isFinite(fps) || fps <= 0 || fps > 60) mediaLimit("Videos must contain at most 60 frames per second.");
      // Reject obviously excessive work from the header before asking FFprobe
      // to decode frames; verify the actual stream again below.
      const declaredFrames = source.nb_frames !== undefined ? Number(source.nb_frames) : durationMs === undefined ? undefined : Math.ceil(durationMs / 1000 * fps);
      if (declaredFrames !== undefined && (!Number.isSafeInteger(declaredFrames) || declaredFrames < 1 || declaredFrames > MAX_VIDEO_FRAMES || source.width! * source.height! * declaredFrames > MAX_VIDEO_DECODED_PIXELS)) mediaLimit("This video requires too much decoding. Reduce its resolution, frame rate or duration.");
      if (audio.some((value) => !["aac", "opus", "vorbis", "mp3", "flac", "pcm_s16le", "pcm_s24le"].includes(value.codec_name ?? "") || !value.channels || value.channels > 2 || (!Number.isFinite(Number(value.sample_rate)) || Number(value.sample_rate) < 1 || Number(value.sample_rate) > 96_000))) invalidMedia("Use a video with mono or stereo audio at at most 96 kHz.");
      // Inspect actual decoded frame geometry and timestamps, not just container
      // claims. This also rejects malformed/truncated input before publication.
      const decoded = jsonProbe(await runMediaTool("ffprobe", [...inputArgs, "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time,width,height", "-of", "json", input], 1024 * 1024, 30_000));
      const frames = decoded.frames ?? [];
      if (!frames.length || frames.length > MAX_VIDEO_FRAMES) mediaLimit("This video contains too many frames.");
      let totalPixels = 0, previousTime = -1, decodedEnd = 0;
      for (const frame of frames) {
        dimensions(frame.width, frame.height);
        totalPixels += frame.width! * frame.height!;
        const time = Number(frame.best_effort_timestamp_time);
        const frameDuration = Math.max(0, Number(frame.pkt_duration_time) || 0);
        if (!Number.isFinite(time) || time < 0 || time < previousTime || time + frameDuration > 60.05) mediaLimit("This video has an invalid timeline or lasts longer than 60 seconds.");
        previousTime = time;
        decodedEnd = Math.max(decodedEnd, time + frameDuration);
      }
      if (totalPixels > MAX_VIDEO_DECODED_PIXELS) mediaLimit("This video requires too much decoding. Reduce its resolution, frame rate or duration.");
      if (decodedEnd < 0.01) invalidMedia("This video has no playable frames.");
      await runMediaTool("ffmpeg", ["-nostdin", "-xerror", "-threads", "1", "-filter_threads", "1", "-timelimit", "50", ...inputArgs.slice(2), "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn", "-t", String(Math.min(60, decodedEnd)), "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-r", "30", "-frames:v", "1801", "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-maxrate", "4M", "-bufsize", "8M", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000", "-movflags", "+faststart", "-fs", String(MAX_VIDEO_BYTES + 1), "-y", output], 64 * 1024, 55_000);
      const outputSize = (await stat(output)).size;
      if (!outputSize || outputSize > MAX_VIDEO_BYTES) mediaLimit("The processed video exceeds 32 MB.");
      await runMediaTool("ffmpeg", ["-nostdin", "-threads", "1", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", "-i", output, "-frames:v", "1", "-an", "-sn", "-dn", "-map_metadata", "-1", "-y", posterPath], 64 * 1024, 10_000);
      const poster = await sharp(await readFile(posterPath), { limitInputPixels: 2_000_000 }).webp({ quality: 84 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
      return { bytes: await readFile(output), poster: poster.data, width: poster.info.width, height: poster.info.height, durationMs: Math.min(durationMs ?? MAX_VIDEO_DURATION_MS, Math.round(decodedEnd * 1000)), frames: frames.length, animated: false };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      invalidMedia("This file could not be decoded as a safe video.");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
