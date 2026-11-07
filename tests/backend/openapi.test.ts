import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../../src/app/api/v1/openapi/route";

test("OpenAPI exposes owner-protected history, bounded previews and responsive upload metadata", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const api = await response.json();
  assert.equal(api.openapi, "3.1.0");
  assert.equal(api.info.version, "2.0.0");
  for (const path of ["/api/v1/articles/{id}/history", "/api/v1/articles/{id}/history/{version}", "/api/v1/articles/{id}/history/{version}/restore"]) {
    const operation = api.paths[path].get || api.paths[path].post;
    assert.deepEqual(operation.security, [{ editingKey: [] }]);
  }
  assert.ok(api.paths["/api/v1/link-preview"].post.responses["503"]);
  assert.equal(api.components.schemas.UploadedMedia.properties.thumbnailWidth.maximum, 480);
  assert.equal(api.components.schemas.ImageAttributes.properties.sourceWidth.maximum, 2400);
  assert.equal(api.components.schemas.ArticleRevision.properties.schemaVersion.const, 1);
  assert.ok(api.components.schemas.DocumentNode.properties.type.enum.includes("mermaid"));
  assert.ok(api.components.schemas.DocumentNode.properties.marks.items.properties.type.enum.includes("highlight"));
  const references: string[] = [];
  const visit = (value: unknown) => { if (!value || typeof value !== "object") return; for (const [key, entry] of Object.entries(value)) { if (key === "$ref") references.push(String(entry)); else visit(entry); } };
  visit(api);
  for (const reference of references) { assert.ok(reference.startsWith("#/components/schemas/")); assert.ok(api.components.schemas[reference.slice("#/components/schemas/".length)], reference); }
});
