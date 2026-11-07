import { DocumentValidationError } from "../document";
import { isAllowedOrigin } from "./security";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) { super(message); }
}

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status, error.headers);
  if (error instanceof DocumentValidationError) return json({ error: { code: "INVALID_DOCUMENT", message: error.message } }, 400);
  // Never log request bodies, ownership keys, database URLs or raw IPs.
  console.error("Verso request failed", error instanceof Error ? error.name : "UnknownError");
  return json({ error: { code: "UNAVAILABLE", message: "The service is temporarily unavailable. Please try again." } }, 503);
}

export function requireMutationOrigin(request: Request): void {
  if (!isAllowedOrigin(request)) throw new HttpError(403, "ORIGIN_DENIED", "This request origin is not allowed.");
}

export async function readBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function readJson(request: Request, maximumBytes = 512 * 1024): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send an application/json request.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBody(request, maximumBytes)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_JSON", "The request contains invalid JSON.");
  }
}

export function requirePublicId(id: string): void {
  if (!/^[A-Za-z0-9]{12}$/u.test(id)) throw new HttpError(404, "NOT_FOUND", "This article could not be found.");
}
