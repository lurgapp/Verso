import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readingMinutes, readingTimeLabel, viewsLabel } from '../../src/lib/article-stats';
import { isViewRequestEligible, viewRequestKey } from '../../src/lib/server/article-metrics';
import { POST } from '../../src/app/api/v1/articles/[id]/views/route';
import type { EditorDocument } from '../../src/lib/types';

const words = (count: number): EditorDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: Array.from({ length: count }, () => 'слово').join(' ') }] }] });
const browserRequest = (extra: Record<string, string> = {}) => new Request('https://verso.lurg.pro/api/v1/articles/AbCdEf012345/views', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0 Safari/537.36', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty', 'x-real-ip': '192.0.2.10', ...extra } });

test('reading estimates use document words with a minimum minute and safe boundary rounding', () => {
  assert.equal(readingMinutes(words(0)), 1);
  assert.equal(readingMinutes(words(1)), 1);
  assert.equal(readingMinutes(words(200)), 1);
  assert.equal(readingMinutes(words(201)), 2);
  assert.equal(readingMinutes(words(800)), 4);
  assert.equal(readingMinutes({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.test/a.png', alt: 'An image alternative text is not article prose' } }] }), 1);
  assert.equal(readingMinutes({ type: 'doc', content: [words(100).content[0], { type: 'codeBlock', content: [{ type: 'text', text: 'const answer = 42;' }] }, words(100).content[0]] }), 2);
});

test('minimal reading metadata is localized, including Russian counter plural forms', () => {
  assert.equal(readingTimeLabel(4, 'ru'), '4 мин чтения');
  assert.equal(readingTimeLabel(4, 'en'), '4 min read');
  for (const [count, expected] of [[0, '0 просмотров'], [1, '1 просмотр'], [2, '2 просмотра'], [5, '5 просмотров'], [11, '11 просмотров'], [14, '14 просмотров'], [21, '21 просмотр'], [22, '22 просмотра'], [112, '112 просмотров'], [128, '128 просмотров']] as const) assert.equal(viewsLabel(count, 'ru'), expected);
  assert.equal(viewsLabel(1, 'en'), '1 view');
  assert.equal(viewsLabel(128, 'en'), '128 views');
});

test('view tokens are bounded, cannot link articles or windows, and never contain the IP', () => {
  const now = Date.UTC(2026, 9, 17, 12, 1);
  const request = browserRequest();
  const token = viewRequestKey(request, 'article', 'AbCdEf012345', now);
  assert.equal(token.key, viewRequestKey(request, 'article', 'AbCdEf012345', now + 60_000).key);
  assert.notEqual(token.key, viewRequestKey(request, 'article', 'OtherArticle', now).key);
  assert.notEqual(token.key, viewRequestKey(request, 'article', 'AbCdEf012345', now + 30 * 60_000).key);
  assert.notEqual(token.key, viewRequestKey(browserRequest({ 'x-real-ip': '192.0.2.11' }), 'article', 'AbCdEf012345', now).key);
  assert.notEqual(token.key, viewRequestKey(request, 'budget', '', now).key);
  assert.ok(token.key.length < 96);
  assert.ok(!token.key.includes('192.0.2.10'));
  assert.equal(token.expiresAt.toISOString(), '2026-10-17T12:30:00.000Z');
  assert.ok(token.expiresAt.getTime() - now <= 30 * 60_000);
});

test('known bots, previews, prefetches and cross-site resource requests never count', () => {
  assert.equal(isViewRequestEligible(browserRequest()), true);
  for (const agent of ['', 'Googlebot/2.1', 'TelegramBot (like TwitterBot)', 'HeadlessChrome/130', 'curl/8.0', 'Lighthouse', 'facebookexternalhit/1.1']) assert.equal(isViewRequestEligible(browserRequest({ 'user-agent': agent })), false, agent);
  for (const headers of [{ purpose: 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-dest': 'image' }] as Record<string, string>[]) assert.equal(isViewRequestEligible(browserRequest(headers)), false, JSON.stringify(headers));
});

test('view endpoint rejects invalid origins, article IDs and unexpected bodies before database access', async () => {
  const target = 'http://127.0.0.1:3000/api/v1/articles/AbCdEf012345/views';
  const call = (headers: Record<string, string>, body = '{}', id = 'AbCdEf012345') => POST(new Request(target, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), { params: Promise.resolve({ id }) });
  assert.equal((await call({})).status, 403);
  assert.equal((await call({ origin: 'https://evil.test' })).status, 403);
  assert.equal((await call({ origin: 'http://127.0.0.1:3000' }, '{}', 'wrong')).status, 404);
  assert.equal((await call({ origin: 'http://127.0.0.1:3000' }, '{"visitorId":"tracking-is-not-accepted"}')).status, 400);
  assert.equal((await call({ origin: 'http://127.0.0.1:3000' }, JSON.stringify({ x: 'a'.repeat(128) }))).status, 413);
  const bot = await call({ origin: 'http://127.0.0.1:3000', 'user-agent': 'TelegramBot' });
  assert.equal(bot.status, 200);
  assert.deepEqual(await bot.json(), { counted: false });
});
