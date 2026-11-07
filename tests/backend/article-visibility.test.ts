import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '@prisma/client';
import { parseArticleMutation, publicArticle } from '../../src/lib/server/articles';
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A legacy article remains readable.' }] }] };
const article = { internalId: '00000000-0000-4000-8000-000000000001', publicId: 'LegacyStory1', title: 'Legacy', content, html: '<p>A legacy article remains readable.</p>', format: 'tiptap-json', schemaVersion: 1, editKeyHash: 'a'.repeat(64), version: 1, status: 'PUBLISHED', createdAt: new Date('2026-10-12T12:00:00Z'), updatedAt: new Date('2026-10-12T12:00:00Z'), viewCount: 128, showViewCount: true } as Article;
test('view visibility is an optional strict boolean so older API clients can update safely', () => {
 assert.equal(parseArticleMutation({title:'Legacy',content,schemaVersion:1,version:1},true).showViewCount, undefined);
 assert.equal(parseArticleMutation({title:'Legacy',content,schemaVersion:1,showViewCount:false}).showViewCount, false);
 for (const showViewCount of [0,'false',null,{}]) assert.throws(() => parseArticleMutation({title:'Legacy',content,schemaVersion:1,showViewCount}));
});
test('hidden counters are omitted from the public API while reading estimate remains available', () => {
 const visible = publicArticle(article);
 assert.equal(visible.viewCount,128);
 assert.equal(visible.readingMinutes,1);
 assert.equal(visible.showViewCount,true);
 const hidden = publicArticle({...article,showViewCount:false});
 assert.equal(hidden.showViewCount,false);
 assert.equal(Object.hasOwn(hidden,'viewCount'),false);
 assert.equal(hidden.id,article.publicId);
 assert.equal(hidden.version,article.version);
 assert.equal(Object.hasOwn(hidden,'editKeyHash'),false);
});
