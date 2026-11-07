'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { CellSelection } from '@tiptap/pm/tables';
import { BLOCK_COMMANDS, filterBlockCommands, type BlockCommand } from './editor-block-registry';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from './editor-extensions';
import { moveCurrentBlock, moveTopLevelBlock, parseDelimited, tableFromRows, preservePlainUrls } from './editor-transforms';
import { MathView, MermaidView } from './advanced-block-views';
import { Bold, Italic, Strikethrough, Link2, Code, Heading, Quote, List, ListOrdered, ListTodo, Table2, Minus, Braces, ChevronDown, Upload, Plus, Camera, Check, Loader2, Film, Underline, Highlighter, MoreHorizontal, Subscript, Superscript, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/lib/client/storage';
import { isSafeUrl } from '@/lib/document';
import { mayAnimateImage, normaliseVideoUrl, type VideoAttributes } from '@/lib/media-url';
import { Dialog, ErrorMessage, IconButton } from './ui';
import { usePreferences } from './preferences';
import { ControlledImagePreview } from './controlled-media';

type SelectionRange = { from: number; to: number };

function fileKind(file: File): 'image' | 'video' | null {
  if (/^video\/(mp4|webm)$/.test(file.type) || (!file.type && /\.(mp4|webm)$/i.test(file.name))) return 'video';
  if (/^image\/(png|apng|jpeg|gif|webp|avif)$/.test(file.type) || (!file.type && /\.(png|apng|jpe?g|gif|webp|avif)$/i.test(file.name))) return 'image';
  return null;
}
function validateMediaFile(file: File, expected?: 'image' | 'video') {
  const kind = fileKind(file);
  if (!kind || (expected && expected !== kind)) throw new Error(expected === 'video' ? 'Choose an MP4 or WebM video under 32 MB and 60 seconds.' : 'Choose a PNG, APNG, JPEG, GIF, WebP or AVIF image under 8 MB.');
  if (!file.size || file.size > (kind === 'video' ? 32 : 8) * 1024 * 1024) throw new Error(kind === 'video' ? 'Choose an MP4 or WebM video under 32 MB and 60 seconds.' : 'Choose a PNG, APNG, JPEG, GIF, WebP or AVIF image under 8 MB.');
}


async function fileHasAnimation(file: File): Promise<boolean> {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) return true;
  if (file.type === 'image/jpeg' || file.type === 'image/avif' || /\.(jpe?g|avif)$/i.test(file.name)) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tag = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const view = new DataView(bytes.buffer);
  if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      if (tag(offset, 4) === 'ANIM' || tag(offset, 4) === 'ANMF') return true;
      const length = view.getUint32(offset + 4, true); offset += 8 + length + (length % 2);
    }
    return false;
  }
  if (tag(1, 3) === 'PNG') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const type = tag(offset + 4, 4); if (type === 'acTL') return true; if (type === 'IDAT' || type === 'IEND') return false;
      offset += 12 + view.getUint32(offset);
    }
  }
  return false;
}

type UploadedMedia = { url: string; kind: 'image' | 'video'; animated: boolean; posterUrl?: string; width: number; height: number; thumbnailUrl?: string; thumbnailWidth?: number };
async function uploadMediaFile(file: File, signal?: AbortSignal) { validateMediaFile(file); const body = new FormData(); body.set('file', file); return api<UploadedMedia>('/api/v1/media', { method: 'POST', body, signal }); }
export async function uploadImage(editor: Editor, file: File, selection?: SelectionRange, alt?: string, signal?: AbortSignal) {
  const media = await uploadMediaFile(file, signal);
  const chain = editor.chain().focus();
  if (selection) chain.setTextSelection(selection);
  const poster = media.posterUrl ? { posterSrc: media.posterUrl } : {};
  if (media.kind === 'video') chain.insertContent([{ type: 'video', attrs: { provider: 'file', src: media.url, ...poster } }, { type: 'paragraph' }]).run();
  else chain.insertContent({ type: 'image', attrs: { src: media.url, alt: alt === undefined ? file.name.replace(/\.[^.]+$/, '') : alt.trim(), animated: media.animated, ...(media.thumbnailUrl && media.thumbnailWidth ? { thumbnailSrc: media.thumbnailUrl, thumbnailWidth: media.thumbnailWidth, sourceWidth: media.width } : {}), width: media.width, height: media.height, ...poster } }).run();
}
export const uploadMedia = uploadImage;

