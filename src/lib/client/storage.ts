import { openDB, type IDBPDatabase } from 'idb';
import type { EditorDocument } from '@/lib/types';
import { validateDocument } from '@/lib/document';

export type Draft = {
  id: string;
  title: string;
  content: EditorDocument;
  revision: number;
  updatedAt: string;
  writerId: string;
  baseVersion?: number;
  showViewCount?: boolean;
};
export type Ownership = { articleId: string; editKey: string; createdAt: string };

let databasePromise: Promise<IDBPDatabase> | undefined;
const db = () => databasePromise ??= openDB('verso-private', 2, {
  upgrade(database) {
    if (!database.objectStoreNames.contains('drafts')) database.createObjectStore('drafts', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('ownership')) database.createObjectStore('ownership', { keyPath: 'articleId' });
    if (!database.objectStoreNames.contains('snapshots')) { const store = database.createObjectStore('snapshots', { keyPath: 'id' }); store.createIndex('draftId', 'draftId'); }
  },
  blocking() { void databasePromise?.then(database => database.close()); databasePromise = undefined; },
  terminated() { databasePromise = undefined; },
}).catch(error => { databasePromise = undefined; throw error; });

export async function readDraft(id: string): Promise<Draft | undefined> {
  return (await db()).get('drafts', id);
}

export class DraftConflict extends Error {
  constructor() { super('This draft was changed in another tab.'); }
}

export async function writeDraft(draft: Draft, expectedRevision: number): Promise<Draft> {
  const database = await db();
  const tx = database.transaction('drafts', 'readwrite');
  const previous = await tx.store.get(draft.id) as Draft | undefined;
  if ((previous?.revision ?? 0) !== expectedRevision) {
    await tx.done;
    throw new DraftConflict();
  }
  const next = { ...draft, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
  await tx.store.put(next);
  await tx.done;
  // History is optional: storage quota exhaustion must never prevent saving the live draft.
  await saveDraftSnapshot(next).catch(() => undefined);
  return next;
}

export async function removeDraft(id: string, expectedRevision: number): Promise<void> {
  const database = await db();
  const tx = database.transaction('drafts', 'readwrite');
  const previous = await tx.store.get(id) as Draft | undefined;
  if ((previous?.revision ?? 0) === expectedRevision) await tx.store.delete(id);
  await tx.done;
}

export async function saveOwnership(key: Ownership): Promise<void> {
  await (await db()).put('ownership', key);
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);
}
export async function readOwnership(articleId: string): Promise<Ownership | undefined> {
  return (await db()).get('ownership', articleId);
}
export async function allOwnership(): Promise<Ownership[]> {
  return (await db()).getAll('ownership');
}
export async function removeOwnership(articleId: string): Promise<void> {
  await (await db()).delete('ownership', articleId);
}

export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(value: string, filename: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options?.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(payload?.error?.message ?? 'Something went wrong. Please try again.', response.status, payload?.error?.code, parseRetryAfter(response.headers.get('Retry-After')));
  return payload as T;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfterSeconds?: number) { super(message); }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value || value.length > 128) return undefined;
  const header = value.trim();
  let seconds: number;
  if (/^\d+$/.test(header)) seconds = Number(header);
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) {
    const timestamp = Date.parse(header);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== header) return undefined;
    seconds = Math.ceil((timestamp - now) / 1000);
  }
  else return undefined;
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(86_400, Math.max(1, seconds));
}

export function publicationRateLimitMessage(language: string, retryAfterSeconds: number | undefined, draftSaved: boolean): string {
  const count = retryAfterSeconds === undefined ? undefined : retryAfterSeconds < 60 ? retryAfterSeconds : Math.ceil(retryAfterSeconds / 60);
  const seconds = retryAfterSeconds !== undefined && retryAfterSeconds < 60;
  if (language === 'ru') {
    const retry = count === undefined ? 'Попробуйте немного позже.' : `Повторите через ${count} ${seconds ? 'сек.' : 'мин.'}`;
    return `Лимит публикаций временно исчерпан. ${retry} ${draftSaved ? 'Черновик сохранён на этом устройстве.' : 'Текст остаётся в редакторе. Скачайте копию через меню.'}`;
  }
  const retry = count === undefined ? 'Please try again later.' : `Please try again in ${count} ${seconds ? 'second' : 'minute'}${count === 1 ? '' : 's'}.`;
  return `Publication limit reached. ${retry} ${draftSaved ? 'Your draft is saved on this device.' : 'Your text remains in the editor. Download a copy from the menu.'}`;
}


export type DraftSnapshot = Omit<Draft, 'id'> & { id: string; draftId: string; createdAt: string; bytes: number; reason: 'periodic' | 'restore' | 'import' | 'manual' };
const SNAPSHOT_INTERVAL = 60_000;
const SNAPSHOT_RETENTION = 30 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 40;
const MAX_TOTAL_SNAPSHOTS = 200;
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;

export async function saveDraftSnapshot(draft: Draft, reason: DraftSnapshot['reason'] = 'periodic'): Promise<void> {
  if (draft.title.length > 240) throw new Error('Invalid snapshot title.');
  const database = await db();
  const tx = database.transaction('snapshots', 'readwrite');
  const records = (await tx.store.getAll()) as DraftSnapshot[];
  const all = records.filter(item => item && typeof item.id === 'string' && typeof item.draftId === 'string' && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) && typeof item.title === 'string' && Number.isFinite(item.bytes) && item.bytes >= 0);
  for (const record of records) if (!all.includes(record) && record && typeof record.id === 'string') await tx.store.delete(record.id);
  const own = all.filter(item => item.draftId === draft.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const now = Date.now();
  const previous = own[0];
  if (previous && reason === 'periodic' && (now - Date.parse(previous.createdAt) < SNAPSHOT_INTERVAL || (previous.title === draft.title && JSON.stringify(previous.content) === JSON.stringify(draft.content)))) { await tx.done; return; }
  validateDocument(draft.content, { allowEmpty: true });
  const serialized = JSON.stringify({ title: draft.title, content: draft.content, showViewCount: draft.showViewCount });
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > 1_000_000) { await tx.done; return; }
  const snapshot: DraftSnapshot = { ...draft, id: crypto.randomUUID(), draftId: draft.id, createdAt: new Date(now).toISOString(), bytes, reason };
  await tx.store.put(snapshot);
  const keep = [...all, snapshot].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counts = new Map<string, number>();
  let totalBytes = 0, total = 0;
  for (const item of keep) {
    const count = (counts.get(item.draftId) ?? 0) + 1;
    counts.set(item.draftId, count);
    const size = Number.isFinite(item.bytes) ? item.bytes : 1_000_000;
    if (count > MAX_SNAPSHOTS || total >= MAX_TOTAL_SNAPSHOTS || totalBytes + size > MAX_SNAPSHOT_BYTES || now - Date.parse(item.createdAt) > SNAPSHOT_RETENTION) await tx.store.delete(item.id);
    else { total++; totalBytes += size; }
  }
  await tx.done;
}

export async function listDraftSnapshots(draftId: string): Promise<DraftSnapshot[]> {
  const values = await (await db()).getAllFromIndex('snapshots', 'draftId', draftId) as DraftSnapshot[];
  return values.filter(value => {
    try { if (typeof value.title !== 'string' || value.title.length > 240 || !Number.isFinite(Date.parse(value.createdAt)) || Date.now() - Date.parse(value.createdAt) > SNAPSHOT_RETENTION) return false; validateDocument(value.content, { allowEmpty: true }); return true; } catch { return false; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
