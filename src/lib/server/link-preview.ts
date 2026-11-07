import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { Parser } from "htmlparser2";
import { HttpError } from "./http";

export const PREVIEW_MAX_BYTES = 256 * 1024;
export const PREVIEW_TIMEOUT_MS = 4000;
export const MAX_PREVIEW_REQUESTS = 2;
let activePreviews = 0;
export type LinkPreview = { url: string; title: string; description: string; image?: string };
type Address = { address: string; family: number };
export type PreviewDependencies = {
  lookup: (hostname: string) => Promise<Address[]>;
  request: (url: URL, address: Address, remainingMs: number) => Promise<{ status: number; headers: Record<string, string | undefined>; body: string }>;
};

/** Conservative global-unicast allowlist; mapped IPv4 and all special IPv6 ranges fail closed. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b, c] = parts;
    if ([0, 10, 127].includes(a) || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  // Native global unicast only. This excludes loopback, link/site local, multicast,
  // NAT64 and IPv4-mapped addresses without relying on text-prefix substitutions.
  const first = Number.parseInt(lower.split(":")[0], 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff || lower.startsWith("2002:") || lower.startsWith("3fff:")) return false;
  if (lower.startsWith("2001:")) {
    const second = Number.parseInt(lower.split(":")[1] || "0", 16);
    if (second < 0x200 || second === 0xdb8) return false;
  }
  return true;
}

export function previewUrl(input: unknown): URL {
  if (typeof input !== "string" || input.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(input)) throw new HttpError(400, "INVALID_URL", "Provide a public HTTPS page URL.");
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError(400, "INVALID_URL", "Provide a public HTTPS page URL."); }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hostname || hostname.endsWith(".") || (!hostname.includes(".") && !isIP(hostname)) || /(?:^|\.)(?:localhost|local|internal|home|invalid|test|onion)$/u.test(hostname) || (isIP(hostname) && !isPublicAddress(hostname))) throw new HttpError(400, "INVALID_URL", "Only public HTTPS page URLs are supported.");
  url.hash = "";
  return url;
}

async function boundedHttps(url: URL, address: Address, remainingMs: number) {
  return new Promise<{ status: number; headers: Record<string, string | undefined>; body: string }>((resolve, reject) => {
    const request = https.request(url, {
      method: "GET", maxHeaderSize: 16 * 1024, family: address.family,
      headers: { "User-Agent": "VersoLinkPreview/2.0", Accept: "text/html,application/xhtml+xml;q=0.9", "Accept-Encoding": "identity" },
      // The connection uses the exact validated DNS answer. HTTPS still verifies
      // the original hostname; no second DNS lookup can rebind it to a private IP.
      lookup: ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null, address.address, address.family)) as never,
      agent: false,
    }, (response) => {
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(response.headers)) headers[key] = Array.isArray(value) ? value[0] : value;
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) { response.destroy(); resolve({ status, headers, body: "" }); return; }
      if (!/^text\/html(?:;|$)|^application\/xhtml\+xml(?:;|$)/iu.test(headers["content-type"] ?? "") || (headers["content-encoding"] && headers["content-encoding"] !== "identity") || Number(headers["content-length"] ?? 0) > PREVIEW_MAX_BYTES) {
        response.destroy(); reject(new HttpError(422, "PREVIEW_UNAVAILABLE", "The page cannot be previewed.")); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > PREVIEW_MAX_BYTES) { response.destroy(); reject(new HttpError(422, "PREVIEW_UNAVAILABLE", "The page is too large to preview.")); }
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new Error("Preview timed out")), remainingMs);
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });
}

const defaults: PreviewDependencies = { lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }), request: boundedHttps };

export function metadataFromHtml(html: string, page: URL): LinkPreview {
  const meta = new Map<string, string>(); let inTitle = false; let title = "";
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "title") inTitle = true;
      if (name === "meta") {
        const key = (attrs.property || attrs.name || "").toLowerCase();
        if (["og:title", "og:description", "description", "og:image", "twitter:title", "twitter:description", "twitter:image"].includes(key) && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
      }
    },
    ontext(text) { if (inTitle && title.length < 1000) title += text; },
    onclosetag(name) { if (name === "title") inTitle = false; },
  }, { decodeEntities: true });
  parser.write(html.slice(0, PREVIEW_MAX_BYTES)); parser.end();
  const clean = (value: string, limit: number) => value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
  const result: LinkPreview = { url: page.href, title: clean(meta.get("og:title") || meta.get("twitter:title") || title || page.hostname, 300), description: clean(meta.get("og:description") || meta.get("twitter:description") || meta.get("description") || "", 1000) };
  const image = meta.get("og:image") || meta.get("twitter:image");
  if (image) {
    try {
      const url = previewUrl(new URL(image, page).href);
      // Images are never fetched server-side. Literal private targets are still
      // excluded so readers are not directed to obvious internal resources.
      result.image = url.href;
    } catch { /* Metadata images are optional. */ }
  }
  return result;
}

export async function fetchLinkPreview(input: unknown, dependencies: PreviewDependencies = defaults): Promise<LinkPreview> {
  let url = previewUrl(input);
  if (activePreviews >= MAX_PREVIEW_REQUESTS) throw new HttpError(503, "PREVIEW_BUSY", "Link previews are busy. Please try again shortly.", { "Retry-After": "3" });
  // Admission covers DNS, all redirects and TLS/body reads; no unbounded queue.
  activePreviews++;
  const deadline = Date.now() + PREVIEW_TIMEOUT_MS;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const hostname = url.hostname.replace(/^\[|\]$/gu, "");
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
        dependencies.lookup(hostname),
        new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(new Error("DNS timed out")), Math.max(1, deadline - Date.now())); timeout.unref(); }),
      ]);
      if (!addresses.length || addresses.some((address) => !isPublicAddress(address.address))) throw new HttpError(400, "INVALID_URL", "This host is not available for link previews.");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Preview timed out");
      const response = await dependencies.request(url, addresses[0], remaining);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3 || !response.headers.location) throw new Error("Too many redirects");
        url = previewUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (response.status < 200 || response.status >= 300 || Buffer.byteLength(response.body, "utf8") > PREVIEW_MAX_BYTES) throw new Error("Page unavailable");
      return metadataFromHtml(response.body, url);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, "PREVIEW_UNAVAILABLE", "This page could not be previewed. You can insert a normal link instead.");
  } finally {
    activePreviews--;
  }
  throw new HttpError(422, "PREVIEW_UNAVAILABLE", "This page could not be previewed.");
}
