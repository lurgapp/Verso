import { expect } from '@playwright/test';
import { test } from './fixtures';
import sharp from 'sharp';
const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000').origin;
const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });
const document = { type: 'doc', content: [
  { type: 'tableOfContents' },
  { type: 'heading', attrs: { level: 2, id: 'h-first' }, content: [text('Первая глава')] },
  { type: 'paragraph', content: [text('Текст формулы '), { type: 'mathInline', attrs: { latex: 'E=mc^2' } }, { type: 'footnote', attrs: { id: 'note-one', text: 'Пояснение к формуле.' } }] },
  { type: 'mathBlock', attrs: { latex: '\\int_0^1 x^2 dx=\\frac13', id: 'eq-integral', numbered: true } },
  { type: 'codeBlock', attrs: { language: 'typescript', filename: 'example.ts', lineNumbers: true, wrap: true }, content: [text('const answer: number = 42;\nconsole.log(answer);')] },
  { type: 'mermaid', attrs: { code: 'flowchart LR\n  A[Write] --> B[Publish]\n  B --> C[Share]' } },
  { type: 'heading', attrs: { level: 3, id: 'h-second' }, content: [text('Вторая глава')] },
  { type: 'callout', attrs: { kind: 'tip', title: 'Совет' }, content: [paragraph('Сохраните ссылку и ключ редактирования.')] },
  { type: 'toggle', attrs: { title: 'Подробности', open: false }, content: [paragraph('Этот текст раскрывается с клавиатуры.')] },
  { type: 'gallery', attrs: { layout: 'grid' }, content: [
    { type: 'image', attrs: { src: 'https://qa-images.test/first.jpg', alt: 'Первое изображение', caption: 'Подпись к первому изображению', width: 640, height: 480 } },
    { type: 'image', attrs: { src: 'https://qa-images.test/second.jpg', alt: 'Второе изображение', width: 640, height: 480 } },
  ] },
  paragraph('Конец статьи.'),
] };

test('advanced public article renders math, lazy highlighted code, secure diagrams, exports and accessible gallery', async ({ page, request, context }) => {
  expect(['127.0.0.1','localhost','[::1]']).toContain(new URL(origin).hostname);
  const response = await request.post('/api/v1/articles', { headers: { origin }, data: { title: 'Формулы, схемы и примеры', content: document, schemaVersion: 1 } });
  expect(response.status()).toBe(201);
  const publication = await response.json();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const still = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#8797ad' } }).jpeg().toBuffer();
  await page.route('https://qa-images.test/**', route => route.fulfill({ contentType: 'image/jpeg', body: still }));
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  try {
    const ssr = await request.get(`/a/${publication.article.id}`);
    const html = await ssr.text();
    expect(html).toContain('katex-mathml');
    expect(html).not.toContain('contenteditable="true"');
    await page.goto(`/a/${publication.article.id}`);
    await expect(page.locator('.article-prose .katex')).toHaveCount(2);
    const code = page.locator('.advanced-code');
    await code.scrollIntoViewIfNeeded();
    await expect(code.locator('.shiki')).toBeVisible({ timeout: 30000 });
    await expect(code).toHaveClass(/code-line-numbers/);
    await code.getByRole('button', { name: 'Copy code', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('const answer: number = 42;');
    const diagram = page.locator('.advanced-mermaid');
    await page.locator('.mermaid-block').scrollIntoViewIfNeeded();
    await expect(diagram.locator('.mermaid-scroll svg')).toBeVisible({ timeout: 30000 });
    await expect(diagram.locator('.advanced-block-error')).toHaveCount(0);
    expect(await diagram.locator('.mermaid-scroll svg').evaluate(svg => svg.querySelectorAll('script,foreignObject,a,image').length)).toBe(0);
    const svgDownload = page.waitForEvent('download');
    await diagram.getByRole('button', { name: 'SVG', exact: true }).click();
    expect((await svgDownload).suggestedFilename()).toBe('verso-diagram.svg');
    const pngDownload = page.waitForEvent('download');
    await diagram.getByRole('button', { name: 'PNG', exact: true }).click();
    expect((await pngDownload).suggestedFilename()).toBe('verso-diagram.png');
    await page.locator('summary', { hasText: 'Подробности' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Этот текст раскрывается с клавиатуры.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open image: Первое изображение', exact: true }).focus();
    await page.keyboard.press('Enter');
    const gallery = page.getByRole('dialog', { name: 'Image viewer', exact: true });
    await expect(gallery).toBeVisible();
    await expect(gallery.locator('img')).toHaveAttribute('alt','Первое изображение');
    await page.keyboard.press('ArrowRight');
    await expect(gallery.locator('img')).toHaveAttribute('alt','Второе изображение');
    await page.keyboard.press('Escape');
    await expect(gallery).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open image: Первое изображение', exact: true })).toBeFocused();
    await page.locator('#h-first').scrollIntoViewIfNeeded();
    await page.locator('#h-first .heading-anchor-copy').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/a/${publication.article.id}#h-first`);
    await expect(page.locator('.footnotes')).toContainText('Пояснение к формуле.');
    await test.info().attach('advanced-reader', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(errors).toEqual([]);
  } finally {
    const removed = await request.delete(`/api/v1/articles/${publication.article.id}`, { headers: { origin, authorization: `Bearer ${publication.editKey}` } });
    expect(removed.status()).toBe(204);
  }
});

test('malicious Mermaid directives stay inert and show a readable error', async ({ page, request }) => {
  const source = '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A["<img src=x onerror=alert(1)>"]';
  const response = await request.post('/api/v1/articles', { headers: { origin }, data: { title:'Diagram safety', schemaVersion:1, content:{type:'doc',content:[{type:'mermaid',attrs:{code:source}}]} } });
  // The canonical backend may reject dangerous configuration even before rendering.
  if (response.status() === 422) return;
  expect(response.status()).toBe(201); const publication=await response.json();
  let dialogs=0;page.on('dialog',dialog=>{dialogs++;void dialog.dismiss();});
  try {
    await page.goto(`/a/${publication.article.id}`);
    await expect(page.locator('.advanced-mermaid .advanced-block-error')).toBeVisible({timeout:30000});
    await expect(page.locator('.article-prose script,.article-prose iframe,.article-prose img')).toHaveCount(0);
    expect(dialogs).toBe(0);
  } finally { await request.delete(`/api/v1/articles/${publication.article.id}`,{headers:{origin,authorization:`Bearer ${publication.editKey}`}}); }
});
