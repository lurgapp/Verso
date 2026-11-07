import { listArticleHistory } from "@/lib/server/articles";
import { errorResponse, json, requirePublicId } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { requestEditKey } from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "history", 120, 3600);
    return json({ versions: await listArticleHistory(id, requestEditKey(request)) });
  } catch (error) { return errorResponse(error); }
}
