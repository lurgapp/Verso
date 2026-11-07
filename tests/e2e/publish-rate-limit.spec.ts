import { test } from './fixtures';
import { expect } from '@playwright/test';

test('a simulated publish 429 explains retry time and preserves the saved draft without auto retry', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, locale: 'en-US' });
  let publicationRequests = 0;
  await context.route('**/api/v1/articles', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    publicationRequests++;
    // This UI regression never creates an actual publication or consumes server quota.
    await route.fulfill({
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '90' },
      body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }),
    });
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const title = `E2E preserved 429 draft ${Date.now()}`;
    const body = 'This draft must survive a rejected publication and a reload.';
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await page.getByRole('textbox', { name: 'Tell your story', exact: true }).fill(body);
    await page.locator('summary[aria-label="More actions"]').click();
    await page.getByLabel('Language', { exact: true }).selectOption('ru');
    await page.locator('summary[aria-label="Другие действия"]').click();
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();

    const publish = page.getByRole('button', { name: 'Опубликовать', exact: true });
    const message = 'Лимит публикаций временно исчерпан. Повторите через 2 мин. Черновик сохранён на этом устройстве.';
    const error = page.getByRole('alert').filter({ hasText: 'Лимит публикаций временно исчерпан.' });
    await publish.click();
    await expect(error).toHaveText(message);
    await expect(publish).toBeEnabled();
    expect(publicationRequests).toBe(1);
    await page.waitForTimeout(1000); // Observe that a rejection does not trigger automatic retries.
    expect(publicationRequests).toBe(1);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await expect(page.getByRole('textbox', { name: 'Tell your story', exact: true })).toContainText(body);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await expect(page.getByRole('textbox', { name: 'Tell your story', exact: true })).toContainText(body);
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    expect(publicationRequests).toBe(1);
    await publish.click();
    await expect(error).toHaveText(message);
    await expect(publish).toBeEnabled();
    expect(publicationRequests).toBe(2);
    await page.waitForTimeout(1000);
    expect(publicationRequests).toBe(2);
    expect(new URL(page.url()).pathname).toBe('/');
    await testInfo.attach('localized 429 and preserved draft', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  } finally { await context.close(); }
});
