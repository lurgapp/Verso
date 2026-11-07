import type { DocumentMark, DocumentNode, EditorDocument } from "./types";
import { isCanonicalVideo, isUploadedPoster } from "./media-url";

export const DOCUMENT_SCHEMA_VERSION = 1 as const;
export const MAX_DOCUMENT_NODES = 10_000;
export const MAX_DOCUMENT_DEPTH = 32;
export const MAX_DOCUMENT_TEXT = 500_000;

export class DocumentValidationError extends Error {}

const inline = new Set(["text", "hardBreak", "mathInline", "footnote"]);
const blocks = new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "codeBlock", "horizontalRule", "table", "image", "video", "mathBlock", "mermaid", "tableOfContents", "callout", "toggle", "gallery", "linkPreview"]);
const children: Record<string, Set<string>> = {
  doc: blocks,
  paragraph: inline,
  heading: inline,
  callout: blocks,
  toggle: blocks,
  gallery: new Set(["image"]),
  blockquote: blocks,
  bulletList: new Set(["listItem"]),
  orderedList: new Set(["listItem"]),
  taskList: new Set(["taskItem"]),
  listItem: blocks,
  taskItem: blocks,
  codeBlock: new Set(["text"]),
  table: new Set(["tableRow"]),
  tableRow: new Set(["tableCell", "tableHeader"]),
  tableCell: blocks,
  tableHeader: blocks,
};
const noChildren = new Set(["text", "hardBreak", "horizontalRule", "image", "video", "mathInline", "mathBlock", "mermaid", "footnote", "tableOfContents", "linkPreview"]);
const nodeTypes = new Set([...Object.keys(children), ...noChildren]);
const markTypes = new Set(["bold", "italic", "strike", "code", "link", "underline", "highlight", "textStyle", "subscript", "superscript"]);

function fail(message = "The document contains unsupported or invalid formatting."): never {
  throw new DocumentValidationError(message);
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  return input as Record<string, unknown>;
}

export function isSafeUrl(value: unknown, image = false): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  if (!image && /^#(?:h|eq)-[A-Za-z0-9_-]{1,90}$/u.test(value)) return true;
  if (image && /^\/api\/v1\/media\/[A-Za-z0-9_-]{24,64}\.webp$/u.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return image ? url.protocol === "https:" : ["https:", "http:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function integer(value: unknown, min: number, max: number, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail();
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max || /[\u0000]/u.test(value)) fail();
  return value;
}

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "gray"] as const;
export const TEXT_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"] as const;

