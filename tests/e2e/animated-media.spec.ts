import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';



const source = '/api/v1/media/abcdefghijklmnopqrstuvwxyzABCDEF.webp';
const poster = '/api/v1/media/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef.webp';
const localVideo = '/api/v1/media/0123456789abcdefghijklmnopqrstuv.mp4';
const content = {
  type: 'doc', content: [
    { type: 'image', attrs: { src: source, animated: true, posterSrc: poster, alt: 'Animated interface', width: 32, height: 24 } },
    { type: 'video', attrs: { provider: 'file', src: localVideo, posterSrc: poster } },
    { type: 'paragraph', content: [{ type: 'text', text: 'The animation and demonstration stay in the draft.' }] },
  ],
};

async function importDraft(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeEnabled();
  await page.getByLabel('Import draft file', { exact: true }).setInputFiles({
    name: 'animation.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'verso-draft', version: 1, title: 'Animated instructions', content })),
  });
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Animated instructions');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
}

async function readSaved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('verso-private'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const value = await new Promise<Record<string, unknown>>((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get('new'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return value;
  });
}

async function mediaFixtures(page: Page) {
  const still = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#aa2233' } }).webp().toBuffer();
  await page.route('**/api/v1/media/*.webp', route => route.fulfill({ contentType: 'image/webp', body: still }));
  await page.route(`**${localVideo}`, route => route.fulfill({ status: 404, body: '' }));
}

test('reduced motion pauses uploaded animation, playback never edits JSON, Markdown retains posters', async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mediaFixtures(page);
  await importDraft(page);
  const motion = page.locator('.editor-document [data-vm-motion="image"]');
  await expect(motion).toHaveAttribute('data-vm-state', 'paused');
  await expect(motion.locator('img')).toHaveAttribute('src', poster);
  const before = await readSaved(page);
  await motion.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect(motion).toHaveAttribute('data-vm-state', 'playing');
  await expect(motion.locator('img')).toHaveAttribute('src', source);
  await motion.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(motion.locator('img')).toHaveAttribute('src', poster);
  await page.waitForTimeout(900);
  expect(await readSaved(page)).toEqual(before);
  const player = page.locator('.editor-document video');
  await expect(player).toHaveAttribute('controls', '');
  await expect(player).not.toHaveAttribute('autoplay', '');
  await expect(player).toHaveAttribute('poster', poster);
  await page.getByLabel('More actions', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown', exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const markdown = Buffer.concat(chunks).toString();
  expect(markdown).toContain('data-vm-animated="true"');
  expect(markdown).toContain(`data-vm-poster="${poster}"`);
  expect(markdown).toContain(`poster="${poster}"`);
  const fresh = await browser.newContext({ locale: 'en-US', reducedMotion: 'reduce' });
  try {
    const next = await fresh.newPage(); await mediaFixtures(next); await next.goto('/');
    await expect(next.getByRole('textbox', { name: 'Title', exact: true })).toBeEnabled();
    await next.getByLabel('Import Markdown file', { exact: true }).setInputFiles({ name: 'animation.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
    await expect(next.getByText('Saved on this device', { exact: true })).toBeVisible();
    const saved = await readSaved(next);
    const nodes = (saved.content as { content: Array<{ type: string; attrs?: object }> }).content;
    expect(nodes.find(node => node.type === 'image')?.attrs).toMatchObject(content.content[0].attrs!);
    expect(nodes.find(node => node.type === 'video')?.attrs).toMatchObject(content.content[1].attrs!);
    await expect(next.locator('.editor-document [data-vm-motion="image"]')).toHaveAttribute('data-vm-state', 'paused');
  } finally { await fresh.close(); }
});

test('GIF preview freezes under reduced motion and static PNG has no motion controls; cancelling sends no upload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let uploads = 0; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/media') uploads++; });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Insert image', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true });
  const pixels = Buffer.alloc(32 * 24 * 2 * 4, 255);
  for (let pixel = 0; pixel < pixels.length; pixel += 4) pixels[pixel + (pixel < pixels.length / 2 ? 0 : 2)] = 0;
  const gif = await sharp(pixels, { raw: { width: 32, height: 48, pageHeight: 24, channels: 4 } }).gif({ delay: [100, 100] }).toBuffer();
  await dialog.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'demo.gif', mimeType: 'image/gif', buffer: gif });
  await expect(dialog.locator('[data-vm-motion="image"]')).toHaveAttribute('data-vm-state', 'frozen');
  await expect(dialog.locator('canvas')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect(dialog.locator('[data-vm-motion="image"]')).toHaveAttribute('data-vm-state', 'playing');
  await dialog.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(dialog.locator('canvas')).toBeVisible();
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#223344' } }).png().toBuffer();
  await dialog.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await expect(dialog.locator('[data-vm-motion]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(uploads).toBe(0);
});

test('local MP4 previews privately, inserts only after confirmation and retains manual native playback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Insert block', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert video', exact: true });
  let uploads = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/media') uploads++; });
  const mp4 = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=10', '-t', '0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
  await dialog.getByLabel('Upload video', { exact: true }).setInputFiles({ name: 'interface.mp4', mimeType: 'video/mp4', buffer: mp4 });
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  await expect(dialog.locator('video')).toHaveAttribute('src', /^blob:/);
  expect(await dialog.locator('video').evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  expect(uploads).toBe(0);
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/media');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  const response = await uploaded; expect(response.status()).toBe(201);
  const media = await response.json();
  await expect(dialog).not.toBeVisible();
  const video = page.locator('.editor-document video');
  await expect(video).toHaveAttribute('src', media.url);
  await expect(video).toHaveAttribute('poster', media.posterUrl);
  await expect(video).toHaveAttribute('controls', '');
  expect(await video.evaluate(element => (element as HTMLVideoElement).autoplay)).toBe(false);
  expect(uploads).toBe(1);
});

test('real GIF upload publishes all frames, reader uses initial poster and remembers pause preference', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Animation reader integration');
  await page.getByRole('button', { name: 'Insert image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert image', exact: true });
  const pixels = Buffer.alloc(32 * 24 * 2 * 4, 255);
  for (let pixel = 0; pixel < pixels.length; pixel += 4) pixels[pixel + (pixel < pixels.length / 2 ? 0 : 2)] = 0;
  const gif = await sharp(pixels, { raw: { width: 32, height: 48, pageHeight: 24, channels: 4 } }).gif({ delay: [120, 160], loop: 0 }).toBuffer();
  await dialog.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'reader.gif', mimeType: 'image/gif', buffer: gif });
  await expect(dialog.getByRole('button', { name: 'Insert', exact: true })).toBeEnabled();
  const uploadResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/media');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  const upload = await uploadResponse; expect(upload.status()).toBe(201);
  const media = await upload.json(); expect(media.animated).toBe(true); expect(media.frames).toBe(2); expect(media.posterUrl).toMatch(/\.webp$/);
  const downloaded = await request.get(media.url);
  expect(downloaded.status()).toBe(200);
  expect((await sharp(await downloaded.body(), { animated: true }).metadata()).pages).toBe(2);
  const animatedRequests: string[] = [];
  page.on('request', incoming => { if (new URL(incoming.url()).pathname === media.url) animatedRequests.push(incoming.url()); });
  const publishedResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/articles');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const response = await publishedResponse; expect(response.status()).toBe(201);
  const publication = await response.json();
  try {
    await expect(page).toHaveURL(new RegExp(`/a/${publication.article.id}$`));
    const motion = page.locator('.article-prose [data-vm-motion="image"]');
    await expect(motion).toHaveAttribute('data-vm-state', 'paused');
    await expect(motion.locator('img')).toHaveAttribute('src', media.posterUrl);
    expect(animatedRequests).toHaveLength(0);
    await motion.getByRole('button', { name: 'Play animation', exact: true }).click();
    await expect(motion).toHaveAttribute('data-vm-state', 'playing');
    await expect.poll(() => animatedRequests.length).toBeGreaterThan(0);
    await page.getByLabel('Animation playback', { exact: true }).selectOption('paused');
    await expect(motion).toHaveAttribute('data-vm-state', 'paused');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.getByLabel('Animation playback', { exact: true })).toHaveValue('paused');
    await expect(motion).toHaveAttribute('data-vm-state', 'paused');
    await page.getByLabel('Animation playback', { exact: true }).selectOption('system');
    await expect(motion).toHaveAttribute('data-vm-state', 'playing');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(motion).toHaveAttribute('data-vm-state', 'paused');
  } finally {
    const removed = await request.delete(`/api/v1/articles/${publication.article.id}`, { headers: { Authorization: `Bearer ${publication.editKey}` } });
    expect([204, 404]).toContain(removed.status());
  }
});
