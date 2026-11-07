import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { parseMediaRange, processImage } from "../../src/lib/server/media";
import { HttpError } from "../../src/lib/server/http";

test("upload processing decodes real pixels, strips metadata and resizes to WebP", async () => {
  const source = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#1785a4" } }).jpeg().withMetadata({ density: 300 }).toBuffer();
  const result = await processImage(source);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(result.width, 2400);
  assert.equal(result.height, 800);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
});

test("HTML, SVG and oversized files cannot be uploaded as images", async () => {
  for (const source of [Buffer.from("<html><script>alert(1)</script></html>"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>')]) {
    await assert.rejects(() => processImage(source), (error: unknown) => error instanceof HttpError && error.status === 415);
  }
  await assert.rejects(() => processImage(Buffer.alloc(8 * 1024 * 1024 + 1)), (error: unknown) => error instanceof HttpError && error.status === 413);
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0); output.write(type, 4, "ascii"); data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
  return output;
}
async function apngFixture(): Promise<Buffer> {
  const frames = await Promise.all(["#ff0000", "#0000ff"].map((background) => sharp({ create: { width: 16, height: 16, channels: 4, background } }).png().toBuffer()));
  const chunks = (bytes: Buffer, wanted: string) => { const result: Buffer[] = []; for (let offset = 8; offset + 12 <= bytes.length;) { const length = bytes.readUInt32BE(offset); if (bytes.toString("ascii", offset + 4, offset + 8) === wanted) result.push(bytes.subarray(offset + 8, offset + 8 + length)); offset += length + 12; } return Buffer.concat(result); };
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2); animation.writeUInt32BE(2, 4);
  const control = (sequence: number, delay: number) => { const data = Buffer.alloc(26); data.writeUInt32BE(sequence); data.writeUInt32BE(16, 4); data.writeUInt32BE(16, 8); data.writeUInt16BE(delay, 20); data.writeUInt16BE(100, 22); return pngChunk("fcTL", data); };
  const secondData = Buffer.concat([Buffer.from([0, 0, 0, 2]), chunks(frames[1], "IDAT")]);
  return Buffer.concat([frames[0].subarray(0, 8), pngChunk("IHDR", chunks(frames[0], "IHDR")), pngChunk("acTL", animation), control(0, 8), pngChunk("IDAT", chunks(frames[0], "IDAT")), control(1, 16), pngChunk("fdAT", secondData), pngChunk("IEND", Buffer.alloc(0))]);
}
async function animationFixture(format: "gif" | "webp", frames = 2): Promise<Buffer> {
  const pixels = Buffer.alloc(16 * 16 * frames * 4);
  for (let frame = 0; frame < frames; frame++) for (let pixel = frame * 16 * 16 * 4; pixel < (frame + 1) * 16 * 16 * 4; pixel += 4) { pixels[pixel + (frame % 2 ? 2 : 0)] = 255; pixels[pixel + 3] = 255; }
  const image = sharp(pixels, { raw: { width: 16, height: 16 * frames, channels: 4, pageHeight: 16 } });
  return format === "gif" ? image.gif({ delay: Array.from({ length: frames }, (_, index) => index % 2 ? 160 : 80), loop: 2 }).toBuffer() : image.webp({ lossless: true, delay: [80, 160], loop: 2 }).toBuffer();
}

for (const format of ["gif", "webp", "apng"] as const) test(`${format} animations retain all distinct frames, timing and looping with a still poster`, async () => {
  const source = format === "apng" ? await apngFixture() : await animationFixture(format);
  const result = await processImage(source);
  const metadata = await sharp(result.bytes, { animated: true }).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [80, 160]);
  assert.equal(metadata.loop, 2);
  assert.equal(result.animated, true);
  assert.equal(result.durationMs, 240);
  assert.equal(result.width, 16); assert.equal(result.height, 16);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined);
  assert.ok(result.poster);
  assert.equal((await sharp(result.poster).metadata()).pages ?? 1, 1);
  const raw = await sharp(result.bytes, { animated: true }).ensureAlpha().raw().toBuffer();
  assert.ok(raw[0] > 200 && raw[2] < 50, "First frame remains red");
  assert.ok(raw[16 * 16 * 4 + 2] > 200 && raw[16 * 16 * 4] < 50, "Second frame remains blue");
});

