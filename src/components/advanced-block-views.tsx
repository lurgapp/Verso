'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, Minus, Plus, WrapText } from 'lucide-react';
import { highlightCode } from '@/lib/client/code-highlight';

function ru() { return typeof document !== 'undefined' && document.documentElement.lang === 'ru'; }
async function copy(value: string) { await navigator.clipboard.writeText(value); }
function save(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function useDark() {
  const [dark, setDark] = useState(false);
  const [, refreshLanguage] = useState(0);
  useEffect(() => { const update = () => setDark(document.documentElement.dataset.theme === 'dark'); update(); const observer = new MutationObserver(changes => { update(); if (changes.some(change => change.attributeName === 'lang')) refreshLanguage(value => value + 1); }); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'lang'] }); return () => observer.disconnect(); }, []);
  return dark;
}

export function CodeBlockView({ code, language = 'text', filename, lineNumbers = false, wrap = false }: { code: string; language?: string; filename?: string; lineNumbers?: boolean; wrap?: boolean }) {
  const dark = useDark();
  const [html, setHtml] = useState('');
  const [wrapped, setWrapped] = useState(wrap);
  const [copied, setCopied] = useState(false);
  useEffect(() => setWrapped(wrap), [wrap]);
  useEffect(() => { let current = true; const timer = setTimeout(() => { highlightCode(code, language, dark).then(result => { if (current) setHtml(result); }).catch(() => { if (current) setHtml(''); }); }, 120); return () => { current = false; clearTimeout(timer); }; }, [code, language, dark]);
  return <div className={`advanced-code${wrapped ? ' code-wrap' : ''}${lineNumbers ? ' code-line-numbers' : ''}`}>
    <div className="advanced-block-bar"><span>{filename || language || 'text'}</span><span className="advanced-block-actions"><button type="button" aria-label={ru() ? 'Перенос строк' : 'Wrap lines'} aria-pressed={wrapped} onClick={() => setWrapped(value => !value)}><WrapText size={15}/></button><button type="button" aria-label={ru() ? 'Копировать код' : 'Copy code'} onClick={() => { copy(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => setCopied(false)); }}><Copy size={14}/>{copied ? '✓' : ''}</button></span></div>
    {html ? <div className="advanced-code-highlight" dangerouslySetInnerHTML={{ __html: html }}/> : <pre><code>{code}</code></pre>}
  </div>;
}

export function MathView({ latex, display = false, numbered = false, number }: { latex: string; display?: boolean; numbered?: boolean; number?: number }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { let current = true; import('katex').then(katex => {
    try { const result = katex.default.renderToString(latex, { displayMode: display, throwOnError: true, trust: false, strict: 'error', maxSize: 20, maxExpand: 300, output: 'htmlAndMathml' }); if (current) { setHtml(result); setError(''); } }
    catch (cause) { if (current) { setHtml(''); setError(cause instanceof Error ? cause.message : 'Invalid formula'); } }
  }).catch(() => { if (current) setError('Formula preview unavailable'); }); return () => { current = false; }; }, [latex, display]);
  const Tag = display ? 'div' : 'span';
  return <Tag className={`advanced-math${display ? ' advanced-math-display' : ''}`}>
    {html ? <span dangerouslySetInnerHTML={{ __html: html }}/> : <code>{latex || (ru() ? 'Формула' : 'Formula')}</code>}
    {error && <span className="advanced-block-error" role="status">{error}</span>}
    {numbered && <span className="math-number" aria-label={ru() ? 'Нумерованная формула' : 'Numbered formula'}>{number ? `(${number})` : '№'}</span>}
  </Tag>;
}

