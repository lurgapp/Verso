import assert from 'node:assert/strict';
import { chmod, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import sharp from 'sharp';

// Run only after deployment readiness and coordinating the publication rate
// limit with other tests. Secrets are written to a private /tmp fixture only.
// KEEP_SMOKE_ARTICLE=1 node tests/security-smoke.mjs
// VERIFY_SMOKE_ARTICLE=1 node tests/security-smoke.mjs (read-only restart/restore check)
// RESUME_SMOKE_ARTICLE=1 KEEP_SMOKE_ARTICLE=1 node tests/security-smoke.mjs
// CLEANUP_SMOKE_ARTICLE=1 node tests/security-smoke.mjs (captured owner DELETE only)
const origin = new URL(process.env.VERSO_BASE_URL ?? 'https://verso.lurg.pro').origin;
const keep = process.env.KEEP_SMOKE_ARTICLE === '1';
const fixturePath = process.env.VERSO_SMOKE_OWNER_FILE ?? '/tmp/verso-smoke-owner.json';
const hostileText = '<script>window.__verso_smoke_xss = true</script>';
const content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: hostileText }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Заголовок по-русски' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Реальная проверка сохранения, владения и безопасного HTML.' }] },
  ],
};
let publication;
let current;
let mediaUrl;
let reportSubmitted = false;
let complete = false;

async function request(path, options = {}) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'Every smoke request must stay on the deployment origin');
  return fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25_000), ...options });
}

async function mutation(path, method, body, key, extraHeaders = {}) {
  return request(path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label}: unexpected HTTP status`);
  console.log(`PASS ${label}`);
  return response;
}

async function saveFixture() {
  assert.ok(publication && current, 'A private fixture requires a successful publication');
  const value = {
    format: 'verso-production-smoke-v1',
    origin,
    articleId: publication.article.id,
    editKey: publication.editKey,
    title: current.title,
    content: current.content,
    version: current.version,
    url: `${origin}/a/${publication.article.id}`,
    mediaUrl,
    reportSubmitted,
    createdAt: publication.article.createdAt,
    checkedAt: new Date().toISOString(),
  };
  const temporaryPath = `${fixturePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporaryPath, fixturePath);
  await chmod(fixturePath, 0o600);
}

if (process.env.CLEANUP_SMOKE_ARTICLE === '1') {
  let fixture;
  try { fixture = JSON.parse(await readFile(fixturePath, 'utf8')); }
  catch { throw new Error('The private smoke fixture is missing or invalid. Its contents were not printed.'); }
  assert.ok(fixture.format === 'verso-production-smoke-v1' && fixture.origin === origin, 'Cleanup fixture must belong to this deployment');
  assert.ok(/^[A-Za-z0-9]{12}$/.test(fixture.articleId), 'Cleanup fixture must contain a valid public article ID');
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(fixture.editKey), 'Cleanup fixture must contain a valid editing secret');
  const path = `/api/v1/articles/${fixture.articleId}`;
  const deleted = await mutation(path, 'DELETE', undefined, fixture.editKey);
  assert.ok([204, 404].includes(deleted.status), `Owner cleanup returned unexpected HTTP ${deleted.status}`);
  await expectStatus(await request(path), 404, 'retained smoke article no longer public');
  await unlink(fixturePath);
  console.log(`Retained article ${fixture.articleId} deleted and private owner fixture removed. No publication POST.`);
  process.exit(0);
}

