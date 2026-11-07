import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, api, parseRetryAfter, publicationRateLimitMessage } from '../../src/lib/client/storage';

test('Retry-After accepts seconds and a valid future HTTP date with bounded values', () => {
  const now = Date.UTC(2026, 9, 12, 10, 0);
  assert.equal(parseRetryAfter(' 90 ', now), 90);
  assert.equal(parseRetryAfter('Mon, 12 Oct 2026 10:01:30 GMT', now), 90);
  assert.equal(parseRetryAfter('Mon, 12 Oct 2026 09:00:00 GMT', now), 1);
  assert.equal(parseRetryAfter('0', now), 1);
  assert.equal(parseRetryAfter('999999999', now), 86_400);
});

test('Retry-After ignores malformed, negative, fractional and oversized headers', () => {
  for (const header of [null, '', '-10', '1.5', 'Infinity', 'tomorrow', '2026-10-13', 'Thu, 31 Feb 2026 10:00:00 GMT', '1'.repeat(129)]) {
    assert.equal(parseRetryAfter(header), undefined, String(header));
  }
});

test('publication limits explain retry time and truthful draft persistence in both languages', () => {
  assert.equal(publicationRateLimitMessage('ru', 61, true), 'Лимит публикаций временно исчерпан. Повторите через 2 мин. Черновик сохранён на этом устройстве.');
  assert.equal(publicationRateLimitMessage('en', 1, true), 'Publication limit reached. Please try again in 1 second. Your draft is saved on this device.');
  assert.equal(publicationRateLimitMessage('en', 60, false), 'Publication limit reached. Please try again in 1 minute. Your text remains in the editor. Download a copy from the menu.');
  assert.equal(publicationRateLimitMessage('ru', undefined, false), 'Лимит публикаций временно исчерпан. Попробуйте немного позже. Текст остаётся в редакторе. Скачайте копию через меню.');
});

test('API rejection retains Retry-After alongside status and server error without retrying', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }), { status: 429, headers: { 'Retry-After': '120' } });
  });
  await assert.rejects(api('/api/v1/articles', { method: 'POST', body: '{}' }), error => error instanceof ApiError && error.status === 429 && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 120 && error.message === 'Too many requests.');
  assert.equal(requests, 1);
});
