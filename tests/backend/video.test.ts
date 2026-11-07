import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isCanonicalVideo, normaliseVideoUrl, VIDEO_FRAME_ORIGINS } from "../../src/lib/media-url";
import { DocumentValidationError, validateDocument } from "../../src/lib/document";
import { renderDocument } from "../../src/lib/server/render";
import { parseArticleMutation } from "../../src/lib/server/articles";
import { proxy } from "../../src/proxy";

const youtubeId = "M7lc1UVf-VE";
const rutubeId = "7716bd3e665725c3c008ae7ab4ff02e2";
const videoDoc = (attrs: unknown) => ({ type: "doc", content: [{ type: "video", attrs }] });

test("YouTube watch, share, shorts and embed URLs normalize to the privacy-enhanced player", () => {
  for (const input of [
    `https://www.youtube.com/watch?v=${youtubeId}&feature=shared`,
    `https://youtube.com/watch?v=${youtubeId}`,
    `https://m.youtube.com/watch?v=${youtubeId}`,
    `https://youtu.be/${youtubeId}?si=publicShareToken`,
    `https://www.youtube.com/shorts/${youtubeId}`,
    `https://www.youtube.com/embed/${youtubeId}`,
    `https://www.youtube-nocookie.com/embed/${youtubeId}`,
  ]) {
    assert.deepEqual(normaliseVideoUrl(input), { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${youtubeId}` });
  }
});

test("Vimeo and RuTube public links normalize and remain round-trippable", () => {
  assert.deepEqual(normaliseVideoUrl("https://vimeo.com/76979871"), { provider: "vimeo", src: "https://player.vimeo.com/video/76979871" });
  assert.deepEqual(normaliseVideoUrl("https://player.vimeo.com/video/76979871"), { provider: "vimeo", src: "https://player.vimeo.com/video/76979871" });
  assert.deepEqual(normaliseVideoUrl(`https://rutube.ru/video/${rutubeId.toUpperCase()}/`), { provider: "rutube", src: `https://rutube.ru/play/embed/${rutubeId}/` });
  assert.deepEqual(normaliseVideoUrl(`https://rutube.ru/play/embed/${rutubeId}/`), { provider: "rutube", src: `https://rutube.ru/play/embed/${rutubeId}/` });
  for (const value of ["https://vimeo.com/76979871?h=privateHash", "https://player.vimeo.com/video/76979871?h=privateHash", `https://rutube.ru/video/${rutubeId}/?p=accessToken`]) assert.equal(normaliseVideoUrl(value), null, "Unsupported private access keys must not be silently discarded");
});

test("direct HTTPS video links preserve signed query and fragment URLs", () => {
  for (const extension of ["mp4", "webm", "ogv"]) {
    const source = `https://media.example.test/film.${extension}?expires=42&quality=high#t=2`;
    assert.deepEqual(normaliseVideoUrl(source), { provider: "file", src: source });
    assert.equal(isCanonicalVideo({ provider: "file", src: source }), true);
  }
});

test("video normalization rejects executable protocols, credentials, malformed IDs and frame lookalikes", () => {
  for (const source of [
    "javascript:alert(1)", "data:text/html,<script></script>", "file:///tmp/film.mp4", "http://example.test/film.mp4", "//example.test/film.mp4",
    `https://user:password@youtube.com/watch?v=${youtubeId}`, `https://youtube.com:444/watch?v=${youtubeId}`,
    `https://www.youtube.com.evil.test/embed/${youtubeId}`, `https://youtube.com./watch?v=${youtubeId}`, `https://localhost/embed/${youtubeId}`,
    `https://127.0.0.1/embed/${youtubeId}`, `https://[::1]/embed/${youtubeId}`, `https://10.0.0.1/embed/${youtubeId}`,
    "https://youtu.be/too-short", `https://youtube.com/watch?v=${youtubeId}&v=${youtubeId}`, "https://vimeo.com/not-a-number", "https://rutube.ru/video/not-hex/",
    `https://www.youtube.com\\@evil.test/embed/${youtubeId}`, "https://example.test/film.html", "https://example.test/film.mp4/extra",
  ]) assert.equal(normaliseVideoUrl(source), null, source);
});

test("canonical document validation enforces exact matching provider and normalized source", () => {
  const value = { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${youtubeId}` };
  assert.equal(isCanonicalVideo(value), true);
  assert.deepEqual(validateDocument(videoDoc(value)).content[0].attrs, value);
  for (const attrs of [
    { ...value, provider: "vimeo" },
    { ...value, src: `https://youtube.com/watch?v=${youtubeId}` },
    { ...value, src: `https://www.youtube-nocookie.com.evil.test/embed/${youtubeId}` },
    { ...value, src: `https://localhost/embed/${youtubeId}` },
    { ...value, onload: "alert(1)" },
    { ...value, title: "Injected title" },
    { provider: "file", src: "javascript:alert(1)" },
  ]) assert.throws(() => validateDocument(videoDoc(attrs)), DocumentValidationError);
});

test("server video rendering emits allowlisted, sandboxed frames without fetching providers", (context) => {
  const network = context.mock.method(globalThis, "fetch", () => { throw new Error("The server must never fetch embedded video URLs."); });
  for (const [provider, src] of [
    ["youtube", `https://www.youtube-nocookie.com/embed/${youtubeId}`],
    ["vimeo", "https://player.vimeo.com/video/76979871"],
    ["rutube", `https://rutube.ru/play/embed/${rutubeId}/`],
  ]) {
    const html = parseArticleMutation({ title: "A video", content: videoDoc({ provider, src }), schemaVersion: 1 }).html;
    assert.ok(html.includes(`<iframe src="${src}"`));
    assert.match(html, /class="video-block video-embed aspect-16-9"/u);
    assert.match(html, /loading="lazy"/u);
    assert.match(html, /allowfullscreen/u);
    assert.match(html, /sandbox="allow-scripts allow-same-origin allow-presentation"/u);
    assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/u);
    assert.ok(!html.includes("allow-top-navigation"));
  }
  assert.equal(network.mock.callCount(), 0);
});

test("direct video SSR uses controls and escapes query attributes without raw HTML injection", () => {
  const source = "https://media.example.test/film.mp4?quality=high&caption=%22";
  const html = renderDocument(validateDocument(videoDoc({ provider: "file", src: source })));
  assert.match(html, /class="video-block video-file aspect-16-9"/u);
  assert.match(html, /<video src="https:\/\/media\.example\.test\/film\.mp4\?quality=high&amp;caption=%22" controls playsinline preload="metadata"/u);
  assert.ok(!html.includes("<iframe"));
  assert.throws(() => renderDocument({ type: "doc", content: [{ type: "video", attrs: { provider: "youtube", src: "https://evil.test/embed/any" } }] }), /Invalid video attributes/u);
});

test("CSP grants frames only to exact video providers and media to HTTPS/self/blob", () => {
  const response = proxy(new NextRequest("https://verso.example.test/a/ABCDEFGHIJKL"));
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  assert.ok(csp.includes(`frame-src ${VIDEO_FRAME_ORIGINS.join(" ")}`));
  assert.ok(csp.includes("media-src 'self' https: blob:"));
  const frameDirective = csp.split(";").find((value) => value.trim().startsWith("frame-src")) ?? "";
  assert.ok(!frameDirective.includes("https:;") && !frameDirective.includes("*"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});
