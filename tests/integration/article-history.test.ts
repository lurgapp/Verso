import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db } from "../../src/lib/server/db";
import { createArticle, deleteArticle, getArticleRevision, getPublicArticle, listArticleHistory, MAX_ARTICLE_HISTORY_BYTES, MAX_ARTICLE_VERSIONS, restoreArticleVersion, updateArticle } from "../../src/lib/server/articles";
import { HttpError } from "../../src/lib/server/http";
import { GET as listRoute } from "../../src/app/api/v1/articles/[id]/history/route";
import { GET as revisionRoute } from "../../src/app/api/v1/articles/[id]/history/[version]/route";
import { POST as restoreRoute } from "../../src/app/api/v1/articles/[id]/history/[version]/restore/route";
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const isolated = process.env.VERSO_ALLOW_ISOLATED_DB_TESTS === "1" && databaseUrl?.protocol === "postgresql:" && ["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname) && /^verso(?:_[a-z0-9]+)*_test$/u.test(decodeURIComponent(databaseUrl.pathname.slice(1)));
const ids: string[] = [], rateKeys: string[] = [];
const run = randomUUID();
const origin = "http://127.0.0.1:3000";
const document = (text = "History fixture") => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
async function fixture() { const created = await createArticle({ title: `History ${run}`, schemaVersion: 1, content: document() }); ids.push(created.article.id); return created; }
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
const mutation = (version: number, title: string, text = title) => ({ title, version, content: document(text), schemaVersion: 1 });
function request(id: string, key?: string, method = "GET", body?: unknown) {
  return new Request(`${origin}/api/v1/articles/${id}/history`, { method, headers: { origin, "content-type": "application/json", "x-real-ip": "192.0.2.219", ...(key ? { authorization: `Bearer ${key}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
before(async () => {
  assert.ok(isolated, "Requires explicitly authorized loopback verso[_suffix]_test database.");
  process.env.PUBLIC_BASE_URL = origin;
  await db.$queryRaw`SELECT "articleId", "bytes" FROM "ArticleVersion" LIMIT 1`;
  // Track only this test network's history rate key for precise teardown.
  const { clientDigest } = await import("../../src/lib/server/security");
  const slot = Math.floor(Date.now() / 3600_000);
  rateKeys.push(`history:${clientDigest(request("AAAAAAAAAAAA"))}:${slot}`, `edit:${clientDigest(request("AAAAAAAAAAAA"))}:${slot}`);
});
after(async () => { if (isolated) { if (ids.length) await db.article.deleteMany({ where: { publicId: { in: ids } } }); if (rateKeys.length) await db.rateLimit.deleteMany({ where: { key: { in: rateKeys } } }); await db.$disconnect(); } });

test("owner updates atomically retain the exact previous content and visibility without exposing secrets", async () => {
  const { article, editKey } = await fixture();
  const changed = await updateArticle(article.id, editKey, { ...mutation(1, "Version two"), showViewCount: false });
  assert.equal(changed.version, 2); assert.equal(changed.id, article.id);
  const versions = await listArticleHistory(article.id, editKey);
  assert.equal(versions.length, 1); assert.equal(versions[0].version, 1); assert.equal(versions[0].title, article.title);
  const revision = await getArticleRevision(article.id, editKey, 1);
  assert.deepEqual(revision.content, article.content); assert.equal(revision.showViewCount, true);
  assert.doesNotMatch(JSON.stringify({ versions, revision }), /editKey|editKeyHash|internalId/u);
  assert.ok(!(await getPublicArticle(article.id) as unknown as Record<string, unknown>).versions);
});

test("history requires the article owner's key on both list and revision routes", async () => {
  const { article, editKey } = await fixture();
  await updateArticle(article.id, editKey, mutation(1, "Private history"));
  for (const key of [null, "A".repeat(43)]) { await assert.rejects(listArticleHistory(article.id, key), status(401)); await assert.rejects(getArticleRevision(article.id, key, 1), status(401)); }
  const context = { params: Promise.resolve({ id: article.id }) };
  assert.equal((await listRoute(request(article.id), context)).status, 401);
  const response = await listRoute(request(article.id, editKey), context);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await revisionRoute(request(article.id), { params: Promise.resolve({ id: article.id, version: "1" }) })).status, 401);
  assert.equal((await revisionRoute(request(article.id, editKey), { params: Promise.resolve({ id: article.id, version: "0" }) })).status, 404);
});

test("concurrent writers produce exactly one new version and one genuine snapshot", async () => {
  const { article, editKey } = await fixture();
  const results = await Promise.allSettled([updateArticle(article.id, editKey, mutation(1, "Writer one")), updateArticle(article.id, editKey, mutation(1, "Writer two"))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(status(409)(rejected.reason));
  const history = await listArticleHistory(article.id, editKey);
  assert.deepEqual(history.map((entry) => entry.version), [1]);
  assert.equal((await getPublicArticle(article.id))?.version, 2);
});

test("restore creates a new publication version and preserves both stable URL and intervening history", async () => {
  const { article, editKey } = await fixture();
  await updateArticle(article.id, editKey, { ...mutation(1, "Intermediate"), showViewCount: false });
  const restored = await restoreArticleVersion(article.id, editKey, 1, { version: 2 });
  assert.equal(restored.version, 3); assert.equal(restored.id, article.id); assert.equal(restored.title, article.title); assert.equal(restored.showViewCount, true); assert.deepEqual(restored.content, article.content);
  assert.deepEqual((await listArticleHistory(article.id, editKey)).map((entry) => entry.version), [2, 1]);
  assert.equal((await getArticleRevision(article.id, editKey, 2)).title, "Intermediate");
  await assert.rejects(restoreArticleVersion(article.id, editKey, 1, { version: 2 }), status(409));
  assert.equal((await listArticleHistory(article.id, editKey)).length, 2);
  assert.equal((await restoreRoute(request(article.id, undefined, "POST", { version: 3 }), { params: Promise.resolve({ id: article.id, version: "1" }) })).status, 401);
});

test("count, approximate bytes and age independently bound retained private history", async () => {
  const { article, editKey } = await fixture();
  const record = await db.article.findUniqueOrThrow({ where: { publicId: article.id } });
  await db.article.update({ where: { internalId: record.internalId }, data: { version: 101 } });
  const base = { articleId: record.internalId, title: "Synthetic isolated retention fixture", content: document(), showViewCount: true, schemaVersion: 1, createdAt: new Date() };
  await db.articleVersion.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ ...base, version: index + 1, bytes: 1024 })) });
  await updateArticle(article.id, editKey, mutation(101, "Count retention"));
  assert.equal((await listArticleHistory(article.id, editKey)).length, MAX_ARTICLE_VERSIONS);
  await db.articleVersion.updateMany({ where: { articleId: record.internalId }, data: { bytes: Math.floor(MAX_ARTICLE_HISTORY_BYTES / 3) } });
  await updateArticle(article.id, editKey, mutation(102, "Byte retention"));
  assert.ok((await listArticleHistory(article.id, editKey)).length <= 4);
  await db.articleVersion.updateMany({ where: { articleId: record.internalId }, data: { createdAt: new Date(Date.now() - 91 * 86400_000) } });
  await updateArticle(article.id, editKey, mutation(103, "Age retention"));
  assert.deepEqual((await listArticleHistory(article.id, editKey)).map((entry) => entry.version), [103]);
});

test("deletion clears private snapshots while keeping the public ID reserved", async () => {
  const { article, editKey } = await fixture();
  await updateArticle(article.id, editKey, mutation(1, "Will be erased"));
  const record = await db.article.findUniqueOrThrow({ where: { publicId: article.id } });
  assert.equal(await db.articleVersion.count({ where: { articleId: record.internalId } }), 1);
  await deleteArticle(article.id, editKey);
  assert.equal(await db.articleVersion.count({ where: { articleId: record.internalId } }), 0);
  assert.equal(await getPublicArticle(article.id), null); await assert.rejects(listArticleHistory(article.id, editKey), status(404));
  assert.equal((await db.article.findUniqueOrThrow({ where: { publicId: article.id } })).status, "DELETED");
});
