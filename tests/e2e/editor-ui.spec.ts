import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

async function openEditor(page: Page, body = '') {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Editor interaction check');
  const editor = page.getByRole('textbox', { name: 'Tell your story', exact: true });
  await editor.fill(body);
  return editor;
}

test('formatting appears above selected text and disappears with a collapsed selection', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.pressSequentially('Select this phrase for formatting.');
  await expect(page.locator('.word-count')).toHaveText('5 words · 1 min read');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting', exact: true });
  await expect(page.getByRole('toolbar', { name: 'Text formatting', exact: true })).toHaveCount(0);
  await expect(toolbar).not.toBeVisible();
  await editor.press('Home');
  await editor.press('Shift+End');
  await expect(toolbar).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const selection = window.getSelection();
    const toolbar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selection formatting"]');
    if (!toolbar || !selection?.rangeCount || selection.isCollapsed) return false;
    const selected = selection.getRangeAt(0).getBoundingClientRect();
    const bubble = toolbar.getBoundingClientRect();
    return bubble.top >= 0 && bubble.bottom <= selected.top + 1 &&
      bubble.bottom >= selected.top - 40 && bubble.left >= 0 && bubble.right <= window.innerWidth;
  })).toBe(true);
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Select this phrase for formatting.');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await expect(toolbar).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Select this phrase for formatting.');
  await editor.press('ArrowRight');
  await expect(toolbar).not.toBeVisible();
  await editor.fill('');
  await editor.press('Control+a');
  await expect(toolbar).not.toBeVisible();
});

test('the gutter offers grouped block insertion without covering the writing area', async ({ page }) => {
  const editor = await openEditor(page);
  const plus = page.getByRole('button', { name: 'Insert block', exact: true });
  const camera = page.getByRole('button', { name: 'Insert image', exact: true });
  await expect(plus).toBeVisible();
  await expect(camera).toBeVisible();
  const textBox = await editor.boundingBox();
  const plusBox = await plus.boundingBox();
  const cameraBox = await camera.boundingBox();
  expect(textBox).not.toBeNull();
  expect(plusBox).not.toBeNull();
  expect(cameraBox).not.toBeNull();
  expect(plusBox!.x + plusBox!.width).toBeLessThanOrEqual(textBox!.x + 1);
  expect(cameraBox!.x + cameraBox!.width).toBeLessThanOrEqual(textBox!.x + 1);
  await plus.click();
  const menu = page.getByRole('menu', { name: 'Insert blocks', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bullet list', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Insert 3 × 3 table', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Code block', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await editor.fill('Ordinary text keeps the canvas quiet.');
  await editor.press('End');
  await expect(plus).not.toBeVisible();
  await expect(camera).not.toBeVisible();
  await editor.press('Enter');
  await expect(plus).toBeVisible();
  await expect(camera).toBeVisible();
});

test('mobile gutter controls and table actions stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await openEditor(page);
  const plus = page.getByRole('button', { name: 'Insert block', exact: true });
  const camera = page.getByRole('button', { name: 'Insert image', exact: true });
  await expect(plus).toBeInViewport();
  await expect(camera).not.toBeVisible();
  const editorBox = await editor.boundingBox();
  for (const control of [plus]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(editorBox!.x + 1);
  }
  await plus.click();
  await page.getByRole('menuitem', { name: 'Insert image', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Insert image', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await plus.click();
  await page.getByRole('menuitem', { name: 'Insert 3 × 3 table', exact: true }).click();
  await editor.locator('th,td').first().click();
  await page.keyboard.insertText('Mobile cell');
  await page.locator('.v2-table-context').getByRole('button', { name: 'Table', exact: true }).click();
  await page.locator('.v2-table-context').getByRole('button', { name: 'Add row', exact: true }).click();
  await expect(editor.locator('tr')).toHaveCount(4);
  await page.locator('.v2-table-context').getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(editor.locator('tr').first().locator('th,td')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeInViewport();
});

test('an invalid image URL cannot be inserted without a successful preview', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await dialog.getByLabel('Image URL', { exact: true }).fill('javascript:alert(1)');
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('img', { name: 'Image preview', exact: true })).not.toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('a local image is previewed privately and can be cancelled before upload', async ({ page }) => {
  const editor = await openEditor(page);
  const uploads: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/media') uploads.push(request.url());
  });
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true });
  const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#737373' } }).png().toBuffer();
  await dialog.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'private-preview.png', mimeType: 'image/png', buffer: png });
  const preview = dialog.locator('.image-preview img');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => preview.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(48);
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await expect(editor.locator('img')).toHaveCount(0);
  expect(uploads).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(editor.locator('img')).toHaveCount(0);
  expect(uploads).toHaveLength(0);
});

test('Markdown keyboard shortcuts and undo redo work without a fixed toolbar', async ({ page }) => {
  const editor = await openEditor(page);
  await editor.pressSequentially('## A section');
  await expect(editor.locator('h2')).toHaveText('A section');
  await editor.press('Enter');
  await editor.press('Control+b');
  await editor.pressSequentially('Bold sentence');
  await editor.press('Control+b');
  await expect(editor.locator('strong')).toHaveText('Bold sentence');
  await editor.press('Control+z');
  await editor.press('Control+Shift+z');
  await expect(editor.locator('strong')).toHaveText('Bold sentence');
  await expect(page.getByRole('toolbar', { name: 'Text formatting', exact: true })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Selection formatting', exact: true })).not.toBeVisible();
});
