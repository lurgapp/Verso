import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, Plugin } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { textStatistics } from '../../src/lib/writing-stats';
import { findMatches, findReplaceKey, replaceSearchMatches, type SearchState } from '../../src/components/find-replace-extension';

const schema = new Schema({ nodes:{doc:{content:'block+'},paragraph:{group:'block',content:'inline*'},blockquote:{group:'block',content:'block+'},text:{group:'inline'},hardBreak:{inline:true,group:'inline'}},marks:{bold:{}} });
test('Unicode statistics correctly segment Russian and English, headings, sentences and links',()=>{
  const result=textStatistics({type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Новая статья'}]},{type:'paragraph',content:[{type:'text',text:'Привет, мир! Hello world.',marks:[{type:'link',attrs:{href:'https://lurg.pro'}}]}]}]},'ru');
  assert.equal(result.words,6);assert.equal(result.headings,1);assert.equal(result.paragraphs,1);assert.equal(result.sentences,3);assert.equal(result.links,1);assert.equal(result.readingMinutes,1);assert.equal(result.charactersWithoutSpaces,[...'НоваястатьяПривет,мир!Helloworld.'].length);
});
test('empty writing statistics do not claim reading time',()=>{
  assert.deepEqual(textStatistics({type:'doc',content:[{type:'paragraph'}]}),{words:0,characters:0,charactersWithoutSpaces:0,paragraphs:0,sentences:0,readingMinutes:0,headings:0,links:0});
});
test('search crosses inline mark boundaries and retains accurate Unicode offsets inside nested blocks',()=>{
  const paragraph=schema.nodes.paragraph.create(null,[schema.text('😀 При'),schema.text('вет',[schema.marks.bold.create()]),schema.text(' мир. ПРИВЕТ!')]);
  const document=schema.nodes.doc.create(null,schema.nodes.blockquote.create(null,paragraph));
  assert.deepEqual(findMatches(document,'привет'),[{from:5,to:11},{from:17,to:23}]);
  assert.equal(findMatches(document,'Привет',true).length,1);
  assert.equal(findMatches(document,'ПРИВЕТ',true).length,1);
});
test('literal search prevents regex injection and never merges adjacent paragraphs',()=>{
  const document=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('a.*b [x]')]),schema.node('paragraph',null,[schema.text('second')])]);
  assert.equal(findMatches(document,'.*').length,1);assert.equal(findMatches(document,'[x]').length,1);assert.equal(findMatches(document,'[x]second').length,0);
});
test('search is bounded for large documents',()=>{
  const document=schema.node('doc',null,[schema.node('paragraph',null,[schema.text('a'.repeat(8000))])]);assert.equal(findMatches(document,'a').length,2000);assert.deepEqual(findMatches(document,'x'.repeat(501)),[]);
});
test('replace all is one undo operation and preserves nested block structure',()=>{
  const document=schema.node('doc',null,[schema.node('blockquote',null,[schema.node('paragraph',null,[schema.text('one '),schema.text('one',[schema.marks.bold.create()])])]),schema.node('paragraph',null,[schema.text('one')])]);
  const matches=findMatches(document,'one');
  let state=EditorState.create({schema,doc:document,plugins:[history(),new Plugin<SearchState>({key:findReplaceKey,state:{init:()=>({query:'one',caseSensitive:false,index:0,matches,decorations:DecorationSet.empty}),apply:(_transaction,previous)=>previous}})]});
  const editor={get state(){return state;},view:{dispatch(transaction:Parameters<typeof state.apply>[0]){state=state.apply(transaction);}}} as unknown as Editor;
  replaceSearchMatches(editor,'two',true);assert.equal(state.doc.textContent,'two twotwo');assert.equal(state.doc.firstChild?.type.name,'blockquote');assert.equal(state.doc.childCount,2);
  assert.ok(undo(state,transaction=>{state=state.apply(transaction);}));assert.deepEqual(state.doc.toJSON(),document.toJSON());
});


test('one link split by formatting is counted once, separate links remain distinct',()=>{
 const result=textStatistics({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'linked ',marks:[{type:'link',attrs:{href:'https://lurg.pro'}}]},{type:'text',text:'bold',marks:[{type:'link',attrs:{href:'https://lurg.pro'}},{type:'bold'}]},{type:'text',text:' plain '},{type:'text',text:'linked again',marks:[{type:'link',attrs:{href:'https://lurg.pro'}}]}]}]});assert.equal(result.links,2);
});

test('canonical HTML export preserves math, table and footnotes while escaping executable text',async()=>{
 const {exportDocumentBody,completeHtmlDocument}=await import('../../src/lib/client/document-export');
 const content={type:'doc' as const,content:[{type:'paragraph',content:[{type:'text',text:'<img src=x onerror=alert(1)>'},{type:'mathInline',attrs:{latex:'E=mc^2'}},{type:'footnote',attrs:{id:'note-1',text:'Сноска <script>bad</script>'}}]},{type:'mathBlock',attrs:{latex:'x^2',numbered:true,id:'eq-first'}},{type:'mathBlock',attrs:{latex:'y^2',numbered:true,id:'eq-second'}}]};
 const html=await exportDocumentBody(content);assert.ok(html.includes('<math'));assert.ok(html.includes('Сноска &lt;script&gt;bad&lt;/script&gt;'));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.match(html,/href="#eq-first">\(1\)/);assert.match(html,/href="#eq-second">\(2\)/);
 const full=await completeHtmlDocument({title:'<script>Кириллица</script>',content},'abc');assert.ok(full.includes('<title>&lt;script&gt;Кириллица&lt;/script&gt;</title>'));
});

test('HTML export rejects arbitrary nodes and unsafe media before rendering',async()=>{
 const {exportDocumentBody}=await import('../../src/lib/client/document-export');
 await assert.rejects(exportDocumentBody({type:'doc',content:[{type:'script',text:'alert(1)'}]}));
 await assert.rejects(exportDocumentBody({type:'doc',content:[{type:'image',attrs:{src:'javascript:alert(1)'}}]}));
});
