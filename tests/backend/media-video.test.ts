import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { processVideo, isVideoBytes } from "../../src/lib/server/media-video";
import { runMediaTool, withMediaConversion, withMediaUpload } from "../../src/lib/server/media-process";
import { processImage } from "../../src/lib/server/media-image";
import { HttpError } from "../../src/lib/server/http";

async function fixture(extension: "mp4" | "webm", seconds = "0.4", geometry = "64x48", rate = 10, live = false): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "verso-video-test-"));
  try {
    const output = join(directory, `fixture.${extension}`);
    await runMediaTool("ffmpeg", ["-nostdin", "-threads", "1", "-filter_threads", "1", "-f", "lavfi", "-i", `testsrc2=size=${geometry}:rate=${rate}`, "-t", seconds, "-an", "-c:v", extension === "mp4" ? "libx264" : "libvpx-vp9", "-threads", "1", "-pix_fmt", "yuv420p", "-map_metadata", "-1", ...(live ? ["-live", "1"] : []), "-y", output]);
    return await readFile(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
for (const format of ["mp4", "webm"] as const) test(`${format} uploads decode and become metadata-free MP4 plus a still poster`, async () => {
  const input = await fixture(format);
  assert.equal(isVideoBytes(input), true);
  const result = await processVideo(input);
  assert.equal(result.bytes.toString("ascii", 4, 8), "ftyp");
  assert.equal(result.width, 64); assert.equal(result.height, 48);
  assert.equal(result.frames, 4); assert.equal(result.durationMs, 400);
  assert.equal(result.animated, false);
  const poster = await sharp(result.poster).metadata();
  assert.equal(poster.format, "webp"); assert.equal(poster.pages ?? 1, 1);
  assert.equal(poster.exif, undefined); assert.equal(poster.xmp, undefined);
});
test("video upload rejects spoofed containers, malformed streams, oversized files and excessive duration", async () => {
  for (const bytes of [Buffer.from("<html>video.mp4</html>"), Buffer.from("0000ftypmalformed-container")]) await assert.rejects(() => processVideo(bytes), (error: unknown) => error instanceof HttpError && error.status === 415);
  await assert.rejects(() => processVideo(Buffer.alloc(32 * 1024 * 1024 + 1)), (error: unknown) => error instanceof HttpError && error.status === 413);
  const longVideo = await fixture("mp4", "60.1");
  await assert.rejects(() => processVideo(longVideo), (error: unknown) => error instanceof HttpError && error.status === 413);
});
test("native media conversions reject concurrent work instead of building an unbounded queue", async () => {
  let release!: () => void;
  const active = withMediaConversion(() => new Promise<void>((resolve) => { release = resolve; }));
  await assert.rejects(() => processVideo(Buffer.from("0000ftypmalformed-container")), (error: unknown) => error instanceof HttpError && error.status === 503 && error.headers["Retry-After"] === "3");
  release(); await active;
});


test("video preflight rejects excessive dimensions and frame rate", async () => {
  for (const input of [await fixture("mp4", "0.1", "4098x16"), await fixture("webm", "0.1", "64x48", 120)]) {
    await assert.rejects(() => processVideo(input), (error: unknown) => error instanceof HttpError && error.status === 413);
  }
});

test("native tool output and wall-clock time are bounded and external protocols are disabled", async () => {
  await assert.rejects(() => runMediaTool("ffmpeg", ["-nostdin", "-threads", "1", "-filter_threads", "1", "-f", "lavfi", "-i", "color=size=16x16:rate=30", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], 1, 1000), (error: unknown) => error instanceof HttpError && error.status === 413);
  await assert.rejects(() => runMediaTool("ffmpeg", ["-nostdin", "-threads", "1", "-f", "lavfi", "-i", "color=size=16x16:rate=30", "-f", "null", "-"], 1024, 25), (error: unknown) => error instanceof HttpError && error.code === "MEDIA_PROCESSING_TIMEOUT" && error.status === 422);
  await assert.rejects(() => runMediaTool("ffprobe", ["-protocol_whitelist", "file,pipe", "-i", "https://example.invalid/not-fetched.mp4"], 1024, 1000), (error: unknown) => error instanceof HttpError && error.status === 415);
});


test("streaming WebM without a container duration uses its actual frame timeline", async () => {
  const result = await processVideo(await fixture("webm", "0.4", "64x48", 10, true));
  assert.equal(result.durationMs, 400);
  assert.equal(result.frames, 4);
  assert.equal(result.width, 64); assert.equal(result.height, 48);
});


test("AVIF's ISO container remains an image rather than being misclassified as MP4", async () => {
  const source = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).avif().toBuffer();
  assert.equal(isVideoBytes(source), false);
  const result = await processImage(source);
  assert.equal(result.animated, false);
  assert.equal(result.width, 16); assert.equal(result.height, 16);
  assert.equal((await sharp(result.bytes).metadata()).format, "webp");
});


test("upload admission bounds multipart/storage work and releases after success or failure", async () => {
  let release!: () => void;
  let blockedCalls = 0;
  const active = withMediaUpload(() => new Promise<string>((resolve) => { release = () => resolve("stored"); }));
  const rejected = await Promise.allSettled(Array.from({ length: 8 }, () => withMediaUpload(async () => { blockedCalls++; })));
  for (const result of rejected) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.ok(result.reason instanceof HttpError && result.reason.status === 503 && result.reason.headers["Retry-After"] === "3");
  }
  assert.equal(blockedCalls, 0, "Rejected uploads never enter body reading or storage work");
  release(); assert.equal(await active, "stored");
  const failure = new Error("Simulated storage failure");
  await assert.rejects(() => withMediaUpload(async () => { throw failure; }), (error: unknown) => error === failure);
  assert.equal(await withMediaUpload(async () => "next upload"), "next upload");
});


test("media tools do not inherit application credentials", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(join(tmpdir(), "verso-tool-env-"));
  const originalPath = process.env.PATH;
  const originalSecret = process.env.VERSO_PRIVATE_TEST_SECRET;
  try {
    await writeFile(join(directory, "ffprobe"), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ secret: process.env.VERSO_PRIVATE_TEST_SECRET, locale: process.env.LC_ALL }));\n', { mode: 0o700 });
    process.env.PATH = `${directory}:${originalPath}`;
    process.env.VERSO_PRIVATE_TEST_SECRET = "synthetic-secret-not-for-child-processes";
    const output = JSON.parse((await runMediaTool("ffprobe", ["-version"])).toString());
    assert.equal(output.secret, undefined);
    assert.equal(output.locale, "C");
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    if (originalSecret === undefined) delete process.env.VERSO_PRIVATE_TEST_SECRET; else process.env.VERSO_PRIVATE_TEST_SECRET = originalSecret;
    await rm(directory, { recursive: true, force: true });
  }
});