function ImageDialog({ editor, selection, onClose }: { editor: Editor; selection: SelectionRange; onClose: () => void }) {
  const { t, language } = usePreferences();
  const ru = language === 'ru';
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => uploadAbort.current?.abort(), []);
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewMotion, setPreviewMotion] = useState(true);
  const [preview, setPreview] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const currentSrc = useRef('');
  currentSrc.current = previewSrc;
  useEffect(() => {
    setPreviewSrc(''); setPreview('idle'); setError('');
    if (selectedFile) {
      const objectUrl = URL.createObjectURL(selectedFile);
      let cancelled = false;
      setPreviewMotion(!/^(image\/(jpeg|avif))$/.test(selectedFile.type));
      setPreviewSrc(objectUrl); setPreview('loading');
      void fileHasAnimation(selectedFile).then(animated => { if (!cancelled) setPreviewMotion(animated); }).catch(() => {});
      return () => { cancelled = true; URL.revokeObjectURL(objectUrl); };
    }
    if (!url.trim()) return;
    const timer = setTimeout(() => {
      try {
        const parsed = new URL(url.trim(), location.origin);
        const src = parsed.origin === location.origin && parsed.pathname.startsWith('/api/v1/media/') ? parsed.pathname : parsed.href;
        if (!isSafeUrl(src, true)) throw new Error(t('Use an HTTPS image URL.'));
        setPreviewMotion(mayAnimateImage(src)); setPreviewSrc(src); setPreview('loading');
      } catch { setError(t('Use an HTTPS image URL.')); setPreview('error'); }
    }, 300);
    return () => clearTimeout(timer);
  }, [url, selectedFile, t]);
  useEffect(() => {
    if (preview !== 'loading') return;
    const timer = setTimeout(() => { setPreview('error'); setError(t('The image took too long to load. Check the URL or upload a file.')); }, 12000);
    return () => clearTimeout(timer);
  }, [preview, previewSrc, t]);
  async function insertImage(event: FormEvent) {
    event.preventDefault();
    if (selectedFile) {
      if (preview !== 'ready' || !previewSrc.startsWith('blob:')) return;
      setBusy(true); setError('');
      try { uploadAbort.current = new AbortController(); await uploadImage(editor, selectedFile, selection, alt, uploadAbort.current.signal); onClose(); }
      catch (exception) { if (!(exception instanceof DOMException && exception.name === 'AbortError')) setError(exception instanceof Error ? t(exception.message) : t('Upload failed.')); }
      finally { setBusy(false); }
      return;
    }
    let currentUrl = '';
    try { const parsed = new URL(url.trim(), location.origin); currentUrl = parsed.origin === location.origin && parsed.pathname.startsWith('/api/v1/media/') ? parsed.pathname : parsed.href; } catch {}
    if (preview !== 'ready' || !isSafeUrl(previewSrc, true) || currentUrl !== previewSrc) { setError(t('Wait for a valid image preview before inserting.')); return; }
    editor.chain().focus().setTextSelection(selection).setImage({ src: previewSrc, alt: alt.trim() }).run(); onClose();
  }
  function selectFile(file?: File) {
    if (!file) return;
    try { validateMediaFile(file, 'image'); setSelectedFile(file); setUrl(''); setFileError(''); setError(''); }
    catch (exception) { setSelectedFile(null); setUrl(''); setPreview('error'); setPreviewSrc(''); setFileError(exception instanceof Error ? t(exception.message) : t('Upload failed.')); }
    if (fileRef.current) fileRef.current.value = '';
  }
  return <Dialog title={t('Insert image')} dismissible={!busy} onClose={onClose}>
    {busy && <div role="status" className="v2-upload-progress"><progress /> <button type="button" className="text-button" onClick={() => { uploadAbort.current?.abort(); setBusy(false); }}>{ru ? 'Отменить загрузку' : 'Cancel upload'}</button></div>}
    <p>{ru ? 'Загрузите изображение или вставьте HTTPS-ссылку. GIF, Animated WebP и APNG сохраняют анимацию. До 8 МБ, 240 кадров и 30 секунд.' : 'Upload an image or paste an HTTPS URL. GIF, animated WebP and APNG keep their animation. Up to 8 MB, 240 frames and 30 seconds.'}</p>
    <button className="secondary-button upload-button" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 size={17} className="spin" /> : <Upload size={17} />}{t(busy ? 'Uploading…' : 'Upload image')}</button>
    <input ref={fileRef} className="visually-hidden" type="file" tabIndex={-1} accept="image/png,image/apng,image/jpeg,image/gif,image/webp,image/avif,.apng" aria-label={t('Upload image')} onChange={event => selectFile(event.target.files?.[0])} />
    <form onSubmit={event => void insertImage(event)}>
      <label className="form-label">{t('Image URL')}<input type="url" disabled={busy} value={url} onChange={event => { setSelectedFile(null); setFileError(''); setUrl(event.target.value); }} placeholder="https://" aria-label={t('Image URL')} /></label>
      {previewSrc && <div className="image-preview" data-state={preview}>
        <ControlledImagePreview key={`${previewSrc}-${previewMotion}`} src={previewSrc} motion={previewMotion} alt={alt.trim() || t('Image preview')} onLoad={width => { if (currentSrc.current === previewSrc && width > 0) { setPreview('ready'); setError(''); } }} onError={() => { if (currentSrc.current === previewSrc) { setPreview('error'); setError(t('This image could not be loaded. Use a direct image URL or upload a file.')); } }} />
        <div className="image-preview-status" role="status">{preview === 'loading' ? <><Loader2 size={15} className="spin" />{t('Loading preview…')}</> : preview === 'ready' ? <><Check size={15} />{t('Image ready')}</> : null}</div>
      </div>}
      <label className="form-label">{t('Alternative text')}<input disabled={busy} value={alt} onChange={event => setAlt(event.target.value)} aria-label={t('Alternative text')} /></label>
      {(fileError || error) && <ErrorMessage>{fileError || error}</ErrorMessage>}
      <div className="dialog-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={preview !== 'ready' || busy}>{t(busy ? 'Uploading…' : 'Insert')}</button></div>
    </form>
  </Dialog>;
}

