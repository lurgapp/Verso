'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import { Download, Upload, FileText, Trash2, Loader2 } from 'lucide-react';
import type { EditorDocument, PublicArticle } from '@/lib/types';
import { validateDocument } from '@/lib/document';
import { ApiError, DraftConflict, api, downloadJson, downloadText, publicationRateLimitMessage, readDraft, readOwnership, removeDraft, saveOwnership, writeDraft, type Ownership } from '@/lib/client/storage';
import { usePreferences } from './preferences';
import { Header, Footer, MoreActions } from './chrome';
import { Dialog, ErrorMessage } from './ui';
import { EditorControls, uploadImage } from './editor-toolbar';
import { createEditorExtensions } from './editor-extensions';
import { WritingTools } from './writing-tools';
import { matchesShortcut } from '@/lib/shortcuts';
import type { WritingDocument } from '@/lib/client/document-files';
import { prepareVersoMarkdown, serializeVersoMarkdown } from './editor-markdown';
import './editor-v2.css';

const EMPTY: EditorDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
function countWords(editor: Editor) { return editor.getText({ blockSeparator: ' ' }).trim().split(/\s+/u).filter(Boolean).length; }

export function EditorPage({ article, lurgUrl }: { article?: PublicArticle; lurgUrl?: string }) {
  const { t, language, toast } = usePreferences();
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? '');
  const [showViewCount, setShowViewCount] = useState(article?.showViewCount ?? true);
  const showViewCountRef = useRef(showViewCount);
  showViewCountRef.current = showViewCount;
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>(article ? 'checking' : 'allowed');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'error' | 'conflict'>('loading');
  const [online, setOnline] = useState(true);
  const [wordCount, setWordCount] = useState(0);
  const [isDocumentEmpty, setIsDocumentEmpty] = useState(!article);
  const [updateTick, setUpdateTick] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaAbort = useRef<AbortController | null>(null);
  useEffect(() => () => mediaAbort.current?.abort(), []);
  async function uploadPastedMedia(current: Editor, file: File, selection: {from:number;to:number}) {
    if (mediaAbort.current) return; const controller = new AbortController(); mediaAbort.current = controller; setUploading(true); setError('');
    try { await uploadImage(current,file,selection,undefined,controller.signal); } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { if (mediaAbort.current === controller) { mediaAbort.current = null; setUploading(false); } }
  }
  const [error, setError] = useState('');
  const [versionConflict, setVersionConflict] = useState(false);
  const [clearDialog, setClearDialog] = useState(false);
  const [recoverKey, setRecoverKey] = useState<{ ownership: Ownership; url: string } | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const editorDocumentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLInputElement>(null);
  const pendingImport = useRef<{ format: 'json' | 'markdown'; data: unknown } | null>(null);
  const [replaceDialog, setReplaceDialog] = useState(false);
  const generation = useRef(0);
  const savedGeneration = useRef(0);
  const dirty = useRef(false);
  const readyRef = useRef(false);
  const revision = useRef(0);
  const version = useRef(article?.version);
  const conflict = useRef(false);
  const writer = useRef('');
  const ownership = useRef<Ownership | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const linkRequest = useRef<(() => void) | null>(null);
  const publishRequest = useRef<(() => void) | null>(null);
  const draftId = article ? `article:${article.id}` : 'new';

  const extensions = useMemo(() => createEditorExtensions(), []);
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: article?.content ?? EMPTY,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Tell your story', 'aria-multiline': 'true', spellcheck: 'true', class: 'article-prose editor-content' },
      handleKeyDown: (_view, event) => {
        if (matchesShortcut(event,'publish')) { event.preventDefault(); publishRequest.current?.(); return true; }
        if (matchesShortcut(event,'link')) { event.preventDefault(); linkRequest.current?.(); return true; }
        return false;
      },
      handlePaste: (view, event) => {
        const image = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith('image/') || ['video/mp4', 'video/webm'].includes(file.type));
        if (image) { event.preventDefault(); if (editor) void uploadPastedMedia(editor, image, {from:view.state.selection.from,to:view.state.selection.to}); return true; }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const file = event.dataTransfer?.files[0];
        if (!moved && file && (file.type.startsWith('image/') || ['video/mp4', 'video/webm'].includes(file.type)) && editor) { event.preventDefault(); const position = view.posAtCoords({left:event.clientX,top:event.clientY})?.pos ?? view.state.selection.to; void uploadPastedMedia(editor, file, {from:position,to:position}); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setWordCount(countWords(editor)); setIsDocumentEmpty(editor.isEmpty);
      if (!readyRef.current) return;
      dirty.current = true; generation.current++; setUpdateTick(v => v + 1); setStatus(conflict.current ? 'conflict' : 'saving');
    },
  });

  useEffect(() => { const showError = (event: Event) => setError(String((event as CustomEvent).detail ?? 'Paste failed.')); window.addEventListener('verso-editor-error', showError); return () => window.removeEventListener('verso-editor-error', showError); }, []);

  const verifyAccess = useCallback(async () => {
    if (!article) return;
    setAccess('checking');
    try {
      const key = await readOwnership(article.id);
      if (!key) { setAccess('denied'); return; }
      await api(`/api/v1/articles/${article.id}/ownership`, { headers: { Authorization: `Bearer ${key.editKey}` } });
      ownership.current = key; setAccess('allowed');
    } catch { setAccess('denied'); }
  }, [article]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    writer.current ||= crypto.randomUUID();
    setOnline(navigator.onLine);
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    void (async () => {
      try {
        const saved = await readDraft(draftId);
        if (cancelled) return;
        if (saved) {
          revision.current = saved.revision;
          setShowViewCount(saved.showViewCount ?? article?.showViewCount ?? true);
          if (saved.title || saved.content.content.some(node => node.type !== 'paragraph' || node.content?.length)) {
            setTitle(saved.title); editor.commands.setContent(saved.content, { emitUpdate: false });
            setWordCount(countWords(editor)); setIsDocumentEmpty(editor.isEmpty);
            if (article && saved.baseVersion !== article.version) setVersionConflict(true);
            else toast(t('Draft restored'));
          }
          version.current = saved.baseVersion ?? article?.version;
        } else setWordCount(countWords(editor)); setIsDocumentEmpty(editor.isEmpty);
        setStatus('saved');
      } catch { setStatus('error'); setError(language === 'ru' ? 'Браузер не разрешает сохранять черновики. Вы можете скачать текст через меню.' : 'Your browser cannot save drafts. Download your text from the menu to keep a copy.'); }
      readyRef.current = true; setReady(true); void verifyAccess();
    })();
    return () => { cancelled = true; window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [editor, draftId]);

  useEffect(() => {
    if (!editor || !ready) return;
    editor.setEditable(access === 'allowed' && !busy);
  }, [editor, ready, access, busy]);

  useEffect(() => {
    if (!editor || !ready || !('BroadcastChannel' in window)) return;
    const broadcast = new BroadcastChannel('verso-drafts'); channel.current = broadcast;
    broadcast.onmessage = async event => {
      if (event.data?.id !== draftId || event.data.writerId === writer.current || event.data.revision <= revision.current) return;
      if (dirty.current) { conflict.current = true; setStatus('conflict'); return; }
      const saved = await readDraft(draftId).catch(() => undefined);
      if (!saved || dirty.current) return;
      revision.current = saved.revision; version.current = saved.baseVersion ?? version.current;
      setTitle(saved.title); setShowViewCount(saved.showViewCount ?? article?.showViewCount ?? true); editor.commands.setContent(saved.content, { emitUpdate: false }); setWordCount(countWords(editor)); setIsDocumentEmpty(editor.isEmpty);
    };
    return () => { broadcast.close(); channel.current = null; };
  }, [editor, ready, draftId]);

  function saveNow(): Promise<void> {
    if (!editor || !readyRef.current || !dirty.current || conflict.current) return saveChain.current;
    const snapshot = { title: titleRef.current, content: editor.getJSON() as EditorDocument, showViewCount: showViewCountRef.current, generation: generation.current };
    const task = saveChain.current.catch(() => undefined).then(async () => {
      if (conflict.current || snapshot.generation <= savedGeneration.current) return;
      try {
        const saved = await writeDraft({ id: draftId, title: snapshot.title, content: snapshot.content, revision: revision.current, updatedAt: '', writerId: writer.current, baseVersion: version.current, showViewCount: snapshot.showViewCount }, revision.current);
        revision.current = saved.revision;
        savedGeneration.current = snapshot.generation;
        channel.current?.postMessage({ id: draftId, revision: saved.revision, writerId: writer.current });
        if (generation.current === snapshot.generation) { dirty.current = false; setStatus('saved'); }
      } catch (exception) {
        if (exception instanceof DraftConflict) { conflict.current = true; setStatus('conflict'); }
        else { setStatus('error'); setError(language === 'ru' ? 'Не удалось сохранить черновик. Скачайте копию через меню.' : 'Could not save this draft. Download a copy from the menu.'); }
      }
    });
    saveChain.current = task;
    return task;
  }

  useEffect(() => {
    if (!ready || !dirty.current || conflict.current) return;
    const timer = setTimeout(() => void saveNow(), 650);
    return () => clearTimeout(timer);
  }, [title, showViewCount, updateTick, ready]);

  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    const flush = () => { if (document.visibilityState === 'hidden') void saveNow(); };
    window.addEventListener('beforeunload', warning); document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('beforeunload', warning); document.removeEventListener('visibilitychange', flush); void saveNow(); };
  }, [editor, ready, draftId]);

  useEffect(() => {
    if (!titleInput.current) return;
    titleInput.current.style.height = 'auto'; titleInput.current.style.height = `${titleInput.current.scrollHeight}px`;
  }, [title]);

  function updateShowViewCount(value: boolean) { setShowViewCount(value); showViewCountRef.current = value; dirty.current = true; generation.current++; setStatus(conflict.current ? 'conflict' : 'saving'); }
  function updateTitle(value: string) { setTitle(value); dirty.current = true; generation.current++; setStatus(conflict.current ? 'conflict' : 'saving'); }
  function exportDraft() { if (editor) downloadJson({ format: 'verso-draft', version: 1, title: titleRef.current, content: editor.getJSON(), showViewCount: showViewCountRef.current, exportedAt: new Date().toISOString() }, `verso-${article?.id ?? 'draft'}.json`); }
  function exportMarkdown() { if (editor) downloadText(`# ${titleRef.current}\n\n${serializeVersoMarkdown(editor)}`, `verso-${article?.id ?? 'story'}.md`); }

  async function loadSavedDraft() {
    if (!editor) return;
    try {
      await saveChain.current;
      const saved = await readDraft(draftId);
      revision.current = saved?.revision ?? 0; dirty.current = false; conflict.current = false;
      setShowViewCount(saved?.showViewCount ?? article?.showViewCount ?? true);
      setTitle(saved?.title ?? article?.title ?? ''); editor.commands.setContent(saved?.content ?? article?.content ?? EMPTY, { emitUpdate: false }); setWordCount(countWords(editor)); setIsDocumentEmpty(editor.isEmpty); setStatus('saved');
      version.current = saved?.baseVersion ?? article?.version;
      setVersionConflict(!!article && !!saved && saved.baseVersion !== article.version);
    } catch { setError('Could not read the saved draft.'); }
  }

  async function loadLatestArticle() {
    if (!article || !editor) return;
    exportDraft();
    try {
      const { article: latest } = await api<{ article: PublicArticle }>(`/api/v1/articles/${article.id}`, { cache: 'no-store' });
      version.current = latest.version; setTitle(latest.title); titleRef.current = latest.title; setShowViewCount(latest.showViewCount); editor.commands.setContent(latest.content, { emitUpdate: false }); setWordCount(countWords(editor)); setIsDocumentEmpty(editor.isEmpty);
      setVersionConflict(false); dirty.current = true; generation.current++; setUpdateTick(v => v + 1);
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not load article.'); }
  }

  async function publish() {
    if (!editor || !ready || busy || access !== 'allowed' || conflict.current || versionConflict) return;
    if (!title.trim()) { setError(language === 'ru' ? 'Добавьте заголовок.' : 'Add a title to your story.'); titleInput.current?.focus(); return; }
    if (editor.isEmpty) { setError(language === 'ru' ? 'Напишите что-нибудь перед публикацией.' : 'Write something before publishing.'); editor.commands.focus(); return; }
    setBusy(true); setError('');
    try {
      await saveNow();
      if (conflict.current) return;
      const result = await api<{ article: PublicArticle; editKey?: string; url: string }>(article ? `/api/v1/articles/${article.id}` : '/api/v1/articles', {
        method: article ? 'PATCH' : 'POST', headers: article ? { Authorization: `Bearer ${ownership.current?.editKey}` } : {},
        body: JSON.stringify({ title: title.trim(), content: editor.getJSON(), schemaVersion: 1, showViewCount: showViewCountRef.current, ...(article ? { version: version.current } : {}) }),
      });
      if (result.editKey) {
        const key = { articleId: result.article.id, editKey: result.editKey, createdAt: result.article.createdAt };
        try { await saveOwnership(key); }
        catch { setRecoverKey({ ownership: key, url: result.url }); return; }
      }
      await finishPublication(result.article.id, result.url);
    } catch (exception) {
      if (exception instanceof ApiError && exception.status === 409) { setVersionConflict(true); }
      else if (exception instanceof ApiError && exception.status === 429) {
        const savedDraft = await readDraft(draftId).catch(() => undefined);
        const draftSaved = savedDraft?.title === titleRef.current && JSON.stringify(savedDraft.content) === JSON.stringify(editor.getJSON());
        setError(publicationRateLimitMessage(language, exception.retryAfterSeconds, draftSaved));
      }
      else setError(exception instanceof Error ? exception.message : 'Publication failed. Please try again.');
    } finally { setBusy(false); }
  }
  publishRequest.current = () => void publish();

  async function finishPublication(id: string, url: string) {
    dirty.current = false;
    await removeDraft(draftId, revision.current).catch(() => undefined);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch {}
    try { sessionStorage.setItem('verso-published', JSON.stringify({ id, copied, updated: !!article })); } catch {}
    router.push(`/a/${id}`); router.refresh();
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>, format: 'json' | 'markdown') {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !editor) return;
    try {
      if (file.size > 1_000_000) throw new Error('Import a file smaller than 1 MB.');
      const text = await file.text();
      let data: unknown = text;
      if (format === 'json') {
        data = JSON.parse(text);
        const value = data as { format?: string; version?: number; title?: string; content?: JSONContent; showViewCount?: boolean };
        if (value.format !== 'verso-draft' || value.version !== 1 || typeof value.title !== 'string' || value.title.length > 240 || value.content?.type !== 'doc' || !Array.isArray(value.content.content)) throw new Error('Invalid Verso draft.');
        if (value.showViewCount !== undefined && typeof value.showViewCount !== 'boolean') throw new Error('Invalid view count preference.');
        validateDocument(value.content, { allowEmpty: true });
      }
      pendingImport.current = { format, data };
      if (title || !editor.isEmpty) setReplaceDialog(true); else applyImport();
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Import failed.'); }
  }

  function applyImport() {
    const pending = pendingImport.current; if (!pending || !editor) return;
    if (title || !editor.isEmpty) exportDraft();
    if (pending.format === 'json') {
      const value = pending.data as { title: string; content: JSONContent; showViewCount?: boolean };
      const validated = validateDocument(value.content, { allowEmpty: true });
      editor.commands.setContent(validated, { errorOnInvalidContent: true }); updateTitle(value.title); updateShowViewCount(value.showViewCount ?? article?.showViewCount ?? true); toast(t('Draft imported'));
    } else {
      let markdown = pending.data as string;
      const firstTitle = markdown.match(/^# ([^\n]+)\n+/);
      if (firstTitle) { updateTitle(firstTitle[1].trim()); markdown = markdown.slice(firstTitle[0].length); }
      editor.commands.setContent(prepareVersoMarkdown(markdown), { contentType: 'markdown' }); toast(t('Markdown imported'));
    }
    pendingImport.current = null; setReplaceDialog(false);
  }

  async function clearDraft() {
    if (!editor) return;
    exportDraft(); setClearDialog(false);
    await saveChain.current;
    const saved = await readDraft(draftId).catch(() => undefined);
    revision.current = saved?.revision ?? 0; conflict.current = false; setStatus('saving'); setVersionConflict(false);
    updateTitle(''); editor.commands.setContent(EMPTY); editor.commands.focus();
  }

  function applyWritingDocument(value: WritingDocument) { if (!editor) return; updateTitle(value.title); updateShowViewCount(value.showViewCount ?? showViewCountRef.current); editor.commands.setContent(value.content, { errorOnInvalidContent: true }); if (article && value.baseVersion !== undefined) { version.current = value.baseVersion; setVersionConflict(false); } generation.current++; dirty.current = true; setUpdateTick(v => v + 1); }

  const disabled = !ready || busy || access !== 'allowed' || status === 'conflict' || versionConflict;
  return <div className="editor-page"><Header><button className="primary-button publish-button" disabled={disabled} onClick={() => void publish()}>{busy && <Loader2 size={15} className="spin" />}{t(busy ? article ? 'Updating…' : 'Publishing…' : article ? 'Update' : 'Publish')}</button><MoreActions onOwnershipImported={() => void verifyAccess()}>{editor && <WritingTools editor={editor} title={title} draftId={draftId} article={article} onRestore={applyWritingDocument} onImported={applyWritingDocument} />}<label className="menu-setting">{t('Show view count')}<input type="checkbox" checked={showViewCount} disabled={!ready || busy || access !== 'allowed'} onChange={event => updateShowViewCount(event.target.checked)} /></label><button className="menu-item" disabled={!editor} onClick={exportMarkdown}><FileText size={16} />{t('Export Markdown')}</button><button className="menu-item" disabled={!editor || access !== 'allowed'} onClick={() => markdownRef.current?.click()}><Upload size={16} />{t('Import Markdown')}</button><button className="menu-item" disabled={!editor} onClick={exportDraft}><Download size={16} />{t('Export draft')}</button><button className="menu-item" disabled={!editor || access !== 'allowed'} onClick={() => fileRef.current?.click()}><Upload size={16} />{t('Import draft')}</button><button className="menu-item danger-text" disabled={!editor || access !== 'allowed'} onClick={() => setClearDialog(true)}><Trash2 size={16} />{t('Clear draft')}</button></MoreActions></Header>
    <main className="writing-surface"><div className="draft-status" role="status">{!ready ? t('Loading draft…') : status === 'saved' ? t(online ? 'Saved on this device' : 'Offline · saved on this device') : status === 'saving' ? t('Saving…') : ''}</div>
      {article && access !== 'allowed' ? <section className="access-message"><h1>{t(access === 'checking' ? 'Checking editing access…' : 'Editing access unavailable')}</h1>{access === 'denied' && <><p>{t('The editing key is missing or invalid. Import your saved key to edit this article.')}</p><a className="secondary-button" href={`/a/${article.id}`}>{t('View article')}</a><MoreActions onOwnershipImported={() => void verifyAccess()} /></>}</section> : <><textarea ref={titleInput} className="title-input" rows={1} maxLength={240} aria-label="Title" placeholder={t('Title')} value={title} disabled={!ready || busy} onChange={event => updateTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void publish(); } else if (event.key === 'Enter') { event.preventDefault(); editor?.commands.focus('start'); } }} />
      {status === 'conflict' && <div className="notice" role="alert"><p>{t('Another tab changed this draft. Your text is safe here. Download your version before loading the saved draft.')}</p><div className="notice-actions"><button className="text-button" onClick={exportDraft}>{t('Download my draft')}</button><button className="secondary-button" onClick={() => void loadSavedDraft()}>{t('Load saved draft')}</button></div></div>}
      {versionConflict && <div className="notice" role="alert"><p>{t('This article changed since your draft was saved. Export your draft before loading the latest article.')}</p><div className="notice-actions"><button className="text-button" onClick={exportDraft}>{t('Download my draft')}</button><button className="secondary-button" onClick={() => void loadLatestArticle()}>{t('Load latest article')}</button></div></div>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {uploading && <div className="v2-upload-progress" role="status"><progress aria-label={language === 'ru' ? 'Загрузка медиа' : 'Uploading media'} /><button className="text-button" type="button" onClick={() => mediaAbort.current?.abort()}>{language === 'ru' ? 'Отменить загрузку' : 'Cancel upload'}</button></div>}
      <div ref={editorDocumentRef} className="editor-document"><p className="editor-placeholder" aria-hidden="true" hidden={!isDocumentEmpty}>{t('Tell your story…')}</p>{editor ? <EditorContent editor={editor} /> : <div className="editor-loading" aria-busy="true" />}{editor && <EditorControls editor={editor} containerRef={editorDocumentRef} disabled={busy || !ready} onLinkRequest={callback => { linkRequest.current = callback; }} />}</div></>}
    </main><Footer wordCount={wordCount} lurgUrl={lurgUrl} editor={editor ?? undefined} />
    <input className="visually-hidden" ref={fileRef} type="file" tabIndex={-1} accept="application/json,.json" aria-label="Import draft file" onChange={event => void importFile(event, 'json')} /><input className="visually-hidden" ref={markdownRef} type="file" tabIndex={-1} accept="text/markdown,text/plain,.md,.markdown,.txt" aria-label="Import Markdown file" onChange={event => void importFile(event, 'markdown')} />
    {clearDialog && <Dialog title={t('Clear draft')} onClose={() => setClearDialog(false)}><p>{t('Your current draft will be downloaded before it is replaced.')}</p><div className="dialog-actions"><button className="text-button" onClick={() => setClearDialog(false)}>{t('Cancel')}</button><button className="primary-button" onClick={() => void clearDraft()}>{t('Clear draft')}</button></div></Dialog>}
    {replaceDialog && <Dialog title={t('Replace draft?')} onClose={() => setReplaceDialog(false)}><p>{t('Your current draft will be downloaded before it is replaced.')}</p><div className="dialog-actions"><button className="text-button" onClick={() => setReplaceDialog(false)}>{t('Cancel')}</button><button className="primary-button" onClick={() => { try { applyImport(); } catch (exception) { setError(exception instanceof Error ? exception.message : 'Import failed.'); setReplaceDialog(false); } }}>{t('Replace')}</button></div></Dialog>}
    {recoverKey && <Dialog title={t('Editing keys')} dismissible={false} onClose={() => undefined}><p>{t('Your browser could not save the editing key. Download it now to keep editing access.')}</p><div className="dialog-stack"><button className="primary-button" onClick={() => downloadJson({ format: 'verso-editing-keys', version: 1, origin: location.origin, keys: [recoverKey.ownership] }, 'verso-editing-key.json')}>{t('Download editing key')}</button><button className="secondary-button" onClick={() => void finishPublication(recoverKey.ownership.articleId, recoverKey.url)}>{t('Open article')}</button></div></Dialog>}
  </div>;
}
