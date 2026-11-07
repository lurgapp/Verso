import { test } from './fixtures';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

type PublishedArticle = { id: string; version: number; title: string; content: object };
type Publication = { article: PublishedArticle; editKey: string; url: string };
const ownedArticles: Array<{ id: string; editKey: string }> = [];
const doc = (value: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
});
const uniqueTitle = (purpose: string) => `E2E ${purpose} ${Date.now()}`;

async function createArticle(request: APIRequestContext, purpose: string): Promise<Publication> {
  const response = await request.post('/api/v1/articles', {
    data: { title: uniqueTitle(purpose), content: doc('A real persisted article.'), schemaVersion: 1 },
  });
  expect(response.status()).toBe(201);
  const publication = await response.json() as Publication;
  ownedArticles.push({ id: publication.article.id, editKey: publication.editKey });
  return publication;
}

async function writeArticle(page: Page, title: string, body: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  const editor = page.getByRole('textbox', { name: 'Tell your story', exact: true });
  await editor.fill(body);
  return editor;
}

async function publish(page: Page): Promise<Publication> {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/v1/articles' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const publication = await response.json() as Publication;
  ownedArticles.push({ id: publication.article.id, editKey: publication.editKey });
  await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}$`));
  return publication;
}

test.afterEach(async ({ request }) => {
  for (const article of ownedArticles.splice(0)) {
    const response = await request.delete(`/api/v1/articles/${article.id}`, {
      headers: { Authorization: `Bearer ${article.editKey}` },
    });
    expect([200, 204, 404]).toContain(response.status());
  }
});

test('API stores a public article and keeps the owner key private', async ({ request }) => {
  const publication = await createArticle(request, 'create');
  expect(publication.article.id).toMatch(/^[A-Za-z0-9]{12}$/);
  expect(publication.editKey.length).toBeGreaterThanOrEqual(32);
  expect(publication.editKey).not.toBe(publication.article.id);
  expect(new URL(publication.url).pathname).toBe(`/a/${publication.article.id}`);
  expect(new URL(publication.url).search).toBe('');
  const response = await request.get(`/api/v1/articles/${publication.article.id}`);
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.article.title).toBe(publication.article.title);
  expect(payload.article.content).toEqual(publication.article.content);
  expect(JSON.stringify(payload)).not.toContain(publication.editKey);
  expect(payload.article).not.toHaveProperty('editKeyHash');
});

test('API refuses unauthorized editing and detects a stale version', async ({ request }) => {
  const { article, editKey } = await createArticle(request, 'ownership');
  const changes = { title: 'Updated by its owner', content: doc('A verified update.'), schemaVersion: 1, version: article.version };
  for (const headers of [{}, { Authorization: 'Bearer an-incorrect-owner-secret' }] as Array<Record<string, string>>) {
    const denied = await request.patch(`/api/v1/articles/${article.id}`, { data: changes, headers });
    expect(denied.status()).toBe(401);
  }
  const headers = { Authorization: `Bearer ${editKey}` };
  const updated = await request.patch(`/api/v1/articles/${article.id}`, { data: changes, headers });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).article.id).toBe(article.id);
  const conflict = await request.patch(`/api/v1/articles/${article.id}`, { data: changes, headers });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error.code).toBe('VERSION_CONFLICT');
  const unchanged = await request.get(`/api/v1/articles/${article.id}`);
  expect((await unchanged.json()).article.title).toBe(changes.title);
});

test('invalid documents and executable uploads are rejected', async ({ request }) => {
  const invalid = await request.post('/api/v1/articles', {
    data: { title: 'Invalid content', schemaVersion: 1, content: { type: 'doc', content: [{ type: 'script', attrs: { src: 'javascript:alert(1)' } }] } },
  });
  expect(invalid.status()).toBe(400);
  const upload = await request.post('/api/v1/media', {
    multipart: { file: { name: 'disguised.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert("xss")</script>') } },
  });
  expect([400, 415]).toContain(upload.status());
});

test('publishing opens reading mode; the author updates the same URL', async ({ page }) => {
  const title = uniqueTitle('publish');
  await writeArticle(page, title, 'Write. Publish. Share.');
  const publication = await publish(page);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Tell your story', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  const changedTitle = `${title} updated`;
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(changedTitle);
  await page.getByRole('textbox', { name: 'Tell your story', exact: true }).fill('This is the revised article.');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}$`));
  await expect(page.getByRole('heading', { name: changedTitle, exact: true })).toBeVisible();
  const guest = await page.context().browser()!.newContext({ locale: 'en-US' });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(publication.url);
    await expect(guestPage.getByRole('heading', { name: changedTitle, exact: true })).toBeVisible();
    await expect(guestPage.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  } finally { await guest.close(); }
});

