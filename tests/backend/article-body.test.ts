import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ARTICLE_JSON_BYTES } from "../../src/lib/server/articles";
import { HttpError, readJson } from "../../src/lib/server/http";
const request = (body: string) => new Request("http://127.0.0.1/api/v1/articles", { method: "POST", headers: { "content-type": "application/json" }, body });

test("the bounded article body supports long Cyrillic text while unrelated JSON keeps the smaller default", async () => {
  const body = JSON.stringify({ text: "я".repeat(500000) });
  assert.ok(Buffer.byteLength(body, "utf8") > 512 * 1024);
  assert.equal(MAX_ARTICLE_JSON_BYTES, 2 * 1024 * 1024);
  assert.equal((await readJson(request(body), MAX_ARTICLE_JSON_BYTES) as { text: string }).text.length, 500000);
  await assert.rejects(readJson(request(body)), (error: unknown) => error instanceof HttpError && error.status === 413);
  await assert.rejects(readJson(request(JSON.stringify({ text: "я".repeat(MAX_ARTICLE_JSON_BYTES / 2) })), MAX_ARTICLE_JSON_BYTES), (error: unknown) => error instanceof HttpError && error.status === 413);
});
