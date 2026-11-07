import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLinkPreview, isPublicAddress, metadataFromHtml, previewUrl, type PreviewDependencies } from "../../src/lib/server/link-preview";
import { HttpError } from "../../src/lib/server/http";
const publicAddress = { address: "93.184.216.34", family: 4 };
const html = '<title>Fallback &amp; title</title><meta property="og:title" content="A &quot;good&quot; page"><meta name="description" content="Description"><meta property="og:image" content="/image.png">';

test("preview address policy rejects private, reserved, mapped and metadata targets", () => {
  for (const ip of ["0.0.0.0", "10.0.0.1", "127.1.2.3", "100.64.1.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff00::1", "64:ff9b::7f00:1", "2001:db8::1", "2002:7f00:1::", "2001::1", "3fff::1"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const url of ["http://example.com", "https://localhost", "https://metadata.google.internal", "https://127.1", "https://2130706433", "https://0x7f000001", "https://[::1]/", "https://user:secret@example.com", "https://example.com:8443", "https://example.com./", "file:///etc/passwd"]) assert.throws(() => previewUrl(url), HttpError, url);
});

test("HTML metadata parser decodes entities and resolves optional images without fetching them", () => {
  assert.deepEqual(metadataFromHtml(html, new URL("https://example.com/page")), { url: "https://example.com/page", title: 'A "good" page', description: "Description", image: "https://example.com/image.png" });
  const noImage = metadataFromHtml('<title>Readable &amp; safe</title><meta property="og:image" content="http://169.254.169.254/a">', new URL("https://example.com/"));
  assert.equal(noImage.title, "Readable & safe"); assert.equal(noImage.image, undefined);
});

test("DNS validation checks every answer and pins the chosen public IP to the request", async () => {
  let requests = 0;
  const dependencies: PreviewDependencies = { lookup: async () => [publicAddress], request: async (url, address) => { requests++; assert.equal(url.hostname, "example.com"); assert.deepEqual(address, publicAddress); return { status: 200, headers: { "content-type": "text/html" }, body: html }; } };
  const result = await fetchLinkPreview("https://example.com/page#section", dependencies);
  assert.equal(result.url, "https://example.com/page"); assert.equal(requests, 1);
  await assert.rejects(fetchLinkPreview("https://example.com", { ...dependencies, lookup: async () => [publicAddress, { address: "127.0.0.1", family: 4 }] }), (error: unknown) => error instanceof HttpError && error.status === 400);
  assert.equal(requests, 1, "Mixed public/private DNS never connects");
});

test("redirect destinations are resolved and revalidated before connecting", async () => {
  const connected: string[] = [], resolved: string[] = [];
  const dependencies: PreviewDependencies = {
    lookup: async (hostname) => { resolved.push(hostname); return hostname === "private.example.com" ? [{ address: "10.1.1.1", family: 4 }] : [publicAddress]; },
    request: async (url) => { connected.push(url.hostname); return { status: 302, headers: { location: "https://private.example.com/secret" }, body: "" }; },
  };
  await assert.rejects(fetchLinkPreview("https://example.com", dependencies), HttpError);
  assert.deepEqual(connected, ["example.com"]); assert.deepEqual(resolved, ["example.com", "private.example.com"]);
  await assert.rejects(fetchLinkPreview("https://example.com", { ...dependencies, request: async () => ({ status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" }, body: "" }) }), HttpError);
});

test("redirect loops, response limits and network failures produce a bounded safe error", async () => {
  let count = 0;
  const dependencies: PreviewDependencies = { lookup: async () => [publicAddress], request: async () => { count++; return { status: 302, headers: { location: "/again" }, body: "" }; } };
  await assert.rejects(fetchLinkPreview("https://example.com", dependencies), HttpError); assert.equal(count, 4);
  await assert.rejects(fetchLinkPreview("https://example.com", { ...dependencies, request: async () => ({ status: 200, headers: {}, body: "x".repeat(256 * 1024 + 1) }) }), HttpError);
  await assert.rejects(fetchLinkPreview("https://example.com", { ...dependencies, request: async () => { throw new Error("private diagnostic"); } }), (error: unknown) => error instanceof HttpError && error.message.includes("normal link") && !error.message.includes("private diagnostic"));
});


test("global preview admission bounds DNS and TLS requests and releases every slot", async () => {
  let releaseDns!: (value: { address: string; family: number }[]) => void;
  let releaseRequest!: (value: { status: number; headers: Record<string, string>; body: string }) => void;
  let connected = 0;
  const dns = new Promise<{ address: string; family: number }[]>(resolve => { releaseDns = resolve; });
  const response = new Promise<{ status: number; headers: Record<string, string>; body: string }>(resolve => { releaseRequest = resolve; });
  const first = fetchLinkPreview("https://example.com/first", { lookup: () => dns, request: async () => { connected++; return { status: 200, headers: {}, body: html }; } });
  const second = fetchLinkPreview("https://example.com/second", { lookup: async () => [publicAddress], request: async () => { connected++; return response; } });
  const immediate = { lookup: async () => [publicAddress], request: async () => { connected++; return { status: 200, headers: {}, body: html }; } };
  try {
    await assert.rejects(fetchLinkPreview("https://example.com/third", immediate), (error: unknown) => error instanceof HttpError && error.status === 503 && error.code === "PREVIEW_BUSY" && error.headers["Retry-After"] === "3");
    assert.equal(connected, 1, "Only the admitted TLS request connects while another slot is resolving DNS");
    releaseDns([publicAddress]);
    await first;
    assert.equal((await fetchLinkPreview("https://example.com/after-success", immediate)).title, 'A "good" page');
    await assert.rejects(fetchLinkPreview("https://example.com/dns-error", { ...immediate, lookup: async () => { throw new Error("DNS failure"); } }), HttpError);
    await assert.rejects(fetchLinkPreview("https://example.com/request-error", { ...immediate, request: async () => { throw new Error("TLS failure"); } }), HttpError);
    await assert.rejects(fetchLinkPreview("https://example.com/private", { ...immediate, lookup: async () => [{ address: "127.0.0.1", family: 4 }] }), HttpError);
    assert.equal((await fetchLinkPreview("https://example.com/after-failures", immediate)).title, 'A "good" page');
  } finally {
    releaseDns([publicAddress]);
    releaseRequest({ status: 200, headers: {}, body: html });
    await Promise.allSettled([first, second]);
  }
  assert.equal((await fetchLinkPreview("https://example.com/final", immediate)).title, 'A "good" page');
});