test('IndexedDB restores a draft after a reload and while offline', async ({ page, context }) => {
  const title = uniqueTitle('draft');
  await writeArticle(page, title, 'A draft that must survive reload.');
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).length)).toBeGreaterThan(0);
  await page.waitForTimeout(1200); // Allow the editor's debounced persistence to complete.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
  await expect(page.getByRole('textbox', { name: 'Tell your story', exact: true })).toContainText('A draft that must survive reload.');
  await context.setOffline(true);
  await page.getByRole('textbox', { name: 'Tell your story', exact: true }).fill('Saved locally without a connection.');
  await page.waitForTimeout(1200);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Tell your story', exact: true })).toContainText('Saved locally without a connection.');
});

test('Markdown shortcuts, bold and undo/redo survive publication', async ({ page }) => {
  const title = uniqueTitle('markdown');
  const editor = await writeArticle(page, title, '');
  await editor.pressSequentially('## Section');
  await expect(editor.locator('h2')).toHaveText('Section');
  await editor.press('Enter');
  await editor.press('Control+b');
  await editor.pressSequentially('Bold sentence');
  await editor.press('Control+b');
  await expect(editor.locator('strong')).toHaveText('Bold sentence');
  await editor.press('Control+z');
  await editor.press('Control+Shift+z');
  await expect(editor.locator('strong')).toHaveText('Bold sentence');
  await publish(page);
  await expect(page.getByRole('heading', { name: 'Section', exact: true })).toBeVisible();
  await expect(page.locator('main strong')).toHaveText('Bold sentence');
});

