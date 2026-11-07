import sanitizeHtml from "sanitize-html";
import katex from "katex";
import type { DocumentNode, EditorDocument } from "../types";
import { documentText } from "../document";
import { isCanonicalVideo, isUploadedPoster, mayAnimateImage, VIDEO_FRAME_ORIGINS } from "../media-url";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

type Heading = { id: string; level: number; text: string };
type Footnote = { id: string; text: string; number: number; references: string[] };
type Context = { headings: Heading[]; headingIds: Map<DocumentNode, string>; footnotes: Map<string, Footnote>; math: string[]; formula: number; usedIds: Set<string> };

function uniqueId(candidate: string, used: Set<string>): string {
  let value = candidate, suffix = 2;
  while (used.has(value)) value = `${candidate}-${suffix++}`;
  used.add(value);
  return value;
}
function scan(document: DocumentNode): Context {
  const context: Context = { headings: [], headingIds: new Map(), footnotes: new Map(), math: [], formula: 0, usedIds: new Set() };
  const visit = (node: DocumentNode) => {
    if (node.type === "heading") {
      const text = documentText(node).trim();
      const slug = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 70);
      const id = uniqueId(String(node.attrs?.id ?? `h-${slug || `section-${context.headings.length + 1}`}`), context.usedIds);
      context.headings.push({ id, level: Number(node.attrs?.level ?? 1), text });
      context.headingIds.set(node, id);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document);
  return context;
}