function attributes(type: string, value: unknown): Record<string, unknown> | undefined {
  const source = value === undefined ? {} : record(value);
  let result: Record<string, unknown> = {};
  const accepted = new Set<string>();
  const accept = (...keys: string[]) => keys.forEach((key) => accepted.add(key));
  if (["paragraph", "heading"].includes(type)) {
    accept("textAlign");
    if (source.textAlign != null) {
      if (!["left", "center", "right", "justify"].includes(String(source.textAlign))) fail();
      result.textAlign = source.textAlign;
    }
  }
  if (type === "heading") {
    accept("level", "id");
    if (source.id != null) { if (typeof source.id !== "string" || !/^h-[A-Za-z0-9_-]{1,80}$/u.test(source.id)) fail(); result.id = source.id; }
    result.level = integer(source.level, 1, 6, 1);
  }
  if (type === "orderedList") {
    accept("start", "type");
    result.start = integer(source.start, 1, 1_000_000, 1);
    if (source.type != null) {
      if (!["1", "a", "A", "i", "I"].includes(String(source.type))) fail();
      result.type = source.type;
    }
  }
  if (type === "taskItem") {
    accept("checked");
    if (source.checked !== undefined && typeof source.checked !== "boolean") fail();
    result.checked = source.checked ?? false;
  }
  if (type === "codeBlock") {
    accept("language", "filename", "lineNumbers", "wrap");
    if (source.filename != null) result.filename = optionalText(source.filename, 120);
    for (const key of ["lineNumbers", "wrap"]) if (source[key] != null) { if (typeof source[key] !== "boolean") fail(); result[key] = source[key]; }
    const language = optionalText(source.language, 32);
    if (language && !/^[A-Za-z0-9_+#.-]+$/u.test(language)) fail();
    result.language = language;
  }
  if (["tableCell", "tableHeader"].includes(type)) {
    accept("colspan", "rowspan", "colwidth", "align", "textAlign");
    result = { colspan: integer(source.colspan, 1, 100, 1), rowspan: integer(source.rowspan, 1, 100, 1) };
    if (source.colwidth != null) {
      if (!Array.isArray(source.colwidth) || source.colwidth.length > 100) fail();
      result.colwidth = source.colwidth.map((width) => integer(width, 0, 2000, 0));
    } else result.colwidth = null;
    if (source.textAlign != null) { if (!["left", "center", "right", "justify"].includes(String(source.textAlign))) fail(); result.textAlign = source.textAlign; }
    if (source.align != null) {
      if (!["left", "center", "right"].includes(String(source.align))) fail();
      result.align = source.align;
    }
  }
  if (type === "image") {
    accept("src", "alt", "title", "width", "height", "animated", "posterSrc", "thumbnailSrc", "sourceWidth", "thumbnailWidth", "caption", "align");
    if (!isSafeUrl(source.src, true)) fail("Images must use an uploaded image URL or an HTTPS URL.");
    result = { src: source.src, alt: optionalText(source.alt, 500), title: optionalText(source.title, 500) };
    if (source.caption != null) result.caption = optionalText(source.caption, 1000);
    if (source.align != null) { if (!["left", "center", "right"].includes(String(source.align))) fail(); result.align = source.align; }
    if (source.thumbnailSrc != null) {
      if (!isUploadedPoster(source.src) || !isUploadedPoster(source.thumbnailSrc)) fail("Image thumbnails must use uploaded local images.");
      result.thumbnailSrc = source.thumbnailSrc;
    }
    if (source.sourceWidth != null || source.thumbnailWidth != null) {
      if (!isUploadedPoster(source.src) || !isUploadedPoster(source.thumbnailSrc)) fail("Image source dimensions require uploaded local images and a thumbnail.");
      if (source.sourceWidth == null || source.thumbnailWidth == null) fail("Provide both image source dimensions.");
      result.sourceWidth = integer(source.sourceWidth, 1, 2400, 1);
      result.thumbnailWidth = integer(source.thumbnailWidth, 1, 480, 1);
      if (Number(result.thumbnailWidth) > Number(result.sourceWidth)) fail("A thumbnail cannot exceed its original image width.");
    }
    if (source.animated != null) {
      if (typeof source.animated !== "boolean") fail();
      result.animated = source.animated;
    }
    if (source.posterSrc != null) {
      if (!isUploadedPoster(source.posterSrc) || source.animated !== true) fail("Animation posters must use an uploaded static image URL.");
      result.posterSrc = source.posterSrc;
    }
    if (source.width != null) result.width = integer(source.width, 1, 20000, 1);
    if (source.height != null) result.height = integer(source.height, 1, 20000, 1);
  }
  if (type === "video") {
    accept("provider", "src", "posterSrc", "caption", "aspectRatio");
    if (!isCanonicalVideo({ provider: source.provider, src: source.src, ...(source.posterSrc == null ? {} : { posterSrc: source.posterSrc }) })) fail("Videos must use a supported, normalized provider URL or a direct HTTPS video file.");
    result = { provider: source.provider, src: source.src };
    if (source.posterSrc != null) result.posterSrc = source.posterSrc;
    if (source.caption != null) result.caption = optionalText(source.caption, 1000);
    if (source.aspectRatio != null) { if (!["16:9", "4:3", "1:1", "9:16"].includes(String(source.aspectRatio))) fail(); result.aspectRatio = source.aspectRatio; }
  }
  if (["mathInline", "mathBlock"].includes(type)) {
    accept("latex", "id", "numbered");
    const latex = optionalText(source.latex, 4000);
    if (!latex?.trim()) fail("Provide a LaTeX formula.");
    result.latex = latex;
    if (source.id != null) { if (typeof source.id !== "string" || !/^eq-[A-Za-z0-9_-]{1,80}$/u.test(source.id)) fail(); result.id = source.id; }
    if (source.numbered != null) { if (type !== "mathBlock" || typeof source.numbered !== "boolean") fail(); result.numbered = source.numbered; }
  }
  if (type === "mermaid") {
    accept("code");
    const code = optionalText(source.code, 20000);
    if (!code?.trim()) fail("Provide a Mermaid diagram.");
    result.code = code;
  }
  if (type === "footnote") {
    accept("id", "text");
    if (typeof source.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,80}$/u.test(source.id)) fail();
    const text = optionalText(source.text, 4000);
    if (!text?.trim()) fail("Provide a footnote explanation.");
    result = { id: source.id, text };
  }
  if (type === "callout") {
    accept("kind", "title");
    if (!["info", "note", "tip", "warning", "important"].includes(String(source.kind))) fail();
    result.kind = source.kind;
    if (source.title != null) result.title = optionalText(source.title, 240);
  }
  if (type === "toggle") {
    accept("title", "open");
    const title = optionalText(source.title, 240);
    if (!title?.trim()) fail("Provide a collapsible block title.");
    result.title = title;
    if (source.open != null) { if (typeof source.open !== "boolean") fail(); result.open = source.open; }
  }
  if (type === "gallery") {
    accept("layout");
    if (source.layout != null && !["grid", "horizontal", "single"].includes(String(source.layout))) fail();
    result.layout = source.layout ?? "grid";
  }
  if (type === "linkPreview") {
    accept("url", "title", "description", "image");
    if (!isSafeUrl(source.url) || !String(source.url).startsWith("https://")) fail("Link previews must use an HTTPS URL.");
    result = { url: source.url, title: optionalText(source.title, 300) ?? source.url, description: optionalText(source.description, 1000) ?? "" };
    if (source.image != null) { if (!isSafeUrl(source.image, true)) fail(); result.image = source.image; }
  }
  if (Object.keys(source).some((key) => !accepted.has(key))) fail();
  return Object.keys(result).length ? result : undefined;
}

function mark(input: unknown): DocumentMark {
  const value = record(input);
  if (typeof value.type !== "string" || !markTypes.has(value.type)) fail();
  if (Object.keys(value).some((key) => !["type", "attrs"].includes(key))) fail();
  if (["highlight", "textStyle"].includes(value.type)) {
    const attrs = record(value.attrs);
    const palette: readonly string[] = value.type === "highlight" ? HIGHLIGHT_COLORS : TEXT_COLORS;
    if (Object.keys(attrs).some((key) => key !== "color") || typeof attrs.color !== "string" || !palette.includes(attrs.color)) fail();
    return { type: value.type, attrs: { color: attrs.color } };
  }
  if (value.type !== "link") {
    if (value.attrs !== undefined && Object.keys(record(value.attrs)).length) fail();
    return { type: value.type };
  }
  const attrs = record(value.attrs);
  if (!isSafeUrl(attrs.href)) fail("Links must use HTTP, HTTPS, mailto or tel URLs.");
  if (Object.keys(attrs).some((key) => !["href", "target", "rel", "class", "title"].includes(key))) fail();
  return { type: "link", attrs: { href: attrs.href, target: String(attrs.href).startsWith("#") ? "_self" : "_blank", rel: "noopener noreferrer ugc", title: optionalText(attrs.title, 500) } };
}

export function validateDocument(input: unknown, options: { allowEmpty?: boolean } = {}): EditorDocument {
  let nodeCount = 0;
  let textLength = 0;
  let meaningful = false;
  const footnotes = new Map<string, string>();
  const visit = (inputNode: unknown, depth: number, parent?: string): DocumentNode => {
    if (++nodeCount > MAX_DOCUMENT_NODES || depth > MAX_DOCUMENT_DEPTH) fail("The document is too complex.");
    const value = record(inputNode);
    if (typeof value.type !== "string" || !nodeTypes.has(value.type)) fail();
    const type = value.type;
    if ((parent && !children[parent]?.has(type)) || (!parent && type !== "doc")) fail();
    if (Object.keys(value).some((key) => !["type", "attrs", "text", "marks", "content"].includes(key))) fail();
    const node: DocumentNode = { type };
    const attrs = attributes(type, value.attrs);
    if (attrs) node.attrs = attrs;
    if (type === "footnote") {
      const id = String(attrs?.id), text = String(attrs?.text);
      if (footnotes.has(id) && footnotes.get(id) !== text) fail("Footnote IDs must refer to one explanation.");
      footnotes.set(id, text);
    }
    if (type === "text") {
      if (typeof value.text !== "string" || !value.text.length || /[\u0000]/u.test(value.text)) fail();
      textLength += value.text.length;
      if (textLength > MAX_DOCUMENT_TEXT) fail("The article is too long.");
      node.text = value.text;
      meaningful ||= value.text.trim().length > 0;
    } else if (value.text !== undefined) fail();
    if (value.marks !== undefined) {
      if (!["text", "mathInline"].includes(type) || !Array.isArray(value.marks) || value.marks.length > 12) fail();
      node.marks = value.marks.map(mark);
      if (parent === "codeBlock" && node.marks.length) fail();
    }
    if (noChildren.has(type)) {
      if (value.content !== undefined) fail();
      if (["image", "video", "horizontalRule", "mathInline", "mathBlock", "mermaid", "footnote", "linkPreview"].includes(type)) meaningful = true;
      if (["mathInline", "mathBlock", "mermaid", "footnote", "linkPreview"].includes(type)) {
        textLength += Object.values(attrs ?? {}).filter((entry) => typeof entry === "string").reduce((total, entry) => total + String(entry).length, 0);
        if (textLength > MAX_DOCUMENT_TEXT) fail("The article is too long.");
      }
    } else {
      if (value.content !== undefined && !Array.isArray(value.content)) fail();
      node.content = (value.content as unknown[] | undefined ?? []).map((child) => visit(child, depth + 1, type));
      if (!["doc", "paragraph", "heading", "codeBlock"].includes(type) && node.content.length === 0) fail();
      if (type === "gallery" && node.content.length > 30) fail("A gallery can contain up to 30 images.");
      if (["listItem", "taskItem"].includes(type) && node.content[0]?.type !== "paragraph") fail();
    }
    return node;
  };
  const document = visit(input, 0) as EditorDocument;
  if (!meaningful && !options.allowEmpty) fail("Write some text or add an image before publishing.");
  return document;
}

export function documentText(document: DocumentNode): string {
  if (document.type === "text") return document.text ?? "";
  if (document.type === "hardBreak") return "\n";
  if (["mathInline", "mathBlock"].includes(document.type)) return String(document.attrs?.latex ?? "");
  if (document.type === "footnote") return String(document.attrs?.text ?? "");
  if (document.type === "mermaid") return String(document.attrs?.code ?? "");
  if (document.type === "linkPreview") return `${document.attrs?.title ?? ""} ${document.attrs?.description ?? ""}\n`;
  if (["image", "video"].includes(document.type)) return String(document.attrs?.caption ?? "");
  const text = (document.content ?? []).map(documentText).join("");
  return ["paragraph", "heading", "codeBlock", "tableCell", "tableHeader"].includes(document.type) ? `${text}\n` : text;
}
