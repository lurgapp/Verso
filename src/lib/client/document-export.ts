import type { DocumentNode, EditorDocument } from '@/lib/types';
import { validateDocument } from '@/lib/document';
import type { WritingDocument } from './document-files';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);
const text = (node: DocumentNode):string => node.type === 'text' ? node.text ?? '' : (node.content ?? []).map(text).join('');
const css = `body{max-width:760px;margin:50px auto;padding:0 24px;font:18px/1.75 Georgia,'Times New Roman',serif;color:#171717;background:#fff;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{line-height:1.25;break-after:avoid}img,video,iframe,svg{max-width:100%;height:auto}figure{margin:24px 0}figcaption{font:14px/1.5 sans-serif;color:#666;text-align:center}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;font:14px/1.6 monospace}code{font-family:monospace}blockquote,aside{border-left:3px solid #999;padding:8px 20px}aside{background:#f7f7f7}details{margin:20px 0}summary{font-weight:bold}a{color:inherit}mark{color:inherit}.text-red{color:#c43838}.text-orange{color:#a54e08}.text-yellow{color:#826300}.text-green{color:#177245}.text-blue{color:#215ac4}.text-purple{color:#7a3eb1}.text-pink{color:#b63073}.text-gray{color:#666}.highlight-yellow{background:#fff1a8}.highlight-green{background:#d5edcd}.highlight-blue{background:#d5e8ff}.highlight-pink{background:#f6d1e6}.highlight-gray{background:#e6e6e6}.gallery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.gallery-horizontal{display:flex;gap:16px;overflow:auto}.gallery-horizontal figure{min-width:240px}.image-left{text-align:left}.image-center{text-align:center}.image-right{text-align:right}.math-display{text-align:center;position:relative;padding:15px 30px}.equation-number{position:absolute;right:0}.export-error{font:13px/1.5 sans-serif;color:#a00}.footnotes{font-size:14px}.code-filename{font:12px/1.5 sans-serif;color:#666}.diagram-source{font:12px/1.5 monospace}math{font-size:1.15em} @media print{@page{margin:18mm}body{max-width:none;margin:0;padding:0;font-size:11pt}figure,pre,blockquote,tr,.math-display{break-inside:avoid}details>*:not(summary){display:block!important}video,iframe{display:none}.gallery-horizontal{display:block;overflow:visible}.diagram-source{display:none}.export-video{break-inside:avoid}a{overflow-wrap:anywhere}}`;

