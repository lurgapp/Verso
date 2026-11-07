import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { runMediaTool } from "../../src/lib/server/media-process";
import type { UploadedMedia } from "../../src/lib/server/media";

const baseUrl = process.env.VERSO_TEST_BASE_URL;
const isolated = process.env.VERSO_ALLOW_ISOLATED_DB_TESTS === "1" && baseUrl === "http://127.0.0.1:33317";
const headers = { Origin: "http://127.0.0.1:33317", "X-Real-IP": `2001:db8:${Date.now().toString(16).match(/.{1,4}/g)!.join(":")}::245` };

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4, "ascii"); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
function pngData(bytes: Buffer, type: string): Buffer {
  const found: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === type) found.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return Buffer.concat(found);
}
async function animatedInput(format: "gif" | "webp" | "apng"): Promise<Buffer> {
  const pixels = Buffer.alloc(16 * 16 * 2 * 4);
  for (let index = 0; index < pixels.length; index += 4) { pixels[index + (index < pixels.length / 2 ? 0 : 2)] = 255; pixels[index + 3] = 255; }
  const image = sharp(pixels, { raw: { width: 16, height: 32, channels: 4, pageHeight: 16 } });
  if (format === "gif") return image.gif({ delay: [80, 160], loop: 2 }).toBuffer();
  if (format === "webp") return image.webp({ lossless: true, delay: [80, 160], loop: 2 }).toBuffer();
  const frames = await Promise.all(["red", "blue"].map((background) => sharp({ create: { width: 16, height: 16, channels: 4, background } }).png().toBuffer()));
  const control = (sequence: number, delay: number) => {
    const data = Buffer.alloc(26); data.writeUInt32BE(sequence); data.writeUInt32BE(16, 4); data.writeUInt32BE(16, 8); data.writeUInt16BE(delay, 20); data.writeUInt16BE(100, 22);
    return chunk("fcTL", data);
  };
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2); animation.writeUInt32BE(2, 4);
  return Buffer.concat([frames[0].subarray(0, 8), chunk("IHDR", pngData(frames[0], "IHDR")), chunk("acTL", animation), control(0, 8), chunk("IDAT", pngData(frames[0], "IDAT")), control(1, 16), chunk("fdAT", Buffer.concat([Buffer.from([0, 0, 0, 2]), pngData(frames[1], "IDAT")])), chunk("IEND", Buffer.alloc(0))]);
}
async function videoInput(format: "mp4" | "webm"): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "verso-http-media-"));
  try {
    const path = join(directory, `source.${format}`);
    await runMediaTool("ffmpeg", ["-nostdin", "-threads", "1", "-filter_threads", "1", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=10", "-t", "0.4", "-an", "-c:v", format === "mp4" ? "libx264" : "libvpx-vp9", "-threads", "1", "-pix_fmt", "yuv420p", "-y", path]);
    return await readFile(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function get(path: string, extra: Record<string, string> = {}, method = "GET"): Promise<Response> {
  assert.match(path, /^\/api\/v1\/media\/[A-Za-z0-9_-]{32}\.(?:webp|mp4)$/u);
  return fetch(`${baseUrl}${path}`, { method, headers: { ...headers, ...extra }, redirect: "error", signal: AbortSignal.timeout(15_000) });
}
async function assertStorageHttp(media: UploadedMedia): Promise<Buffer> {
  const full = await get(media.url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), media.kind === "video" ? "video/mp4" : "image/webp");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.equal(full.headers.get("cross-origin-resource-policy"), "same-origin");
  const etag = full.headers.get("etag"); assert.ok(etag);
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.equal(full.headers.get("content-length"), String(bytes.length));
  const head = await get(media.url, {}, "HEAD");
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const unchanged = await get(media.url, { "If-None-Match": etag });
  assert.equal(unchanged.status, 304); assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  const part = await get(media.url, { Range: "bytes=0-15", "If-Range": etag });
  assert.equal(part.status, 206); assert.equal(part.headers.get("content-range"), `bytes 0-15/${bytes.length}`); assert.equal(part.headers.get("content-length"), "16");
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 16));
  const suffix = await get(media.url, { Range: "bytes=-16" });
  assert.equal(suffix.status, 206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-16));
  const rangedHead = await get(media.url, { Range: "bytes=0-15" }, "HEAD");
  assert.equal(rangedHead.status, 206); assert.equal(rangedHead.headers.get("content-length"), "16"); assert.equal((await rangedHead.arrayBuffer()).byteLength, 0);
  const fallback = await get(media.url, { Range: "bytes=0-15", "If-Range": '"older-representation"' });
  assert.equal(fallback.status, 200); assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), bytes);
  const unavailable = await get(media.url, { Range: `bytes=${bytes.length}-` });
  assert.equal(unavailable.status, 416); assert.equal(unavailable.headers.get("content-range"), `bytes */${bytes.length}`); await unavailable.arrayBuffer();
  return bytes;
}

