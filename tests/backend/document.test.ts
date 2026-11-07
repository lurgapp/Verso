import { test } from "node:test";
import assert from "node:assert/strict";
import { documentText, DocumentValidationError, isSafeUrl, validateDocument } from "../../src/lib/document";
import { renderDocument } from "../../src/lib/server/render";
import { parseArticleMutation } from "../../src/lib/server/articles";

const paragraph = (text = "A safe story") => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (content: unknown[] = [paragraph()]) => ({ type: "doc", content });

test("canonical document keeps headings, nested tasks, tables, images and code", () => {
  const content = validateDocument(doc([
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Title", marks: [{ type: "bold" }] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Finished")] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Item"), { type: "orderedList", attrs: { start: 4 }, content: [{ type: "listItem", content: [paragraph("Nested")] }] }] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [160] }, content: [paragraph("Cell")] }] }] },
    { type: "codeBlock", attrs: { language: "typescript" }, content: [{ type: "text", text: 'const x = "<script>";' }] },
    { type: "image", attrs: { src: "/api/v1/media/abcdefghijklmnopqrstuvwxyzABCDEF.webp", alt: "A picture", width: 120, height: 80 } },
  ]));
  const html = renderDocument(content);
  assert.match(html, /<h3 id="h-title"><strong>Title<\/strong><\/h3>/u);
  assert.match(html, /type="checkbox" disabled checked/u);
  assert.match(html, /<ol start="4">/u);
  assert.match(html, /<th colspan="1" rowspan="1" style="width:160px"><p>Cell<\/p><\/th>/u);
  assert.match(html, /const x = "&lt;script&gt;";/u);
  assert.match(html, /loading="lazy" decoding="async"/u);
  assert.ok(documentText(content).includes("Finished"));
});

test("text and attribute XSS is escaped, unsafe markup cannot enter the document", () => {
  const html = renderDocument(validateDocument(doc([paragraph('<script>alert("x")</script><img onerror="boom">'), { type: "image", attrs: { src: "https://example.test/a.png", alt: '\" onerror=\"alert(1)' } }])));
  assert.ok(!html.includes("<script>"));
  assert.ok(!/<img[^>]*\sonerror="/u.test(html));
  assert.match(html, /&lt;script&gt;/u);
  assert.throws(() => validateDocument(doc([{ type: "rawHtml", text: "<script>" }])), DocumentValidationError);
  assert.throws(() => validateDocument(doc([{ type: "image", attrs: { src: "https://example.test/a", onerror: "alert(1)" } }])), DocumentValidationError);
});

test("safe URL policy refuses executable, relative, credential and ambiguous URLs", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,boom", "//example.com", "/relative", "https://user:pass@example.com", "https://example.com\\@evil.test", "java\nscript:alert(1)"]) assert.equal(isSafeUrl(url), false, url);
  for (const url of ["https://example.com/a", "http://example.com", "mailto:user@example.com", "tel:+12345"]) assert.equal(isSafeUrl(url), true, url);
  assert.equal(isSafeUrl("http://example.com/image.png", true), false);
});

test("external HTTPS image URLs survive publication as browser images without a server fetch", (context) => {
  const network = context.mock.method(globalThis, "fetch", () => { throw new Error("Article rendering must never fetch an external image."); });
  const source = "https://images.example.test/story.png?width=800&fit=cover";
  const mutation = parseArticleMutation({
    title: "An external image",
    schemaVersion: 1,
    content: doc([{ type: "image", attrs: { src: source, alt: "A mountain", title: 'A \"quoted\" caption', width: 800, height: 600 } }]),
  });
  assert.equal(mutation.content.content[0].attrs?.src, source);
  assert.match(mutation.html, /<img src="https:\/\/images\.example\.test\/story\.png\?width=800&amp;fit=cover"/u);
  assert.match(mutation.html, /alt="A mountain"/u);
  assert.match(mutation.html, /title="A &quot;quoted&quot; caption"/u);
  assert.match(mutation.html, /width="800" height="600" loading="lazy" decoding="async"/u);
  assert.equal(network.mock.callCount(), 0, "External images are loaded by the reader's browser; the API never fetches them.");
});

test("external image source policy rejects executable, insecure and credential-bearing URLs", () => {
  for (const src of ["http://images.example.test/a.png", "//images.example.test/a.png", "javascript:alert(1)", "data:image/svg+xml,<svg></svg>", "file:///etc/passwd", "https://user:secret@images.example.test/a.png"]) {
    assert.throws(() => validateDocument(doc([{ type: "image", attrs: { src } }])), DocumentValidationError, src);
  }
});

test("unsafe links and malformed document structure are rejected", () => {
  assert.throws(() => validateDocument(doc([{ type: "paragraph", content: [{ type: "text", text: "Click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }])), DocumentValidationError);
  assert.throws(() => validateDocument(doc([{ type: "table", content: [paragraph()] }])), DocumentValidationError);
  assert.throws(() => validateDocument(doc([{ type: "heading", attrs: { level: 7 }, content: [] }])), DocumentValidationError);
  assert.throws(() => validateDocument(doc([{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "unknown" }] }] }])), DocumentValidationError);
});

test("document limits reject empty, excessive depth, node count and text", () => {
  assert.throws(() => validateDocument(doc([paragraph("   ")])), DocumentValidationError);
  assert.deepEqual(validateDocument(doc([{ type: "paragraph" }]), { allowEmpty: true }), { type: "doc", content: [{ type: "paragraph", content: [] }] });
  assert.throws(() => validateDocument(doc([paragraph("x".repeat(500001))])), DocumentValidationError);
  assert.throws(() => validateDocument(doc(Array.from({ length: 10001 }, () => paragraph("a")))), DocumentValidationError);
  let node: unknown = paragraph();
  for (let level = 0; level < 34; level++) node = { type: "blockquote", content: [node] };
  assert.throws(() => validateDocument(doc([node])), DocumentValidationError);
});

test("article schema trims title and rejects unknown or incompatible versions", () => {
  const mutation = parseArticleMutation({ title: "  Hello  ", content: doc(), schemaVersion: 1 });
  assert.equal(mutation.title, "Hello");
  assert.throws(() => parseArticleMutation({ title: "Hello", content: doc(), schemaVersion: 2 }));
  assert.throws(() => parseArticleMutation({ title: "Hello", content: doc(), schemaVersion: 1, editKeyHash: "bad" }));
  assert.throws(() => parseArticleMutation({ title: "Hello", content: doc(), schemaVersion: 1 }, true));
  assert.equal(parseArticleMutation({ title: "Hello", content: doc(), schemaVersion: 1, version: 1 }, true).version, 1);
});


test("canonical publication accepts 500,000 characters including Cyrillic and rejects the next character", () => {
  const content = doc([paragraph("я".repeat(500000))]);
  assert.equal(parseArticleMutation({ title: "Large Russian guide", schemaVersion: 1, content, markdown: "я".repeat(500000) }).content.content?.[0].content?.[0].text?.length, 500000);
  assert.throws(() => validateDocument(doc([paragraph("я".repeat(500001))])), DocumentValidationError);
  assert.throws(() => parseArticleMutation({ title: "Large guide", schemaVersion: 1, content: doc(), markdown: "я".repeat(500001) }));
});
