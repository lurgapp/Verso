'use client';

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { CodeBlockView, MermaidView } from './advanced-block-views';
import { usePreferences } from './preferences';

type Picture = { src: string; alt: string; caption: string };
/** Progressive enhancement of server-sanitized HTML, deliberately independent of TipTap. */
export function ArticleEnhancements() {
  const { language } = usePreferences();
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const ru = language === 'ru';
  useEffect(() => {
    const prose = document.querySelector<HTMLElement>('.article-prose');
    if (!prose) return;
    const roots: Root[] = [];
    const cleanups: (() => void)[] = [];
    const deferred: (() => void)[] = [];
    const lazy = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { lazy.unobserve(entry.target); const run = deferred[Number((entry.target as HTMLElement).dataset.v2Mount)]; run?.(); }
    }), { rootMargin: '300px' });
    const mount = (element: HTMLElement, render: () => React.ReactNode) => {
      const position = deferred.push(() => { if (!element.isConnected) return; const root = createRoot(element); roots.push(root); root.render(render()); }) - 1;
      element.dataset.v2Mount = String(position);
      lazy.observe(element);
    };
    prose.querySelectorAll<HTMLElement>('[data-code-block]').forEach(block => {
      const code = block.querySelector('pre>code');
      if (!code) return;
      const source = code.textContent || '';
      const lang = code.getAttribute('data-language') || code.className.replace(/^language-/u, '') || 'text';
      const filename = block.querySelector('.code-header>span')?.textContent || undefined;
      const lineNumbers = block.classList.contains('code-lines'), wrap = block.classList.contains('code-wrap');
      mount(block, () => <CodeBlockView code={source} language={lang} filename={filename} lineNumbers={lineNumbers} wrap={wrap}/>);
    });
    prose.querySelectorAll<HTMLElement>('[data-mermaid]').forEach(block => {
      const code = block.querySelector('.mermaid-source>code')?.textContent || '';
      const target = document.createElement('div');
      block.append(target);
      cleanups.push(() => target.remove());
      mount(target, () => <MermaidView code={code}/>);
    });
    const headings = [...prose.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
    headings.forEach(heading => {
      const oldLabel = heading.getAttribute('aria-label');
      heading.setAttribute('aria-label', heading.textContent || '');
      const button = document.createElement('button'); button.dataset.readerI18n = 'heading-link'; button.type = 'button'; button.className = 'heading-anchor-copy'; button.textContent = '#'; button.setAttribute('aria-label', ru ? 'Копировать ссылку на раздел' : 'Copy section link');
      const click = () => { const url = new URL(location.href); url.hash = heading.id; navigator.clipboard.writeText(url.href).then(() => { button.textContent = '✓'; setTimeout(() => { button.textContent = '#'; }, 1400); }).catch(() => { location.hash = heading.id; }); };
      button.addEventListener('click', click); heading.append(button); cleanups.push(() => { button.remove(); if (oldLabel === null) heading.removeAttribute('aria-label'); else heading.setAttribute('aria-label', oldLabel); });
    });
    const tocLinks = [...prose.querySelectorAll<HTMLAnchorElement>('.table-of-contents a[href^="#"]')];
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
      const active = headings.find(heading => visible.has(heading)) || [...headings].reverse().find(heading => heading.getBoundingClientRect().top < 150);
      tocLinks.forEach(link => active && link.hash === `#${active.id}` ? link.setAttribute('aria-current', 'true') : link.removeAttribute('aria-current'));
    }, { rootMargin: '-50px 0px -55% 0px', threshold: 0 });
    headings.forEach(heading => observer.observe(heading));
    const imageElements = [...prose.querySelectorAll<HTMLImageElement>('img[data-lightbox]')];
    setPictures(imageElements.map(image => ({ src: image.getAttribute('src') || '', alt: image.alt, caption: image.closest('figure')?.querySelector('figcaption')?.textContent || image.alt })));
    imageElements.forEach((image, position) => {
      const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'image-lightbox-trigger'; trigger.dataset.imageAlt = image.alt;
      trigger.setAttribute('aria-label', `${ru ? 'Открыть изображение' : 'Open image'}${image.alt ? `: ${image.alt}` : ''}`);
      image.before(trigger); trigger.append(image);
      const open = () => { returnFocus.current = trigger; setIndex(position); };
      trigger.addEventListener('click', open);
      cleanups.push(() => { trigger.removeEventListener('click', open); trigger.replaceWith(image); });
    });
    const copyMath = (event: Event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-math-copy]');
      if (!target) return;
      const latex = target.closest<HTMLElement>('[data-latex]')?.dataset.latex;
      if (latex) navigator.clipboard.writeText(latex).then(() => { const old = target.textContent; target.textContent = '✓'; setTimeout(() => { target.textContent = old; }, 1400); }).catch(() => undefined);
    };
    prose.addEventListener('click', copyMath);
    return () => { lazy.disconnect(); observer.disconnect(); prose.removeEventListener('click', copyMath); cleanups.forEach(cleanup => cleanup()); roots.forEach(root => queueMicrotask(() => root.unmount())); };
  }, []);
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('[data-reader-i18n="heading-link"]').forEach(button => button.setAttribute('aria-label', ru ? 'Копировать ссылку на раздел' : 'Copy section link'));
    document.querySelectorAll<HTMLElement>('.article-prose .image-lightbox-trigger').forEach(button => button.setAttribute('aria-label', `${ru ? 'Открыть изображение' : 'Open image'}${button.dataset.imageAlt ? `: ${button.dataset.imageAlt}` : ''}`));
    document.querySelectorAll<HTMLElement>('[data-math-copy]').forEach(button => { button.setAttribute('aria-label', ru ? 'Копировать LaTeX' : 'Copy LaTeX'); button.textContent = ru ? 'Копировать LaTeX' : 'Copy LaTeX'; });
  }, [ru]);
  useEffect(() => {
    if (index === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIndex(null); }
      if (event.key === 'ArrowRight') setIndex(value => value === null ? null : (value + 1) % pictures.length);
      if (event.key === 'ArrowLeft') setIndex(value => value === null ? null : (value - 1 + pictures.length) % pictures.length);
      if (event.key === 'Tab') { const buttons = [...document.querySelectorAll<HTMLButtonElement>('.v2-lightbox button')]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = event.shiftKey ? (current - 1 + buttons.length) % buttons.length : (current + 1) % buttons.length; event.preventDefault(); buttons[next]?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard); returnFocus.current?.focus(); };
  }, [index, pictures.length]);
  if (index === null || !pictures[index]) return null;
  const picture = pictures[index];
  return createPortal(<div className="v2-lightbox" role="dialog" aria-modal="true" aria-label={ru ? 'Просмотр изображения' : 'Image viewer'} onClick={event => { if (event.target === event.currentTarget) setIndex(null); }}>
    <button className="v2-lightbox-close" ref={closeRef} aria-label={ru ? 'Закрыть изображение' : 'Close image'} onClick={() => setIndex(null)}><X size={22}/></button>
    {pictures.length > 1 && <><button className="v2-lightbox-prev" aria-label={ru ? 'Предыдущее изображение' : 'Previous image'} onClick={() => setIndex((index - 1 + pictures.length) % pictures.length)}><ChevronLeft/></button><button className="v2-lightbox-next" aria-label={ru ? 'Следующее изображение' : 'Next image'} onClick={() => setIndex((index + 1) % pictures.length)}><ChevronRight/></button></>}
    <img src={picture.src} alt={picture.alt} referrerPolicy="no-referrer"/>
    <p className="v2-lightbox-caption">{picture.caption}{pictures.length > 1 && ` · ${index + 1} / ${pictures.length}`}</p>
  </div>, document.body);
}
