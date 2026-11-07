import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { db } from '../../src/lib/server/db';
import { createArticle, getPublicArticle, updateArticle } from '../../src/lib/server/articles';
import { cleanupExpiredViewKeys, recordArticleView, viewRequestKey, VIEW_WINDOW_SECONDS } from '../../src/lib/server/article-metrics';
import { GET } from '../../src/app/api/v1/articles/[id]/route';
import { POST } from '../../src/app/api/v1/articles/[id]/views/route';
import { HttpError } from '../../src/lib/server/http';

// These tests mutate real PostgreSQL. Never point them at a public/shared database.
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const isIsolatedTestDatabase = process.env.VERSO_ALLOW_ISOLATED_DB_TESTS === '1'
  && databaseUrl?.protocol === 'postgresql:'
  && ['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname)
  && /^verso(?:_[a-z0-9]+)*_test$/u.test(decodeURIComponent(databaseUrl.pathname.slice(1)));
const ids: string[] = [];
const keys = new Set<string>();
const run = randomUUID();
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A real isolated PostgreSQL metrics integration fixture.' }] }] };
const origin = 'http://127.0.0.1:3000';
const now = Date.now();
function request(id: string, ip: string, extra: Record<string, string> = {}) {
  const result = new Request(`${origin}/api/v1/articles/${id}/views`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 Chrome/130.0 Safari/537.36', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty', 'x-real-ip': ip, ...extra }, body: '{}',
  });
  for (const scope of ['article', 'budget'] as const) keys.add(viewRequestKey(result, scope, scope === 'article' ? id : '', now).key);
  return result;
}
async function fixture(showViewCount = true) {
  const publication = await createArticle({ title: `Isolated metrics ${run}`, content, schemaVersion: 1, showViewCount });
  ids.push(publication.article.id);
  return publication;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;

before(async () => {
  assert.ok(isIsolatedTestDatabase, 'Requires VERSO_ALLOW_ISOLATED_DB_TESTS=1 and a loopback PostgreSQL database named verso[_suffix]_test.');
  process.env.PUBLIC_BASE_URL = origin;
  // Fail before fixture writes if additive metrics migration/client is missing.
  await db.$queryRaw`SELECT "viewCount", "showViewCount" FROM "Article" LIMIT 1`;
});
after(async () => {
  if (isIsolatedTestDatabase) {
    if (ids.length) await db.article.deleteMany({ where: { publicId: { in: ids } } });
    if (keys.size) await db.rateLimit.deleteMany({ where: { key: { in: [...keys] } } });
    await db.$disconnect();
  }
});

test('32 simultaneous requests from one network count exactly once without changing the publication version or timestamp', async () => {
  const { article } = await fixture();
  const beforeRecord = await db.article.findUniqueOrThrow({ where: { publicId: article.id } });
  const responses = await Promise.all(Array.from({ length: 32 }, () => recordArticleView(request(article.id, '192.0.2.201'), article.id, now)));
  assert.equal(responses.filter(result => result.counted).length, 1);
  assert.ok(responses.every(result => result.viewCount === 1));
  const afterRecord = await db.article.findUniqueOrThrow({ where: { publicId: article.id } });
  assert.equal(afterRecord.viewCount, 1);
  assert.equal(afterRecord.version, beforeRecord.version);
  assert.equal(afterRecord.updatedAt.toISOString(), beforeRecord.updatedAt.toISOString());
  assert.deepEqual(afterRecord.content, beforeRecord.content);
});

test('different networks count independently; one network is scoped separately to each article and fixed window', async () => {
  const { article } = await fixture();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => recordArticleView(request(article.id, `192.0.2.${210 + i}`), article.id, now)));
  assert.equal(results.filter(result => result.counted).length, 12);
  const other = await fixture();
  assert.equal((await recordArticleView(request(other.article.id, '192.0.2.210'), other.article.id, now)).counted, true);
  const later = now + VIEW_WINDOW_SECONDS * 1_000;
  const laterRequest = request(article.id, '192.0.2.210');
  for (const scope of ['article', 'budget'] as const) keys.add(viewRequestKey(laterRequest, scope, scope === 'article' ? article.id : '', later).key);
  const laterResult = await recordArticleView(laterRequest, article.id, later);
  assert.deepEqual(laterResult, { counted: true, viewCount: 13 });
});

test('hidden counters remain private in view POST and public article GET, including conditional requests', async () => {
  const { article } = await fixture(false);
  const counted = await POST(request(article.id, '192.0.2.230'), context(article.id));
  assert.equal(counted.status, 200);
  assert.deepEqual(await counted.json(), { counted: true });
  assert.equal((await db.article.findUniqueOrThrow({ where: { publicId: article.id } })).viewCount, 1);
  const publicResult = await getPublicArticle(article.id);
  assert.ok(publicResult);
  assert.equal(publicResult.showViewCount, false);
  assert.equal(publicResult.readingMinutes, 1);
  assert.equal(Object.hasOwn(publicResult, 'viewCount'), false);
  const getRequest = new Request(`${origin}/api/v1/articles/${article.id}`, { headers: { 'x-real-ip': '192.0.2.230' } });
  const response = await GET(getRequest, context(article.id));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), `"${article.id}-1-hidden"`);
  assert.equal(Object.hasOwn((await response.json()).article, 'viewCount'), false);
  await recordArticleView(request(article.id, '192.0.2.231'), article.id, now);
  const conditional = await GET(new Request(getRequest.url, { headers: { 'x-real-ip': '192.0.2.230', 'if-none-match': response.headers.get('etag')! } }), context(article.id));
  assert.equal(conditional.status, 304);
});

