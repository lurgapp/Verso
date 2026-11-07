import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';
import { attachMotionImage } from './controlled-media';
import { isSafeUrl } from '@/lib/document';
import { isUploadedPoster, mayAnimateImage } from '@/lib/media-url';

function escapeAttribute(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }

function imageSpec(options: { HTMLAttributes: Record<string, unknown> }, attrs: Record<string, unknown>, html: Record<string, unknown>): DOMOutputSpec {
  const { src, animated, posterSrc } = attrs;
  if (!mayAnimateImage(typeof src === 'string' ? src : '', animated)) return ['img', mergeAttributes(options.HTMLAttributes, html)];
  const poster = isUploadedPoster(posterSrc) ? posterSrc : null;
  return ['div', { class: 'vm-image', 'data-vm-motion': 'image', 'data-vm-src': src, ...(poster ? { 'data-vm-poster': poster } : {}), contenteditable: 'false' },
    ['img', mergeAttributes(options.HTMLAttributes, html, { src: poster ?? src, class: 'vm-image-source' })],
    ['span', { class: 'vm-image-placeholder', 'aria-hidden': 'true' }, 'Animation'],
    ['button', { type: 'button', class: 'vm-motion-toggle', 'aria-pressed': 'false', 'aria-label': 'Play animation' }, 'Play animation'],
  ];
}

