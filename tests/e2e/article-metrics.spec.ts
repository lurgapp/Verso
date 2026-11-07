import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './fixtures';

// This suite publishes fixtures. It must never run against a public deployment.
const localBase = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
const localOrigin = new URL(localBase).origin;
const owned: Array<{ id: string; editKey: string }> = [];
const prose = Array.from({ length: 201 }, () => 'word').join(' ');
const articleDocument = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: prose }] }] };
const browserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
test.use({ userAgent: browserAgent });

test.beforeAll(() => {
  expect(process.env.VERSO_ALLOW_ISOLATED_DB_TESTS).toBe('1');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(localBase).hostname);
});
test.afterEach(async ({ request }) => {
  for (const article of owned.splice(0)) {
    const response = await request.delete(`/api/v1/articles/${article.id}`, { headers: { origin: localOrigin, authorization: `Bearer ${article.editKey}` } });
    expect([204, 404]).toContain(response.status());
  }
});
async function publish(request: APIRequestContext, showViewCount = true) {
  const response = await request.post('/api/v1/articles', { headers: { origin: localOrigin }, data: { title: `Isolated article metadata ${Date.now()}`, content: articleDocument, schemaVersion: 1, showViewCount } });
  expect(response.status()).toBe(201);
  const publication = await response.json();
  owned.push({ id: publication.article.id, editKey: publication.editKey });
  return publication;
}

test('a visible read waits five seconds, localizes metadata and suppresses refreshes in the same session', async ({ page, request }) => {
  const publication = await publish(request);
  await page.addInitScript(() => { localStorage.setItem('verso-language', 'ru'); localStorage.setItem('verso-theme', 'light'); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); });
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/articles/${publication.article.id}/views`)) posts.push(request.url()); });
  await page.goto(`/a/${publication.article.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.article-meta')).toContainText('2 мин чтения');
  await page.clock.install({ time: new Date() });
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('[data-article-views]')).toHaveText('0 просмотров');
  const initialResponse = await request.get(`/api/v1/articles/${publication.article.id}`);
  const initial = (await initialResponse.json()).article;
  await page.clock.runFor(4_999);
  expect(posts).toHaveLength(0);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/articles/${publication.article.id}/views`));
  await page.clock.runFor(100);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ counted: true, viewCount: 1 });
  await expect(page.locator('[data-article-views]')).toHaveText('1 просмотр');
  await test.info().attach('article-metadata-ru', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  const current = (await (await request.get(`/api/v1/articles/${publication.article.id}`)).json()).article;
  expect(current.version).toBe(initial.version);
  expect(current.updatedAt).toBe(initial.updatedAt);
  expect(current.viewCount).toBe(1);
  const stored = await page.evaluate(() => Object.keys(sessionStorage));
  expect(stored).toContain(`verso-view:${publication.article.id}`);
  expect(stored.filter(key => /visitor|fingerprint|reader.?id/iu.test(key))).toEqual([]);
  await page.clock.resume();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.article-meta')).toContainText('2 мин чтения');
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1_000));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(6_000);
  expect(posts).toHaveLength(1);
  await expect(page.locator('[data-article-views]')).toHaveText('1 просмотр');
});

test('background time does not count, and hidden counters are absent from SSR and the counting response', async ({ page, request }) => {
  const publication = await publish(request, false);
  const html = await request.get(`/a/${publication.article.id}`);
  expect(html.status()).toBe(200);
  const markup = await html.text();
  expect(markup).not.toContain('data-article-views');
  // The client payload may carry the visibility setting but never the hidden aggregate.
  expect(markup.replace(/\\+"/gu, '"')).not.toMatch(/"viewCount":\s*\d/u);
  await page.addInitScript(() => { localStorage.setItem('verso-language', 'ru'); localStorage.setItem('verso-theme', 'light'); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); });
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/articles/${publication.article.id}/views`)) posts.push(request.url()); });
  await page.goto(`/a/${publication.article.id}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await page.clock.install({ time: new Date() });
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(3_000);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(20_000);
  expect(posts).toHaveLength(0);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(4_999);
  expect(posts).toHaveLength(0);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/articles/${publication.article.id}/views`));
  await page.clock.runFor(100);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ counted: true });
  await expect(page.locator('[data-article-views]')).toHaveCount(0);
  await expect(page.locator('.article-meta')).toContainText('2 мин чтения');
});

test('author can publish with a hidden counter and persist its visibility setting through edit and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(`Hidden counter author ${Date.now()}`);
  await page.getByRole('textbox', { name: 'Tell your story', exact: true }).fill('A minimal real article with owner-controlled metadata.');
  await page.locator('summary[aria-label="More actions"]').click();
  const preference = page.getByRole('checkbox', { name: 'Show view count', exact: true });
  await expect(preference).toBeChecked();
  await preference.uncheck();
  await page.locator('summary[aria-label="More actions"]').click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('summary[aria-label="More actions"]').click();
  await expect(page.getByRole('checkbox', { name: 'Show view count', exact: true })).not.toBeChecked();
  await page.locator('summary[aria-label="More actions"]').click();
  const published = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/articles');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const response = await published;
  expect(response.status()).toBe(201);
  const publication = await response.json();
  owned.push({ id: publication.article.id, editKey: publication.editKey });
  expect(publication.article.showViewCount).toBe(false);
  expect(publication.article).not.toHaveProperty('viewCount');
  await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}$`));
  await expect(page.locator('[data-article-views]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}/edit$`));
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await page.locator('summary[aria-label="More actions"]').click();
  await expect(page.getByRole('checkbox', { name: 'Show view count', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Show view count', exact: true }).check();
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}$`));
  await expect(page.locator('[data-article-views]')).toBeVisible();
});

// Preferences are also meaningful before the author types the first character.
test('an empty draft retains its hidden-counter preference after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeEnabled();
  await page.locator('summary[aria-label="More actions"]').click();
  await page.getByRole('checkbox', { name: 'Show view count', exact: true }).uncheck();
  await page.locator('summary[aria-label="More actions"]').click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('');
  await page.locator('summary[aria-label="More actions"]').click();
  await expect(page.getByRole('checkbox', { name: 'Show view count', exact: true })).not.toBeChecked();
});