/** Export is generated from validated JSON, never by trusting editor DOM or supplied HTML. */
export async function exportDocumentBody(document: EditorDocument):Promise<string> {
  const canonical = validateDocument(document,{allowEmpty:true});
  const headings:{id:string;level:number;text:string}[]=[];
  const headingIds=new Map<DocumentNode,string>();
  const notes=new Map<string,{text:string;number:number;references:string[]}>();
  const usedIds=new Set<string>();let equations=0,formulas=0,diagrams=0;
  const unique=(candidate:string)=>{let id=candidate,index=2;while(usedIds.has(id))id=`${candidate}-${index++}`;usedIds.add(id);return id;};
  const scan=(node:DocumentNode)=>{if(node.type==='heading'){const id=unique(String(node.attrs?.id??`h-export-${headings.length+1}`));headingIds.set(node,id);headings.push({id,level:Number(node.attrs?.level??1),text:text(node)});}for(const child of node.content??[])scan(child);};scan(canonical);
  async function render(node:DocumentNode):Promise<string>{
    const a=node.attrs??{};
    const children=async()=>{let value='';for(const child of node.content??[])value+=await render(child);return value;};
    if(node.type==='text'){let value=escape(node.text);for(const mark of node.marks??[]){const tag:Record<string,string>={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code',subscript:'sub',superscript:'sup'};if(tag[mark.type])value=`<${tag[mark.type]}>${value}</${tag[mark.type]}>`;else if(mark.type==='link')value=`<a href="${escape(mark.attrs?.href)}" rel="noopener noreferrer">${value}</a>`;else if(mark.type==='textStyle')value=`<span class="text-${escape(mark.attrs?.color)}">${value}</span>`;else if(mark.type==='highlight')value=`<mark class="highlight-${escape(mark.attrs?.color)}">${value}</mark>`;}return value;}
    const align=a.textAlign?` style="text-align:${escape(a.textAlign)}"`:'';
    switch(node.type){
      case 'doc':return children();
      case 'paragraph':return `<p${align}>${await children()||'<br>'}</p>`;
      case 'heading':return `<h${a.level??1} id="${escape(headingIds.get(node))}"${align}>${await children()}</h${a.level??1}>`;
      case 'hardBreak':return '<br>';
      case 'horizontalRule':return '<hr>';
      case 'blockquote':return `<blockquote>${await children()}</blockquote>`;
      case 'bulletList':case 'taskList':return `<ul>${await children()}</ul>`;
      case 'orderedList':return `<ol start="${Number(a.start??1)}">${await children()}</ol>`;
      case 'listItem':return `<li>${await children()}</li>`;
      case 'taskItem':return `<li>${a.checked?'☑':'☐'} ${await children()}</li>`;
      case 'codeBlock':return `${a.filename?`<div class="code-filename">${escape(a.filename)}</div>`:''}<pre><code${a.language?` class="language-${escape(a.language)}"`:''}>${escape(text(node))}</code></pre>`;
      case 'table':return `<table><tbody>${await children()}</tbody></table>`;
      case 'tableRow':return `<tr>${await children()}</tr>`;
      case 'tableCell':case 'tableHeader':{const tag=node.type==='tableHeader'?'th':'td';return `<${tag} colspan="${Number(a.colspan??1)}" rowspan="${Number(a.rowspan??1)}"${align}>${await children()}</${tag}>`;}
      case 'image':{const source=a.animated&&a.posterSrc?a.posterSrc:a.src;return `<figure class="image-${escape(a.align??'center')}"><img src="${escape(source)}" alt="${escape(a.alt)}"${a.width?` width="${a.width}"`:''}${a.height?` height="${a.height}"`:''}>${a.caption?`<figcaption>${escape(a.caption)}</figcaption>`:''}${a.animated?`<figcaption><a href="${escape(a.src)}">${escape(documentLanguage()==='ru'?'Открыть анимацию':'Open animation')}</a></figcaption>`:''}</figure>`;}
      case 'video':return `<figure class="export-video">${a.posterSrc?`<img src="${escape(a.posterSrc)}" alt="${escape(a.caption??'Video')}">`:''}<p><a href="${escape(a.src)}">${escape(a.caption||'Video')} · ${escape(a.src)}</a></p></figure>`;
      case 'mathInline':case 'mathBlock':{const katex=await import('katex');const display=node.type==='mathBlock';const latex=String(a.latex??'');let formula='';try{formula=katex.default.renderToString(latex,{displayMode:display,throwOnError:true,trust:false,strict:'error',maxExpand:300,maxSize:20,output:'mathml'});}catch{formula=`<code>${escape(latex)}</code><span class="export-error">${escape(documentLanguage()==='ru'?'Ошибка формулы':'Invalid formula')}</span>`;}const id=display?unique(String(a.id??`eq-export-${++formulas}`)):'';const number=display&&a.numbered?++equations:0;return display?`<figure class="math-display" id="${escape(id)}">${formula}${a.numbered?`<a class="equation-number" href="#${escape(id)}">(${number})</a>`:''}</figure>`:`<span>${formula}</span>`;}
      case 'mermaid':{const source=String(a.code??'');try{const {renderSafeDiagram}=await import('@/components/advanced-block-views');const svg=await renderSafeDiagram(`verso-export-${++diagrams}-${crypto.randomUUID().replaceAll('-','')}`,source,false);return `<figure>${svg}<details class="diagram-source"><summary>Mermaid</summary><pre><code>${escape(source)}</code></pre></details></figure>`;}catch{return `<figure><pre><code>${escape(source)}</code></pre><p class="export-error">${escape(documentLanguage()==='ru'?'Не удалось отобразить диаграмму':'Diagram preview unavailable')}</p></figure>`;}}
      case 'footnote':{const id=String(a.id);const note=notes.get(id)??{text:String(a.text??''),number:notes.size+1,references:[]};notes.set(id,note);const reference=`fn-ref-${note.number}-${note.references.length+1}`;note.references.push(reference);return `<sup id="${reference}"><a href="#fn-${note.number}">${note.number}</a></sup>`;}
      case 'tableOfContents':return `<nav aria-label="${documentLanguage()==='ru'?'Оглавление':'Contents'}"><ol>${headings.map(heading=>`<li style="margin-left:${(heading.level-1)*12}px"><a href="#${escape(heading.id)}">${escape(heading.text)}</a></li>`).join('')}</ol></nav>`;
      case 'callout':return `<aside><strong>${escape(a.title??a.kind)}</strong>${await children()}</aside>`;
      case 'toggle':return `<details open><summary>${escape(a.title)}</summary>${await children()}</details>`;
      case 'gallery':return `<div class="gallery-${escape(a.layout??'grid')}">${await children()}</div>`;
      case 'linkPreview':return `<figure>${a.image?`<img src="${escape(a.image)}" alt="">`:''}<a href="${escape(a.url)}"><strong>${escape(a.title)}</strong></a><p>${escape(a.description)}</p></figure>`;
      default:throw new Error(`Unsupported export node: ${node.type}`);
    }
  }
  // Sequential traversal keeps equation/footnote numbers deterministic despite async renderers.
  const renderSequential=async()=>{let result='';for(const node of canonical.content)result+=await render(node);return result;};
  let body=await renderSequential();
  if(notes.size)body+=`<section class="footnotes"><hr><ol>${[...notes.values()].map(note=>`<li id="fn-${note.number}">${escape(note.text)} ${note.references.map(reference=>`<a href="#${reference}" aria-label="Back">↩</a>`).join(' ')}</li>`).join('')}</ol></section>`;
  return body;
}
function documentLanguage(){return typeof document!=='undefined'?document.documentElement.lang:'en';}
export async function completeHtmlDocument(value:WritingDocument,metadata:string):Promise<string>{return `<!doctype html><html lang="${escape(documentLanguage()||'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="verso-document" content="${escape(metadata)}"><title>${escape(value.title)}</title><style>${css}</style></head><body><h1>${escape(value.title)}</h1>${await exportDocumentBody(value.content)}</body></html>`;}

export async function printWritingDocument(value:WritingDocument):Promise<void>{
  document.querySelector('.verso-print-root')?.remove();
  const printRoot=document.createElement('div');printRoot.className='verso-print-root';
  const body=await exportDocumentBody(value.content);
  const style=document.createElement('style');style.textContent=`.verso-print-root{display:none}@media print{body>*:not(.verso-print-root){display:none!important}.verso-print-root{display:block!important;color:#111;background:#fff;font:11pt/1.6 Georgia,'Times New Roman',serif}.verso-print-root img,.verso-print-root svg{max-width:100%;height:auto}.verso-print-root pre{white-space:pre-wrap;overflow-wrap:anywhere;font:9pt/1.5 monospace}.verso-print-root table{border-collapse:collapse;width:100%}.verso-print-root td,.verso-print-root th{border:1px solid #ccc;padding:5px}.verso-print-root figure,.verso-print-root pre,.verso-print-root blockquote,.verso-print-root tr{break-inside:avoid}.verso-print-root h1,.verso-print-root h2,.verso-print-root h3{break-after:avoid}.verso-print-root figure{margin:16px 0}.verso-print-root .math-display{position:relative;text-align:center;padding:12px 32px}.verso-print-root .equation-number{position:absolute;right:0;top:12px}.verso-print-root p{margin:10px 0}.verso-print-root .diagram-source{display:none}.verso-print-root a{color:inherit;overflow-wrap:anywhere}.verso-print-root .footnotes{font-size:9pt}.verso-print-root .gallery-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}}`;
  printRoot.innerHTML=`<h1>${escape(value.title)}</h1>${body}`;printRoot.prepend(style);document.body.append(printRoot);
  const cleanup=()=>{printRoot.remove();window.removeEventListener('afterprint',cleanup);};
  try{await Promise.all([...printRoot.querySelectorAll('img')].map(image=>Promise.race([image.decode().catch(()=>undefined),new Promise(resolve=>setTimeout(resolve,5000))])));await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(resolve));window.addEventListener('afterprint',cleanup,{once:true});window.print();}catch(error){cleanup();throw error;}
}
