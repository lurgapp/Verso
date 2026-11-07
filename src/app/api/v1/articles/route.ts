import { createArticle, MAX_ARTICLE_JSON_BYTES } from "@/lib/server/articles";
import { errorResponse, json, readJson, requireMutationOrigin } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicBaseUrl } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    requireMutationOrigin(request);
    await rateLimit(request, "publish", 8, 3600);
    await rateLimit(request, "publishday", 25, 86400);
    const result = await createArticle(await readJson(request, MAX_ARTICLE_JSON_BYTES));
    return json({ ...result, url: `${publicBaseUrl()}/a/${result.article.id}` }, 201);
  } catch (error) { return errorResponse(error); }
}