// Mermaid is loaded only when a diagram is actually displayed. Its configuration
// cannot be changed by a document; a second SVG sanitizer also removes links.
let diagramQueue: Promise<unknown> = Promise.resolve();
export async function renderSafeDiagram(id: string, source: string, dark: boolean) {
  const task = diagramQueue.catch(() => undefined).then(async () => {
    if (!source.trim() || source.length > 20000) throw new Error(ru() ? 'Диаграмма пуста или слишком велика (20 000 символов).' : 'The diagram is empty or exceeds 20,000 characters.');
    if (/^\s*---|%%\s*\{|\b(?:click|linkStyle|classDef|style)\b/imu.test(source)) throw new Error(ru() ? 'Директивы конфигурации и внешние действия отключены.' : 'Configuration directives and external actions are disabled.');
    const [{ default: mermaid }, { default: purifier }] = await Promise.all([import('mermaid'), import('dompurify')]);
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', htmlLabels: false, suppressErrorRendering: true, maxTextSize: 20000, maxEdges: 500, secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'theme', 'themeCSS', 'flowchart'], flowchart: { htmlLabels: false, useMaxWidth: true }, fontFamily: 'Inter, sans-serif' });
    const result = await mermaid.render(id, source);
    const clean = purifier.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'], FORBID_ATTR: ['onload', 'onclick', 'onerror', 'src'] });
    const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml');
    parsed.querySelectorAll('*').forEach(element => [...element.attributes].forEach(attribute => {
      if (/^on/iu.test(attribute.name) || ((attribute.localName === 'href' || attribute.name === 'xlink:href') && !attribute.value.startsWith('#')) || /(?:url\(\s*['"]?(?!#)|@import|expression\s*\()/iu.test(attribute.value)) element.removeAttribute(attribute.name);
    }));
    // Mermaid's generated styles are retained only if all URL references are local.
    parsed.querySelectorAll('style').forEach(style => { if (/@import|url\(\s*['"]?(?!#)|expression\s*\(/iu.test(style.textContent || '')) style.remove(); });
    parsed.documentElement.setAttribute('role', 'img');
    parsed.documentElement.setAttribute('aria-label', parsed.querySelector('title')?.textContent || (ru() ? 'Диаграмма Mermaid' : 'Mermaid diagram'));
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('Invalid diagram output');
    return new XMLSerializer().serializeToString(parsed.documentElement);
  });
  diagramQueue = task;
  return task;
}

export function MermaidView({ code, editable = false }: { code: string; editable?: boolean }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/gu, '');
  const ref = useRef<HTMLDivElement>(null);
  const dark = useDark();
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => { let current = true; const timer = setTimeout(() => { renderSafeDiagram(`verso-diagram-${id}`, code, dark).then(value => { if (current) { setSvg(value); setError(''); } }).catch(cause => { if (current) { setSvg(''); setError(cause instanceof Error ? cause.message : 'Invalid diagram'); } }); }, editable ? 400 : 0); return () => { current = false; clearTimeout(timer); }; }, [code, dark, id, editable]);
  const png = async () => {
    try {
      setExportError('');
      const element = ref.current?.querySelector('svg');
      if (!element) return;
      const box = element.viewBox.baseVal;
      const width = Math.max(1, Math.min(4096, Math.ceil(box.width || element.getBoundingClientRect().width || 800)));
      const height = Math.max(1, Math.min(4096, Math.ceil(box.height || element.getBoundingClientRect().height || 600)));
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = width * (width < 2048 ? 2 : 1); canvas.height = height * (height < 2048 ? 2 : 1);
        const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
        context.fillStyle = dark ? '#161616' : '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('Export failed'); save(blob, 'verso-diagram.png');
      } finally { URL.revokeObjectURL(url); }
    } catch { setExportError(ru() ? 'Не удалось создать PNG. Скачайте SVG.' : 'PNG export failed. Download SVG instead.'); }
  };
  return <div className="advanced-mermaid">
    <div className="advanced-block-bar"><button type="button" onClick={() => setSourceVisible(value => !value)} aria-expanded={sourceVisible}>Mermaid · {ru() ? 'исходник' : 'source'}</button><span className="advanced-block-actions">
      <button type="button" aria-label={ru() ? 'Уменьшить диаграмму' : 'Zoom out diagram'} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}><Minus size={14}/></button>
      <button type="button" aria-label={ru() ? 'Увеличить диаграмму' : 'Zoom in diagram'} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><Plus size={14}/></button>
      <button type="button" aria-label={ru() ? 'Копировать исходник диаграммы' : 'Copy diagram source'} onClick={() => copy(code).catch(() => setExportError(ru() ? 'Буфер обмена недоступен.' : 'Clipboard unavailable.'))}><Copy size={14}/></button>
      <button type="button" disabled={!svg} onClick={() => save(new Blob([svg], { type: 'image/svg+xml' }), 'verso-diagram.svg')}><Download size={14}/> SVG</button>
      <button type="button" disabled={!svg} onClick={png}>PNG</button>
    </span></div>
    <div className="mermaid-scroll" ref={ref}>{svg ? <div style={{ width: `${zoom * 100}%`, minWidth: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }}/> : <pre><code>{code}</code></pre>}</div>
    {sourceVisible && <pre className="mermaid-source"><code>{code}</code></pre>}
    {error && <p className="advanced-block-error" role="status">{error}</p>}
    {exportError && <p className="advanced-block-error" role="status">{exportError}</p>}
  </div>;
}