test('concurrent draft tabs preserve both versions and show a conflict', async ({ page, context }) => {
  const original = uniqueTitle('two tabs');
  await writeArticle(page, original, 'The original draft.');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(original);
  const firstTitle = `${original} A`;
  const secondTitle = `${original} B`;
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(firstTitle);
  await other.getByRole('textbox', { name: 'Title', exact: true }).fill(secondTitle);
  await expect.poll(async () =>
    await page.getByRole('alert').filter({ hasText: 'Another tab changed this draft' }).count() +
    await other.getByRole('alert').filter({ hasText: 'Another tab changed this draft' }).count()).toBeGreaterThan(0);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(firstTitle);
  await expect(other.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(secondTitle);
});

test('system theme and manual language preferences persist without changing article text', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await writeArticle(page, 'An untranslated title', 'An untranslated story.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Language', { exact: true }).selectOption('ru');
  await expect(page.getByRole('button', { name: 'Опубликовать', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('An untranslated title');
  await expect(page.getByRole('textbox', { name: 'Tell your story', exact: true })).toContainText('An untranslated story.');
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Опубликовать', exact: true })).toBeVisible();
});

test('exported owner keys can restore editing access in a fresh browser context', async ({ page }) => {
  await writeArticle(page, uniqueTitle('key export'), 'A publication with portable ownership.');
  const publication = await publish(page);
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible();
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Editing keys', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export editing keys', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const keyFile = await readFile(path!);
  const parsed = JSON.parse(keyFile.toString());
  expect(parsed.format).toBe('verso-editing-keys');
  expect(parsed.keys).toHaveLength(1);
  expect(parsed.keys[0].articleId).toBe(publication.article.id);
  const guest = await page.context().browser()!.newContext({ locale: 'en-US' });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(publication.url);
    await expect(guestPage.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
    await guestPage.locator('summary[aria-label="More actions"]').click();
    await guestPage.getByRole('button', { name: 'Editing keys', exact: true }).click();
    await guestPage.getByLabel('Import editing keys', { exact: true }).setInputFiles({ name: 'verso-editing-keys.json', mimeType: 'application/json', buffer: keyFile });
    await expect(guestPage.getByRole('link', { name: 'Edit', exact: true })).toBeVisible();
    await guestPage.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(guestPage.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  } finally { await guest.close(); }
});

test('tables can grow and are rendered in the published article', async ({ page }) => {
  const title = uniqueTitle('table');
  const editor = await writeArticle(page, title, 'Table introduction.');
  await editor.press('End');
  await editor.press('Enter');
  await page.getByRole('button', { name: 'Insert block', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert 3 × 3 table', exact: true }).click();
  await expect(editor.locator('table')).toHaveCount(1);
  await editor.locator('th,td').first().click();
  await page.keyboard.insertText('First cell');
  const actions = page.locator('.v2-table-context');
  await actions.getByRole('button', { name: 'Table', exact: true }).click();
  await actions.getByRole('button', { name: 'Add row', exact: true }).click();
  await expect(editor.locator('tr')).toHaveCount(4);
  await actions.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(editor.locator('tr').first().locator('th,td')).toHaveCount(4);
  await publish(page);
  await expect(page.locator('main table')).toHaveCount(1);
  await expect(page.locator('main table')).toContainText('First cell');
});

test('a real image upload is re-encoded and visible in the article', async ({ page, request }) => {
  const title = uniqueTitle('image');
  const editor = await writeArticle(page, title, 'An image from the author.');
  await editor.press('End');
  await editor.press('Enter');
  const png = await sharp({ create: { width: 300, height: 180, channels: 3, background: '#737373' } }).png().toBuffer();
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const uploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/media' && response.request().method() === 'POST');
  await page.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true });
  const preview = dialog.locator('.image-preview img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(editor.locator('img')).toHaveCount(0);
  await dialog.getByLabel('Alternative text', { exact: true }).fill('A checked local image');
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const { url } = await response.json();
  const media = await request.get(url);
  expect(media.ok()).toBe(true);
  expect(media.headers()['content-type']).toContain('image/webp');
  await publish(page);
  const image = page.locator('main img').first();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('alt', 'A checked local image');
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('an image URL is previewed before insertion and renders in a public article', async ({ page, request }) => {
  const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#525252' } }).png().toBuffer();
  const uploaded = await request.post('/api/v1/media', {
    multipart: { file: { name: 'url-preview.png', mimeType: 'image/png', buffer: png } },
  });
  expect(uploaded.status()).toBe(201);
  const { url } = await uploaded.json();
  const editor = await writeArticle(page, uniqueTitle('image URL'), '');
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true });
  await dialog.getByLabel('Image URL', { exact: true }).fill(new URL(url, page.url()).href);
  await dialog.getByLabel('Alternative text', { exact: true }).fill('A checked URL image');
  const preview = dialog.locator('.image-preview img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(editor.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(editor.getByRole('img', { name: 'A checked URL image', exact: true })).toBeVisible();
  await publish(page);
  const image = page.locator('main').getByRole('img', { name: 'A checked URL image', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('a video URL is normalized and published as a player rather than a text link', async ({ page, request }) => {
  const videoUrl = 'https://youtu.be/jNQXAC9IVRw';
  const canonical = 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw';
  const rejected = await request.post('/api/v1/articles', {
    data: {
      title: uniqueTitle('unsafe video representation'), schemaVersion: 1,
      content: { type: 'doc', content: [{ type: 'video', attrs: { provider: 'youtube', src: videoUrl } }] },
    },
  });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error.code).toBe('INVALID_DOCUMENT');
  const editor = await writeArticle(page, uniqueTitle('video embed'), '');
  await page.getByRole('button', { name: 'Insert block', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert video', exact: true });
  await dialog.getByLabel('Video URL', { exact: true }).fill(videoUrl);
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(editor.locator('iframe')).toHaveAttribute('src', canonical);
  const publication = await publish(page);
  const response = await request.get(`/api/v1/articles/${publication.article.id}`);
  expect(response.status()).toBe(200);
  const { article } = await response.json();
  expect(article.content.content).toContainEqual({ type: 'video', attrs: { provider: 'youtube', src: canonical, aspectRatio: '16:9' } });
  const iframe = page.locator('main iframe');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', canonical);
  await expect(iframe).toHaveAttribute('loading', 'lazy');
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(page.locator('main a').filter({ hasText: videoUrl })).toHaveCount(0);

  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  const restoredEditor = page.getByRole('textbox', { name: 'Tell your story', exact: true });
  await expect(restoredEditor.locator('iframe')).toHaveAttribute('src', canonical);
  const changedTitle = `${publication.article.title} updated`;
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(changedTitle);
  const updateResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/v1/articles/${publication.article.id}` && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  const updateResponse = await updateResponsePromise;
  expect(updateResponse.status()).toBe(200);
  const updated = await updateResponse.json();
  expect(updated.article.id).toBe(publication.article.id);
  expect(updated.article.version).toBe(publication.article.version + 1);
  expect(updated.article.title).toBe(changedTitle);
  expect(updated.article.content).toEqual(article.content);
  await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}$`));
  await expect(page.getByRole('heading', { name: changedTitle, exact: true })).toBeVisible();
  await expect(page.locator('main iframe')).toBeVisible();
  await expect(page.locator('main iframe')).toHaveAttribute('src', canonical);

  const persistedResponse = await request.get(`/api/v1/articles/${publication.article.id}`);
  expect(persistedResponse.status()).toBe(200);
  const persisted = await persistedResponse.json();
  expect(persisted.article.id).toBe(publication.article.id);
  expect(persisted.article.version).toBe(updated.article.version);
  expect(persisted.article.content).toEqual(article.content);
  const htmlResponse = await request.get(`/a/${publication.article.id}`);
  expect(htmlResponse.status()).toBe(200);
  expect(await htmlResponse.text()).toContain(`<iframe src="${canonical}"`);
  const frameSources = (htmlResponse.headers()['content-security-policy'] ?? '')
    .split(';').find(directive => directive.trim().startsWith('frame-src'))?.trim().split(/\s+/) ?? [];
  expect(frameSources).toContain('https://www.youtube-nocookie.com');
  expect(frameSources).not.toContain('https:');
  expect(frameSources).not.toContain('*');
});

test('mobile layout keeps publication reachable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const title = uniqueTitle('mobile');
  await writeArticle(page, title, 'Comfortable writing on a small screen.');
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await publish(page);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('public reading HTML includes metadata and renders hostile text literally', async ({ request, page }) => {
  const response = await request.post('/api/v1/articles', {
    data: { title: uniqueTitle('safe SSR'), schemaVersion: 1, content: doc('<script>window.__versoXss = true</script>') },
  });
  expect(response.status()).toBe(201);
  const publication = await response.json() as Publication;
  ownedArticles.push({ id: publication.article.id, editKey: publication.editKey });
  const htmlResponse = await request.get(`/a/${publication.article.id}`);
  expect(htmlResponse.status()).toBe(200);
  const html = await htmlResponse.text();
  expect(html).toContain(publication.article.title);
  expect(html).toContain('property="og:title"');
  expect(html).toContain('property="og:image"');
  expect(html).toContain('name="twitter:card"');
  await page.goto(`/a/${publication.article.id}`);
  expect(await page.evaluate(() => '__versoXss' in window)).toBe(false);
  await expect(page.locator('main')).toContainText('<script>window.__versoXss = true</script>');
});