test("isolated HTTP uploads preserve animations and serve stored images/videos with correct byte ranges", { skip: isolated ? false : "Requires explicit isolated-database flag and exact loopback test URL", timeout: 120_000 }, async (suite) => {
  for (const format of ["gif", "webp", "apng", "jpeg", "avif", "mp4", "webm"] as const) {
    await suite.test(format, async () => {
      const video = format === "mp4" || format === "webm";
      const animated = format === "gif" || format === "webp" || format === "apng";
      const source = video ? await videoInput(format) : animated ? await animatedInput(format) : await sharp({ create: { width: 32, height: 20, channels: 3, background: "#1785a4" } }).toFormat(format).withMetadata({ density: 300 }).toBuffer();
      const form = new FormData();
      // Detection must trust bytes even when multipart provides a generic MIME.
      form.append("file", new Blob([Uint8Array.from(source)], { type: "application/octet-stream" }), `fixture.${format}`);
      const response = await fetch(`${baseUrl}/api/v1/media`, { method: "POST", headers, body: form, redirect: "error", signal: AbortSignal.timeout(60_000) });
      const data = await response.json() as UploadedMedia & { error?: unknown };
      assert.equal(response.status, 201, JSON.stringify(data));
      assert.equal(data.kind, video ? "video" : "image"); assert.equal(data.animated, animated);
      assert.equal(data.frames, video ? 4 : animated ? 2 : 1);
      assert.equal(data.width, video ? 64 : animated ? 16 : 32); assert.equal(data.height, video ? 48 : animated ? 16 : 20);
      assert.ok(data.thumbnailUrl);
      const thumbResponse = await get(data.thumbnailUrl); assert.equal(thumbResponse.status, 200);
      const thumb = await sharp(Buffer.from(await thumbResponse.arrayBuffer())).metadata();
      assert.equal(thumb.format, "webp"); assert.equal(thumb.pages ?? 1, 1);
      assert.equal(thumb.width, data.thumbnailWidth); assert.ok(thumb.width! <= 480 && thumb.height! <= 480);
      assert.equal(thumb.exif, undefined);
      const stored = await assertStorageHttp(data);
      if (video) {
        assert.equal(stored.toString("ascii", 4, 8), "ftyp"); assert.equal(data.durationMs, 400);
      } else {
        const metadata = await sharp(stored, { animated: true }).metadata();
        assert.equal(metadata.format, "webp"); assert.equal(metadata.pages ?? 1, animated ? 2 : 1);
        assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined);
        if (animated) {
          assert.deepEqual(metadata.delay, [80, 160]); assert.equal(metadata.loop, 2); assert.equal(data.durationMs, 240);
          const pixels = await sharp(stored, { animated: true }).ensureAlpha().raw().toBuffer();
          assert.ok(pixels[0] > 200 && pixels[2] < 50); assert.ok(pixels[16 * 16 * 4 + 2] > 200 && pixels[16 * 16 * 4] < 50);
        }
      }
      if (animated || video) {
        assert.ok(data.posterUrl);
        const poster = await get(data.posterUrl); assert.equal(poster.status, 200);
        const metadata = await sharp(Buffer.from(await poster.arrayBuffer())).metadata();
        assert.equal(metadata.format, "webp"); assert.equal(metadata.pages ?? 1, 1); assert.equal(metadata.width, data.width); assert.equal(metadata.height, data.height);
      } else assert.equal(data.posterUrl, undefined);
    });
  }
});
