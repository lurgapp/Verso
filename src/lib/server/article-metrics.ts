import { createHmac } from 'node:crypto';
import { db } from './db';
import { HttpError, requirePublicId } from './http';

export const VIEW_WINDOW_SECONDS = 30 * 60;
const BUDGET_WINDOW_SECONDS = 10 * 60;
const MAXIMUM_VIEW_REQUESTS = 120;

/** This is traffic filtering, not a claim that automated traffic is impossible. */
export function isViewRequestEligible(request: Request): boolean {
  const agent = request.headers.get('user-agent') ?? '';
  if (!agent || /bot|spider|crawl|slurp|facebookexternalhit|facebookcatalog|telegram|whatsapp|discord|slack|pinterest|preview|headless|lighthouse|pagespeed|wget|curl/iu.test(agent)) return false;
  const purpose = `${request.headers.get('purpose') ?? ''} ${request.headers.get('sec-purpose') ?? ''}`;
  if (/prefetch|prerender/iu.test(purpose)) return false;
  const site = request.headers.get('sec-fetch-site');
  const destination = request.headers.get('sec-fetch-dest');
  return (site === null || site === 'same-origin') && (destination === null || destination === 'empty');
}

/** Keys cannot link one article or fixed time window to another. No raw IP is stored. */
export function viewRequestKey(request: Request, scope: 'article' | 'budget', articleId: string, now: number): { key: string; expiresAt: Date } {
  const secret = process.env.RATE_LIMIT_SECRET ?? (process.env.NODE_ENV !== 'production' ? 'verso-development-rate-limit-only' : '');
  if (secret.length < 16) throw new Error('View counting is not configured.');
  const seconds = scope === 'article' ? VIEW_WINDOW_SECONDS : BUDGET_WINDOW_SECONDS;
  const slot = Math.floor(now / (seconds * 1000));
  // The trusted private reverse proxy overwrites x-real-ip. Never accept a public forwarded chain.
  const address = (request.headers.get('x-real-ip') ?? 'unavailable-address').slice(0, 128);
  const digest = createHmac('sha256', secret).update(JSON.stringify(['verso-views-v1', scope, articleId, slot, address])).digest('hex');
  return { key: `view:${scope === 'article' ? 'a' : 'b'}:${digest}`, expiresAt: new Date((slot + 1) * seconds * 1000) };
}

type MetricsCleanup = { timer?: ReturnType<typeof setInterval>; running?: boolean };
const cleanupState = globalThis as typeof globalThis & { versoViewCleanup?: MetricsCleanup };

export async function cleanupExpiredViewKeys(): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'view:' }, expiresAt: { lte: new Date() } } });
}

function ensureExpiryCleanup(): void {
  const state = cleanupState.versoViewCleanup ??= {};
  const clean = async () => {
    if (state.running) return;
    state.running = true;
    try { await cleanupExpiredViewKeys(); }
    catch { /* Expired tokens never authorize counting; cleanup retries next minute. */ }
    finally { state.running = false; }
  };
  if (!state.timer) {
    // The deployed app is a long-running Node process. Keep purging even if article traffic stops.
    state.timer = setInterval(() => { void clean(); }, 60_000);
    state.timer.unref();
    void clean();
  }
}

type CounterRow = { internalId: string; viewCount: number; showViewCount: boolean };
export type ViewResult = { counted: boolean; viewCount?: number };

/** Aggregate accepted reads; publication version and modification date deliberately stay unchanged. */
export async function recordArticleView(request: Request, id: string, now = Date.now()): Promise<ViewResult> {
  requirePublicId(id);
  if (!isViewRequestEligible(request)) return { counted: false };
  ensureExpiryCleanup();
  const budget = viewRequestKey(request, 'budget', '', now);
  const budgetRows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${budget.key}, 1, ${budget.expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = LEAST("RateLimit"."count"::bigint + 1, 2147483647)::integer
    RETURNING "count"
  `;
  if ((budgetRows[0]?.count ?? MAXIMUM_VIEW_REQUESTS + 1) > MAXIMUM_VIEW_REQUESTS) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many view requests. Please try again later.', { 'Retry-After': String(Math.max(1, Math.ceil((budget.expiresAt.getTime() - now) / 1000))) });
  }
  const token = viewRequestKey(request, 'article', id, now);
  return db.$transaction(async (transaction) => {
    // Serialize the per-article decision with edits, deletion and other increments.
    const articles = await transaction.$queryRaw<CounterRow[]>`
      SELECT "internalId", "viewCount", "showViewCount" FROM "Article"
      WHERE "publicId" = ${id} AND "status" = 'PUBLISHED' FOR UPDATE
    `;
    const article = articles[0];
    if (!article) throw new HttpError(404, 'NOT_FOUND', 'This article could not be found.');
    const inserted = await transaction.$queryRaw<Array<{ key: string }>>`
      INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${token.key}, 1, ${token.expiresAt})
      ON CONFLICT ("key") DO NOTHING RETURNING "key"
    `;
    const counted = inserted.length > 0;
    if (counted) {
      const rows = await transaction.$queryRaw<CounterRow[]>`
        UPDATE "Article" SET "viewCount" = LEAST("viewCount"::bigint + 1, 2147483647)::integer
        WHERE "internalId" = ${article.internalId}::uuid RETURNING "internalId", "viewCount", "showViewCount"
      `;
      article.viewCount = rows[0].viewCount;
    }
    return { counted, ...(article.showViewCount ? { viewCount: article.viewCount } : {}) };
  });
}