test("animation frame, decoded pixel and timeline limits fail explicitly instead of flattening", async () => {
  const excessiveFrames = await animationFixture("gif", 241);
  await assert.rejects(() => processImage(excessiveFrames), (error: unknown) => error instanceof HttpError && error.status === 413);
  const apng = await apngFixture();
  const canvasBomb = Buffer.from(apng);
  const ihdr = pngChunk("IHDR", Buffer.concat([Buffer.from([0, 0, 0x10, 0]), Buffer.from([0, 0, 0x10, 0]), apng.subarray(24, 29)]));
  ihdr.copy(canvasBomb, 8);
  await assert.rejects(() => processImage(canvasBomb), (error: unknown) => error instanceof HttpError && error.status === 413);
  const longAnimation = await sharp(await animationFixture("gif"), { animated: true }).gif({ delay: [20000, 20000] }).toBuffer();
  await assert.rejects(() => processImage(longAnimation), (error: unknown) => error instanceof HttpError && error.status === 413);
});

test("media ranges support seeking, suffixes and clamp; multi-range and overflow are rejected", () => {
  assert.deepEqual(parseMediaRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseMediaRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaRange("bytes=90-999", 100), { start: 90, end: 99 });
  for (const value of ["bytes=100-", "bytes=20-10", "bytes=-0", "bytes=", "bytes=0-9,20-29", "bytes=999999999999999999999-", "bytes=0-999999999999999999999", "items=0-1"]) assert.throws(() => parseMediaRange(value, 100), (error: unknown) => error instanceof HttpError && error.status === 416 && error.headers["Content-Range"] === "bytes */100");
});


test("APNG rejects declared frame and decoded-pixel bombs before native decoding", async () => {
  const source = await apngFixture();
  const cases = [
    { width: 16, height: 16, frames: 241 },
    { width: 1000, height: 1000, frames: 25 },
    { width: 2001, height: 2000, frames: 2 },
  ];
  for (const item of cases) {
    const bytes = Buffer.from(source);
    const ihdr = Buffer.from(bytes.subarray(16, 29));
    ihdr.writeUInt32BE(item.width, 0); ihdr.writeUInt32BE(item.height, 4);
    pngChunk("IHDR", ihdr).copy(bytes, 8);
    const start = bytes.indexOf(Buffer.from("acTL")) - 4;
    const data = Buffer.alloc(8); data.writeUInt32BE(item.frames); data.writeUInt32BE(0, 4);
    pngChunk("acTL", data).copy(bytes, start);
    await assert.rejects(() => processImage(bytes), (error: unknown) => error instanceof HttpError && error.status === 413);
  }
});

test("APNG rejects truncated chunks, inconsistent frame count and invalid frame rectangles", async () => {
  const source = await apngFixture();
  const inconsistent = Buffer.from(source);
  const animationStart = source.indexOf(Buffer.from("acTL")) - 4;
  const data = Buffer.alloc(8); data.writeUInt32BE(3);
  pngChunk("acTL", data).copy(inconsistent, animationStart);
  await assert.rejects(() => processImage(inconsistent), (error: unknown) => error instanceof HttpError && error.status === 415);
  const invalidFrame = Buffer.from(source);
  const frameStart = source.indexOf(Buffer.from("fcTL")) - 4;
  const frame = Buffer.from(source.subarray(frameStart + 8, frameStart + 34));
  frame.writeUInt32BE(17, 4);
  pngChunk("fcTL", frame).copy(invalidFrame, frameStart);
  for (const bytes of [source.subarray(0, -2), invalidFrame]) await assert.rejects(() => processImage(bytes), (error: unknown) => error instanceof HttpError && error.status === 415);
});

test("animation total duration is bounded independently of each frame delay", async () => {
  const source = await sharp(await animationFixture("gif", 4), { animated: true }).gif({ delay: [10000, 10000, 10000, 10000] }).toBuffer();
  await assert.rejects(() => processImage(source), (error: unknown) => error instanceof HttpError && error.status === 413);
});
