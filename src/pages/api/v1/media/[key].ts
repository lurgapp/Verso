import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { errorResponse } from "@/lib/server/http";
import { imageResponse } from "@/lib/server/media";
import { rateLimit } from "@/lib/server/rate-limit";

// Write validated S3 bytes through the Node response so HEAD and Range retain
// their exact lengths. App Router strips framing headers from Web Responses.
export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function media(request: NextApiRequest, response: NextApiResponse) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.setHeader("Cache-Control", "no-store");
    response.status(405).end();
    return;
  }
  const headers = new Headers();
  for (const name of ["x-real-ip", "range", "if-range", "if-none-match"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
    else if (value) headers.set(name, value.join(","));
  }
  const input = new Request("http://localhost/api/v1/media", { method: request.method, headers });
  let result: Response;
  try {
    await rateLimit(input, "mediaread", 360, 60);
    result = await imageResponse(input, typeof request.query.key === "string" ? request.query.key : "");
  } catch (error) {
    result = errorResponse(error);
  }
  response.statusCode = result.status;
  // Headers come exclusively from Verso's media/error builders, never from an
  // arbitrary fetched response. Length is derived from validated stored data.
  result.headers.forEach((value, name) => response.setHeader(name, value));
  if (request.method === "HEAD" || !result.body) {
    await result.body?.cancel();
    response.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(result.body as import("node:stream/web").ReadableStream), response);
  } catch {
    // A partial response cannot be replaced with JSON or another media body.
    response.destroy();
  }
}
