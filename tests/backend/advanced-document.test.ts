import { test } from "node:test";
import assert from "node:assert/strict";
import { DocumentValidationError, documentText, validateDocument } from "../../src/lib/document";
import { renderDocument } from "../../src/lib/server/render";
const paragraph = (text = "Text") => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: unknown[]) => ({ type: "doc", content });

test("advanced blocks and bounded mark palettes survive canonical JSON and safe SSR", () => {
  const content = validateDocument(doc(
    { type: "paragraph", content: [{ type: "text", text: "H2O", marks: [{ type: "subscript" }, { type: "highlight", attrs: { color: "yellow" } }, { type: "textStyle", attrs: { color: "blue" } }, { type: "underline" }] }] },
    { type: "callout", attrs: { kind: "warning", title: "Read this" }, content: [paragraph("A warning")] },
    { type: "toggle", attrs: { title: "Details", open: true }, content: [paragraph("Hidden details")] },
    { type: "gallery", attrs: { layout: "grid" }, content: [{ type: "image", attrs: { src: "/api/v1/media/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.webp", caption: "A caption", align: "center", width: 700, sourceWidth: 1200, thumbnailWidth: 480, thumbnailSrc: "/api/v1/media/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.webp" } }] },
    { type: "linkPreview", attrs: { url: "https://example.com/page", title: '<img onerror="bad">', description: "A safe card", image: "https://example.com/og.png" } },
    { type: "video", attrs: { provider: "file", src: "https://example.com/a.mp4", caption: "Demo", aspectRatio: "9:16" } },
  ));
  const html = renderDocument(content);
  assert.match(html, /class="highlight-yellow"/u); assert.match(html, /class="text-blue"/u);
  assert.match(html, /<sub>H2O<\/sub>/u); assert.match(html, /<details class="toggle-block" open>/u);
  assert.match(html, /class="callout callout-warning"/u); assert.match(html, /<figcaption>A caption<\/figcaption>/u);
  assert.match(html, /srcset="\/api\/v1\/media\/B{32}\.webp 480w, \/api\/v1\/media\/A{32}\.webp 1200w"/u);
  assert.match(html, /class="image-gallery gallery-grid"/u); assert.match(html, /aspect-9-16/u);
  assert.doesNotMatch(html, /<img onerror=/u); assert.match(html, /&lt;img onerror=/u);
  assert.ok(documentText(content).includes("A caption"));
});

test("unsafe new attributes, structural nesting and palette injection are rejected", () => {
  const invalid = [
    { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "highlight", attrs: { color: "red;position:fixed" } }] }] },
    { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "textStyle", attrs: { color: "#fff" } }] }] },
    { type: "heading", attrs: { id: 'bad" onclick="bad', level: 1 }, content: [] },
    { type: "mathBlock", attrs: { latex: "x", id: "javascript:alert(1)" } },
    { type: "mathBlock", attrs: { latex: "x".repeat(4001) } },
    { type: "mermaid", attrs: { code: "x".repeat(20001) } },
    { type: "gallery", content: [paragraph()] },
    { type: "gallery", content: Array.from({ length: 31 }, () => ({ type: "image", attrs: { src: "https://example.com/a.jpg" } })) },
    { type: "callout", attrs: { kind: "danger" }, content: [paragraph()] },
    { type: "toggle", attrs: { title: "" }, content: [paragraph()] },
    { type: "footnote", attrs: { id: "fn-1", text: "" } },
    { type: "linkPreview", attrs: { url: "javascript:bad", title: "x" } },
    { type: "video", attrs: { provider: "file", src: "https://example.com/a.mp4", aspectRatio: "100/0" } },
  ];
  for (const node of invalid) assert.throws(() => validateDocument(doc(node)), DocumentValidationError, JSON.stringify(node).slice(0, 100));
});

test("LaTeX renders server-side without trusted commands, malformed input remains inert", () => {
  const content = validateDocument(doc(
    { type: "paragraph", content: [{ type: "mathInline", attrs: { latex: "E=mc^2" } }] },
    { type: "mathBlock", attrs: { latex: "\\frac{a+b}{c}", numbered: true, id: "eq-example" } },
    { type: "mathBlock", attrs: { latex: "\\href{javascript:alert(1)}{x}" } },
    { type: "mathBlock", attrs: { latex: "\\htmlClass{evil}{x}" } },
    { type: "mathBlock", attrs: { latex: "\\invalidcommand{" } },
  ));
  const html = renderDocument(content);
  assert.match(html, /class="katex"/u); assert.match(html, /<math xmlns=/u); assert.match(html, /id="eq-example"/u);
  assert.match(html, /href="#eq-example"/u); assert.match(html, /\(1\)/u); assert.match(html, /katex-error/u);
  assert.doesNotMatch(html, /href="javascript:|class="evil"|<script/iu);
});

test("ToC and repeated headings have stable unique anchors and numbered footnotes link back", () => {
  const heading = (text: string, id?: string) => ({ type: "heading", attrs: { level: 2, ...(id ? { id } : {}) }, content: [{ type: "text", text }] });
  const note = { type: "footnote", attrs: { id: "fn-a", text: 'An explanation <script>alert(1)</script>' } };
  const content = validateDocument(doc({ type: "tableOfContents" }, heading("Install", "h-stable"), heading("Install"), heading("Install"), { type: "paragraph", content: [{ type: "text", text: "Reference" }, note, note] }));
  const html = renderDocument(content);
  for (const id of ["h-stable", "h-install", "h-install-2"]) { assert.match(html, new RegExp(`id="${id}"`)); assert.match(html, new RegExp(`href="#${id}"`)); }
  assert.equal((html.match(/id="footnote-1"/gu) ?? []).length, 1);
  assert.match(html, /href="#footnote-ref-1-1"/u); assert.match(html, /href="#footnote-ref-1-2"/u);
  assert.doesNotMatch(html, /<script>/u);
});

test("Mermaid and code sources are escaped and carry only safe enhancement hooks", () => {
  const html = renderDocument(validateDocument(doc(
    { type: "mermaid", attrs: { code: 'flowchart LR\nA["</code><script>alert(1)</script>"] --> B' } },
    { type: "codeBlock", attrs: { language: "typescript", filename: '<img src=x onerror="bad">', lineNumbers: true, wrap: true }, content: [{ type: "text", text: '<script>alert("code")</script>' }] },
  )));
  assert.match(html, /data-mermaid="true"/u); assert.match(html, /data-mermaid-action="svg"/u);
  assert.match(html, /data-code-copy="true"/u); assert.match(html, /code-wrap code-lines/u);
  assert.doesNotMatch(html, /<script>|<img src=x/u); assert.match(html, /&lt;script&gt;/u);
});


test("formula references use bounded internal anchors and stay in the article", () => {
  const html = renderDocument(validateDocument(doc({ type: "paragraph", content: [{ type: "text", text: "See equation", marks: [{ type: "link", attrs: { href: "#eq-example" } }] }] })));
  assert.match(html, /href="#eq-example" target="_self"/u);
  assert.throws(() => validateDocument(doc({ type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: '#eq-bad"onclick="bad' } }] }] })), DocumentValidationError);
});

