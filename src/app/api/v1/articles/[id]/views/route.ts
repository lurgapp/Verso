import { recordArticleView } from '@/lib/server/article-metrics';
import { errorResponse, HttpError, json, readJson, requireMutationOrigin, requirePublicId } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    requireMutationOrigin(request);
    // Unlike public article reads, this write requires a real same-site Origin.
    if (!request.headers.get('origin')) throw new HttpError(403, 'ORIGIN_DENIED', 'This request origin is not allowed.');
    const { id } = await context.params;
    requirePublicId(id);
    const input = await readJson(request, 128);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new HttpError(400, 'INVALID_INPUT', 'Send an empty JSON object.');
    return json(await recordArticleView(request, id));
  } catch (error) { return errorResponse(error); }
}
