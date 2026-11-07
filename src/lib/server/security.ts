import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{12}$/u;
export const EDIT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const generatePublicId = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 12);

export function newPublicId(): string { return generatePublicId(); }
export function newEditKey(): string { return randomBytes(32).toString("base64url"); }
export function hashEditKey(key: string): string { return createHash("sha256").update(key).digest("hex"); }

export function verifyEditKey(key: string | null, expectedHash: string): boolean {
  if (!key || !EDIT_KEY_PATTERN.test(key) || !/^[a-f0-9]{64}$/u.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(hashEditKey(key), "hex"), Buffer.from(expectedHash, "hex"));
}

export function requestEditKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const key = authorization.slice(7);
  return EDIT_KEY_PATTERN.test(key) ? key : null;
}

export function publicBaseUrl(): string {
  const value = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  const url = new URL(value);
  if ((process.env.NODE_ENV === "production" && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid public URL configuration.");
  return url.origin;
}

export function clientDigest(request: Request): string {
  const secret = process.env.RATE_LIMIT_SECRET ?? (process.env.NODE_ENV !== "production" ? "verso-development-rate-limit-only" : "");
  if (secret.length < 16) throw new Error("Rate limiting is not configured.");
  // The app listens on a private network. Its reverse proxy MUST overwrite this
  // header; forwarding arbitrary client-supplied headers would bypass limits.
  const address = request.headers.get("x-real-ip") ?? "unavailable-address";
  return createHmac("sha256", secret).update(address.slice(0, 128)).digest("hex");
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!origin) return site === null || site === "same-origin" || site === "none";
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    // The development URL fallback is useful for generated links, but must not
    // authorize localhost:3000 against a dev server running on another port.
    if (process.env.PUBLIC_BASE_URL && origin === publicBaseUrl()) return true;
    if (process.env.NODE_ENV === "production") return false;
    const target = new URL(request.url);
    if (origin === target.origin) return true;
    // Next.js can canonicalize the request hostname to localhost while the
    // browser is opened at 127.0.0.1. This alias exception stays dev-only and
    // requires both the actual protocol and port to match.
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return loopbackHosts.has(parsed.hostname) && loopbackHosts.has(target.hostname) && parsed.protocol === target.protocol && parsed.port === target.port;
  } catch { return false; }
}
