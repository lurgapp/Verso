'use client';

import { useEffect, useState } from 'react';
import { readingTimeLabel, viewsLabel } from '@/lib/article-stats';
import { usePreferences } from './preferences';

const VISIBLE_DWELL_MS = 5_000;
const SESSION_COOLDOWN_MS = 30 * 60 * 1_000;
type Props = { id: string; createdAt: string; readingMinutes: number; showViewCount: boolean; viewCount?: number };

/** Session storage holds only article IDs and timestamps, never a reader identifier. */
export function ArticleMeta({ id, createdAt, readingMinutes, showViewCount, viewCount }: Props) {
  const { language } = usePreferences();
  const [views, setViews] = useState(viewCount);
  useEffect(() => { setViews(viewCount); }, [id, viewCount]);
  useEffect(() => {
    const key = `verso-view:${id}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let complete = false;
    let active = true;
    const controller = new AbortController();
    const countedRecently = () => {
      try {
        const saved = Number(sessionStorage.getItem(key));
        return Number.isFinite(saved) && saved > 0 && saved <= Date.now() && Date.now() - saved < SESSION_COOLDOWN_MS;
      } catch { return false; }
    };
    const register = async () => {
      timer = undefined;
      if (!active || pending || complete || document.visibilityState !== 'visible' || countedRecently()) return;
      pending = true;
      try {
        const response = await fetch(`/api/v1/articles/${id}/views`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (!active) return;
        complete = true;
        try { sessionStorage.setItem(key, String(Date.now())); } catch { /* Server-side suppression still applies. */ }
        if (result && typeof result === 'object' && 'viewCount' in result && Number.isSafeInteger(result.viewCount) && Number(result.viewCount) >= 0) setViews(Number(result.viewCount));
      } catch { /* Reading stays available if counting is blocked or the browser is offline. */ }
      finally { pending = false; }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (active && !pending && !complete && document.visibilityState === 'visible' && !countedRecently()) timer = setTimeout(() => { void register(); }, VISIBLE_DWELL_MS);
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('online', schedule);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller.abort();
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('online', schedule);
    };
  }, [id]);
  const date = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date(createdAt));
  return <div className="article-meta">
    <time dateTime={createdAt}>{date}</time>
    <span aria-hidden="true"> · </span><span>{readingTimeLabel(readingMinutes, language)}</span>
    {showViewCount && typeof views === 'number' && <><span aria-hidden="true"> · </span><span data-article-views title={language === 'ru' ? 'Приблизительный счётчик прочтений, не уникальные читатели' : 'Approximate reads, not unique readers'}>{viewsLabel(views, language)}</span></>}
  </div>;
}
