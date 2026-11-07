export type VideoProvider = "youtube" | "vimeo" | "rutube" | "file";
export type VideoAttributes = { provider: VideoProvider; src: string; posterSrc?: string | null };

export function isUploadedPoster(value: unknown): value is string {
  return typeof value === "string" && /^\/api\/v1\/media\/[A-Za-z0-9_-]{32}\.webp$/u.test(value);
}

/** These URLs can contain animation; extensionless remote image URLs are conservative. */
export function mayAnimateImage(src: string, animated?: unknown): boolean {
  if (animated === true) return true;
  if (src.startsWith("/api/v1/media/")) return false;
  try { return !/\.(?:jpe?g|avif|svg)$/iu.test(new URL(src).pathname); } catch { return false; }
}

export const VIDEO_FRAME_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://rutube.ru",
] as const;

const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const youtubeEmbedHosts = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
const vimeoHosts = new Set(["vimeo.com", "www.vimeo.com"]);
const rutubeHosts = new Set(["rutube.ru", "www.rutube.ru"]);
const youtubeId = /^[A-Za-z0-9_-]{11}$/u;

/** Normalize supported URLs locally. This helper never requests their content. */
export function normaliseVideoUrl(input: string): VideoAttributes | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  if (/^\/api\/v1\/media\/[A-Za-z0-9_-]{32}\.(?:mp4|webm)$/u.test(value)) return { provider: "file", src: value };
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname) return null;
  const host = url.hostname;
  const path = url.pathname;

  if (host === "youtu.be" || youtubeHosts.has(host) || youtubeEmbedHosts.has(host)) {
    let id: string | null = null;
    if (host === "youtu.be") id = path.match(/^\/([A-Za-z0-9_-]{11})\/?$/u)?.[1] ?? null;
    else if (youtubeHosts.has(host) && /^\/watch\/?$/u.test(path) && url.searchParams.getAll("v").length === 1) id = url.searchParams.get("v");
    else if (youtubeHosts.has(host)) id = path.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})\/?$/u)?.[1] ?? null;
    else id = path.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/u)?.[1] ?? null;
    if (!id || !youtubeId.test(id)) return null;
    return { provider: "youtube", src: `${VIDEO_FRAME_ORIGINS[0]}/embed/${id}` };
  }

  if (vimeoHosts.has(host) || host === "player.vimeo.com") {
    // Private Vimeo videos can depend on an h= token. Never discard an unknown
    // query and turn a working private URL into a different public embed.
    if (url.search || url.hash) return null;
    const match = host === "player.vimeo.com" ? path.match(/^\/video\/([1-9][0-9]{0,19})\/?$/u) : path.match(/^\/([1-9][0-9]{0,19})\/?$/u);
    if (!match) return null;
    return { provider: "vimeo", src: `${VIDEO_FRAME_ORIGINS[1]}/video/${match[1]}` };
  }

  if (rutubeHosts.has(host)) {
    // Private/limited-access RuTube links can carry query access keys.
    if (url.search || url.hash) return null;
    const id = path.match(/^\/(?:video|play\/embed)\/([A-Fa-f0-9]{32})\/?$/u)?.[1];
    if (!id) return null;
    return { provider: "rutube", src: `${VIDEO_FRAME_ORIGINS[2]}/play/embed/${id.toLowerCase()}/` };
  }

  if (/\.(?:mp4|webm|ogv)$/iu.test(path)) return { provider: "file", src: url.href };
  return null;
}

/** Require an exact, canonical provider/src pair before storing or rendering. */
export function isCanonicalVideo(input: unknown): input is VideoAttributes {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["provider", "src", "posterSrc"].includes(key)) || typeof value.src !== "string" || typeof value.provider !== "string") return false;
  if (value.posterSrc != null && (value.provider !== "file" || !isUploadedPoster(value.posterSrc))) return false;
  const canonical = normaliseVideoUrl(value.src);
  return !!canonical && canonical.src === value.src && canonical.provider === value.provider;
}
