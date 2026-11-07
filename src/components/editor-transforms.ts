import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Plugin, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { prepareVersoMarkdown } from './editor-markdown';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
const plainUrls = new Set<string>();
export function preservePlainUrls(text: string) { for(const match of text.matchAll(/https:\/\/[^\s<>]+/g)) {if(plainUrls.size >= 2000) plainUrls.delete(plainUrls.values().next().value!); plainUrls.add(match[0]);} }
export function shouldAutoLink(url:string) {return !plainUrls.has(url);}
export const MAX_PASTE_CHARACTERS = 500_000;
const SAFE_TAGS = new Set('p br h1 h2 h3 h4 h5 h6 strong b em i u s del strike code pre a ul ol li blockquote hr table thead tbody tfoot tr th td img span mark sub sup div figure figcaption'.split(' '));
const DISCARD_TAGS = new Set('script style iframe object embed template svg math form input button textarea select link meta base'.split(' '));
/** DOM parsing never executes clipboard markup; only this explicit vocabulary reaches ProseMirror. */
export function cleanPastedHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html.slice(0, MAX_PASTE_CHARACTERS), 'text/html');
  let nodes = 0; const visit = (element: Element, depth = 0) => {
    if (++nodes > 20000 || depth > 60) {element.remove(); return;}
    for (const name of ['colspan','rowspan','width','height','start']) {if(!element.hasAttribute(name))continue;const value=Number(element.getAttribute(name)); const max=name==='colspan'?30:name==='rowspan'?200:name==='start'?1000000:20000;if(!Number.isSafeInteger(value)||value<1||value>max)element.removeAttribute(name);}
    const style = element.getAttribute('style') ?? '';
    if (element.tagName.toLowerCase() === 'span') { const strong = /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style); const italic = /font-style\s*:\s*italic/i.test(style); const underline = /text-decoration[^;]*:\s*[^;]*underline/i.test(style); for (const tag of [strong ? 'strong' : '',italic ? 'em' : '',underline ? 'u' : ''].filter(Boolean)) { const wrapper = parsed.createElement(tag); wrapper.append(...element.childNodes); element.append(wrapper); } }
    for (const child of [...element.children]) visit(child,depth+1);
    const tag = element.tagName.toLowerCase();
    if (DISCARD_TAGS.has(tag)) { element.remove(); return; }
    if (!SAFE_TAGS.has(tag)) { element.replaceWith(...element.childNodes); return; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(); const value = attribute.value;
      const keep = (name === 'href' && tag === 'a' && /^(?:https?:|mailto:|#)/i.test(value)) || (name === 'src' && tag === 'img' && /^https:\/\//i.test(value)) || ['alt', 'title', 'colspan', 'rowspan', 'width', 'height', 'start'].includes(name) || (name === 'style' && /^(?:text-align\s*:\s*(?:left|right|center|justify)\s*;?\s*)$/i.test(value));
      if (!keep) element.removeAttribute(attribute.name);
    }
  };
  for (const child of [...parsed.body.children]) visit(child);
  for(const table of parsed.body.querySelectorAll('table')) {
    const rows=[...table.querySelectorAll('tr')];const occupied=Array<number>(30).fill(0);let valid=rows.length<=200;
    for(let rowIndex=0;valid&&rowIndex<rows.length;rowIndex++){let column=0;for(const cell of [...rows[rowIndex].children].filter(cell=>/^(TD|TH)$/.test(cell.tagName))){while(column<30&&occupied[column]>rowIndex)column++;const colspan=Number(cell.getAttribute('colspan')||1);const rowspan=Number(cell.getAttribute('rowspan')||1);if(column+colspan>30||rowIndex+rowspan>rows.length||occupied.slice(column,column+colspan).some(until=>until>rowIndex)){valid=false;break;}for(let offset=0;offset<colspan;offset++)occupied[column+offset]=rowIndex+rowspan;column+=colspan;}}
    if(!valid)table.replaceWith(parsed.createTextNode(table.textContent??''));
  }
  return parsed.body.innerHTML;
}
export function parseDelimited(text: string, separator = ','): string[][] {
  if (text.length > MAX_PASTE_CHARACTERS) throw new Error('Table data is too large.');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; } else if (!quoted && c === separator) { row.push(field); field = ''; } else if (!quoted && (c === '\n' || c === '\r')) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; } else field += c; }
  if (quoted) throw new Error('Close the quoted CSV field.');
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length > 200 || rows.some(value => value.length > 30)) throw new Error('Use a table with at most 200 rows and 30 columns.');
  return rows;
}
export function tableFromRows(rows: string[][], header = true): JSONContent {
  const width = Math.max(1, ...rows.map(row => row.length));
  return { type: 'table', content: rows.map((row, index) => ({ type: 'tableRow', content: Array.from({ length: width }, (_, column) => ({ type: index === 0 && header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: row[column] ? [{ type: 'text', text: row[column] }] : [] }] })) })) };
}
export function moveTopLevelBlock(editor: Editor, position: number, target: number) {
  const { doc } = editor.state; const source = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  const from = source.depth ? source.before(1) : position; const node = doc.nodeAt(from); if (!node || !node.isBlock || target >= from && target <= from + node.nodeSize) return false;
  const tr = editor.state.tr.delete(from, from + node.nodeSize); const destination = tr.mapping.map(Math.max(0, Math.min(target, doc.content.size)));
  tr.insert(destination, node); const previous = editor.state.selection;
  if (previous.from >= from && previous.to <= from + node.nodeSize) {
    if (previous instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc,destination));
    else { const start = Math.min(tr.doc.content.size,destination + previous.from - from); const end = Math.min(tr.doc.content.size,destination + previous.to - from); const first = tr.doc.resolve(start); const last = tr.doc.resolve(end); tr.setSelection(first.parent.isTextblock && last.parent.isTextblock ? TextSelection.create(tr.doc,start,end) : TextSelection.near(first)); }
  }
  editor.view.dispatch(closeHistory(tr).scrollIntoView()); editor.commands.focus(); return true;
}
export function moveCurrentBlock(editor: Editor, direction: -1 | 1) {
  const { $from } = editor.state.selection; const index = $from.index(0); if (index + direction < 0 || index + direction >= editor.state.doc.childCount) return false;
  let from = 0; for (let i = 0; i < index; i++) from += editor.state.doc.child(i).nodeSize;
  const target = direction < 0 ? from - editor.state.doc.child(index - 1).nodeSize : from + editor.state.doc.child(index).nodeSize + editor.state.doc.child(index + 1).nodeSize;
  return moveTopLevelBlock(editor, from, target);
}
export const SmartPaste = Extension.create({
  name: 'smartPaste',
  onCreate() {this.editor.state.doc.descendants(node=>{if(node.isText&&!node.marks.some(mark=>mark.type.name==='link'))preservePlainUrls(node.text??'');});},
  addKeyboardShortcuts() { return { 'Alt-Shift-ArrowUp': () => moveCurrentBlock(this.editor, -1), 'Alt-Shift-ArrowDown': () => moveCurrentBlock(this.editor, 1) }; },
  addProseMirrorPlugins() { const editor = this.editor; let plain = false; return [new Plugin({ props: {
    handleKeyDown(_view, event) { plain = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v'; return false; },
    handlePaste(view, event) {
      if (event.clipboardData?.files.length) return false;
      const text = event.clipboardData?.getData('text/plain') ?? ''; const html = event.clipboardData?.getData('text/html') ?? '';
      if (!text && !html) return false;
      if (text.length + html.length > MAX_PASTE_CHARACTERS) { event.preventDefault(); window.dispatchEvent(new CustomEvent('verso-editor-error', { detail: 'Paste at most 500,000 characters at a time.' })); return true; }
      event.preventDefault();
      if (plain) { plain = false; preservePlainUrls(text); const lines = text.split(/\r?\n/); const content = lines.map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })); editor.commands.insertContent(content); return true; }
      if (/^https:\/\/[^\s<>]+$/i.test(text.trim()) && text.length < 2048) { window.dispatchEvent(new CustomEvent('verso-paste-url', { detail: { url: text.trim(), from: view.state.selection.from, to: view.state.selection.to } })); return true; }
      if (html) { const wrapper = document.createElement('div'); wrapper.innerHTML = cleanPastedHtml(html); const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(wrapper); view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView()); return true; }
      if (text.includes('\t') && text.includes('\n')) { try { editor.commands.insertContent(tableFromRows(parseDelimited(text, '\t'))); return true; } catch { /* Large/irregular text remains plain. */ } }
      editor.commands.insertContent(prepareVersoMarkdown(text), { contentType: 'markdown' }); return true;
    },
  } })]; },
});
