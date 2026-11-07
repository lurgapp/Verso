import { expect } from '@playwright/test';
import { test } from './fixtures';

test('unused Next.js image optimizer is unavailable', async ({ request }) => {
  for (const url of ['/icon.svg', '/api/health', 'http://127.0.0.1:3000/api/health']) {
    const response = await request.get('/_next/image', { params: { url, w: '64', q: '75' } });
    expect(response.status()).toBe(404);
  }
});

test('cross-origin publication is rejected before writing', async ({ request }) => {
  const response = await request.post('/api/v1/articles', {
    headers: { Origin: 'https://foreign-origin.invalid', 'Content-Type': 'application/json' },
    data: { title: 'Must never be published', schemaVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph' }] } },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('ORIGIN_DENIED');
});

test('editor responses retain browser security boundaries', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("base-uri 'self'");
  expect(headers['x-powered-by']).toBeUndefined();
});