if (process.env.VERIFY_SMOKE_ARTICLE === '1') {
  let fixture;
  try { fixture = JSON.parse(await readFile(fixturePath, 'utf8')); }
  catch { throw new Error('The private smoke fixture is missing or invalid. Its contents were not printed.'); }
  assert.ok(fixture.format === 'verso-production-smoke-v1' && fixture.origin === origin, 'Private fixture must belong to this deployment');
  assert.ok(/^[A-Za-z0-9]{12}$/.test(fixture.articleId), 'Private fixture must contain a valid public article ID');
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(fixture.editKey), 'Private fixture must contain a valid editing secret');
  await expectStatus(await request('/api/health'), 200, 'database readiness after restart/restore');
  const response = await expectStatus(await request(`/api/v1/articles/${fixture.articleId}`), 200, 'retained article after restart/restore');
  const saved = (await response.json()).article;
  assert.equal(saved.version, fixture.version, 'Publication version must survive restart/restore');
  assert.equal(saved.title, fixture.title, 'Publication title must survive restart/restore');
  assert.deepEqual(saved.content, fixture.content, 'Canonical document must survive restart/restore');
  await expectStatus(await request(`/api/v1/articles/${fixture.articleId}/ownership`, { headers: { Authorization: `Bearer ${fixture.editKey}` } }), 200, 'owner authorization after restart/restore');
  if (fixture.mediaUrl) {
    const media = await expectStatus(await request(fixture.mediaUrl), 200, 'media after restart/restore');
    const metadata = await sharp(Buffer.from(await media.arrayBuffer())).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 48);
    assert.equal(metadata.height, 32);
  }
  console.log(`Read-only continuity verification completed for article ${fixture.articleId}.`);
  process.exit(0);
}

