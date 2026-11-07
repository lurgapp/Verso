import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createWithUniqueId } from "../../src/lib/server/articles";
import { hashEditKey, isAllowedOrigin, newEditKey, newPublicId, requestEditKey, verifyEditKey } from "../../src/lib/server/security";
import { HttpError, readBody, readJson } from "../../src/lib/server/http";

function withOriginEnvironment(environment: "development" | "production", publicUrl: string | undefined, check: () => void): void {
  const environmentVariables = process.env as Record<string, string | undefined>;
  const previousEnvironment = environmentVariables.NODE_ENV;
  const previousPublicUrl = environmentVariables.PUBLIC_BASE_URL;
  environmentVariables.NODE_ENV = environment;
  if (publicUrl === undefined) delete environmentVariables.PUBLIC_BASE_URL;
  else environmentVariables.PUBLIC_BASE_URL = publicUrl;
  try { check(); }
  finally {
    if (previousEnvironment === undefined) delete environmentVariables.NODE_ENV;
    else environmentVariables.NODE_ENV = previousEnvironment;
    if (previousPublicUrl === undefined) delete environmentVariables.PUBLIC_BASE_URL;
    else environmentVariables.PUBLIC_BASE_URL = previousPublicUrl;
  }
}

test("public identifiers use independent crypto-generated 12-character Base62 values", () => {
  const ids = new Set(Array.from({ length: 5000 }, newPublicId));
  assert.equal(ids.size, 5000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{12}$/u);
});

test("256-bit secrets verify only against SHA-256 hashes", () => {
  const key = newEditKey();
  const hash = hashEditKey(key);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(hash, /^[a-f0-9]{64}$/u);
  assert.equal(verifyEditKey(key, hash), true);
  assert.equal(verifyEditKey(newEditKey(), hash), false);
  assert.equal(verifyEditKey(null, hash), false);
  assert.equal(verifyEditKey(key, "invalid"), false);
  assert.equal(requestEditKey(new Request("http://localhost", { headers: { Authorization: `Bearer ${key}` } })), key);
  assert.equal(requestEditKey(new Request("http://localhost", { headers: { Authorization: "Bearer bad" } })), null);
});

test("public-ID collisions retry, unrelated database failures propagate", async () => {
  let attempts = 0;
  const value = await createWithUniqueId(async (id) => {
    if (++attempts < 3) throw new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "6.19.0", meta: { target: ["publicId"] } });
    return id;
  }, () => "ABCDEFGHIJKL");
  assert.equal(value, "ABCDEFGHIJKL");
  assert.equal(attempts, 3);
  await assert.rejects(() => createWithUniqueId(async () => { throw new Error("Connection lost"); }), /Connection lost/u);
  await assert.rejects(() => createWithUniqueId(async () => { throw new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "6.19.0", meta: { target: ["internalId"] } }); }));
});

test("CSRF policy permits same-origin and native clients while denying foreign browser origins", () => {
  const url = "http://localhost:3000/api/v1/articles";
  assert.equal(isAllowedOrigin(new Request(url, { headers: { Origin: "http://localhost:3000" } })), true);
  assert.equal(isAllowedOrigin(new Request(url)), true);
  assert.equal(isAllowedOrigin(new Request(url, { headers: { Origin: "https://evil.test" } })), false);
  assert.equal(isAllowedOrigin(new Request(url, { headers: { "Sec-Fetch-Site": "cross-site" } })), false);
  assert.equal(isAllowedOrigin(new Request(url, { headers: { Origin: "null" } })), false);
});

test("development mutation origins accept strict loopback aliases only on the actual protocol and port", () => {
  withOriginEnvironment("development", undefined, () => {
    const target = "http://localhost:3001/api/v1/media";
    for (const origin of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001"]) assert.equal(isAllowedOrigin(new Request(target, { headers: { Origin: origin } })), true, origin);
    assert.equal(isAllowedOrigin(new Request("http://127.0.0.1:3001/api/v1/media", { headers: { Origin: "http://localhost:3001" } })), true);
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "https://127.0.0.1:3001", "http://evil.test:3001", "http://localhost.evil.test:3001", "http://127.0.0.2:3001", "http://localhost.:3001"]) assert.equal(isAllowedOrigin(new Request(target, { headers: { Origin: origin } })), false, origin);
  });
});

test("production mutation origins remain restricted to the configured public origin", () => {
  withOriginEnvironment("production", "https://verso.example.test", () => {
    const target = "http://localhost:3001/api/v1/media";
    assert.equal(isAllowedOrigin(new Request(target, { headers: { Origin: "https://verso.example.test" } })), true);
    for (const origin of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001", "https://verso.example.test:8443", "https://evil.test"]) assert.equal(isAllowedOrigin(new Request(target, { headers: { Origin: origin } })), false, origin);
  });
  withOriginEnvironment("production", undefined, () => {
    assert.equal(isAllowedOrigin(new Request("http://localhost:3000/api/v1/media", { headers: { Origin: "http://localhost:3000" } })), false);
  });
});

test("JSON parser enforces content type and limits chunked bodies", async () => {
  await assert.rejects(() => readJson(new Request("http://localhost", { method: "POST", body: "{}" })), (error: unknown) => error instanceof HttpError && error.status === 415);
  assert.deepEqual(await readJson(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"title":"hello"}' })), { title: "hello" });
  await assert.rejects(() => readBody(new Request("http://localhost", { method: "POST", body: "123456789" }), 5), (error: unknown) => error instanceof HttpError && error.status === 413);
  await assert.rejects(() => readJson(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: "bad json" })), (error: unknown) => error instanceof HttpError && error.status === 400);
});
