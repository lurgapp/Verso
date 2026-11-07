import { expect, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { Editor } from '@tiptap/core';
import { test } from './fixtures';

async function open(page: Page, content?: unknown[]) {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Tell your story', exact: true });
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  if (content) {
    await page.getByLabel('Import draft file', { exact: true }).setInputFiles({ name: 'editor-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'verso-draft', version: 1, title: 'Editor V2 verification', content: { type: 'doc', content } })) });
    await expect(page.getByText('Draft imported', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Editor V2 verification');
  }
  return editor;
}
const paragraph = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
async function select(locator: Locator) {
  await locator.click();
  await locator.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
}
async function paste(editor: Locator, text: string, html = '') {
  await editor.evaluate((element, value) => { const data = new DataTransfer(); data.setData('text/plain', value.text); if (value.html) data.setData('text/html', value.html); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, { text, html });
}
async function command(page: Page, editor: Locator, name: string) {
  await editor.press('Control+End'); await editor.press('Enter'); await page.keyboard.insertText(`/${name}`);
  await expect(page.getByRole('listbox', { name: 'Block commands' })).toBeVisible();
  await page.keyboard.press('Enter');
}

test('slash and gutter share headings and commands; Escape preserves ordinary text', async ({ page }) => {
  const editor = await open(page); await editor.fill('/h6');
  const slash = page.getByRole('listbox', { name: 'Block commands' }); await expect(slash.getByRole('option')).toHaveCount(1);
  await editor.press('Enter'); await page.keyboard.insertText('Deep heading'); await expect(editor.locator('h6')).toHaveText('Deep heading');
  await editor.press('Enter'); await page.keyboard.insertText('/таблица'); await expect(slash.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Escape'); await expect(slash).not.toBeVisible(); await expect(editor).toContainText('/таблица');
  await editor.press('Control+a'); await editor.press('Backspace');
  await page.getByRole('button', { name: 'Insert block', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Insert blocks', exact: true });
  for (let level = 1; level <= 6; level++) await expect(menu.getByRole('menuitem', { name: `Heading ${level}`, exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Heading 3', exact: true }).click(); await page.keyboard.insertText('Shared heading');
  await expect(editor.locator('h3')).toHaveText('Shared heading'); await expect(editor.locator('h3')).toHaveAttribute('id', /^h-/);
});

test('selection toolbar preserves selection for underline, highlight and bounded colors', async ({ page }) => {
  const editor = await open(page); await editor.fill('Formatting survives reload');
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
  await select(editor.locator('p')); await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Underline', exact: true }).click();
  await toolbar.getByLabel('Highlight', { exact: true }).click(); await toolbar.getByRole('button', { name: 'Highlight green', exact: true }).click();
  await toolbar.getByLabel('More formatting', { exact: true }).click(); await toolbar.getByRole('button', { name: 'Text color blue', exact: true }).click();
  await expect(editor.locator('u')).toHaveText('Formatting survives reload'); await expect(editor.locator('mark')).toHaveAttribute('data-highlight', 'green');
  await expect(editor.locator('span[data-color=blue]')).toHaveText('Formatting survives reload');
  await editor.press('ArrowRight'); await expect(toolbar).not.toBeVisible(); await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator('.editor-content mark[data-highlight=green]')).toHaveText('Formatting survives reload');
});

test('smart paste keeps document structure, strips dangerous HTML and accepts spreadsheet TSV', async ({ page }) => {
  const editor = await open(page); await editor.click();
  await paste(editor, 'Heading\nSafe bold text', '<h2>Heading</h2><p onclick="window.XSS=1">Safe <span style="font-weight:700;font-style:italic">bold</span> text</p><script>window.XSS=1</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">invalid</a>');
  await expect(editor.locator('h2')).toHaveText('Heading'); await expect(editor.locator('strong em')).toHaveText('bold');
  await expect(editor.locator('script,iframe,[onclick],a[href^="javascript:"]')).toHaveCount(0); expect(await page.evaluate(() => Object.hasOwn(window, 'XSS'))).toBe(false);
  await editor.press('Control+End'); await editor.press('Enter'); await paste(editor, 'Name\tValue\nBeta\t20\nAlpha\t10');
  await expect(editor.locator('table tr')).toHaveCount(3); await expect(editor.locator('table tr').nth(1)).toHaveText('Beta20');
  await editor.locator('td').first().click(); await page.getByRole('button', { name: 'Table', exact: true }).click(); await page.getByRole('button', { name: 'Sort ascending', exact: true }).click();
  await expect(editor.locator('table tr').nth(1)).toHaveText('Alpha10'); await editor.press('Control+z'); await expect(editor.locator('table tr').nth(1)).toHaveText('Beta20');
});

test('plain paste and URL choices retain the requested representation', async ({ page }) => {
  const editor = await open(page); await editor.click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob(['**literal**'], { type: 'text/plain' }),
    'text/html': new Blob(['<strong>literal</strong>'], { type: 'text/html' }),
  })]));
  await editor.press('Control+Shift+v');
  await expect(editor).toHaveText('**literal**'); await expect(editor.locator('strong')).toHaveCount(0);
  await editor.press('End'); await editor.press('Enter'); await paste(editor, 'https://example.com/story');
  const dialog = page.getByRole('dialog', { name: 'Paste URL', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Plain text', exact: true }).click();
  await expect(editor.locator('p').last()).toHaveText('https://example.com/story'); await expect(editor.locator('a')).toHaveCount(0);
  await editor.press('End'); await editor.press('Enter'); await paste(editor, 'https://example.com/link'); await dialog.getByRole('button', { name: 'Text link', exact: true }).click();
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/link');
  await page.route('**/api/v1/link-preview', route => route.fulfill({ json: { preview: { url: 'https://example.com/card', title: 'Preview title', description: 'Preview description' } } }));
  await editor.press('End'); await editor.press('Enter'); await paste(editor, 'https://example.com/card'); await dialog.getByRole('button', { name: 'Preview card', exact: true }).click();
  await expect(editor.locator('.v2-link-preview')).toContainText('Preview title');
});

test('CSV import supports quoted fields; table actions and column resize preserve structure', async ({ page }) => {
  const editor = await open(page); await editor.fill('/csv'); await expect(page.getByRole('listbox', { name: 'Block commands', exact: true })).toBeVisible(); await editor.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Import CSV', exact: true }); await dialog.getByRole('textbox', { name: 'CSV data' }).fill('Name,Note\nBeta,"hello, world"\nAlpha,"line 1\nline 2"'); await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(editor.locator('tr')).toHaveCount(3); await expect(editor.locator('tr').nth(1).locator('td').nth(1)).toHaveText('hello, world');
  await editor.locator('td').first().click(); const tableMenu = page.getByRole('button', { name: 'Table', exact: true }); await tableMenu.click(); await page.getByRole('button', { name: 'Add row', exact: true }).click(); await expect(editor.locator('tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add column', exact: true }).click(); await expect(editor.locator('tr').first().locator('th,td')).toHaveCount(3);
  const first = editor.locator('th').first(); const rect = (await first.boundingBox())!; await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width + 45, rect.y + rect.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(editor.locator('colgroup col').first()).toHaveAttribute('style', /width:/);
});

test('footnotes renumber after editing and deletion; TOC follows heading edits', async ({ page }) => {
  const editor = await open(page, [{ type: 'heading', attrs: { level: 2, id: 'h-start' }, content: [{ type: 'text', text: 'Section start' }] }, { type: 'tableOfContents' }, { type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'footnote', attrs: { id: 'fn-first', text: 'First explanation' } }, { type: 'text', text: ' Second' }, { type: 'footnote', attrs: { id: 'fn-second', text: 'Second explanation' } }] }]);
  await expect(editor.locator('.v2-footnote>button')).toHaveText(['[1]', '[2]']); await editor.locator('.v2-footnote>button').first().click(); await editor.getByRole('textbox', { name: 'Footnote text' }).fill('Changed explanation'); await expect(editor.locator('.v2-footnote>button')).toHaveText(['[1]', '[2]']);
  await editor.getByRole('button', { name: 'Delete', exact: true }).click(); await expect(editor.locator('.v2-footnote>button')).toHaveText(['[1]']);
  await editor.locator('h2').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' updated'); await expect(editor.locator('.v2-toc a')).toHaveText('Section start updated');
});

test('keyboard block moves keep the nested block intact and undo independently', async ({ page }) => {
  const editor = await open(page, [paragraph('Before'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Nested list')] }] }, paragraph('After')]);
  await editor.locator('li p').click();
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.selection.$from.parent.textContent)).toBe('Nested list');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  const topLevelTags = () => editor.evaluate(element => [...element.children].slice(0, 3).map(child => child.tagName));
  await expect.poll(topLevelTags).toEqual(['P', 'P', 'UL']);
  expect((await editor.locator(':scope>p').allTextContents()).filter(Boolean)).toEqual(['Before','After']);
  await expect(editor.locator(':scope>ul').last()).toHaveText('Nested list'); await page.keyboard.press('Control+z');
  await expect.poll(topLevelTags).toEqual(['P', 'UL', 'P']);
});

test('image editing retains caption, alt, alignment and responsive intrinsic metadata', async ({ page }) => {
  const editor = await open(page); await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true }); const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#858585' } }).png().toBuffer();
  await dialog.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'responsive.png', mimeType: 'image/png', buffer: png }); await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled(); await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(editor.locator('img')).toBeVisible(); await editor.locator('img').click(); await editor.getByRole('textbox', { name: 'Image caption' }).fill('A useful caption'); await editor.getByRole('textbox', { name: 'Image caption' }).press('Tab');
  await editor.getByRole('textbox', { name: 'Image alternative text' }).fill('Accessible description'); await editor.getByRole('textbox', { name: 'Image alternative text' }).press('Tab'); await editor.getByRole('combobox', { name: 'Image alignment' }).selectOption('left');
  await expect(editor.locator('figcaption')).toHaveText('A useful caption'); await expect(editor.locator('img')).toHaveAttribute('alt', 'Accessible description');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible(); const attrs = await page.evaluate(async () => new Promise<Record<string, unknown>>((resolve, reject) => { const request = indexedDB.open('verso-private'); request.onsuccess = () => { const db = request.result; const get = db.transaction('drafts').objectStore('drafts').get('new'); get.onsuccess = () => { const node = get.result.content.content.find((node: { type: string }) => node.type === 'image'); resolve(node.attrs); db.close(); }; get.onerror = () => reject(get.error); }; request.onerror = () => reject(request.error); }));
  expect(attrs.sourceWidth).toBe(1200); expect(attrs.thumbnailWidth).toBe(480); expect(attrs.thumbnailSrc).toMatch(/^\/api\/v1\/media\//); expect(attrs.align).toBe('left');
});

test('code edits get live syntax colors, filename, wrapping and a readable preview', async ({ page }) => {
  const editor = await open(page, [{ type: 'codeBlock', attrs: { language: 'plaintext' }, content: [{ type: 'text', text: '{"message":"Привет","count":2}' }] }]);
  await editor.getByRole('button', { name: 'Detect language', exact: true }).click(); await expect(editor.getByRole('combobox', { name: 'Code language' })).toHaveValue('json');
  await expect(editor.locator('.code-editable-content span[style*=color]').first()).toBeVisible({ timeout: 30000 });
  await editor.locator('.code-editable-content').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' ');
  await editor.getByRole('textbox', { name: 'Code filename' }).fill('example.json'); await editor.getByRole('checkbox', { name: 'Wrap', exact: true }).check(); await editor.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(editor.locator('.advanced-code')).toContainText('example.json'); await expect(editor.locator('.advanced-code')).toContainText('Привет');
});

test('formula numbering, safe diagram rendering, callouts and collapsible content work in the editor', async ({ page }) => {
  test.setTimeout(90000);
  const editor = await open(page); await editor.fill('/math'); await expect(page.getByRole('listbox', { name: 'Block commands' })).toBeVisible(); await editor.press('Enter');
  const formula = page.getByRole('dialog', { name: 'LaTeX formula', exact: true }); await formula.getByRole('textbox', { name: 'LaTeX source' }).fill('x^2 + y^2 = z^2'); await formula.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(editor.locator('.katex')).toBeVisible(); await editor.getByRole('button', { name: 'Edit formula', exact: true }).click(); await editor.getByRole('checkbox', { name: 'Number equation', exact: true }).check(); await expect(editor.locator('.math-number')).toHaveText('(1)'); await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await command(page, editor, 'mermaid'); const diagram = page.getByRole('dialog', { name: 'Mermaid diagram', exact: true }); await diagram.getByRole('textbox', { name: 'Mermaid source' }).fill('flowchart LR\n A[Write] --> B[Publish]'); await expect(diagram.locator('.mermaid-scroll svg')).toBeVisible({ timeout: 45000 }); await diagram.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(editor.locator('.v2-mermaid-node .mermaid-scroll svg')).toBeVisible(); await command(page, editor, 'callout'); await editor.getByRole('combobox', { name: 'Callout type' }).selectOption('warning'); await editor.getByRole('textbox', { name: 'Callout title' }).fill('Remember'); await editor.locator('.v2-callout-content p').click(); await page.keyboard.insertText('Important technical detail.');
  await expect(editor.locator('.v2-callout')).toHaveAttribute('data-kind', 'warning'); await command(page, editor, 'toggle'); await editor.getByRole('textbox', { name: 'Details title' }).fill('Optional explanation'); await editor.locator('.v2-toggle-content p').click(); await page.keyboard.insertText('Nested detail');
  const toggle = editor.getByRole('button', { name: 'Toggle details', exact: true }); await toggle.click(); await expect(editor.locator('.v2-toggle-content')).not.toBeVisible(); await toggle.press('Enter'); await expect(editor.locator('.v2-toggle-content')).toContainText('Nested detail');
});

test('dragging blocks shows a drop target; mobile buttons offer a touch alternative', async ({ page }) => {
  const editor = await open(page, [paragraph('First block'), paragraph('Second block'), paragraph('Third block')]);
  await editor.locator('p').first().hover(); const handle = page.getByRole('button', { name: 'Drag block', exact: true }); await expect(handle).toBeVisible();
  const third = editor.locator('p').filter({ hasText: /^Third block$/ }); const rect = (await third.boundingBox())!; await handle.dragTo(third, { targetPosition: { x: 20, y: rect.height - 2 } });
  await expect(editor.locator(':scope>p').filter({ hasText: /block/ })).toHaveText(['Second block', 'Third block', 'First block']); await editor.press('Control+z'); await expect(editor.locator(':scope>p').filter({ hasText: /block/ })).toHaveText(['First block', 'Second block', 'Third block']);
  await page.setViewportSize({ width: 390, height: 844 }); const first = editor.locator('p').first(); await first.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 250 }); await expect(page.getByRole('button', { name: 'Move block down', exact: true })).toBeVisible(); await first.dispatchEvent('pointerup', { pointerType: 'touch' });
  await page.getByRole('button', { name: 'Move block down', exact: true }).click(); await expect(editor.locator(':scope>p').filter({ hasText: /block/ })).toHaveText(['Second block', 'First block', 'Third block']); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('galleries preserve layout and footnotes export to conventional Markdown', async ({ page }) => {
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#858585' } }).png().toBuffer(); await page.route('https://media.example.test/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  const editor = await open(page); await editor.fill('/gallery'); await expect(page.getByRole('listbox', { name: 'Block commands' })).toBeVisible(); await editor.press('Enter');
  const gallery = page.getByRole('dialog', { name: 'Image gallery', exact: true }); await gallery.getByRole('textbox', { name: 'Block source' }).fill('https://media.example.test/a.png\nhttps://media.example.test/b.png'); await gallery.getByRole('combobox', { name: 'Layout' }).selectOption('horizontal'); await gallery.getByRole('button', { name: 'Insert', exact: true }).click(); await expect(editor.locator('.v2-gallery')).toHaveAttribute('data-layout', 'horizontal'); await expect(editor.locator('.v2-gallery img')).toHaveCount(2);
  await page.locator('input[aria-label="Import Markdown file"]').setInputFiles({ name: 'footnotes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Footnote article\n\nReference[^a].\n\n[^a]: Conventional Markdown explanation.') }); await page.getByRole('dialog', { name: 'Replace draft?', exact: true }).getByRole('button', { name: 'Replace', exact: true }).click(); await expect(editor.locator('.v2-footnote>button')).toHaveText('[1]');
  await page.locator('.more-menu>summary').click(); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export Markdown', exact: true }).click(); const download = await downloadPromise; const path = await download.path(); const text = await import('node:fs/promises').then(fs => fs.readFile(path!, 'utf8')); expect(text).toContain('[^fn-a]'); expect(text).toContain('[^fn-a]: Conventional Markdown explanation.');
});

test('table cell selection merges and splits without discarding text', async ({ page }) => {
  const editor = await open(page); await editor.fill('/table'); await expect(page.getByRole('listbox', { name: 'Block commands' })).toBeVisible(); await editor.press('Enter');
  const cells = editor.locator('tr').first().locator('th'); await cells.nth(0).click(); await page.keyboard.insertText('One'); await cells.nth(1).click(); await page.keyboard.insertText('Two');
  const first = (await cells.nth(0).boundingBox())!; const second = (await cells.nth(1).boundingBox())!; await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down(); await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(editor.locator('.selectedCell')).toHaveCount(2); await page.getByRole('button', { name: 'Table', exact: true }).click(); await page.getByRole('button', { name: 'Merge cells', exact: true }).click();
  await expect(editor.locator('th[colspan="2"]')).toContainText('One'); await expect(editor.locator('th[colspan="2"]')).toContainText('Two'); await page.getByRole('button', { name: 'Split cell', exact: true }).click(); await expect(editor.locator('tr').first().locator('th')).toHaveCount(3); await expect(editor.locator('th[colspan="2"]')).toHaveCount(0);
});

test('cancelling an in-flight image upload preserves the draft and permits retry', async ({ page }) => {
  const editor = await open(page); await editor.fill('Keep my text'); await editor.press('End'); await editor.press('Enter');
  let pending: import('@playwright/test').Route | undefined; await page.route('**/api/v1/media', route => { pending = route; });
  await page.getByRole('button', { name: 'Insert image', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true }); const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#999' } }).png().toBuffer(); await dialog.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'cancel-me.png', mimeType: 'image/png', buffer: png }); await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled(); await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel upload', exact: true })).toBeVisible(); await dialog.getByRole('button', { name: 'Cancel upload', exact: true }).click(); await pending?.abort().catch(() => undefined); await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(editor).toContainText('Keep my text'); await expect(editor.locator('img')).toHaveCount(0);
});


test('adversarial clipboard table spans and deep HTML stay bounded and preserve readable text', async ({ page }) => {
  const editor = await open(page); await editor.click(); const start = Date.now();
  await paste(editor,'A B','<table><tr><td colspan="1000000000">A</td><td rowspan="200">B</td></tr></table>');
  await expect(editor).toContainText('AB'); await expect(editor.locator('table')).toHaveCount(0);
  await editor.press('End'); await paste(editor,'Deep text','<div>'.repeat(1000)+'Deep text'+'</div>'.repeat(1000));
  expect(Date.now()-start).toBeLessThan(5000); await editor.press('Control+End'); await page.keyboard.insertText('Still editable'); await expect(editor).toContainText('Still editable');
});


test('copying the whole table retains spreadsheet tabs and line breaks', async ({page}) => {
  const editor=await open(page);await page.context().grantPermissions(['clipboard-read','clipboard-write']);await editor.click();await paste(editor,'Name\tValue\nAlpha\t10');
  const first=(await editor.locator('th').first().boundingBox())!;const last=(await editor.locator('td').last().boundingBox())!;await page.mouse.move(first.x+10,first.y+first.height/2);await page.mouse.down();await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:8});await page.mouse.up();await expect(editor.locator('.selectedCell')).toHaveCount(4);
  await page.getByRole('button',{name:'Table',exact:true}).click();await page.getByRole('button',{name:'Copy cells',exact:true}).click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('Name\tValue\nAlpha\t10');
});