try {
  await expectStatus(await request('/api/health'), 200, 'database readiness');

  if (process.env.RESUME_SMOKE_ARTICLE === '1') {
    let fixture;
    try { fixture = JSON.parse(await readFile(fixturePath, 'utf8')); }
    catch { throw new Error('The private smoke fixture is missing or invalid. Its contents were not printed.'); }
    assert.ok(fixture.format === 'verso-production-smoke-v1' && fixture.origin === origin, 'Resume fixture must belong to this deployment');
    publication = { article: { id: fixture.articleId, title: fixture.title, content: fixture.content, version: fixture.version, createdAt: fixture.createdAt }, editKey: fixture.editKey, url: fixture.url };
    current = publication.article;
    mediaUrl = fixture.mediaUrl;
    reportSubmitted = fixture.reportSubmitted;
    console.log(`Resuming existing article ${current.id}; no publication POST.`);
  } else {
    // Preserve a previous retained owner's credential file rather than silently
    // replacing the only local copy of its editing secret.
    try {
      await readFile(fixturePath);
      const previousPath = `${fixturePath}.${Date.now()}.previous`;
      await rename(fixturePath, previousPath);
      await chmod(previousPath, 0o600);
      console.log(`Previous private fixture preserved: ${previousPath}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const created = await expectStatus(await mutation('/api/v1/articles', 'POST', {
      title: `Проверка Verso ${new Date().toISOString()}`,
      schemaVersion: 1,
      content,
    }), 201, 'real article publication');
    publication = await created.json();
    current = publication.article;
  }
  assert.ok(/^[A-Za-z0-9]{12}$/.test(current.id), 'Public identifier must be 12-character Base62');
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(publication.editKey), 'Owner secret must be a 256-bit base64url value');
  assert.ok(publication.editKey !== current.id, 'Editing secret and public identifier must be independent');
  assert.equal(new URL(publication.url).origin, origin, 'Public URL must use the configured deployment origin');
  assert.equal(new URL(publication.url).pathname, `/a/${current.id}`, 'Public URL must use the article path');
  assert.ok(new URL(publication.url).search === '', 'Public URL must never include the editing secret');
  await saveFixture();

  const path = `/api/v1/articles/${current.id}`;
  const read = await expectStatus(await request(path), 200, 'public GET');
  const readPayload = await read.json();
  assert.equal(readPayload.article.id, current.id);
  assert.equal(readPayload.article.title, current.title);
  assert.ok(!JSON.stringify(readPayload).includes(publication.editKey), 'Public response must not expose editing secret');
  assert.ok(!('editKeyHash' in readPayload.article), 'Public response must not expose editing verifier');

  const changes = { title: `${current.title} · обновлено`, content, schemaVersion: 1, version: current.version };
  await expectStatus(await mutation(path, 'PATCH', changes), 401, 'PATCH without editing key denied');
  await expectStatus(await mutation(path, 'DELETE'), 401, 'DELETE without editing key denied');
  await expectStatus(await mutation(path, 'PATCH', changes, 'A'.repeat(43)), 401, 'PATCH with incorrect editing key denied');
  await expectStatus(await mutation(path, 'DELETE', undefined, 'A'.repeat(43)), 401, 'DELETE with incorrect editing key denied');
  await expectStatus(await mutation(path, 'PATCH', changes, publication.editKey, { Origin: 'https://foreign-origin.invalid' }), 403, 'cross-origin owner mutation denied');

  const updated = await expectStatus(await mutation(path, 'PATCH', changes, publication.editKey), 200, 'owner PATCH');
  current = (await updated.json()).article;
  assert.equal(current.id, publication.article.id, 'Owner update must preserve the public URL');
  assert.equal(current.version, publication.article.version + 1, 'Owner update must increment publication version');
  await saveFixture();
  const stale = await expectStatus(await mutation(path, 'PATCH', changes, publication.editKey), 409, 'stale-version write denied');
  assert.equal((await stale.json()).error.code, 'VERSION_CONFLICT');
  await expectStatus(await request(`${path}/ownership`, { headers: { Authorization: `Bearer ${publication.editKey}` } }), 200, 'owner-key verification');

  const image = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#737373' } }).png().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/png' }), 'verso-smoke.png');
  const uploaded = await expectStatus(await request('/api/v1/media', { method: 'POST', body: form }), 201, 'genuine image upload');
  mediaUrl = (await uploaded.json()).url;
  assert.ok(/^\/api\/v1\/media\/[A-Za-z0-9_-]{32}\.webp$/.test(mediaUrl), 'Storage URL must be a safe same-origin WebP route');
  const media = await expectStatus(await request(mediaUrl), 200, 'private-storage image retrieval');
  assert.equal(media.headers.get('content-type'), 'image/webp');
  const metadata = await sharp(Buffer.from(await media.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 48);
  assert.equal(metadata.height, 32);
  console.log('PASS uploaded pixels re-encoded as WebP');
  await saveFixture();

  const htmlResponse = await expectStatus(await request(`/a/${current.id}`), 200, 'server-rendered article');
  const html = await htmlResponse.text();
  assert.ok(html.includes('&lt;script&gt;window.__verso_smoke_xss = true&lt;/script&gt;'), 'Hostile article text must be escaped in SSR HTML');
  assert.ok(!html.includes(hostileText), 'Hostile article text must never become an executable HTML tag');
  assert.ok(html.includes('property="og:title"'), 'SSR must contain Open Graph metadata');
  assert.ok(html.includes('property="og:image"'), 'SSR must reference its Open Graph image');
  assert.ok(htmlResponse.headers.get('content-security-policy')?.includes("script-src 'self' 'nonce-"), 'SSR must use a nonce-based CSP');
  console.log('PASS literal hostile text, metadata and CSP');

  const og = await expectStatus(await request(`/a/${current.id}/og`), 200, 'Cyrillic-title Open Graph rendering');
  const ogMetadata = await sharp(Buffer.from(await og.arrayBuffer())).metadata();
  assert.equal(ogMetadata.width, 1200);
  assert.equal(ogMetadata.height, 630);
  assert.equal(ogMetadata.format, 'png');
  console.log('PASS Open Graph PNG is 1200 × 630');

  await expectStatus(await mutation(`${path}/reports`, 'POST', { reason: 'other', details: 'Authorized deployment smoke test; no moderation action required.' }), 201, 'report submission');
  reportSubmitted = true;
  await saveFixture();
  complete = true;
  console.log(`Production security smoke completed for article ${current.id}.`);
  console.log('Operator follow-up: verify its Report row in PostgreSQL by public article identifier.');
} finally {
  if (publication) {
    if (keep) {
      await saveFixture();
      console.log(`Retained smoke article: ${publication.article.id}`);
      console.log(`Private owner fixture: ${fixturePath} (mode 600; contains an editing secret).`);
    } else {
      const deleted = await mutation(`/api/v1/articles/${publication.article.id}`, 'DELETE', undefined, publication.editKey);
      await expectStatus(deleted, 204, 'owner DELETE of disposable article');
      await expectStatus(await request(`/api/v1/articles/${publication.article.id}`), 404, 'deleted article no longer public');
      await unlink(fixturePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  if (!complete) console.error('Production smoke stopped before completion. Private owner material was never printed.');
}
