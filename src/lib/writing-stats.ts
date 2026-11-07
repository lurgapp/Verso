import type { DocumentNode, EditorDocument } from './types';

export type WritingStatistics = { words: number; characters: number; charactersWithoutSpaces: number; paragraphs: number; sentences: number; readingMinutes: number; headings: number; links: number };
export function textStatistics(document: EditorDocument, locale = 'en'): WritingStatistics {
  const blocks: string[] = [];
  let paragraphs = 0, headings = 0, links = 0;
  function walk(node: DocumentNode): string {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    let previousHref:unknown;
    const text = (node.content ?? []).map(child => {
      const href = child.marks?.find(mark => mark.type === 'link')?.attrs?.href;
      if (href && href !== previousHref) links++;
      previousHref = href;
      return walk(child);
    }).join('');
    if (['paragraph', 'heading', 'codeBlock', 'mathBlock', 'mermaid'].includes(node.type)) {
      if (node.type === 'paragraph' && text.trim()) paragraphs++;
      if (node.type === 'heading') headings++;
      blocks.push(text || (typeof node.attrs?.latex === 'string' ? node.attrs.latex : typeof node.attrs?.code === 'string' ? node.attrs.code : typeof node.attrs?.source === 'string' ? node.attrs.source : ''));
    }
    if (node.type === 'linkPreview') links++;
    return text;
  }
  walk(document);
  const text = blocks.join('\n').trim();
  let words: number, sentences: number;
  try {
    words = [...new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)].filter(value => value.isWordLike).length;
    sentences = [...new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text)].filter(value => /[\p{L}\p{N}]/u.test(value.segment)).length;
  } catch { words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0; sentences = text.split(/[.!?。！？]+/u).filter(value => /[\p{L}\p{N}]/u.test(value)).length; }
  return { words, characters: [...text].length, charactersWithoutSpaces: [...text.replace(/\s/gu, '')].length, paragraphs, sentences, readingMinutes: words ? Math.max(1, Math.ceil(words / 200)) : 0, headings, links };
}
