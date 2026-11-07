import { documentText } from './document';
import type { EditorDocument } from './types';

/** A reading estimate, rather than a promise about an individual reader. */
export function readingMinutes(document: EditorDocument): number {
  const text = documentText(document).trim();
  const words = text ? text.split(/\s+/u).length : 0;
  return Math.max(1, Math.ceil(words / 200));
}

export function readingTimeLabel(minutes: number, language: 'en' | 'ru'): string {
  return language === 'ru' ? `${minutes} мин чтения` : `${minutes} min read`;
}

export function viewsLabel(views: number, language: 'en' | 'ru'): string {
  const count = new Intl.NumberFormat(language).format(views);
  if (language === 'en') return `${count} ${views === 1 ? 'view' : 'views'}`;
  const mod10 = views % 10;
  const mod100 = views % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'просмотр' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'просмотра' : 'просмотров';
  return `${count} ${word}`;
}
