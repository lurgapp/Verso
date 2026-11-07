import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test } from './fixtures';

async function openEditor(page:Page, body='Hello world. Привет, мир!') {
  await page.goto('/');
  await page.getByRole('textbox',{name:'Title',exact:true}).fill('Writing experience');
  const editor=page.getByRole('textbox',{name:'Tell your story',exact:true});
  await editor.fill(body);
  await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();
  return editor;
}
async function more(page:Page) {const summary=page.getByRole('button',{name:'More actions',exact:true});if(await summary.count())await summary.click();else await page.locator('.more-menu>summary').first().click();}

test('find replaces across formatting and all replacements undo together',async({page})=>{
  const editor=await openEditor(page,'hello hello WORLD');
  await editor.press('Control+h');
  const find=page.getByRole('region',{name:'Find and replace'});
  await expect(find).toBeVisible();
  await find.getByRole('textbox',{name:'Find',exact:true}).fill('hello');
  await expect(find.getByRole('status')).toHaveText('1/2');
  await expect(editor.locator('.search-match')).toHaveCount(2);
  await find.getByRole('textbox',{name:'Replace with',exact:true}).fill('goodbye');
  await find.getByRole('button',{name:'All',exact:true}).click();
  await expect(editor).toHaveText('goodbye goodbye WORLD');
  await find.getByRole('button',{name:'Close search'}).click();
  await editor.press('Control+z');
  await expect(editor).toHaveText('hello hello WORLD');
});

