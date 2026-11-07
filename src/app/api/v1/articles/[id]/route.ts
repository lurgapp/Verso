import { revalidatePath } from "next/cache";
import { deleteArticle, getArticleRecord, MAX_ARTICLE_JSON_BYTES, publicArticle, updateArticle } from "@/lib/server/articles";
import { errorResponse, json, readJson, requireMutationOrigin, requirePublicId } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicBaseUrl, requestEditKey } from "@/lib/server/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "read", 180, 60);
    const article = publicArticle(await getArticleRecord(id));
    const etag = `"${article.id}-${article.version}-${article.showViewCount ? article.viewCount : "hidden"}"`;
    const headers = { "Cache-Control": "public, max-age=0, must-revalidate", ETag: etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return json({ article }, 200, headers);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    requireMutationOrigin(request);
    const { id } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "edit", 60, 3600);
    const article = await updateArticle(id, requestEditKey(request), await readJson(request, MAX_ARTICLE_JSON_BYTES));
    revalidatePath(`/a/${id}`);
    return json({ article, url: `${publicBaseUrl()}/a/${id}` });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    requireMutationOrigin(request);
    const { id } = await context.params;
    requirePublicId(id);
    await rateLimit(request, "delete", 20, 3600);
    await deleteArticle(id, requestEditKey(request));
    revalidatePath(`/a/${id}`);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
