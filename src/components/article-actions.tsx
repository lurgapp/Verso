'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, Plus, Trash2, Flag, Pencil, Download } from 'lucide-react';
import type { PublicArticle } from '@/lib/types';
import { api, downloadJson, readOwnership, removeOwnership, type Ownership } from '@/lib/client/storage';
import { Header, MoreActions } from './chrome';
import { Dialog, ErrorMessage, IconButton } from './ui';
import { usePreferences } from './preferences';
import { DocumentExports, ReaderTypography, PublishedHistory } from './reading-tools';
import { readableMarkdown } from '@/lib/client/document-files';

export function ArticleActions({ article }: { article: PublicArticle; lurgUrl?: string }) {
  const { t, language, toast } = usePreferences();
  const router = useRouter();
  const [owner, setOwner] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'report' | 'copy' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('harmful');
  const [details, setDetails] = useState('');
  const ownership = useRef<Ownership | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  async function verifyOwner() {
    try {
      const key = await readOwnership(article.id);
      if (!key) return;
      await api(`/api/v1/articles/${article.id}/ownership`, { headers: { Authorization: `Bearer ${key.editKey}` } });
      ownership.current = key; setOwner(true);
    } catch { setOwner(false); }
  }
  useEffect(() => {
    void verifyOwner();
    try {
      const value = JSON.parse(sessionStorage.getItem('verso-published') ?? 'null');
      if (value?.id === article.id) { toast(`${t(value.updated ? 'Article updated' : 'Published')}${value.copied ? ` · ${t('Link copied')}` : ''}`); sessionStorage.removeItem('verso-published'); }
    } catch {}
  }, [article.id]);

  function articleUrl() { return `${location.origin}/a/${article.id}`; }
  async function copyLink() {
    try { await navigator.clipboard.writeText(articleUrl()); toast(t('Link copied')); }
    catch { setDialog('copy'); setError(''); }
  }
  async function deleteArticle() {
    if (!ownership.current) return;
    setBusy(true); setError('');
    try {
      downloadJson({ format: 'verso-draft', version: 1, title: article.title, content: article.content, showViewCount: article.showViewCount, exportedAt: new Date().toISOString() }, `verso-${article.id}.json`);
      await api(`/api/v1/articles/${article.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownership.current.editKey}` } });
      await removeOwnership(article.id).catch(() => undefined); router.push('/'); router.refresh();
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not delete article.'); }
    finally { setBusy(false); }
  }
  async function submitReport(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`/api/v1/articles/${article.id}/reports`, { method: 'POST', body: JSON.stringify({ reason, details }) }); setDialog(null); toast(t('Report received')); }
    catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not send report.'); }
    finally { setBusy(false); }
  }
  return <><Header><IconButton label={t('Copy link')} onClick={() => void copyLink()}><Copy size={19} /></IconButton>{owner ? <Link href={`/a/${article.id}/edit`} className="primary-button"><Pencil size={14} />{t('Edit')}</Link> : <Link href="/" className="primary-button">{t('New story')}</Link>}<MoreActions onOwnershipImported={() => void verifyOwner()}><ReaderTypography/><DocumentExports value={{title:article.title,content:article.content,showViewCount:article.showViewCount}} html={article.html} markdown={()=>readableMarkdown(article.content)} filename={`verso-${article.id}`}/>{owner&&<PublishedHistory article={article}/>}<Link href="/" className="menu-item"><Plus size={16} />{t('New story')}</Link><button className="menu-item" onClick={() => downloadJson({ format: 'verso-draft', version: 1, title: article.title, content: article.content, showViewCount: article.showViewCount, exportedAt: new Date().toISOString() }, `verso-${article.id}.json`)}><Download size={16} />{t('Export draft')}</button><button className="menu-item" onClick={() => { setDialog('report'); setError(''); }}><Flag size={16} />{t('Report article')}</button>{owner && <button className="menu-item danger-text" onClick={() => { setDialog('delete'); setError(''); }}><Trash2 size={16} />{t('Delete article')}</button>}</MoreActions></Header>
    {dialog === 'delete' && <Dialog title={t('Delete article')} onClose={() => !busy && setDialog(null)}><p>{t('This permanently removes the public article. A copy of your text will be downloaded first.')}</p>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="dialog-actions"><button className="text-button" disabled={busy} onClick={() => setDialog(null)}>{t('Cancel')}</button><button className="primary-button danger-button" disabled={busy} onClick={() => void deleteArticle()}>{busy ? '…' : t('Delete')}</button></div></Dialog>}
    {dialog === 'report' && <Dialog title={t('Report harmful or illegal content')} onClose={() => !busy && setDialog(null)}><form onSubmit={submitReport}><label className="form-label">{t('Reason')}<select aria-label={t('Reason')} value={reason} onChange={event => setReason(event.target.value)}><option value="harmful">{language === 'ru' ? 'Вредоносное содержимое' : 'Harmful content'}</option><option value="illegal">{language === 'ru' ? 'Незаконное содержимое' : 'Illegal content'}</option><option value="spam">{language === 'ru' ? 'Спам' : 'Spam'}</option><option value="copyright">{language === 'ru' ? 'Авторское право' : 'Copyright'}</option><option value="other">{language === 'ru' ? 'Другое' : 'Other'}</option></select></label><label className="form-label">{language === 'ru' ? 'Подробности (необязательно)' : 'Details (optional)'}<textarea aria-label="Report details" rows={4} value={details} maxLength={2000} onChange={event => setDetails(event.target.value)} /></label>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="dialog-actions"><button type="button" disabled={busy} className="text-button" onClick={() => setDialog(null)}>{t('Cancel')}</button><button className="primary-button" disabled={busy} type="submit">{busy ? '…' : t('Send report')}</button></div></form></Dialog>}
    {dialog === 'copy' && <Dialog title={t('Copy link')} onClose={() => setDialog(null)}><label className="form-label">{t('Copy link')}<input ref={linkInput} autoFocus readOnly value={articleUrl()} aria-label="Article URL" onFocus={event => event.currentTarget.select()} /></label><div className="dialog-actions"><button className="secondary-button" onClick={() => { linkInput.current?.select(); const copied = document.execCommand('copy'); if (copied) { toast(t('Link copied')); setDialog(null); } }}>{t('Copy link')}</button></div></Dialog>}
  </>;
}