test('visible counter changes public ETag without changing owner version', async () => {
  const { article } = await fixture();
  const headers = { 'x-real-ip': '192.0.2.232' };
  const url = `${origin}/api/v1/articles/${article.id}`;
  const beforeResponse = await GET(new Request(url, { headers }), context(article.id));
  assert.equal(beforeResponse.status, 200);
  await recordArticleView(request(article.id, '192.0.2.232'), article.id, now);
  const afterResponse = await GET(new Request(url, { headers: { ...headers, 'if-none-match': beforeResponse.headers.get('etag')! } }), context(article.id));
  assert.equal(afterResponse.status, 200);
  assert.notEqual(afterResponse.headers.get('etag'), beforeResponse.headers.get('etag'));
  const current = (await afterResponse.json()).article;
  assert.equal(current.version, article.version);
  assert.equal(current.viewCount, 1);
});

test('owner can hide and show the counter; legacy updates preserve preference; incorrect keys cannot change it', async () => {
  const { article, editKey } = await fixture();
  const update = (version: number, preference: Record<string, unknown> = {}) => ({ title: article.title, content, schemaVersion: 1, version, ...preference });
  await assert.rejects(updateArticle(article.id, 'incorrect-edit-key', update(article.version, { showViewCount: false })), hasStatus(401));
  assert.equal((await getPublicArticle(article.id))?.showViewCount, true);
  const hidden = await updateArticle(article.id, editKey, update(article.version, { showViewCount: false }));
  assert.equal(hidden.showViewCount, false);
  assert.equal(Object.hasOwn(hidden, 'viewCount'), false);
  const legacy = await updateArticle(article.id, editKey, update(hidden.version));
  assert.equal(legacy.showViewCount, false);
  assert.equal(Object.hasOwn(legacy, 'viewCount'), false);
  await recordArticleView(request(article.id, '192.0.2.233'), article.id, now);
  const visible = await updateArticle(article.id, editKey, update(legacy.version, { showViewCount: true }));
  assert.equal(visible.showViewCount, true);
  assert.equal(visible.viewCount, 1);
  assert.equal(visible.version, article.version + 3);
});

test('known bots and prefetch requests write no counting or traffic-budget token', async () => {
  const { article } = await fixture();
  const inputs = [request(article.id, '192.0.2.234', { 'user-agent': 'TelegramBot' }), request(article.id, '192.0.2.235', { purpose: 'prefetch' })];
  for (const input of inputs) assert.deepEqual(await recordArticleView(input, article.id, now), { counted: false });
  const skippedKeys = inputs.flatMap(input => (['article', 'budget'] as const).map(scope => viewRequestKey(input, scope, scope === 'article' ? article.id : '', now).key));
  assert.equal(await db.rateLimit.count({ where: { key: { in: skippedKeys } } }), 0);
  assert.equal((await getPublicArticle(article.id))?.viewCount, 0);
});

test('expired view tokens are removed while valid tokens and unrelated rate limits survive', async () => {
  const past = new Date(Date.now() - 1_000);
  const future = new Date(Date.now() + 60_000);
  const expired = `view:a:${run.replaceAll('-', '')}expired`;
  const active = `view:a:${run.replaceAll('-', '')}active`;
  const unrelated = `unrelated:${run}`;
  for (const key of [expired, active, unrelated]) keys.add(key);
  await db.rateLimit.createMany({ data: [{ key: expired, count: 1, expiresAt: past }, { key: active, count: 1, expiresAt: future }, { key: unrelated, count: 1, expiresAt: past }] });
  await cleanupExpiredViewKeys();
  const rows = await db.rateLimit.findMany({ where: { key: { in: [expired, active, unrelated] } }, select: { key: true } });
  assert.deepEqual(rows.map(row => row.key).sort(), [active, unrelated].sort());
});

test('request flood budget denies excess requests before creating a view token or incrementing an article', async () => {
  const { article } = await fixture();
  const input = request(article.id, '192.0.2.236');
  const budget = viewRequestKey(input, 'budget', '', now);
  const token = viewRequestKey(input, 'article', article.id, now);
  await db.rateLimit.create({ data: { key: budget.key, count: 120, expiresAt: budget.expiresAt } });
  await assert.rejects(recordArticleView(input, article.id, now), error => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 429);
    assert.ok(Number(error.headers['Retry-After']) >= 1 && Number(error.headers['Retry-After']) <= 600);
    return true;
  });
  assert.equal(await db.rateLimit.count({ where: { key: token.key } }), 0);
  assert.equal((await getPublicArticle(article.id))?.viewCount, 0);
});

test('counter saturation remains bounded and deleted articles cannot accumulate reads', async () => {
  const { article } = await fixture();
  await db.article.update({ where: { publicId: article.id }, data: { viewCount: 2_147_483_647 } });
  assert.deepEqual(await recordArticleView(request(article.id, '192.0.2.237'), article.id, now), { counted: true, viewCount: 2_147_483_647 });
  await db.article.update({ where: { publicId: article.id }, data: { status: 'DELETED' } });
  await assert.rejects(recordArticleView(request(article.id, '192.0.2.238'), article.id, now), hasStatus(404));
  assert.equal(await getPublicArticle(article.id), null);
});
