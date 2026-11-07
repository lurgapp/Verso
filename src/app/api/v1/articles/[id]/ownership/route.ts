import { getArticleRecord, requireOwner } from "@/lib/server/articles";
import { errorResponse, json, requirePublicId } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { requestEditKey } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "ownership", 90, 60);
    requireOwner(await getArticleRecord(id), requestEditKey(request));
    return json({ owner: true });
  } catch (error) { return errorResponse(error); }
}
