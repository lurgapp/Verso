import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base=process.env.VERSO_TEST_BASE_URL;
const enabled=process.env.VERSO_ALLOW_ISOLATED_DB_TESTS==='1'&&base==='http://127.0.0.1:33317';
test('a 50000-word Cyrillic document over 512 KiB publishes, updates and reads through the real API', {skip:enabled?false:'Requires exact isolated loopback server and explicit flag',timeout:60000},async()=>{
  const headers={'content-type':'application/json',origin:base!,'x-real-ip':`2001:db8:${randomUUID().replaceAll('-','').slice(0,16).match(/.{4}/g)!.join(':')}::99`};
  const content={type:'doc',content:Array.from({length:250},()=>({type:'paragraph',content:[{type:'text',text:Array.from({length:200},()=>'слово').join(' ')}]}))};
  const body=JSON.stringify({title:'Isolated 50000 word article',content,schemaVersion:1});
  assert.ok(Buffer.byteLength(body)>512*1024&&Buffer.byteLength(body)<2*1024*1024);
  const created=await fetch(`${base}/api/v1/articles`,{method:'POST',headers,body});assert.equal(created.status,201);
  const result=await created.json() as {article:{id:string;version:number;content:unknown};editKey:string};
  try {
    assert.deepEqual(result.article.content,content);
    const html=await fetch(`${base}/a/${result.article.id}`);assert.equal(html.status,200);assert.ok((await html.text()).includes('слово слово'));
    const updated=await fetch(`${base}/api/v1/articles/${result.article.id}`,{method:'PATCH',headers:{...headers,authorization:`Bearer ${result.editKey}`},body:JSON.stringify({title:'Updated large article',content,schemaVersion:1,version:1})});assert.equal(updated.status,200);assert.equal((await updated.json()).article.version,2);
    const rejected=await fetch(`${base}/api/v1/articles/${result.article.id}`,{method:'PATCH',headers:{...headers,authorization:`Bearer ${result.editKey}`},body:JSON.stringify({title:'Too large',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'я'.repeat(500001)}]}]},schemaVersion:1,version:2})});assert.equal(rejected.status,400);
    const current=await fetch(`${base}/api/v1/articles/${result.article.id}`);const article=(await current.json()).article;assert.equal(article.title,'Updated large article');assert.equal(article.version,2);
  }finally{const deleted=await fetch(`${base}/api/v1/articles/${result.article.id}`,{method:'DELETE',headers:{...headers,authorization:`Bearer ${result.editKey}`}});assert.equal(deleted.status,204);}
});