test("attribute text limits include formulas, diagram source and footnotes across the whole document", () => {
  assert.throws(() => validateDocument(doc(...Array.from({ length: 126 }, () => ({ type: "mathBlock", attrs: { latex: "x".repeat(4000) } })))), DocumentValidationError);
  assert.throws(() => validateDocument(doc(...Array.from({ length: 26 }, () => ({ type: "mermaid", attrs: { code: "x".repeat(20000) } })))), DocumentValidationError);
  assert.throws(() => validateDocument(doc({ type: "paragraph", content: [{ type: "footnote", attrs: { id: "fn-duplicate", text: "First" } }, { type: "footnote", attrs: { id: "fn-duplicate", text: "Changed" } }] })), DocumentValidationError);
  let nested: unknown = paragraph();
  for (let index = 0; index < 34; index++) nested = { type: "toggle", attrs: { title: "Nested" }, content: [nested] };
  assert.throws(() => validateDocument(doc(nested)), DocumentValidationError);
});

test("duplicate authored heading and formula IDs are escaped and disambiguated without DOM clobbering", () => {
  const content = validateDocument(doc(
    { type: "heading", attrs: { level: 1, id: "h-safe" }, content: [{ type: "text", text: '<img src=x onerror="bad">' }] },
    { type: "heading", attrs: { level: 6, id: "h-safe" }, content: [{ type: "text", text: "Repeated" }] },
    { type: "mathBlock", attrs: { id: "eq-safe", latex: "x" } },
    { type: "mathBlock", attrs: { id: "eq-safe", latex: "y" } },
  ));
  const html = renderDocument(content);
  assert.match(html, /id="h-safe-2"/u); assert.match(html, /id="eq-safe-2"/u);
  assert.doesNotMatch(html, /<img src=x/u);
  for (const id of ["constructor", "__proto__", "location", 'h-\" onclick=\"bad', "h-кириллица"]) assert.throws(() => validateDocument(doc({ type: "heading", attrs: { level: 1, id }, content: [] })), DocumentValidationError);
});


test("responsive image descriptors use intrinsic dimensions and never a resized display width", () => {
  const src = "/api/v1/media/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.webp";
  const thumbnailSrc = "/api/v1/media/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.webp";
  const image = (attrs: Record<string, unknown>) => ({ type: "image", attrs: { src, ...attrs } });
  const html = renderDocument(validateDocument(doc(image({ thumbnailSrc, width: 300, sourceWidth: 1400, thumbnailWidth: 420 }))));
  assert.match(html, /width="300"/u);
  assert.match(html, /srcset="[^"<>]+ 420w, [^"<>]+ 1400w"/u);
  assert.doesNotMatch(html, /300w|480w/u);
  for (const attrs of [{ width: 300, thumbnailSrc }, { width: 300 }, { thumbnailSrc, sourceWidth: 420, thumbnailWidth: 420 }]) {
    assert.doesNotMatch(renderDocument(validateDocument(doc(image(attrs)))), /srcset=/u);
  }
  const posterSrc = "/api/v1/media/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.webp";
  assert.doesNotMatch(renderDocument(validateDocument(doc(image({ animated: true, posterSrc, thumbnailSrc, sourceWidth: 1400, thumbnailWidth: 420 })))), /srcset=/u);
  for (const attrs of [
    { thumbnailSrc: "https://example.com/thumb.webp", sourceWidth: 1400, thumbnailWidth: 420 },
    { src: "https://example.com/image.jpg", thumbnailSrc, sourceWidth: 1400, thumbnailWidth: 420 },
    { thumbnailSrc, sourceWidth: 2401, thumbnailWidth: 480 },
    { thumbnailSrc, sourceWidth: 1400, thumbnailWidth: 481 },
    { thumbnailSrc, sourceWidth: 400, thumbnailWidth: 480 },
    { thumbnailSrc, sourceWidth: 1400 },
    { thumbnailSrc, thumbnailWidth: 420 },
    { sourceWidth: 1400, thumbnailWidth: 420 },
    { thumbnailSrc, sourceWidth: "1400", thumbnailWidth: 420 },
  ]) assert.throws(() => validateDocument(doc(image(attrs))), DocumentValidationError);
});