function nodeHtml(node: DocumentNode, context: Context): string {
  const content = (node.content ?? []).map((child) => nodeHtml(child, context)).join("");
  const attrs = node.attrs ?? {};
  if (node.type === "text") {
    let text = escapeHtml(node.text);
    for (const mark of node.marks ?? []) {
      const tag = { bold: "strong", italic: "em", strike: "s", code: "code", underline: "u", subscript: "sub", superscript: "sup" }[mark.type];
      if (tag) text = `<${tag}>${text}</${tag}>`;
      else if (mark.type === "highlight") text = `<mark class="highlight-${escapeHtml(mark.attrs?.color)}">${text}</mark>`;
      else if (mark.type === "textStyle") text = `<span class="text-${escapeHtml(mark.attrs?.color)}">${text}</span>`;
      else if (mark.type === "link") text = `<a href="${escapeHtml(mark.attrs?.href)}" target="${String(mark.attrs?.href).startsWith("#") ? "_self" : "_blank"}" rel="noopener noreferrer ugc"${mark.attrs?.title ? ` title="${escapeHtml(mark.attrs.title)}"` : ""}>${text}</a>`;
    }
    return text;
  }
  const alignment = attrs.textAlign ? ` style="text-align:${escapeHtml(attrs.textAlign)}"` : "";
  switch (node.type) {
    case "doc": return content;
    case "paragraph": return `<p${alignment}>${content || "<br>"}</p>`;
    case "heading": return `<h${attrs.level ?? 1} id="${escapeHtml(context.headingIds.get(node))}"${alignment}>${content}</h${attrs.level ?? 1}>`;
    case "hardBreak": return "<br>";
    case "horizontalRule": return "<hr>";
    case "blockquote": return `<blockquote>${content}</blockquote>`;
    case "bulletList": return `<ul>${content}</ul>`;
    case "orderedList": return `<ol start="${attrs.start ?? 1}"${attrs.type ? ` type="${escapeHtml(attrs.type)}"` : ""}>${content}</ol>`;
    case "listItem": return `<li>${content}</li>`;
    case "taskList": return `<ul data-type="taskList">${content}</ul>`;
    case "taskItem": return `<li data-type="taskItem" data-checked="${attrs.checked === true}"><label><input type="checkbox" disabled${attrs.checked ? " checked" : ""} aria-label="${attrs.checked ? "Completed task" : "Uncompleted task"}"></label><div>${content}</div></li>`;
    case "codeBlock": return `<div class="code-block${attrs.wrap ? " code-wrap" : ""}${attrs.lineNumbers ? " code-lines" : ""}" data-code-block="true"><div class="code-header"><span>${escapeHtml(attrs.filename || attrs.language || "Code")}</span><button type="button" data-code-copy="true" aria-label="Copy code">Copy</button></div><pre><code${attrs.language ? ` class="language-${escapeHtml(attrs.language)}" data-language="${escapeHtml(attrs.language)}"` : ""}>${content}</code></pre></div>`;
    case "table": return `<div class="table-wrap"><table><tbody>${content}</tbody></table></div>`;
    case "tableRow": return `<tr>${content}</tr>`;
    case "tableCell":
    case "tableHeader": {
      const tag = node.type === "tableHeader" ? "th" : "td";
      const widths = Array.isArray(attrs.colwidth) ? attrs.colwidth as number[] : [];
      const width = widths.reduce((total, entry) => total + entry, 0);
      const style = [attrs.textAlign || attrs.align ? `text-align:${escapeHtml(attrs.textAlign || attrs.align)}` : "", width ? `width:${width}px` : ""].filter(Boolean).join(";");
      return `<${tag} colspan="${attrs.colspan ?? 1}" rowspan="${attrs.rowspan ?? 1}"${style ? ` style="${style}"` : ""}>${content}</${tag}>`;
    }
    case "image": {
      const animated = mayAnimateImage(String(attrs.src), attrs.animated);
      const responsive = !animated && typeof attrs.sourceWidth === "number" && Number.isInteger(attrs.sourceWidth) && attrs.sourceWidth >= 1 && attrs.sourceWidth <= 2400 && typeof attrs.thumbnailWidth === "number" && Number.isInteger(attrs.thumbnailWidth) && attrs.thumbnailWidth >= 1 && attrs.thumbnailWidth <= 480 && attrs.thumbnailWidth < attrs.sourceWidth && isUploadedPoster(attrs.src) && isUploadedPoster(attrs.thumbnailSrc);
      const image = `<img src="${escapeHtml(animated && attrs.posterSrc ? attrs.posterSrc : attrs.src)}" alt="${escapeHtml(attrs.alt)}"${attrs.title ? ` title="${escapeHtml(attrs.title)}"` : ""}${attrs.width ? ` width="${attrs.width}"` : ""}${attrs.height ? ` height="${attrs.height}"` : ""} loading="lazy" decoding="async"${animated ? ' class="vm-image-source"' : ' data-lightbox="true"'}${responsive ? ` srcset="${escapeHtml(attrs.thumbnailSrc)} ${attrs.thumbnailWidth}w, ${escapeHtml(attrs.src)} ${attrs.sourceWidth}w" sizes="(max-width: 600px) 100vw, 760px"` : ""}>`;
      const body = !animated ? image : `<div class="vm-image" data-vm-motion="image" data-vm-src="${escapeHtml(attrs.src)}"${attrs.posterSrc ? ` data-vm-poster="${escapeHtml(attrs.posterSrc)}"` : ""}>${image}<span class="vm-image-placeholder" aria-hidden="true">Animation</span><button type="button" class="vm-motion-toggle" aria-pressed="false" aria-label="Play animation">Play animation</button></div>`;
      return `<figure class="image-figure${attrs.align ? ` image-${attrs.align}` : ""}">${body}${attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : ""}</figure>`;
    }
    case "video": {
      if (!isCanonicalVideo({ provider: attrs.provider, src: attrs.src, ...(attrs.posterSrc == null ? {} : { posterSrc: attrs.posterSrc }) })) throw new Error("Invalid video attributes.");
      const aspect = String(attrs.aspectRatio ?? "16:9").replace(":", "-");
      const title = { youtube: "YouTube video player", vimeo: "Vimeo video player", rutube: "RuTube video player", file: "Video player" }[String(attrs.provider)] ?? "Video player";
      const player = attrs.provider === "file" ? `<video src="${escapeHtml(attrs.src)}" controls playsinline preload="metadata"${attrs.posterSrc ? ` poster="${escapeHtml(attrs.posterSrc)}"` : ""} aria-label="Video player"></video>` : `<iframe src="${escapeHtml(attrs.src)}" title="${title}" width="560" height="315" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
      return `<figure class="video-figure"><div class="video-block ${attrs.provider === "file" ? "video-file" : "video-embed"} aspect-${aspect}">${player}</div>${attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : ""}</figure>`;
    }
    case "mathInline":
    case "mathBlock": {
      const index = context.math.length;
      const latex = String(attrs.latex ?? "");
      const rendered = katex.renderToString(latex, { displayMode: node.type === "mathBlock", throwOnError: false, trust: false, strict: "error", maxExpand: 300, maxSize: 20, output: "htmlAndMathml" });
      context.math.push(rendered);
      const id = node.type === "mathBlock" ? uniqueId(String(attrs.id ?? `eq-formula-${index + 1}`), context.usedIds) : undefined;
      const number = node.type === "mathBlock" && attrs.numbered === true ? ++context.formula : null;
      const math = `<span data-math-index="${index}"></span>`;
      if (node.type === "mathInline") return `<span class="math-inline" data-latex="${escapeHtml(latex)}">${math}</span>`;
      return `<figure class="math-block" id="${id}" data-latex="${escapeHtml(latex)}">${math}${number ? `<a class="equation-number" href="#${id}" aria-label="Equation ${number}">(${number})</a>` : ""}<button type="button" data-math-copy="true" aria-label="Copy LaTeX">Copy LaTeX</button></figure>`;
    }
    case "mermaid": return `<figure class="mermaid-block" data-mermaid="true"><pre class="mermaid-source"><code>${escapeHtml(attrs.code)}</code></pre><div class="mermaid-output" aria-live="polite"></div><div class="mermaid-controls"><button type="button" data-mermaid-action="copy">Copy source</button><button type="button" data-mermaid-action="zoom">Zoom</button><button type="button" data-mermaid-action="svg">SVG</button><button type="button" data-mermaid-action="png">PNG</button></div></figure>`;
    case "footnote": {
      const id = String(attrs.id), footnote = context.footnotes.get(id) ?? { id, text: String(attrs.text), number: context.footnotes.size + 1, references: [] };
      context.footnotes.set(id, footnote);
      const number = footnote.number;
      const reference = `footnote-ref-${number}-${footnote.references.length + 1}`;
      footnote.references.push(reference);
      return `<sup class="footnote-reference" id="${reference}"><a href="#footnote-${number}" aria-label="Footnote ${number}">${number}</a></sup>`;
    }
    case "tableOfContents": {
      type Entry = Heading & { children: Entry[] };
      const root: Entry[] = [], stack: Entry[] = [];
      for (const heading of context.headings) {
        const entry: Entry = { ...heading, children: [] };
        while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
        (stack.length ? stack[stack.length - 1].children : root).push(entry);
        stack.push(entry);
      }
      const list = (entries: Entry[]): string => `<ol>${entries.map((entry) => `<li><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a>${entry.children.length ? list(entry.children) : ""}</li>`).join("")}</ol>`;
      return `<nav class="table-of-contents" aria-label="Table of contents">${list(root)}</nav>`;
    }
    case "callout": return `<aside class="callout callout-${escapeHtml(attrs.kind)}" data-kind="${escapeHtml(attrs.kind)}"><div class="callout-title"><span aria-hidden="true">${{ info: "ⓘ", note: "✎", tip: "◇", warning: "⚠", important: "!" }[String(attrs.kind)] ?? "ⓘ"}</span> ${escapeHtml(attrs.title || attrs.kind)}</div><div>${content}</div></aside>`;
    case "toggle": return `<details class="toggle-block"${attrs.open ? " open" : ""}><summary>${escapeHtml(attrs.title)}</summary><div>${content}</div></details>`;
    case "gallery": return `<div class="image-gallery gallery-${escapeHtml(attrs.layout || "grid")}">${content}</div>`;
    case "linkPreview": {
      let host = "";
      try { host = new URL(String(attrs.url)).hostname; } catch { /* Validated before publication. */ }
      return `<a class="link-preview" href="${escapeHtml(attrs.url)}" target="_blank" rel="noopener noreferrer ugc">${attrs.image ? `<img src="${escapeHtml(attrs.image)}" alt="" loading="lazy" decoding="async">` : ""}<span class="link-preview-body"><strong>${escapeHtml(attrs.title)}</strong><span>${escapeHtml(attrs.description)}</span><span class="link-preview-domain">${escapeHtml(host)}</span></span></a>`;
    }
    default: throw new Error("Unknown document node.");
  }
}

export function renderDocument(document: EditorDocument): string {
  const context = scan(document);
  let source = nodeHtml(document, context);
  if (context.footnotes.size) source += `<section class="footnotes" aria-label="Footnotes"><hr><ol>${[...context.footnotes.values()].map((note, index) => `<li id="footnote-${index + 1}"><p>${escapeHtml(note.text)} ${note.references.map((reference, occurrence) => `<a href="#${reference}" aria-label="Back to reference ${occurrence + 1}">↩</a>`).join(" ")}</p></li>`).join("")}</ol></section>`;
  const html = sanitizeHtml(source, {
    allowedTags: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "s", "u", "sub", "sup", "mark", "code", "pre", "a", "blockquote", "ul", "ol", "li", "hr", "br", "div", "table", "tbody", "tr", "th", "td", "img", "label", "input", "iframe", "video", "span", "button", "figure", "figcaption", "nav", "aside", "details", "summary", "section"],
    allowedAttributes: {
      "*": ["class", "id", "aria-label"],
      a: ["href", "target", "rel", "title"],
      img: ["src", "srcset", "sizes", "alt", "title", "width", "height", "loading", "decoding", "data-lightbox"],
      span: ["aria-hidden", "data-math-index", "data-latex"],
      figure: ["data-latex", "data-mermaid"],
      button: ["type", "aria-pressed", "data-code-copy", "data-math-copy", "data-mermaid-action"],
      iframe: ["src", "title", "width", "height", "loading", "allow", "allowfullscreen", "referrerpolicy", "sandbox"],
      video: ["src", "controls", "playsinline", "preload", "poster"],
      input: ["type", "disabled", "checked"],
      li: ["data-type", "data-checked"], ul: ["data-type"], ol: ["start", "type"],
      div: ["data-vm-motion", "data-vm-src", "data-vm-poster", "data-code-block", "aria-live"],
      code: ["data-language"], aside: ["data-kind"], details: ["open"],
      th: ["colspan", "rowspan", "style"], td: ["colspan", "rowspan", "style"],
      p: ["style"], h1: ["style"], h2: ["style"], h3: ["style"], h4: ["style"], h5: ["style"], h6: ["style"],
    },
    allowedClasses: {
      div: ["table-wrap", "video-block", "video-file", "video-embed", "vm-image", "code-block", "code-header", "code-wrap", "code-lines", "mermaid-output", "mermaid-controls", "callout-title", "image-gallery", "gallery-*", "aspect-*"],
      img: ["vm-image-source"], span: ["vm-image-placeholder", "text-*", "math-inline", "link-preview-body", "link-preview-domain"], button: ["vm-motion-toggle"], code: ["language-*"],
      mark: ["highlight-*"], figure: ["image-figure", "image-left", "image-center", "image-right", "video-figure", "math-block", "mermaid-block"],
      sup: ["footnote-reference"], pre: ["mermaid-source"], nav: ["table-of-contents"], aside: ["callout", "callout-*"], details: ["toggle-block"], section: ["footnotes"], a: ["equation-number", "link-preview"],
    },
    allowedStyles: { "*": { "text-align": [/^(left|center|right|justify)$/u], width: [/^[0-9]{1,6}px$/u] } },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"], iframe: ["https"], video: ["https"] },
    allowedIframeHostnames: VIDEO_FRAME_ORIGINS.map((origin) => new URL(origin).hostname),
    allowIframeRelativeUrls: false, allowProtocolRelative: false, enforceHtmlBoundary: true,
  });
  // KaTeX is the only HTML inserted after sanitization: generated by this library,
  // with trust disabled and bounded expansion. User HTML never bypasses the sanitizer.
  return html.replace(/<span data-math-index="([0-9]+)"><\/span>/gu, (_, index: string) => context.math[Number(index)] ?? "");
}