function VideoDialog({ editor, selection, onClose }: { editor: Editor; selection: SelectionRange; onClose: () => void }) {
  const { t, language } = usePreferences();
  const ru = language === 'ru';
  const [url, setUrl] = useState('');
  const [video, setVideo] = useState<VideoAttributes | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const uploadAbort = useRef<AbortController | null>(null); useEffect(() => () => uploadAbort.current?.abort(),[]);
  const currentSrc = useRef('');
  currentSrc.current = video?.src ?? '';
  useEffect(() => {
    setVideo(null); setReady(false); setError('');
    if (selectedFile) {
      const objectUrl = URL.createObjectURL(selectedFile);
      setVideo({ provider: 'file', src: objectUrl });
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (!url.trim()) return;
    const timer = setTimeout(() => {
      let source = url.trim();
      try { const parsed = new URL(source, location.origin); if (parsed.origin === location.origin && parsed.pathname.startsWith('/api/v1/media/')) source = parsed.pathname; } catch {}
      const normalized = normaliseVideoUrl(source);
      if (!normalized) { setError(t('Use a YouTube, Vimeo, RuTube or direct HTTPS video URL.')); return; }
      setVideo(normalized); setReady(normalized.provider !== 'file');
    }, 300);
    return () => clearTimeout(timer);
  }, [url, selectedFile, t]);
  useEffect(() => {
    if (!video || video.provider !== 'file' || ready || error) return;
    const timer = setTimeout(() => setError(t('The video took too long to load. Check the direct file URL.')), 12000);
    return () => clearTimeout(timer);
  }, [video, ready, error, t]);
  async function insertVideo(event: FormEvent) {
    event.preventDefault();
    if (!video || !ready) return;
    if (selectedFile) {
      setBusy(true); setError('');
      try { uploadAbort.current = new AbortController(); await uploadImage(editor, selectedFile, selection, undefined, uploadAbort.current.signal); onClose(); }
      catch (exception) { if (!(exception instanceof DOMException && exception.name === 'AbortError')) setError(exception instanceof Error ? t(exception.message) : t('Upload failed.')); }
      finally { setBusy(false); }
      return;
    }
    let source = url.trim();
    try { const parsed = new URL(source, location.origin); if (parsed.origin === location.origin && parsed.pathname.startsWith('/api/v1/media/')) source = parsed.pathname; } catch {}
    const current = normaliseVideoUrl(source);
    if (!current || current.src !== video.src || current.provider !== video.provider) return;
    editor.chain().focus().setTextSelection(selection).insertContent([{ type: 'video', attrs: video }, { type: 'paragraph' }]).run(); onClose();
  }
  function selectFile(file?: File) {
    if (!file) return;
    try { validateMediaFile(file, 'video'); setSelectedFile(file); setUrl(''); setError(''); }
    catch (exception) { setSelectedFile(null); setVideo(null); setReady(false); setError(exception instanceof Error ? t(exception.message) : t('Upload failed.')); }
    if (fileRef.current) fileRef.current.value = '';
  }
  return <Dialog title={t('Insert video')} dismissible={!busy} onClose={onClose}>
    {busy && <div role="status" className="v2-upload-progress"><progress /><button type="button" className="text-button" onClick={() => uploadAbort.current?.abort()}>{ru ? 'Отменить загрузку' : 'Cancel upload'}</button></div>}
    <p>{ru ? 'Загрузите MP4 или WebM до 32 МБ и 60 секунд. Или вставьте ссылку YouTube, Vimeo, RuTube либо прямую HTTPS-ссылку на видео. Видео запускается только вручную.' : 'Upload an MP4 or WebM file up to 32 MB and 60 seconds. Or paste a YouTube, Vimeo, RuTube or direct HTTPS video URL. Videos play only when you choose.'}</p>
    <button className="secondary-button upload-button" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 size={17} className="spin" /> : <Upload size={17} />}{busy ? t('Uploading…') : ru ? 'Загрузить видео' : 'Upload video'}</button>
    <input ref={fileRef} className="visually-hidden" type="file" tabIndex={-1} accept="video/mp4,video/webm,.mp4,.webm" aria-label={ru ? 'Загрузить видео' : 'Upload video'} onChange={event => selectFile(event.target.files?.[0])} />
    <form onSubmit={event => void insertVideo(event)}>
      <label className="form-label">{t('Video URL')}<input type="url" disabled={busy} value={url} onChange={event => { setSelectedFile(null); setUrl(event.target.value); }} placeholder="https://" aria-label={t('Video URL')} /></label>
      {video && <div className="video-preview">
        {video.provider === 'file' ? <video key={video.src} src={video.src} controls playsInline preload="metadata" aria-label={ru ? 'Предпросмотр видео' : 'Video preview'} onLoadedMetadata={event => {
          if (currentSrc.current !== video.src || event.currentTarget.videoWidth <= 0) return;
          if (selectedFile && (!Number.isFinite(event.currentTarget.duration) || event.currentTarget.duration > 60)) { setReady(false); setError(ru ? 'Видео должно длиться не более 60 секунд.' : 'Videos must be no longer than 60 seconds.'); return; }
          setReady(true); setError('');
        }} onError={() => { if (currentSrc.current === video.src) { setReady(false); setError(t('This video could not be loaded. Check the direct file URL.')); } }} /> : <iframe src={video.src} title="Video preview" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" />}
        <div className="image-preview-status" role="status">{ready ? <><Check size={15} />{t('Video ready')}</> : <><Loader2 size={15} className="spin" />{t('Loading preview…')}</>}</div>
      </div>}
      {error && <ErrorMessage>{error}</ErrorMessage>}<div className="dialog-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type="submit" className="primary-button" disabled={!ready || busy}>{t(busy ? 'Uploading…' : 'Insert')}</button></div>
    </form>
  </Dialog>;
}

function AdvancedDialog({ name, editor, selection, onClose }: { name: string; editor: Editor; selection: SelectionRange; onClose: () => void }) {
  const { language } = usePreferences(); const ru = language === 'ru'; const [source, setSource] = useState(name === 'math' ? 'E = mc^2' : name === 'mermaid' ? 'flowchart LR\n  A[Idea] --> B[Write]\n  B --> C[Publish]' : ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [inline, setInline] = useState(name === 'footnote'); const [layout, setLayout] = useState('grid'); const [files, setFiles] = useState<File[]>([]); const [previews, setPreviews] = useState<string[]>([]); const uploadAbort = useRef<AbortController | null>(null); const [uploadProgress, setUploadProgress] = useState(0); useEffect(() => { const urls = files.map(file => URL.createObjectURL(file)); setPreviews(urls); return () => urls.forEach(url => URL.revokeObjectURL(url)); },[files]); useEffect(() => () => uploadAbort.current?.abort(), []);
  const titles: Record<string,string> = { math: ru ? 'Формула LaTeX' : 'LaTeX formula', mermaid: ru ? 'Диаграмма Mermaid' : 'Mermaid diagram', footnote: ru ? 'Сноска' : 'Footnote', gallery: ru ? 'Галерея' : 'Image gallery', preview: ru ? 'Карточка ссылки' : 'Link preview', csv: ru ? 'Импорт CSV' : 'Import CSV' };
  async function insert(event: FormEvent) { event.preventDefault(); setError(''); setBusy(true); try {
    let content: Parameters<Editor['commands']['insertContent']>[0];
    if (name === 'math') content = { type: inline ? 'mathInline' : 'mathBlock', attrs: { latex: source, ...(inline ? {} : { id: `eq-${crypto.randomUUID()}`, numbered: false }) } };
    else if (name === 'mermaid') content = { type: 'mermaid', attrs: { code: source } };
    else if (name === 'footnote') { editor.chain().focus().setTextSelection(selection.to).insertContent({ type: 'footnote', attrs: { id: `fn-${crypto.randomUUID()}`, text: source } }).run(); onClose(); return; }
    else if (name === 'gallery' && files.length) { uploadAbort.current = new AbortController(); const images = []; for (let index = 0; index < files.length; index++) { const media = await uploadMediaFile(files[index], uploadAbort.current.signal); images.push({ type: 'image', attrs: { src: media.url, alt: files[index].name.replace(/\.[^.]+$/, ''), animated: media.animated, width: media.width, height: media.height, ...(media.posterUrl ? { posterSrc: media.posterUrl } : {}), ...(media.thumbnailUrl && media.thumbnailWidth ? { thumbnailSrc: media.thumbnailUrl, thumbnailWidth: media.thumbnailWidth, sourceWidth: media.width } : {}) } }); setUploadProgress(index + 1); } content = { type: 'gallery', attrs: { layout }, content: images }; }
    else if (name === 'gallery') { const urls = source.split(/\n/).map(value => value.trim()).filter(Boolean); if (!urls.length || urls.length > 20 || urls.some(value => !isSafeUrl(value, true))) throw new Error(ru ? 'Добавьте до 20 HTTPS-ссылок на изображения, по одной на строку.' : 'Add up to 20 HTTPS image URLs, one per line.'); content = { type: 'gallery', attrs: { layout }, content: urls.map(src => ({ type: 'image', attrs: { src, alt: '' } })) }; }
    else if (name === 'csv') content = tableFromRows(parseDelimited(source, source.includes('\t') ? '\t' : ','));
    else { const { preview } = await api<{ preview: { url: string; title: string; description: string; image?: string } }>('/api/v1/link-preview', { method: 'POST', body: JSON.stringify({ url: source.trim() }) }); content = { type: 'linkPreview', attrs: preview }; }
    editor.chain().focus().setTextSelection(selection).insertContent(content).run(); onClose();
  } catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not insert block.'); } finally { setBusy(false); } }
  return <Dialog title={titles[name] ?? name} onClose={onClose} dismissible={!busy}><form onSubmit={event => void insert(event)}><label className="form-label">{name === 'gallery' ? ru ? 'Ссылки на изображения, по одной на строку' : 'Image URLs, one per line' : name === 'footnote' ? ru ? 'Текст сноски' : 'Footnote text' : name === 'preview' ? 'URL' : ru ? 'Исходный текст' : 'Source'}<textarea autoFocus disabled={busy} aria-label={name === 'math' ? 'LaTeX source' : name === 'mermaid' ? 'Mermaid source' : name === 'csv' ? 'CSV data' : name === 'footnote' ? 'Footnote text' : 'Block source'} rows={name === 'preview' ? 2 : 6} maxLength={name === 'mermaid' ? 20000 : name === 'csv' ? 500000 : 4000} value={source} onChange={event => setSource(event.target.value)} /></label>
    {name === 'math' && <><label className="menu-setting">{ru ? 'Внутри строки' : 'Inline formula'}<input type="checkbox" checked={inline} onChange={event => setInline(event.target.checked)} /></label><div className="v2-form-preview"><MathView latex={source} display={!inline} /></div></>}
    {name === 'mermaid' && <div className="v2-form-preview"><MermaidView code={source} /></div>}
    {name === 'gallery' && <><label className="secondary-button v2-file-button">{ru ? 'Выбрать изображения' : 'Choose images'}<input type="file" multiple accept="image/png,image/apng,image/jpeg,image/gif,image/webp,image/avif" onChange={event => { const picked = [...(event.target.files ?? [])]; try { if (picked.length > 20 || picked.reduce((sum,file) => sum + file.size,0) > 32 * 1024 * 1024) throw new Error(ru ? 'До 20 изображений, суммарно не более 32 МБ.' : 'Up to 20 images, 32 MB total.'); picked.forEach(file => validateMediaFile(file,'image')); setFiles(picked); setSource(''); setError(''); } catch (exception) { setError(exception instanceof Error ? exception.message : 'Invalid files.'); } }} /></label><div className="v2-gallery-previews">{previews.map((src,index) => <ControlledImagePreview key={src} src={src} motion={true} alt={files[index]?.name ?? ''} onLoad={() => {}} onError={() => setError(ru ? 'Не удалось открыть изображение.' : 'Could not preview image.')} />)}</div>{busy && <div role="status">{uploadProgress}/{files.length} <button type="button" className="text-button" onClick={() => uploadAbort.current?.abort()}>{ru ? 'Отменить загрузку' : 'Cancel upload'}</button></div>}<label className="form-label">{ru ? 'Расположение' : 'Layout'}<select value={layout} onChange={event => setLayout(event.target.value)}><option value="grid">Grid</option><option value="horizontal">Horizontal</option><option value="single">Single</option></select></label></>}
    {name === 'csv' && <label className="secondary-button v2-file-button">{ru ? 'Выбрать CSV-файл' : 'Choose CSV file'}<input type="file" accept=".csv,text/csv,text/tab-separated-values" onChange={event => { const file = event.target.files?.[0]; if (file && file.size <= 500000) void file.text().then(setSource); else setError('Choose a file under 500 KB.'); }} /></label>}
    {error && <ErrorMessage>{error}</ErrorMessage>}<div className="dialog-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>{ru ? 'Отмена' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={busy || (!source.trim() && !files.length)}>{busy ? '…' : ru ? 'Вставить' : 'Insert'}</button></div></form></Dialog>;
}

export function EditorControls({ editor, containerRef, disabled = false, onLinkRequest }: { editor: Editor; containerRef: RefObject<HTMLDivElement | null>; disabled?: boolean; onLinkRequest?: (callback: () => void) => void }) {
  const { t, language } = usePreferences(); const ru = language === 'ru'; const [, render] = useState(0); const [pastedUrl, setPastedUrl] = useState<{url:string;from:number;to:number} | null>(null); const [pasteBusy,setPasteBusy] = useState(false); useEffect(() => { const pasted = (event: Event) => { const value = (event as CustomEvent).detail; if (value && typeof value.url === 'string') setPastedUrl(value); }; window.addEventListener('verso-paste-url',pasted); return () => window.removeEventListener('verso-paste-url',pasted); },[]); async function insertPastedUrl(kind: 'link'|'plain'|'card') { if (!pastedUrl) return; setPasteBusy(true); try { const attrs = pastedUrl; if(kind === 'plain') preservePlainUrls(attrs.url); let content: Parameters<Editor['commands']['insertContent']>[0] = { type:'text',text:attrs.url, ...(kind === 'link' ? {marks:[{type:'link',attrs:{href:attrs.url}}]} : {}) }; if (kind === 'card') { const result = await api<{preview:{url:string;title:string;description:string;image?:string}}>('/api/v1/link-preview',{method:'POST',body:JSON.stringify({url:attrs.url})}); content = {type:'linkPreview',attrs:result.preview}; } editor.chain().focus().setTextSelection({from:attrs.from,to:attrs.to}).insertContent(content).run(); setPastedUrl(null); } catch(cause) { setError(cause instanceof Error ? cause.message : 'Could not paste URL.'); } finally {setPasteBusy(false);} } const [menuOpen, setMenuOpen] = useState(false); const [menuAbove, setMenuAbove] = useState(false); const [menuMaxHeight,setMenuMaxHeight] = useState(380); const [dialog, setDialog] = useState<string | null>(null); const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [gutter, setGutter] = useState({ top: 0, visible: false }); const [block, setBlock] = useState({ pos: 0, top: 0, visible: false }); const [dropTop, setDropTop] = useState<number | null>(null); const [slash, setSlash] = useState<{ from: number; to: number; query: string; top: number; left: number } | null>(null); const [slashIndex, setSlashIndex] = useState(0); const [tableOpen, setTableOpen] = useState(false);
  const gutterRef = useRef<HTMLDivElement>(null); const menuRef = useRef<HTMLDivElement>(null); const plusRef = useRef<HTMLButtonElement>(null); const bubbleRef = useRef<HTMLDivElement>(null); const selectedRange = useRef<SelectionRange>({ from: 1, to: 1 }); const slashDismissed = useRef(-1); const dragFrom = useRef<number | null>(null); const dropTarget = useRef(0); const slashRef = useRef(slash); slashRef.current = slash; const slashIndexRef = useRef(slashIndex); slashIndexRef.current = slashIndex;
  function placeFormattingMenu(element: HTMLDetailsElement) { if(!element.open)return;const panel=element.querySelector<HTMLElement>('.menu-panel');if(!panel)return;for(const sibling of element.parentElement?.querySelectorAll('details[open]')??[])if(sibling!==element)(sibling as HTMLDetailsElement).open=false;requestAnimationFrame(()=>{const rect=element.getBoundingClientRect();const top=window.visualViewport?.offsetTop??0;const height=window.visualViewport?.height??window.innerHeight;const width=window.visualViewport?.width??window.innerWidth;const left=window.visualViewport?.offsetLeft??0;const above=rect.top-top-18;const below=top+height-rect.bottom-18;const useAbove=above>=140||above>=below;panel.style.maxHeight=`${Math.max(80,Math.min(440,useAbove?above:below))}px`;panel.style.top=useAbove?'auto':'calc(100% + 9px)';panel.style.bottom=useAbove?'calc(100% + 9px)':'auto';const panelWidth=panel.getBoundingClientRect().width;panel.style.left=`${Math.max(left+8,Math.min(rect.right-panelWidth,left+width-panelWidth-8))-rect.left}px`;panel.style.right='auto';});}
  const bubbleOptions = useMemo(() => ({ strategy: 'fixed' as const, placement: 'top' as const, offset: 10, flip: true, shift: { mainAxis: true, crossAxis: false, padding: 10 }, autoPlacement: false, inline: true, onShow: () => { if (bubbleRef.current) bubbleRef.current.dataset.visible = 'true'; }, onHide: () => { if (bubbleRef.current) bubbleRef.current.dataset.visible = 'false'; } }), []);
  const showBubble = useCallback(({ editor: current }: { editor: Editor }) => !disabled && !dialog && current.state.selection instanceof TextSelection && !current.state.selection.empty && !!current.state.doc.textBetween(current.state.selection.from, current.state.selection.to).trim() && (current.isFocused || !!bubbleRef.current?.contains(document.activeElement)), [disabled, dialog]);
  const openDialog = useCallback((name: string) => { selectedRange.current = { from: editor.state.selection.from, to: editor.state.selection.to }; setMenuOpen(false); setDialog(name); setError(''); if (name === 'link') setUrl(editor.getAttributes('link').href ?? ''); }, [editor]);
  const openLink = useCallback(() => openDialog('link'), [openDialog]); useEffect(() => { onLinkRequest?.(openLink); }, [onLinkRequest, openLink]);
  function runBlock(command: BlockCommand, fromSlash = false) { if (fromSlash && slashRef.current) editor.chain().focus().deleteRange({ from: slashRef.current.from, to: slashRef.current.to }).run(); setSlash(null); command.run(editor, openDialog); if(!['math','mermaid','footnote','image','video','gallery','preview','csv'].includes(command.id)) editor.view.focus(); setMenuOpen(false); }
  const runBlockRef = useRef(runBlock); runBlockRef.current = runBlock;
  useEffect(() => {
    let frame = 0; const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (editor.isDestroyed || !containerRef.current) return; render(v => v + 1); const selection = editor.state.selection; const parent = selection.$from.parent; const isCursor = selection instanceof TextSelection && selection.empty; const emptyBlock = parent.isTextblock && parent.content.size === 0 && parent.type.name !== 'codeBlock'; const visible = !disabled && !dialog && isCursor && (emptyBlock || editor.isActive('table')) && (editor.isFocused || editor.isEmpty || menuOpen || !!gutterRef.current?.contains(document.activeElement)); const caret = editor.view.coordsAtPos(selection.from); const bounds = containerRef.current.getBoundingClientRect(); setGutter({ top: Math.max(0, caret.top - bounds.top + (caret.bottom - caret.top - 34) / 2), visible });
      const before = parent.isTextblock ? parent.textBetween(0, selection.$from.parentOffset, '\n', '\ufffc') : ''; const match = /^\/([^\n/]{0,40})$/.exec(before); if (!match) slashDismissed.current = -1;
      if (!disabled && !dialog && isCursor && parent.type.name === 'paragraph' && match && slashDismissed.current !== selection.$from.start()) { const from = selection.$from.start(); setSlash(previous => previous?.query === match[1] && previous.to === selection.to ? previous : { from, to: selection.to, query: match[1], top: Math.max((window.visualViewport?.offsetTop ?? 0) + 8, Math.min(caret.bottom + 8, (window.visualViewport?.height ?? window.innerHeight) + (window.visualViewport?.offsetTop ?? 0) - 220)), left: Math.min(Math.max((window.visualViewport?.offsetLeft ?? 0) + 8, caret.left), (window.visualViewport?.width ?? window.innerWidth) + (window.visualViewport?.offsetLeft ?? 0) - 270) }); } else setSlash(null);
    }); };
    editor.on('transaction', update); editor.on('focus', update); editor.on('blur', update); window.addEventListener('resize', update); window.addEventListener('scroll', update, true); window.visualViewport?.addEventListener('resize', update); update();
    return () => { cancelAnimationFrame(frame); editor.off('transaction', update); editor.off('focus', update); editor.off('blur', update); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.visualViewport?.removeEventListener('resize', update); };
  }, [editor, containerRef, disabled, dialog, menuOpen]);
  useEffect(() => { setSlashIndex(0); }, [slash?.query]);
  useEffect(() => { const keydown = (event: KeyboardEvent) => { const current = slashRef.current; if (!current) return; const commands = filterBlockCommands(current.query); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); slashDismissed.current = current.from; setSlash(null); } else if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setSlashIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(commands.length, 1)) % Math.max(commands.length, 1)); } else if (event.key === 'Enter' && commands.length) { event.preventDefault(); event.stopPropagation(); runBlockRef.current(commands[Math.min(slashIndexRef.current, commands.length - 1)], true); } }; editor.view.dom.addEventListener('keydown', keydown, true); return () => editor.view.dom.removeEventListener('keydown', keydown, true); }, [editor]);
  useEffect(() => { if (!menuOpen) return; const close = (event: PointerEvent) => { if (!gutterRef.current?.contains(event.target as globalThis.Node)) setMenuOpen(false); }; document.addEventListener('pointerdown', close); const menu = menuRef.current; const rect = gutterRef.current?.getBoundingClientRect(); if (menu && rect) {const viewportTop = window.visualViewport?.offsetTop ?? 0; const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight); const below = viewportBottom - rect.bottom - 16; const above = rect.top - viewportTop - 16; const useAbove = below < Math.min(menu.scrollHeight,200) && above > below; setMenuAbove(useAbove); setMenuMaxHeight(Math.max(80,Math.min(380,useAbove ? above : below)));} const frame = requestAnimationFrame(() => menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({preventScroll:true})); return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', close); }; }, [menuOpen]);
  useEffect(() => { const root = editor.view.dom; const locate = (target: EventTarget | null) => { let element = target instanceof Element ? target : null; while (element && element.parentElement !== root) element = element.parentElement; if (!element || element.parentElement !== root) return null; const position = editor.view.posAtDOM(element, 0); const resolved = editor.state.doc.resolve(Math.min(position, editor.state.doc.content.size)); const pos = resolved.depth ? resolved.before(1) : position; return { element, pos }; };
    const mousemove = (event: MouseEvent) => { if (disabled || dragFrom.current !== null) return; const found = locate(event.target); if (!found || !containerRef.current) return; setBlock({ pos: found.pos, top: found.element.getBoundingClientRect().top - containerRef.current.getBoundingClientRect().top, visible: true }); };
    const dragover = (event: DragEvent) => { if (dragFrom.current === null) return; const found = locate(event.target); if (!found || !containerRef.current) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; const rect = found.element.getBoundingClientRect(); const after = event.clientY > rect.top + rect.height / 2; const node = editor.state.doc.nodeAt(found.pos); dropTarget.current = found.pos + (after && node ? node.nodeSize : 0); setDropTop((after ? rect.bottom : rect.top) - containerRef.current.getBoundingClientRect().top); if (event.clientY < 80) window.scrollBy(0, -22); if (event.clientY > window.innerHeight - 80) window.scrollBy(0, 22); };
    const drop = (event: DragEvent) => { if (dragFrom.current === null) return; event.preventDefault(); event.stopPropagation(); moveTopLevelBlock(editor, dragFrom.current, dropTarget.current); dragFrom.current = null; setDropTop(null); };
    let touchTimer: ReturnType<typeof setTimeout>; let touchStart: {x:number;y:number} | null = null; const pointerdown = (event: PointerEvent) => { if (event.pointerType !== 'touch') return; setBlock(previous => ({...previous,visible:false})); const found = locate(event.target); if (!found || !containerRef.current) return; touchStart = {x:event.clientX,y:event.clientY}; touchTimer = setTimeout(() => { setBlock({pos:found.pos,top:found.element.getBoundingClientRect().top - containerRef.current!.getBoundingClientRect().top,visible:true}); },550); }; const cancelTouch = () => { clearTimeout(touchTimer); touchStart = null; }; const pointermove = (event: PointerEvent) => { if (touchStart && Math.abs(event.clientX - touchStart.x) + Math.abs(event.clientY - touchStart.y) > 8) cancelTouch(); }; root.addEventListener('pointerdown',pointerdown); root.addEventListener('pointerup',cancelTouch); root.addEventListener('pointercancel',cancelTouch); root.addEventListener('pointermove',pointermove);
    const end = () => { dragFrom.current = null; setDropTop(null); }; root.addEventListener('mousemove', mousemove); root.addEventListener('dragover', dragover); root.addEventListener('drop', drop, true); document.addEventListener('dragend', end); return () => { cancelTouch(); root.removeEventListener('pointerdown',pointerdown); root.removeEventListener('pointerup',cancelTouch); root.removeEventListener('pointercancel',cancelTouch); root.removeEventListener('pointermove',pointermove); root.removeEventListener('mousemove', mousemove); root.removeEventListener('dragover', dragover); root.removeEventListener('drop', drop, true); document.removeEventListener('dragend', end); };
  }, [editor, disabled, containerRef]);
  function closeDialog() { setDialog(null); requestAnimationFrame(() => editor.commands.focus()); }
  function applyLink(event: FormEvent) { event.preventDefault(); if (!url.trim()) { editor.chain().focus().setTextSelection(selectedRange.current).extendMarkRange('link').unsetLink().run(); closeDialog(); return; } try { const target = /^#(?:eq|h)-[A-Za-z0-9_-]{1,80}$/.test(url.trim()) ? url.trim() : new URL(url.trim(), location.origin).href; if (!isSafeUrl(target)) throw new Error(t('Enter a valid HTTPS, HTTP or email link.')); editor.chain().focus().setTextSelection(selectedRange.current).extendMarkRange('link').setLink({ href: target, ...(target.startsWith('#') ? { target: '_self' } : {}) }).run(); closeDialog(); } catch (exception) { setError(exception instanceof Error ? exception.message : t('Invalid link.')); } }
  function sortTable(reverse = false) { const { $from } = editor.state.selection; let depth = $from.depth; while (depth > 0 && $from.node(depth).type.name !== 'table') depth--; if (!depth) return; const table = $from.node(depth); if (table.content.content.some(row => row.content.content.some(cell => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1))) { setError(ru ? 'Разделите объединённые ячейки перед сортировкой.' : 'Split merged cells before sorting.'); return; } const rows = [...table.content.content]; const column = $from.index(depth + 1); const header = rows[0]?.firstChild?.type.name === 'tableHeader' ? rows.shift() : undefined; rows.sort((a,b) => (a.child(Math.min(column,a.childCount - 1)).textContent.localeCompare(b.child(Math.min(column,b.childCount - 1)).textContent, undefined, { numeric: true })) * (reverse ? -1 : 1)); if (header) rows.unshift(header); editor.view.dispatch(closeHistory(editor.state.tr.replaceWith($from.before(depth), $from.after(depth), table.type.create(table.attrs, rows)))); }
  async function copyCells() { const selection = editor.state.selection; const values: string[] = []; if (selection instanceof CellSelection) selection.content().content.forEach(node => { const addRow = (row: typeof node) => values.push(row.content.content.map(cell => cell.textContent).join('\t')); if(node.type.name === 'table') node.forEach(addRow); else if (node.type.name === 'tableRow') addRow(node); }); else values.push(selection.$from.parent.textContent); try {await navigator.clipboard.writeText(values.join('\n'));} catch {setError(ru ? 'Буфер обмена недоступен. Используйте Ctrl+C или Cmd+C.' : 'Clipboard unavailable. Use Ctrl+C or Cmd+C.');} }
  const tableActions: [string, () => void][] = [[t('Add row'), () => { editor.chain().focus().addRowAfter().run(); }], [t('Delete row'), () => { editor.chain().focus().deleteRow().run(); }], [t('Add column'), () => { editor.chain().focus().addColumnAfter().run(); }], [t('Delete column'), () => { editor.chain().focus().deleteColumn().run(); }], [ru ? 'Объединить ячейки' : 'Merge cells', () => { editor.chain().focus().mergeCells().run(); }], [ru ? 'Разделить ячейки' : 'Split cell', () => { editor.chain().focus().splitCell().run(); }], [ru ? 'Строка заголовков' : 'Header row', () => { editor.chain().focus().toggleHeaderRow().run(); }], [ru ? 'Копировать ячейки' : 'Copy cells', () => { void copyCells(); }], [ru ? 'Сортировать А→Я' : 'Sort ascending', () => sortTable()], [ru ? 'Сортировать Я→А' : 'Sort descending', () => sortTable(true)], [ru ? 'Импорт CSV' : 'Import CSV', () => openDialog('csv')], [t('Delete table'), () => { editor.chain().focus().deleteTable().run(); }]];
  return <>
    <BubbleMenu className="selection-bubble" editor={editor} updateDelay={60} resizeDelay={30} options={bubbleOptions} shouldShow={showBubble}><div ref={bubbleRef} className="editor-toolbar floating-toolbar selection-toolbar v2-selection-toolbar" role="toolbar" aria-label="Selection formatting" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); editor.chain().focus().setTextSelection(editor.state.selection.to).run(); } }}>
      <IconButton label={t('Bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={18} /></IconButton><IconButton label={t('Italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={18} /></IconButton><IconButton label={ru ? 'Подчёркнутый' : 'Underline'} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={18} /></IconButton><IconButton label={t('Strikethrough')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={18} /></IconButton><IconButton label={t('Add a link')} active={editor.isActive('link')} onClick={openLink}><Link2 size={18} /></IconButton><IconButton label={t('Inline code')} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={18} /></IconButton>
      <details className="toolbar-menu" onToggle={event => placeFormattingMenu(event.currentTarget)}><summary aria-label={ru ? 'Маркер' : 'Highlight'}><Highlighter size={18} /></summary><div className="menu-panel v2-palette">{HIGHLIGHT_COLORS.map(color => <button key={color} type="button" aria-label={`Highlight ${color}`} className={`v2-color-swatch highlight-${color}`} onClick={() => editor.chain().focus().setHighlight({ color }).run()} />)}<button className="text-button" type="button" onClick={() => editor.chain().focus().unsetHighlight().run()}>{ru ? 'Сбросить' : 'Reset'}</button></div></details>
      <details className="toolbar-menu" onToggle={event => placeFormattingMenu(event.currentTarget)}><summary aria-label={ru ? 'Ещё форматирование' : 'More formatting'}><MoreHorizontal size={19} /></summary><div className="menu-panel v2-format-more"><div className="v2-color-label">{ru ? 'Цвет текста' : 'Text color'}</div><div className="v2-palette">{TEXT_COLORS.map(color => <button key={color} type="button" aria-label={`Text color ${color}`} className={`v2-color-swatch text-${color}`} onClick={() => editor.chain().focus().setMark('textStyle', { color }).run()}>A</button>)}<button className="text-button" type="button" onClick={() => editor.chain().focus().unsetMark('textStyle').run()}>{ru ? 'Сбросить' : 'Reset'}</button></div><button className="menu-item" onClick={() => editor.chain().focus().toggleSubscript().run()}><Subscript size={17} />{ru ? 'Нижний индекс' : 'Subscript'}</button><button className="menu-item" onClick={() => editor.chain().focus().toggleSuperscript().run()}><Superscript size={17} />{ru ? 'Верхний индекс' : 'Superscript'}</button><button className="menu-item" onClick={() => openDialog('footnote')}>{ru ? 'Добавить сноску' : 'Add footnote'}</button><button className="menu-item" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={17} />{t('Blockquote')}</button><div className="insert-headings">{([1,2,3,4,5,6] as const).map(level => <button key={level} aria-label={`Heading ${level}`} onClick={() => editor.chain().focus().toggleHeading({level}).run()}>H{level}</button>)}</div>{['left','center','right','justify'].map(align => <button className="menu-item" key={align} onClick={() => editor.chain().focus().setTextAlign(align).run()}>{ru ? ({left:'По левому краю',center:'По центру',right:'По правому краю',justify:'По ширине'} as Record<string,string>)[align] : `Align ${align}`}</button>)}</div></details>
    </div></BubbleMenu>
    <div ref={gutterRef} className="editor-gutter" style={{ top: gutter.top, zIndex:menuOpen ? 60 : 15 }} hidden={!gutter.visible} onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}><button ref={plusRef} type="button" className="gutter-button" aria-label={t('Insert block')} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><Plus size={20} className={menuOpen ? 'plus-open' : ''} /></button><button className="gutter-button gutter-camera" aria-label={t('Insert image')} onClick={() => openDialog('image')}><Camera size={19} /></button>
      {menuOpen && <div ref={menuRef} className="insert-popover" role="menu" aria-label={t('Insert blocks')} data-side={menuAbove ? 'above' : 'below'} style={{maxHeight:menuMaxHeight}} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); plusRef.current?.focus(); return; } if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return; event.preventDefault(); const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]; const current = buttons.indexOf(document.activeElement as HTMLButtonElement); const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[index]?.focus(); }}>
        {(['headings','lists','blocks','media'] as const).map(section => <div key={section} className="insert-section"><span className="insert-section-label">{ru ? ({headings:'Заголовки',lists:'Списки',blocks:'Блоки',media:'Медиа'})[section] : section}</span>{BLOCK_COMMANDS.filter(command => command.section === section).map(command => <button key={command.id} type="button" role="menuitem" className="menu-item" aria-label={command.en.startsWith('Heading') ? command.en : undefined} onClick={() => runBlock(command)}><command.icon size={17} />{ru ? command.ru : command.en}</button>)}</div>)}
        <div className="insert-section"><span className="insert-section-label">{ru ? 'Перемещение' : 'Move block'}</span><button className="menu-item" role="menuitem" onClick={() => moveCurrentBlock(editor,-1)}><ArrowUp size={17} />{ru ? 'Переместить вверх' : 'Move up'}</button><button className="menu-item" role="menuitem" onClick={() => moveCurrentBlock(editor,1)}><ArrowDown size={17} />{ru ? 'Переместить вниз' : 'Move down'}</button></div>
        {editor.isActive('table') && <div className="insert-section"><span className="insert-section-label">{t('Table actions')}</span>{tableActions.map(([label, action]) => <button key={label} className="menu-item" role="menuitem" onClick={action}>{label}</button>)}</div>}
      </div>}
    </div>
    {block.visible && !disabled && <button className="v2-block-handle" draggable aria-label={ru ? 'Перетащить блок' : 'Drag block'} title={ru ? 'Перетащите блок. Alt+Shift+↑/↓ — с клавиатуры.' : 'Drag block. Alt+Shift+↑/↓ to move with keyboard.'} style={{ top: block.top }} onDragStart={event => { dragFrom.current = block.pos; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-verso-block', String(block.pos)); }}><GripVertical size={17} /></button>}
    {block.visible && !disabled && <div className="v2-mobile-block-actions" style={{top:block.top}}><button className="gutter-button" aria-label={ru ? 'Переместить блок вверх' : 'Move block up'} onClick={() => { editor.commands.setTextSelection(Math.min(block.pos + 1,editor.state.doc.content.size)); moveCurrentBlock(editor,-1); }}><ArrowUp size={16}/></button><button className="gutter-button" aria-label={ru ? 'Переместить блок вниз' : 'Move block down'} onClick={() => { editor.commands.setTextSelection(Math.min(block.pos + 1,editor.state.doc.content.size)); moveCurrentBlock(editor,1); }}><ArrowDown size={16}/></button></div>}
    {dropTop !== null && <div className="v2-drop-indicator" style={{ top: dropTop }} />}
    {slash && <div className="v2-slash-menu" role="listbox" aria-label={ru ? 'Команды блоков' : 'Block commands'} style={{ top: slash.top, left: slash.left }}>{filterBlockCommands(slash.query).length ? filterBlockCommands(slash.query).map((command,index) => <button key={command.id} type="button" role="option" aria-selected={index === slashIndex} className={`menu-item ${index === slashIndex ? 'active' : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => runBlock(command,true)}><command.icon size={17} /><span>{ru ? command.ru : command.en}</span><small>/{command.id}</small></button>) : <p>{ru ? 'Команды не найдены' : 'No commands found'}</p>}</div>}
    {editor.isActive('table') && !dialog && <div className="v2-table-context"><button className="secondary-button" type="button" aria-expanded={tableOpen} onMouseDown={event => event.preventDefault()} onClick={() => setTableOpen(value => !value)}><Table2 size={16} />{ru ? 'Таблица' : 'Table'}</button>{tableOpen && <div className="menu-panel" onMouseDown={event => { if ((event.target as Element).closest('button')) event.preventDefault(); }}>{tableActions.map(([label,action]) => <button type="button" className="menu-item" key={label} onClick={action}>{label}</button>)}{['left','center','right'].map(align => <button className="menu-item" key={align} onClick={() => editor.chain().focus().setTextAlign(align).run()}>{`Align ${align}`}</button>)}</div>}</div>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {pastedUrl && <Dialog title={ru ? 'Вставить ссылку' : 'Paste URL'} dismissible={!pasteBusy} onClose={() => void insertPastedUrl('plain')}><p className="v2-pasted-url">{pastedUrl.url}</p><div className="dialog-stack"><button type="button" className="secondary-button" disabled={pasteBusy} onClick={() => void insertPastedUrl('link')}>{ru ? 'Текстовая ссылка' : 'Text link'}</button><button type="button" className="secondary-button" disabled={pasteBusy} onClick={() => void insertPastedUrl('card')}>{ru ? 'Карточка с описанием' : 'Preview card'}</button><button type="button" className="text-button" disabled={pasteBusy} onClick={() => void insertPastedUrl('plain')}>{ru ? 'Обычный текст' : 'Plain text'}</button></div></Dialog>}
    {dialog === 'link' && <Dialog title={t('Add a link')} onClose={closeDialog}><form onSubmit={applyLink}><label className="form-label">{t('Link URL')}<input autoFocus type="text" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" aria-label="Link URL" /></label>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="dialog-actions"><button type="button" className="text-button" onClick={() => { editor.chain().focus().setTextSelection(selectedRange.current).extendMarkRange('link').unsetLink().run(); closeDialog(); }}>{t('Remove link')}</button><button type="submit" className="primary-button">{t('Save')}</button></div></form></Dialog>}
    {dialog === 'image' && <ImageDialog editor={editor} selection={selectedRange.current} onClose={closeDialog} />}{dialog === 'video' && <VideoDialog editor={editor} selection={selectedRange.current} onClose={closeDialog} />}{dialog && !['link','image','video'].includes(dialog) && <AdvancedDialog name={dialog} editor={editor} selection={selectedRange.current} onClose={closeDialog} />}
  </>;
}
