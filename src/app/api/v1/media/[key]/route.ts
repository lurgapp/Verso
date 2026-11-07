import { errorResponse } from "@/lib/server/http";
import { imageResponse } from "@/lib/server/media";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    await rateLimit(request, "mediaread", 360, 60);
    return await imageResponse(request, (await context.params).key);
  } catch (error) { return errorResponse(error); }
}

export const HEAD = GET;
