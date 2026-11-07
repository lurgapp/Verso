import { getArticleRevision } from "@/lib/server/articles";
import { errorResponse, json, requirePublicId } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { requestEditKey } from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; version: string }> }): Promise<Response> {
  try {
    const { id, version } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "history", 120, 3600);
    return json({ revision: await getArticleRevision(id, requestEditKey(request), /^\d{1,10}$/u.test(version) ? Number(version) : NaN) });
  } catch (error) { return errorResponse(error); }
}