test('statistics, writing goals and preferences stay local and focus exits with Escape',async({page})=>{
  const editor=await openEditor(page);
  await page.getByRole('button',{name:'Text statistics'}).click();
  const statistics=page.getByRole('dialog',{name:'Text statistics'});
  await expect(statistics.getByRole('term').filter({hasText:/^Words$/})).toBeVisible();
  await statistics.getByRole('spinbutton',{name:'Writing target'}).fill('1000');
  await statistics.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.statistics-trigger')).toContainText('4 / 1,000 words');
  await more(page);await page.getByRole('button',{name:'Writing preferences',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Writing preferences'});
  await settings.getByRole('combobox',{name:'Font family'}).selectOption('serif');
  await settings.getByRole('combobox',{name:'Content width'}).selectOption('narrow');
  await settings.getByRole('checkbox',{name:'Dim other paragraphs'}).check();
  await settings.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.writing-surface')).toHaveAttribute('data-font','serif');
  await expect(page.locator('.writing-surface')).toHaveAttribute('data-content-width','narrow');
  await page.getByRole('button',{name:'Focus mode',exact:true}).click();
  await expect(page.locator('.editor-page')).toHaveAttribute('data-focus','true');
  await expect(page.getByRole('button',{name:'Exit focus · Esc'})).toBeVisible();
  await expect(page.locator('details.more-menu')).not.toHaveAttribute('open','');
  await editor.press('Control+f');
  const focusSearch=page.getByRole('region',{name:'Find and replace'});
  await expect(focusSearch).toBeVisible();
  await focusSearch.getByRole('textbox',{name:'Find',exact:true}).press('Escape');
  await expect(focusSearch).toHaveCount(0);
  await expect(page.locator('.editor-page')).toHaveAttribute('data-focus','true');
  await editor.press('Escape');
  await expect(page.locator('.editor-page')).toHaveAttribute('data-focus','false');
  await page.reload();
  await expect(page.locator('.writing-surface')).toHaveAttribute('data-font','serif');
  await expect(page.getByRole('textbox',{name:'Tell your story',exact:true})).toContainText('Привет, мир!');
});

test('history restores a snapshot after preserving the current draft and survives reload',async({page})=>{
  const editor=await openEditor(page,'Original safe text');
  await more(page);await page.getByRole('button',{name:'Draft history',exact:true}).click();
  const history=page.getByRole('dialog',{name:'Draft history'});
  await expect(history.locator('.snapshot-button')).not.toHaveCount(0);
  await history.getByRole('button',{name:'Close',exact:true}).click();
  await editor.fill('Changed current text');
  await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Draft history',exact:true}).click();
  await history.locator('.snapshot-button').last().click();
  await history.getByRole('button',{name:'Restore snapshot',exact:true}).click();
  await expect(editor).toHaveText('Original safe text');
  await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Tell your story',exact:true})).toHaveText('Original safe text');
});

test('HTML import sanitizes scripts, preserves current history and exports losslessly',async({page})=>{
  let publications=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/v1/articles'))publications++;});
  await openEditor(page,'Preserve this draft');await more(page);
  await page.locator('input[aria-label="Import document"]').setInputFiles({name:'Imported.html',mimeType:'text/html',buffer:Buffer.from('<title>Безопасная статья</title><h2>Тест</h2><p onclick="window.XSS=1">Сохранить <strong>жирный</strong></p><script>window.XSS=1</script><img src="javascript:alert(1)">')});
  await page.getByRole('dialog',{name:'Import document'}).getByRole('button',{name:'Import',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Tell your story',exact:true});await expect(editor.locator('strong')).toHaveText('жирный');
  expect(await page.evaluate(()=>Object.hasOwn(window,'XSS'))).toBe(false);await expect(editor.locator('script,[onclick],img[src^="javascript:"]')).toHaveCount(0);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export HTML',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/\.html$/);
  const path=await download.path();expect(path).toBeTruthy();
  await page.locator('input[aria-label="Import document"]').setInputFiles({name:download.suggestedFilename(),mimeType:'text/html',buffer:await readFile(path!)});
  await page.getByRole('dialog',{name:'Import document'}).getByRole('button',{name:'Import',exact:true}).click();
  await expect(editor.locator('strong')).toHaveText('жирный');expect(publications).toBe(0);
});

test('old IndexedDB version upgrades without losing drafts and editing keys',async({page})=>{
  await page.goto('/api/health');
  await page.evaluate(async()=>{
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('verso-private',1);request.onupgradeneeded=()=>{request.result.createObjectStore('drafts',{keyPath:'id'});request.result.createObjectStore('ownership',{keyPath:'articleId'});};request.onsuccess=()=>{const database=request.result;const tx=database.transaction(['drafts','ownership'],'readwrite');tx.objectStore('drafts').put({id:'new',title:'Legacy draft',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Never lose this original draft'}]}]},revision:1,updatedAt:new Date().toISOString(),writerId:'legacy'});tx.objectStore('ownership').put({articleId:'aB1234567890',editKey:'K'.repeat(43),createdAt:new Date().toISOString()});tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});
  });
  await page.goto('/');await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Legacy draft');
  await expect(page.getByRole('textbox',{name:'Tell your story',exact:true})).toHaveText('Never lose this original draft');
  const result=await page.evaluate(async()=>new Promise<{stores:string[];key:string}>((resolve,reject)=>{const request=indexedDB.open('verso-private');request.onsuccess=()=>{const database=request.result;const stores=Array.from(database.objectStoreNames);const tx=database.transaction('ownership');const key=tx.objectStore('ownership').get('aB1234567890');key.onsuccess=()=>{resolve({stores,key:key.result.editKey});database.close();};};request.onerror=()=>reject(request.error);}));
  expect(result.stores).toEqual(['drafts','ownership','snapshots']);expect(result.key).toBe('K'.repeat(43));
});

test('an already open editor keeps changes offline and skips corrupt historical snapshots',async({page,context})=>{
  const editor=await openEditor(page,'Initial online text');
  await context.setOffline(true);await editor.fill('Сохранено без соединения');
  await expect(page.getByText('Offline · saved on this device',{exact:true})).toBeVisible();
  await context.setOffline(false);await page.reload();
  await expect(page.getByRole('textbox',{name:'Tell your story',exact:true})).toHaveText('Сохранено без соединения');
  await page.evaluate(async()=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('verso-private');request.onsuccess=()=>{const database=request.result;const tx=database.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({id:'corrupt',draftId:'new',createdAt:null,title:'Broken',content:{type:'script'}});tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);}));
  await more(page);await page.getByRole('button',{name:'Draft history',exact:true}).click();
  const history=page.getByRole('dialog',{name:'Draft history'});await expect(history.getByText('Broken',{exact:true})).toHaveCount(0);
  await expect(history.locator('.snapshot-button')).not.toHaveCount(0);
});

test('published history is private, previews both versions and restores at the same URL',async({page,request})=>{
  const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3000').origin;
  expect(['127.0.0.1','localhost','[::1]']).toContain(new URL(origin).hostname);
  const document=(text:string)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
  const created=await request.post('/api/v1/articles',{headers:{origin},data:{title:'History original',content:document('Первая версия текста'),schemaVersion:1}});expect(created.status()).toBe(201);const publication=await created.json();
  const ownerHeaders={origin,authorization:`Bearer ${publication.editKey}`};
  try{
    const updated=await request.patch(`/api/v1/articles/${publication.article.id}`,{headers:ownerHeaders,data:{title:'History updated',content:document('Вторая версия текста'),schemaVersion:1,version:1}});expect(updated.status()).toBe(200);
    expect((await request.get(`/api/v1/articles/${publication.article.id}/history`)).status()).toBe(401);
    await page.goto('/api/health');
    await page.evaluate(async(value)=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('verso-private',2);request.onupgradeneeded=()=>{for(const [name,key] of [['drafts','id'],['ownership','articleId'],['snapshots','id']]){if(!request.result.objectStoreNames.contains(name)){const store=request.result.createObjectStore(name,{keyPath:key});if(name==='snapshots')store.createIndex('draftId','draftId');}}};request.onsuccess=()=>{const database=request.result;const tx=database.transaction('ownership','readwrite');tx.objectStore('ownership').put({articleId:value.id,editKey:value.key,createdAt:new Date().toISOString()});tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);}),{id:publication.article.id,key:publication.editKey});
    await page.goto(`/a/${publication.article.id}`);await expect(page.getByRole('link',{name:'Edit',exact:true})).toBeVisible();
    await more(page);await page.getByRole('button',{name:'Publication history',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Publication history'});await dialog.locator('.snapshot-button').filter({hasText:'History original'}).click();
    await expect(dialog.locator('.history-preview')).toContainText('Первая версия текста');await dialog.getByRole('button',{name:'Compare with current version',exact:true}).click();
    await expect(dialog.locator('.history-comparison')).toContainText('Вторая версия текста');
    const restored=page.waitForResponse(response=>response.url().endsWith('/history/1/restore')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();expect((await restored).status()).toBe(200);
    await expect(page).toHaveURL(`${origin}/a/${publication.article.id}`);await expect(page.getByRole('heading',{name:'History original',exact:true})).toBeVisible();
    const current=await(await request.get(`/api/v1/articles/${publication.article.id}`)).json();expect(current.article.version).toBe(3);expect(current.article.content).toEqual(document('Первая версия текста'));
  }finally{expect((await request.delete(`/api/v1/articles/${publication.article.id}`,{headers:ownerHeaders})).status()).toBe(204);}
});

test('advanced HTML and PDF exports retain Cyrillic, formulas, diagrams, tables and footnotes',async({page})=>{
  test.setTimeout(90_000);
  await openEditor(page,'Preserved original');await more(page);
  const exportedDocument={title:'Кириллица в экспорте',content:{type:'doc',content:[
    {type:'heading',attrs:{level:2,id:'h-export-check'},content:[{type:'text',text:'Проверка формулы'}]},
    {type:'paragraph',content:[{type:'text',text:'Сохранить формулу '},{type:'mathInline',attrs:{latex:'E=mc^2'}},{type:'footnote',attrs:{id:'note-export',text:'Сноска сохранена'}}]},
    {type:'mathBlock',attrs:{latex:'x^2+y^2=z^2',id:'eq-export-check',numbered:true}},
    {type:'mermaid',attrs:{code:'flowchart LR\n A[Write] --> B[Publish]'}},
    {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',content:[{type:'paragraph',content:[{type:'text',text:'Колонка'}]}]},{type:'tableHeader',content:[{type:'paragraph',content:[{type:'text',text:'Значение'}]}]}]},{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'Тест'}]}]},{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'42'}]}]}]}]},
    {type:'codeBlock',attrs:{language:'javascript',filename:'example.js'},content:[{type:'text',text:'const value = 42;'}]},
  ]}};
  const encoded=Buffer.from(JSON.stringify(exportedDocument)).toString('base64');
  await page.locator('input[aria-label="Import document"]').setInputFiles({name:'rich.md',mimeType:'text/markdown',buffer:Buffer.from(`<!-- verso-document:v2:${encoded} -->`)});
  await page.getByRole('dialog',{name:'Import document'}).getByRole('button',{name:'Import',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue(exportedDocument.title);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export HTML',exact:true}).click();const download=await downloadPromise;const path=await download.path();const html=await readFile(path!,'utf8');
  expect(html).toContain('<math');expect(html).toContain('<svg');expect(html).toContain('Сноска сохранена');expect(html).toContain('Колонка');expect(html).not.toContain('<script');expect(html).not.toContain('foreignObject');
  await page.evaluate(()=>{window.print=()=>{document.body.dataset.printInvoked='true';};});
  await page.getByRole('button',{name:'Export PDF / print',exact:true}).click();await expect(page.locator('body')).toHaveAttribute('data-print-invoked','true');
  const print=page.locator('.verso-print-root');await expect(print.locator('math')).toHaveCount(2);await expect(print.locator('svg')).toHaveCount(1);
  const pdf=await page.pdf({format:'A4',printBackground:true});expect(pdf.subarray(0,5).toString()).toBe('%PDF-');
  const {writeFile}=await import('node:fs/promises');const pdfPath=test.info().outputPath('verso-cyrillic-export.pdf');await writeFile(pdfPath,pdf);
  const {execFileSync}=await import('node:child_process');const pdfText=execFileSync('pdftotext',[pdfPath,'-'],{encoding:'utf8'});expect(pdfText).toContain('Кириллица в экспорте');expect(pdfText).toContain('Проверка формулы');expect(pdfText).toContain('Сноска сохранена');expect(pdfText).toContain('Колонка');expect(pdfText).toContain('const value = 42;');
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('.verso-print-root')).toHaveCount(0);
});

test('shortcut help uses shared labels and editor handlers match Ctrl and Command',async({page})=>{
  const editor=await openEditor(page,'Find the shared shortcut.');
  await page.getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();
  const help=page.getByRole('dialog',{name:'Keyboard shortcuts',exact:true});
  await expect(help.locator('[data-shortcut]')).toHaveCount(11);
  await expect(help.locator('[data-shortcut="find"]')).toContainText('Find');
  await expect(help.locator('[data-shortcut="replace"]')).toContainText('Replace');
  await expect(help.locator('[data-shortcut="publish"]')).toContainText('Publish or update');
  await help.getByRole('button',{name:'Close',exact:true}).click();
  await editor.press('Control+f');const find=page.getByRole('region',{name:'Find and replace'});await expect(find).toBeVisible();
  await expect(find.getByRole('textbox',{name:'Replace with',exact:true})).toHaveCount(0);
  await find.getByRole('textbox',{name:'Find',exact:true}).press('Control+h');await expect(find.getByRole('textbox',{name:'Replace with',exact:true})).toBeVisible();
  await find.getByRole('textbox',{name:'Find',exact:true}).press('Escape');await expect(find).toHaveCount(0);
  await editor.press('Meta+f');await expect(find).toBeVisible();await find.getByRole('button',{name:'Close search'}).click();
});
