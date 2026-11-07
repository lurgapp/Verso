import { errorResponse, HttpError, json, readBody, requireMutationOrigin } from "@/lib/server/http";
import { MAX_VIDEO_BYTES, uploadMedia } from "@/lib/server/media";
import { withMediaUpload } from "@/lib/server/media-process";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    requireMutationOrigin(request);
    return await withMediaUpload(async () => {
      await rateLimit(request, "upload", 20, 3600);
      await rateLimit(request, "uploadday", 60, 86400);
      const contentType = request.headers.get("content-type") ?? "";
      if (!/^multipart\/form-data;\s*boundary=/iu.test(contentType)) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Upload media using multipart/form-data.");
      const body = await readBody(request, MAX_VIDEO_BYTES + 64 * 1024);
      let form: FormData;
      try { form = await new Response(Uint8Array.from(body).buffer, { headers: { "Content-Type": contentType } }).formData(); }
      catch { throw new HttpError(400, "INVALID_INPUT", "This upload is invalid."); }
      const file = form.get("file");
      if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "file")) throw new HttpError(400, "INVALID_INPUT", "Provide one media file in the file field.");
      if (!file.size || file.size > MAX_VIDEO_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Videos must be no larger than 32 MB; images must be no larger than 8 MB.");
      const media = await uploadMedia(new Uint8Array(await file.arrayBuffer()));
      return json(media, 201);
    });
  } catch (error) { return errorResponse(error); }
}
