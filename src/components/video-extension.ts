import { Node } from '@tiptap/core';
import { DOMSerializer, type DOMOutputSpec } from '@tiptap/pm/model';
import { isCanonicalVideo, isUploadedPoster, normaliseVideoUrl } from '@/lib/media-url';

function attributes(element: HTMLElement) {
  const src = element.dataset.videoSrc ?? element.querySelector('iframe,video')?.getAttribute('src') ?? element.getAttribute('src') ?? '';
  const normalized = normaliseVideoUrl(src);
  const posterSrc = element.dataset.videoPoster ?? element.querySelector('video')?.getAttribute('poster') ?? element.getAttribute('poster');
  return normalized ? { ...normalized, ...(isUploadedPoster(posterSrc) && normalized.provider === 'file' ? { posterSrc } : {}) } : null;
}

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      provider: { default: null, parseHTML: element => attributes(element)?.provider ?? null },
      src: { default: null, parseHTML: element => attributes(element)?.src ?? null },
      caption: { default: null, parseHTML: element => element.closest('figure')?.querySelector('figcaption')?.textContent ?? element.getAttribute('data-caption') },
      aspectRatio: { default: '16:9', parseHTML: element => element.getAttribute('data-aspect-ratio') ?? '16:9' },
      posterSrc: { default: null, parseHTML: element => attributes(element)?.posterSrc ?? null },
    };
  },
  parseHTML() { return [{ tag: 'div[data-video-src]', getAttrs: element => attributes(element) ? null : false }, { tag: 'video[src]', getAttrs: element => attributes(element) ? null : false }, { tag: 'iframe[src]', getAttrs: element => attributes(element) ? null : false }]; },
  renderHTML({ node }) {
    if (!isCanonicalVideo({ provider: node.attrs.provider, src: node.attrs.src, ...(node.attrs.posterSrc ? { posterSrc: node.attrs.posterSrc } : {}) })) return ['div', { class: 'video-block' }];
    const { src, provider, posterSrc, caption, aspectRatio } = node.attrs;
    return ['div', { class: `video-block ${provider === 'file' ? 'video-file' : 'video-embed'}`, 'data-video-src': src, 'data-video-provider': provider, 'data-caption': caption, 'data-aspect-ratio': aspectRatio, ...(posterSrc ? { 'data-video-poster': posterSrc } : {}), contenteditable: 'false' },
      provider === 'file'
        ? ['video', { src, ...(posterSrc ? { poster: posterSrc } : {}), controls: '', preload: 'metadata', playsinline: '', 'aria-label': 'Video' }]
        : ['iframe', { src, title: 'Video', loading: 'lazy', allow: 'encrypted-media; fullscreen; picture-in-picture', allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation' }],
      ...(caption ? [['p', { class: 'v2-video-caption' }, caption] as DOMOutputSpec] : []),
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure'); dom.className = 'v2-editor-video'; let current = node; let timer: ReturnType<typeof setTimeout> | undefined;
      const updateAttrs = (attrs: Record<string, unknown>) => { const pos = getPos(); if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs })); };
      const draw = () => { clearTimeout(timer); const valid = isCanonicalVideo({ provider: current.attrs.provider, src: current.attrs.src, ...(current.attrs.posterSrc ? { posterSrc: current.attrs.posterSrc } : {}) }); dom.replaceChildren();
        if (!valid) { dom.textContent = 'Unsupported video URL'; return; }
        const player = document.createElement('div'); player.className = `video-block ${current.attrs.provider === 'file' ? 'video-file' : 'video-embed'}`; player.style.aspectRatio = String(current.attrs.aspectRatio ?? '16:9').replace(':',' / '); player.contentEditable = 'false';
        const element = document.createElement(current.attrs.provider === 'file' ? 'video' : 'iframe'); element.setAttribute('src', current.attrs.src); element.setAttribute('title', 'Video');
        const error = document.createElement('p'); error.className = 'v2-video-error'; error.hidden = true; const link = document.createElement('a'); link.href = current.attrs.src; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open video'; error.append('Video unavailable? ', link);
        if (element instanceof HTMLVideoElement) { element.controls = true; element.preload = 'metadata'; element.playsInline = true; if (current.attrs.posterSrc) element.poster = current.attrs.posterSrc; element.addEventListener('error', () => { error.hidden = false; }); }
        else { element.setAttribute('loading','lazy'); element.setAttribute('allow','encrypted-media; fullscreen; picture-in-picture'); element.setAttribute('allowfullscreen',''); element.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation'); element.setAttribute('referrerpolicy','strict-origin-when-cross-origin'); element.addEventListener('error', () => { error.hidden = false; }); timer = setTimeout(() => { error.hidden = false; }, 12000); element.addEventListener('load', () => clearTimeout(timer)); }
        player.append(element); dom.append(player); if (current.attrs.caption) { const caption = document.createElement('figcaption'); caption.textContent = current.attrs.caption; dom.append(caption); } dom.append(error);
        const controls = document.createElement('div'); controls.className = 'v2-video-controls'; controls.contentEditable = 'false'; const captionInput = document.createElement('input'); captionInput.setAttribute('aria-label','Video caption'); captionInput.placeholder = 'Caption'; captionInput.maxLength = 1000; captionInput.value = current.attrs.caption ?? ''; captionInput.addEventListener('change', () => updateAttrs({ caption: captionInput.value })); controls.append(captionInput);
        const ratio = document.createElement('select'); ratio.setAttribute('aria-label','Video aspect ratio'); for (const value of ['16:9','4:3','1:1','9:16']) { const option = document.createElement('option'); option.value = value; option.textContent = value; ratio.append(option); } ratio.value = current.attrs.aspectRatio ?? '16:9'; ratio.addEventListener('change', () => updateAttrs({ aspectRatio: ratio.value })); controls.append(ratio);
        const url = document.createElement('input'); url.type = 'url'; url.setAttribute('aria-label','Replace video URL'); url.value = current.attrs.src; controls.append(url); const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'text-button'; replace.textContent = 'Replace URL'; replace.addEventListener('click', () => { const attrs = normaliseVideoUrl(url.value); if (!attrs) { error.hidden = false; url.setCustomValidity('Use a supported HTTPS video URL.'); url.reportValidity(); return; } url.setCustomValidity(''); updateAttrs({ ...attrs, posterSrc: null }); }); controls.append(replace); dom.append(controls);
      }; draw();
      return { dom, update(next) { if (next.type !== current.type) return false; const changed = JSON.stringify(next.attrs) !== JSON.stringify(current.attrs); current = next; if (changed) draw(); return true; }, selectNode() { dom.classList.add('is-selected'); }, deselectNode() { dom.classList.remove('is-selected'); }, stopEvent: event => event.target instanceof Element && !!event.target.closest('video,iframe,.v2-video-controls'), ignoreMutation: mutation => mutation.type !== 'selection', destroy() { clearTimeout(timer); } };
    };
  },
  markdownTokenizer: {
    name: 'video', level: 'block',
    start: src => src.indexOf('[video]('),
    tokenize(src) {
      const match = /^\[video\]\(((?:https:\/\/[^\s\n]+|\/api\/v1\/media\/[A-Za-z0-9_-]{32}\.(?:mp4|webm)))\)(?:\n|$)/.exec(src);
      if (!match) return undefined;
      const attrs = normaliseVideoUrl(match[1]);
      return attrs ? { type: 'video', raw: match[0], ...attrs } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('video', { provider: token.provider, src: token.src }),
  renderMarkdown: node => node.attrs?.caption || node.attrs?.aspectRatio !== '16:9' ? `<div data-video-src="${String(node.attrs?.src ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-caption="${String(node.attrs?.caption ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-aspect-ratio="${String(node.attrs?.aspectRatio ?? '16:9')}"${isUploadedPoster(node.attrs?.posterSrc) ? ` data-video-poster="${node.attrs.posterSrc}"` : ''}></div>` : node.attrs?.provider === 'file' && isUploadedPoster(node.attrs?.posterSrc)
    ? `<div data-video-src="${String(node.attrs.src).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-video-poster="${node.attrs.posterSrc}"><video src="${String(node.attrs.src).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" poster="${node.attrs.posterSrc}" controls playsinline preload="metadata"></video></div>`
    : `[video](${node.attrs?.src ?? ''})`,
});
