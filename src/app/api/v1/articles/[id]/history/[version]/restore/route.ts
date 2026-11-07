import { revalidatePath } from "next/cache";
import { restoreArticleVersion } from "@/lib/server/articles";
import { errorResponse, json, readJson, requireMutationOrigin, requirePublicId } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicBaseUrl, requestEditKey } from "@/lib/server/security";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; version: string }> }): Promise<Response> {
  try {
    requireMutationOrigin(request);
    const { id, version } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "edit", 60, 3600);
    const article = await restoreArticleVersion(id, requestEditKey(request), /^\d{1,10}$/u.test(version) ? Number(version) : NaN, await readJson(request, 256));
    revalidatePath(`/a/${id}`);
    return json({ article, url: `${publicBaseUrl()}/a/${id}` });
  } catch (error) { return errorResponse(error); }
}
