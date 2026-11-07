import DOMPurify from 'dompurify';
import { validateDocument } from '@/lib/document';
import type { DocumentNode, EditorDocument } from '@/lib/types';

export type WritingDocument = { title: string; content: EditorDocument; showViewCount?: boolean; baseVersion?: number };
const MAX_FILE_BYTES = 2_000_000;
function encode(value: unknown): string { const bytes = new TextEncoder().encode(JSON.stringify(value)); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function decode(value: string): unknown { if (value.length > 2_700_000 || !/^[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Invalid document metadata.'); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)))); }
export function readEmbeddedDocument(text: string, format: 'html' | 'markdown'): WritingDocument | undefined {
  const encoded = format === 'markdown' ? text.match(/<!-- verso-document:v2:([A-Za-z0-9+/=]+) -->/)?.[1] : new DOMParser().parseFromString(text, 'text/html').querySelector('meta[name="verso-document"]')?.getAttribute('content');
  if (!encoded) return undefined;
  const value = decode(encoded) as WritingDocument;
  if (!value || typeof value.title !== 'string' || value.title.length > 240 || (value.showViewCount !== undefined && typeof value.showViewCount !== 'boolean')) throw new Error('Invalid document metadata.');
  return { title: value.title, content: validateDocument(value.content, { allowEmpty: true }), showViewCount: value.showViewCount };
}
const HTML_TAGS = ['p','br','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','del','strike','code','pre','a','blockquote','ul','ol','li','input','hr','table','thead','tbody','tfoot','tr','th','td','img','video','source','iframe','figure','figcaption','mark','sub','sup','span','div','details','summary','aside','section'];
const HTML_ATTRS = ['href','src','alt','title','width','height','colspan','rowspan','start','type','checked','data-type','data-checked','data-language','data-latex','data-source','data-id','data-content','data-color','data-kind','data-variant','data-align','data-caption','data-provider','data-src','data-poster-src','data-animated','data-poster','data-footnote-id','data-footnote-label','data-mermaid','data-math','open','controls','poster','loading','rel','target','style'];
export function sanitizeImportedHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: HTML_TAGS, ALLOWED_ATTR: HTML_ATTRS, ALLOW_DATA_ATTR: true, FORBID_TAGS: ['script','style','svg','math','object','embed','form','button'], FORBID_ATTR: ['srcdoc','autofocus','autoplay','onerror','onload'], ADD_URI_SAFE_ATTR: ['data-latex','data-source','data-content'] });
  const document = new DOMParser().parseFromString(clean, 'text/html');
  document.querySelectorAll('[style]').forEach(element => {
    const source = element.getAttribute('style') ?? '';
    // Only formatting that the document validator can represent survives import.
    const declarations = source.split(';').map(value => value.trim()).filter(value => /^(text-align:\s*(left|right|center|justify)|color:\s*#[0-9a-f]{3,8}|background-color:\s*#[0-9a-f]{3,8})$/i.test(value));
    if (declarations.length) element.setAttribute('style', declarations.join(';')); else element.removeAttribute('style');
  });
  document.querySelectorAll('iframe').forEach(element => {
    try { const url = new URL(element.getAttribute('src') ?? ''); if (url.protocol !== 'https:' || !['www.youtube-nocookie.com','player.vimeo.com','rutube.ru'].includes(url.hostname)) element.remove(); else { element.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation'); element.setAttribute('loading','lazy'); } } catch { element.remove(); }
  });
  document.querySelectorAll('[href],[src],[poster]').forEach(element => {
    for (const attr of ['href','src','poster']) {
      const value = element.getAttribute(attr); if (!value) continue;
      if (/^\/api\/v1\/media\/[A-Za-z0-9_.-]+$/.test(value)) continue;
      try { const url = new URL(value); const schemes = attr === 'href' ? ['https:','http:','mailto:','tel:'] : ['https:']; if (!schemes.includes(url.protocol) || url.username || url.password) element.removeAttribute(attr); } catch { element.removeAttribute(attr); }
    }
  });
  document.querySelectorAll('a').forEach(element => { element.setAttribute('rel','noopener noreferrer ugc'); element.setAttribute('target','_blank'); });
  return document.body.innerHTML;
}
export function plainDocumentText(node: DocumentNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'footnote') return `[${String(node.attrs?.text ?? '')}]`;
  if (node.type === 'tableOfContents') return '[Contents]\n';
  if (['mathInline','mathBlock','inlineMath','blockMath'].includes(node.type)) return String(node.attrs?.latex ?? node.attrs?.source ?? '');
  if (node.type === 'mermaid') return String(node.attrs?.source ?? node.attrs?.code ?? '');
  if (node.type === 'image') return `[${node.attrs?.alt ?? 'Image'}]${node.attrs?.caption ? ` ${node.attrs.caption}` : ''}\n`;
  if (node.type === 'video' || node.type === 'linkPreview') return `${node.attrs?.title ?? ''} ${node.attrs?.src ?? node.attrs?.url ?? ''}\n`;
  if (node.type === 'horizontalRule') return '\n---\n';
  const separator = ['doc','bulletList','orderedList','taskList','table','tableRow','details','callout'].includes(node.type) ? '\n' : '';
  let value = (node.content ?? []).map(plainDocumentText).join(separator);
  if (['callout','toggle'].includes(node.type) && node.attrs?.title) value = `${node.attrs.title}\n${value}`;
  return ['paragraph','heading','blockquote','codeBlock','tableRow'].includes(node.type) ? `${value}\n` : value;
}
function escape(text: string): string { return text.replace(/[&<>"']/g, value => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[value]!)); }
export function markdownDocument(value: WritingDocument, markdown: string): string { return `# ${value.title.replace(/\n/g,' ')}\n\n${markdown}\n\n<!-- Verso stores an inert document snapshot below for lossless re-import of advanced blocks. -->\n<!-- verso-document:v2:${encode(value)} -->\n`; }
export async function htmlDocument(value: WritingDocument, _html?: string): Promise<string> {
  const { completeHtmlDocument } = await import('./document-export');
  return completeHtmlDocument(value, encode(value));
}
export async function printDocument(value: WritingDocument): Promise<void> {
  const { printWritingDocument } = await import('./document-export');
  return printWritingDocument(value);
}

export function downloadFile(value: string, filename: string, mime: string) { const url = URL.createObjectURL(new Blob([value], { type: `${mime};charset=utf-8` })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function readWritingFile(file: File): Promise<{ format:'html'|'markdown'|'text'; text:string; document?:WritingDocument; title:string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Import a file smaller than 2 MB.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['html','htm','md','markdown','txt'].includes(extension ?? '')) throw new Error('Choose an HTML, Markdown or plain text file.');
  let text = await file.text();
  const format = extension === 'html' || extension === 'htm' ? 'html' : extension === 'txt' ? 'text' : 'markdown';
  const embedded = format === 'text' ? undefined : readEmbeddedDocument(text, format);
  const firstHeading = format === 'markdown' ? text.match(/^# ([^\n]+)\n+/) : null;
  const title = firstHeading ? firstHeading[1].trim().slice(0,240) : format === 'html' ? new DOMParser().parseFromString(text,'text/html').querySelector('title,h1')?.textContent?.trim().slice(0,240) ?? file.name.replace(/\.[^.]+$/,'') : file.name.replace(/\.[^.]+$/,'');
  if (firstHeading && !embedded) text = text.slice(firstHeading[0].length);
  return { format, text: format === 'html' ? sanitizeImportedHtml(text) : text, document: embedded, title };
}

export function readableMarkdown(node: DocumentNode): string {
  const child = () => (node.content ?? []).map(readableMarkdown).join('');
  if (node.type === 'text') {
    let text = (node.text ?? '').replace(/([\\`*_[\]])/g,'\\$1');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text=`**${text}**`;
      else if(mark.type==='italic')text=`*${text}*`;
      else if(mark.type==='strike')text=`~~${text}~~`;
      else if(mark.type==='code')text=`\`${(node.text??'').replace(/`/g,'&#96;')}\``;
      else if(mark.type==='link')text=`[${text}](${String(mark.attrs?.href??'').replace(/[()\s]/g,char=>encodeURIComponent(char))})`;
      else if(mark.type==='underline')text=`<u>${text}</u>`;
      else if(mark.type==='subscript')text=`<sub>${text}</sub>`;
      else if(mark.type==='superscript')text=`<sup>${text}</sup>`;
      else if(mark.type==='highlight')text=`<mark>${text}</mark>`;
    }
    return text;
  }
  if(node.type==='hardBreak')return '  \n';
  if(node.type==='heading')return `${'#'.repeat(Number(node.attrs?.level)||1)} ${child()}\n\n`;
  if(node.type==='paragraph')return `${child()}\n\n`;
  if(node.type==='blockquote')return `${child().trim().split('\n').map(line=>`> ${line}`).join('\n')}\n\n`;
  if(node.type==='horizontalRule')return '---\n\n';
  if(node.type==='codeBlock'){const text=(node.content??[]).map(value=>value.text??'').join('');let fence='```';while(text.includes(fence))fence+='`';return `${fence}${node.attrs?.language??''}\n${text}\n${fence}\n\n`;}
  if(node.type==='bulletList'||node.type==='orderedList'||node.type==='taskList')return (node.content??[]).map((value,index)=>{const prefix=node.type==='orderedList'?`${Number(node.attrs?.start??1)+index}. `:node.type==='taskList'?`- [${value.attrs?.checked?'x':' '}] `:'- ';return prefix+readableMarkdown(value).trim().split('\n').map((line,lineIndex)=>lineIndex?'  '+line:line).join('\n');}).join('\n')+'\n\n';
  if(node.type==='image')return `![${String(node.attrs?.alt??'').replace(/[\[\]]/g,'')}](${node.attrs?.src??''})${node.attrs?.caption?`\n${node.attrs.caption}`:''}\n\n`;
  if(node.type==='video')return `[video](${node.attrs?.src??''})\n\n`;
  if(node.type==='table'){const rows=(node.content??[]).map(row=>(row.content??[]).map(cell=>readableMarkdown(cell).trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>')));return rows.map((row,index)=>`| ${row.join(' | ')} |\n${index===0?'| '+row.map(()=>'---').join(' | ')+' |\n':''}`).join('')+'\n';}
  if(['mathInline','inlineMath'].includes(node.type))return `$${node.attrs?.latex??node.attrs?.source??''}$`;
  if(['mathBlock','blockMath'].includes(node.type))return `$$\n${node.attrs?.latex??node.attrs?.source??''}\n$$\n\n`;
  if(node.type==='mermaid')return `\`\`\`mermaid\n${node.attrs?.source??node.attrs?.code??''}\n\`\`\`\n\n`;
  if(node.type==='linkPreview')return `[${node.attrs?.title??node.attrs?.url??'Link'}](${node.attrs?.url??''})\n\n`;
  return child();
}
