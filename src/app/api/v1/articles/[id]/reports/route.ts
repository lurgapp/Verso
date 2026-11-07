import { z } from "zod";
import { getArticleRecord } from "@/lib/server/articles";
import { db } from "@/lib/server/db";
import { errorResponse, HttpError, json, readJson, requireMutationOrigin, requirePublicId } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
const reportSchema = z.object({ reason: z.enum(["spam", "illegal", "harmful", "copyright", "other"]), details: z.string().trim().max(2000).optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireMutationOrigin(request);
    const { id } = await context.params;
    requirePublicId(id);
    const digest = await rateLimit(request, "reports", 5, 86400);
    const result = reportSchema.safeParse(await readJson(request, 16 * 1024));
    if (!result.success) throw new HttpError(400, "INVALID_INPUT", "Provide a valid report reason and up to 2000 characters of details.");
    const article = await getArticleRecord(id);
    await db.report.create({ data: { articleId: article.internalId, reason: result.data.reason, details: result.data.details, reporterDigest: digest } });
    return json({ received: true }, 201);
  } catch (error) { return errorResponse(error); }
}
