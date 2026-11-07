import type { Editor } from '@tiptap/react';
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Standard Markdown footnotes are expanded into typed inline nodes before parsing. */
export function prepareVersoMarkdown(markdown: string) {
  const definitions = new Map<string,string>();
  let source = markdown.replace(/^\[\^([A-Za-z0-9_-]{1,80})\]:[ \t]*(.*)((?:\n(?: {4}|\t).*)*)/gm, (_all,id:string,first:string,rest:string) => { definitions.set(id, first + rest.replace(/\n(?: {4}|\t)/g, '\n')); return ''; });
  if (!definitions.size) return source;
  source = source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((part,index) => index % 2 ? part : part.replace(/\[\^([A-Za-z0-9_-]{1,80})\]/g, (all,id:string) => { const text = definitions.get(id); if (text === undefined) return all; const node = { type: 'footnote', attrs: { id: id.startsWith('fn-') ? id : `fn-${id}`, text: text.slice(0,4000) } }; return `<span data-verso-node="footnote" data-verso-json="${escapeAttribute(JSON.stringify(node))}"></span>`; })).join('');
  return source;
}
export function serializeVersoMarkdown(editor: Editor) {
  const definitions: string[] = [];
  const markdown = editor.getMarkdown().replace(/<span data-verso-node="footnote" data-verso-json="([^"]*)"><\/span>/g, (all, encoded:string) => { try { const element = new DOMParser().parseFromString(`<span data-value="${encoded}"></span>`, 'text/html').body.firstElementChild; const node = JSON.parse(element?.getAttribute('data-value') ?? 'null'); if (node?.type !== 'footnote' || typeof node.attrs?.text !== 'string') return all; const id = String(node.attrs.id ?? `fn-${definitions.length + 1}`).replace(/[^A-Za-z0-9_-]/g,''); definitions.push(`[^${id}]: ${node.attrs.text.replace(/\n/g,'\n    ')}`); return `[^${id}]`; } catch { return all; } });
  return markdown + (definitions.length ? `\n\n${definitions.join('\n\n')}\n` : '');
}
