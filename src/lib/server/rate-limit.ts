import { db } from "./db";
import { HttpError } from "./http";
import { clientDigest } from "./security";

let cleanupTick = 0;

export async function rateLimit(request: Request, scope: string, maximum: number, windowSeconds: number): Promise<string> {
  const digest = clientDigest(request);
  const slot = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${scope}:${digest}:${slot}`;
  const expiresAt = new Date((slot + 1) * windowSeconds * 1000);
  const result = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"
  `;
  if (++cleanupTick % 256 === 0) {
    // Best effort housekeeping; request limiting itself always fails closed.
    void db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  }
  if ((result[0]?.count ?? maximum + 1) > maximum) throw new HttpError(429, "RATE_LIMITED", "Too many requests. Please try again later.", { "Retry-After": String(Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))) });
  return digest;
}
