'use client';

import Link from 'next/link';
import type { Editor } from '@tiptap/react';
import { WritingStatisticsControl } from './writing-statistics';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Moon, Sun, Monitor, MoreHorizontal, ArrowUpRight, Keyboard, CircleHelp, Download, Upload, KeyRound } from 'lucide-react';
import { usePreferences } from './preferences';
import { Dialog, ErrorMessage, IconButton } from './ui';
import { allOwnership, api, downloadJson, saveOwnership, type Ownership } from '@/lib/client/storage';
import { SHORTCUTS, shortcutKeys } from '@/lib/shortcuts';

export function Header({ children }: { children?: ReactNode; lurgUrl?: string }) {
  const { theme, setTheme, t } = usePreferences();
  return <header className="site-header"><Link className="wordmark" href="/" aria-label="Verso — new story">verso<span aria-hidden="true">·</span></Link><nav className="header-actions" aria-label="Article actions"><IconButton label={`${t('Theme')}: ${t(theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light')}`} onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')}>{theme === 'light' ? <Sun size={20} /> : theme === 'dark' ? <Moon size={20} /> : <Monitor size={20} />}</IconButton>{children}</nav></header>;
}

export function MoreActions({ children, onOwnershipImported }: { children?: ReactNode; onOwnershipImported?: () => void }) {
  const { language, setLanguage, theme, setTheme, t, toast } = usePreferences();
  const [keysOpen, setKeysOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  function closeKeys() { setKeysOpen(false); requestAnimationFrame(() => detailsRef.current?.querySelector('summary')?.focus()); }
  async function exportKeys() {
    setError('');
    try {
      const keys = await allOwnership();
      if (!keys.length) { setError(t('No editing keys on this device yet.')); return; }
      downloadJson({ format: 'verso-editing-keys', version: 1, origin: location.origin, keys }, 'verso-editing-keys.json');
    } catch { setError(language === 'ru' ? 'Не удалось прочитать ключи на этом устройстве.' : 'Could not read the keys on this device.'); }
  }
  async function importKeys(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (file.size > 1_000_000) throw new Error('Key file is too large.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'verso-editing-keys' || data.version !== 1 || !Array.isArray(data.keys) || data.keys.length > 100) throw new Error('Invalid editing key file.');
      if (data.origin !== location.origin) throw new Error(language === 'ru' ? 'Этот файл принадлежит другому сайту Verso. Импортируйте его на исходном сайте.' : 'This key file belongs to another Verso site. Import it on the original site.');
      let imported = 0;
      for (const value of data.keys) {
        if (!value || typeof value !== 'object' || !/^[A-Za-z0-9]{12}$/.test(value.articleId) || typeof value.editKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.editKey)) throw new Error('Invalid editing key file.');
        await api(`/api/v1/articles/${value.articleId}/ownership`, { headers: { Authorization: `Bearer ${value.editKey}` } });
        await saveOwnership({ articleId: value.articleId, editKey: value.editKey, createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString() } satisfies Ownership);
        imported++;
      }
      toast(`${t('Editing keys imported')} · ${imported}`);
      onOwnershipImported?.(); closeKeys();
    } catch (exception) { setError(exception instanceof Error ? exception.message : 'Could not import keys.'); }
    finally { setBusy(false); if (importRef.current) importRef.current.value = ''; }
  }
  return <><details className="more-menu" ref={detailsRef}><summary aria-label={t('More actions')} title={t('More actions')}><MoreHorizontal size={22} /></summary><div className="menu-panel"><div className="menu-section">{children}</div><label className="menu-setting">{t('Language')}<select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value as 'en' | 'ru')}><option value="en">English</option><option value="ru">Русский</option></select></label><label className="menu-setting">{t('Theme')}<select aria-label="Theme" value={theme} onChange={event => setTheme(event.target.value as 'system' | 'light' | 'dark')}><option value="system">{t('System')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option></select></label><button type="button" className="menu-item" onClick={() => { setKeysOpen(true); if (detailsRef.current) detailsRef.current.open = false; }}><KeyRound size={16} />{t('Editing keys')}</button></div></details>{keysOpen && <Dialog title={t('Editing keys')} onClose={closeKeys}><p>{t('Your editing keys are private. Anyone with a key can change or delete its article. Keep this file somewhere safe. Clearing browser data can remove your access.')}</p><div className="dialog-stack"><button className="secondary-button" disabled={busy} onClick={exportKeys}><Download size={16} />{t('Export editing keys')}</button><button className="secondary-button" disabled={busy} onClick={() => importRef.current?.click()}><Upload size={16} />{busy ? '…' : t('Import editing keys')}</button><input className="visually-hidden" type="file" tabIndex={-1} ref={importRef} accept=".json,application/json" aria-label={t('Import editing keys')} onChange={event => void importKeys(event.target.files?.[0])} /></div>{error && <ErrorMessage>{error}</ErrorMessage>}</Dialog>}</>;
}

export function Footer({ wordCount, editor, lurgUrl = 'https://lurg.pro' }: { wordCount?: number; editor?: Editor | null; lurgUrl?: string }) {
  const { t } = usePreferences();
  const [help, setHelp] = useState<'markdown' | 'keyboard' | null>(null);
  const [shortcutPlatform, setShortcutPlatform] = useState<'mac' | 'other'>('other');
  useEffect(() => { setShortcutPlatform(/Mac|iPhone|iPad/u.test(navigator.platform) ? 'mac' : 'other'); }, []);
  return <><footer className="site-footer"><div className="footer-meta"><button className="text-button markdown-hint" onClick={() => setHelp('markdown')}>{t('Markdown is supported')}<CircleHelp size={15} /></button>{editor ? <WritingStatisticsControl editor={editor}/> : wordCount !== undefined && <span className="word-count" aria-live="polite">{wordCount} {t(wordCount === 1 ? 'word' : 'words')}</span>}<IconButton label={t('Keyboard shortcuts')} onClick={() => setHelp('keyboard')}><Keyboard size={18} /></IconButton></div><a className="lurg-credit" href={lurgUrl} target="_blank" rel="noopener noreferrer">Made by Lurg<ArrowUpRight size={16} /></a></footer>{help && <Dialog title={t(help === 'markdown' ? 'Formatting while you write' : 'Keyboard shortcuts')} onClose={() => setHelp(null)}>{help === 'markdown' ? <><p>{t('Type Markdown shortcuts directly in the editor. Paste Markdown or import a .md file to preserve formatting. Tables, images, lists and code stay in one document.')}</p><dl className="shortcut-list"><div><dt><code># </code> … <code>###### </code></dt><dd>{t('Headings')}</dd></div><div><dt><code>**bold**</code></dt><dd>{t('Bold')}</dd></div><div><dt><code>- [ ] </code></dt><dd>{t('Task list')}</dd></div><div><dt><code>```</code></dt><dd>{t('Code block')}</dd></div></dl></> : <dl className="shortcut-list">{SHORTCUTS.map(shortcut => <div key={shortcut.id} data-shortcut={shortcut.id}><dt>{shortcutKeys(shortcut.id, shortcutPlatform).map((key,index) => <span key={key}>{index > 0 && ' + '}<kbd>{key}</kbd></span>)}</dt><dd>{t(shortcut.label)}</dd></div>)}</dl>}</Dialog>}</>;
}
