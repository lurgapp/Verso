import { z } from "zod";
import { errorResponse, HttpError, json, readJson, requireMutationOrigin } from "@/lib/server/http";
import { fetchLinkPreview } from "@/lib/server/link-preview";
import { rateLimit } from "@/lib/server/rate-limit";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    requireMutationOrigin(request);
    await rateLimit(request, "linkpreview", 20, 3600);
    const input = z.object({ url: z.string().max(2048) }).strict().safeParse(await readJson(request, 4096));
    if (!input.success) throw new HttpError(400, "INVALID_INPUT", "Provide a public HTTPS page URL.");
    return json({ preview: await fetchLinkPreview(input.data.url) });
  } catch (error) { return errorResponse(error); }
}
