import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { matchesShortcut } from '@/lib/shortcuts';

export type SearchMatch = { from: number; to: number };
export type SearchState = { query: string; caseSensitive: boolean; index: number; matches: SearchMatch[]; decorations: DecorationSet };
export const findReplaceKey = new PluginKey<SearchState>('verso-find-replace');
export function findMatches(document: ProseMirrorNode, query: string, caseSensitive = false): SearchMatch[] {
  if (!query || query.length > 500) return [];
  const matches: SearchMatch[] = [];
  document.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const value = child.isText ? child.text! : '\uFFFC';
      for (let i = 0; i < value.length; i++) positions.push(position + 1 + offset + i);
      text += value;
    });
    // Use a literal regex so Unicode case folding never changes ProseMirror offsets.
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
    for (const match of text.matchAll(expression)) {
      if (matches.length >= 2000) break;
      const start = match.index!, end = start + match[0].length - 1;
      if (!match[0].includes('\uFFFC') && positions[start] !== undefined && positions[end] !== undefined) matches.push({ from: positions[start], to: positions[end] + 1 });
    }
    return false;
  });
  return matches;
}
function stateFor(document: ProseMirrorNode, query = '', caseSensitive = false, index = 0): SearchState {
  const matches = findMatches(document, query, caseSensitive);
  index = matches.length ? ((index % matches.length) + matches.length) % matches.length : 0;
  return { query, caseSensitive, index, matches, decorations: DecorationSet.create(document, matches.map((match, number) => Decoration.inline(match.from, match.to, { class: number === index ? 'search-match search-match-current' : 'search-match' }))) };
}
export const FindReplaceExtension = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() { return [new Plugin<SearchState>({
    key: findReplaceKey,
    state: { init: (_, state) => stateFor(state.doc), apply(transaction, previous) { const meta = transaction.getMeta(findReplaceKey) as Partial<SearchState> | undefined; if (!meta && !transaction.docChanged) return previous; return stateFor(transaction.doc, meta?.query ?? previous.query, meta?.caseSensitive ?? previous.caseSensitive, meta?.index ?? previous.index); } },
    props: { handleKeyDown: (_view, event) => { if (matchesShortcut(event, 'find') || matchesShortcut(event, 'replace')) { window.dispatchEvent(new CustomEvent('verso-find', { detail: { replace: matchesShortcut(event, 'replace') } })); return true; } return false; }, decorations: state => findReplaceKey.getState(state)?.decorations },
  })]; },
});
export function searchEditor(editor: Editor, query: string, caseSensitive: boolean, index = 0) { editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { query, caseSensitive, index }).setMeta('addToHistory', false)); }
export function goToSearchMatch(editor: Editor, direction: number) {
  const current = findReplaceKey.getState(editor.state); if (!current?.matches.length) return;
  const index = (current.index + direction + current.matches.length) % current.matches.length;
  const match = current.matches[index];
  editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { index }).setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView().setMeta('addToHistory', false));
}
export function replaceSearchMatches(editor: Editor, replacement: string, all = false) {
  const current = findReplaceKey.getState(editor.state); if (!current?.matches.length || replacement.length > 10_000) return;
  const matches = all ? current.matches : [current.matches[current.index]];
  let transaction = editor.state.tr;
  for (const match of [...matches].reverse()) transaction = transaction.insertText(replacement, match.from, match.to);
  // One transaction is one undo operation, including replacement across marks.
  editor.view.dispatch(transaction.setMeta(findReplaceKey, { index: current.index }));
}