/** Keep the standard image node and Markdown compatibility while preserving animation metadata. */
export const AnimatedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: element => { const value = Number(element.getAttribute('width')); return Number.isInteger(value) && value > 0 && value <= 20000 ? value : null; } },
      height: { default: null, parseHTML: element => { const value = Number(element.getAttribute('height')); return Number.isInteger(value) && value > 0 && value <= 20000 ? value : null; } },
      caption: { default: null, parseHTML: element => element.closest('figure')?.querySelector('figcaption')?.textContent ?? element.getAttribute('data-caption') },
      align: { default: 'center', parseHTML: element => element.getAttribute('data-align') ?? 'center' },
      thumbnailSrc: { default: null, parseHTML: element => element.getAttribute('data-thumbnail-src') },
      sourceWidth: { default: null, parseHTML: element => Number(element.getAttribute('data-source-width')) || null },
      thumbnailWidth: { default: null, parseHTML: element => Number(element.getAttribute('data-thumbnail-width')) || null },
      src: { default: null, parseHTML: element => element.closest('[data-vm-src]')?.getAttribute('data-vm-src') ?? element.getAttribute('src') },
      animated: { default: null, rendered: false, parseHTML: element => element.getAttribute('data-vm-animated') === 'true' || element.closest('[data-vm-motion]') ? true : null },
      posterSrc: { default: null, rendered: false, parseHTML: element => { const poster = element.closest('[data-vm-poster]')?.getAttribute('data-vm-poster'); return isUploadedPoster(poster) ? poster : null; } },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'vm-editor-image';
      let current = node;
      let cleanup = () => {};
      const draw = () => {
        cleanup();
        const spec = imageSpec(this.options, current.attrs, { src: current.attrs.src, alt: current.attrs.alt ?? '', ...(current.attrs.title ? { title: current.attrs.title } : {}), ...(current.attrs.width ? { width: current.attrs.width } : {}), ...(current.attrs.height ? { height: current.attrs.height } : {}) });
        const rendered = DOMSerializer.renderSpec(document, spec);
        const figure = document.createElement('figure'); figure.className = 'v2-editor-figure'; figure.dataset.align = String(current.attrs.align ?? 'center'); figure.append(rendered.dom);
        if (current.attrs.caption) { const caption = document.createElement('figcaption'); caption.textContent = String(current.attrs.caption); figure.append(caption); }
        const controls = document.createElement('div'); controls.className = 'v2-image-controls'; controls.contentEditable = 'false';
        const updateAttrs = (attrs: Record<string, unknown>) => { const position = getPos(); if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, ...attrs })); };
        const captionInput = document.createElement('input'); captionInput.setAttribute('aria-label', 'Image caption'); captionInput.placeholder = 'Caption'; captionInput.maxLength = 1000; captionInput.value = String(current.attrs.caption ?? ''); captionInput.addEventListener('change', () => updateAttrs({ caption: captionInput.value })); controls.append(captionInput);
        const altInput = document.createElement('input'); altInput.setAttribute('aria-label', 'Image alternative text'); altInput.placeholder = 'Alternative text'; altInput.maxLength = 500; altInput.value = String(current.attrs.alt ?? ''); altInput.addEventListener('change', () => updateAttrs({ alt: altInput.value })); controls.append(altInput);
        const alignment = document.createElement('select'); alignment.setAttribute('aria-label', 'Image alignment'); for (const value of ['left','center','right']) { const option = document.createElement('option'); option.value = value; option.textContent = value; alignment.append(option); } alignment.value = String(current.attrs.align ?? 'center'); alignment.addEventListener('change', () => updateAttrs({ align: alignment.value })); controls.append(alignment);
        const size = document.createElement('input'); size.type = 'range'; size.min = '100'; size.max = '1000'; size.step = '10'; size.value = String(Math.min(1000, Number(current.attrs.width) || 800)); size.setAttribute('aria-label', 'Image width'); size.addEventListener('input', () => { const img = figure.querySelector('img'); if (img) img.style.width = `${size.value}px`; }); size.addEventListener('change', () => { const previousWidth = Number(current.attrs.width) || Number(size.value); const previousHeight = Number(current.attrs.height); updateAttrs({ width: Number(size.value), ...(previousHeight ? { height: Math.max(1, Math.round(previousHeight * Number(size.value) / previousWidth)) } : {}) }); }); controls.append(size);
        dom.replaceChildren(figure, controls);
        const motion = dom.querySelector<HTMLElement>('[data-vm-motion="image"]');
        cleanup = motion ? attachMotionImage(motion) : () => {};
      };
      draw();
      return {
        dom,
        update(next) { if (next.type !== current.type) return false; const changed = JSON.stringify(next.attrs) !== JSON.stringify(current.attrs); current = next; if (changed) draw(); return true; },
        selectNode() { dom.classList.add('is-selected'); },
        deselectNode() { dom.classList.remove('is-selected'); },
        stopEvent: event => event.target instanceof Element && !!event.target.closest('button.vm-motion-toggle,.v2-image-controls'),
        // Selection mutations belong to ProseMirror; playback DOM mutations do not.
        ignoreMutation: mutation => mutation.type !== 'selection',
        destroy: () => cleanup(),
      };
    };
  },
  renderHTML({ node, HTMLAttributes }) { return imageSpec(this.options, node.attrs, HTMLAttributes); },
  renderMarkdown(node) {
    const attrs = node.attrs ?? {};
    // CommonMark HTML retains the static poster and animation flag through export/import.
    // JSON drafts remain the lossless format for every editor attribute.
    if (attrs.animated === true || attrs.posterSrc || attrs.caption || attrs.align !== 'center' || attrs.thumbnailSrc) {
      return `<img src="${escapeAttribute(attrs.src)}" alt="${escapeAttribute(attrs.alt)}"${attrs.title ? ` title="${escapeAttribute(attrs.title)}"` : ''}${attrs.animated === true ? ' data-vm-animated="true"' : ''}${isUploadedPoster(attrs.posterSrc) ? ` data-vm-poster="${escapeAttribute(attrs.posterSrc)}"` : ''}${attrs.width ? ` width="${Number(attrs.width)}"` : ''}${attrs.height ? ` height="${Number(attrs.height)}"` : ''}${attrs.caption ? ` data-caption="${escapeAttribute(attrs.caption)}"` : ''} data-align="${escapeAttribute(attrs.align ?? 'center')}"${attrs.thumbnailSrc && isSafeUrl(attrs.thumbnailSrc, true) ? ` data-thumbnail-src="${escapeAttribute(attrs.thumbnailSrc)}"` : ''}${attrs.sourceWidth ? ` data-source-width="${Number(attrs.sourceWidth)}"` : ''}${attrs.thumbnailWidth ? ` data-thumbnail-width="${Number(attrs.thumbnailWidth)}"` : ''}>`;
    }
    const alt = String(attrs.alt ?? '').replace(/([\\\[\]])/g, '\\$1');
    const title = attrs.title ? ` "${String(attrs.title).replace(/([\\"])/g, '\\$1')}"` : '';
    return `![${alt}](${String(attrs.src ?? '').replace(/\(/g, '%28').replace(/\)/g, '%29')}${title})`;
  },
});
