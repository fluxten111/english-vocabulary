import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const spelling=await import('./spelling.mjs').catch(()=>({}));
const small=new Set(['pear','ice','ice cream','well-known',"don't",'bear','river']);
test('Q7: dictionary lookup distinguishes a real word from alphabetic nonsense',()=>{
 assert.equal(typeof spelling.inspectInput,'function');
 const result=spelling.inspectInput('pear；youuu',small);
 assert.deepEqual(result.rows.map(r=>r.kind),['found','missing']);
 assert.match(result.rows[1].message,/没有查到.*检查.*拼写/);
});
test('Q1: spaces are not silently split; whole phrases and hyphenated words are looked up',()=>{
 const result=spelling.inspectInput("pear     ice、ice   cream、well‑known、don't",small);
 assert.deepEqual(result.rows.map(r=>r.kind),['phrase','found','found','found']);
 assert.match(result.rows[0].message,/两个|多个/);
 assert.deepEqual(result.words,['pear ice','ice cream','well-known',"don't"]);
});
test('Q1: malformed input stays visible and prevents silent partial save',()=>{
 const result=spelling.inspectInput('bear/ice、pear、pear',small);
 assert.equal(result.invalid.length,1);assert.equal(result.rows[0].kind,'invalid');
 assert.equal(result.duplicates.length,1);assert.equal(result.rows[1].kind,'found');
 assert.equal(result.canSave,false);
});
test('Q7: same-origin dictionary is actually loaded, including inflections and phrases',async()=>{
 const check=spelling.createInputChecker({fetcher:async()=>new Response(await fs.readFile(new URL('./assets/spelling-en-us.txt',import.meta.url),'utf8'))});
 const result=await check('pear；youuu、apples、running、ice cream、well-known');
 assert.deepEqual(result.rows.map(r=>r.kind),['found','missing','found','found','found','found']);
});
test('Q7: network failure is unavailable, never a spelling error; retry can succeed',async()=>{
 let calls=0;const check=spelling.createInputChecker({fetcher:async()=>{if(++calls===1)throw Error('offline');return new Response(await fs.readFile(new URL('./assets/spelling-en-us.txt',import.meta.url),'utf8'));}});
 const first=await check('pear');assert.equal(first.rows[0].kind,'unavailable');
 assert.match(first.rows[0].message,/暂时无法查询/);
 const retry=await check('pear');assert.equal(retry.rows[0].kind,'found');
});
test('Q7: corrupt dictionary must not mark all words valid or invalid',async()=>{
 const check=spelling.createInputChecker({fetcher:async()=>new Response('<html>not the dictionary</html>')});
 const result=await check('pear');assert.equal(result.rows[0].kind,'unavailable');
});
test('Q7: dictionary request contains no user text and is cached only in memory',async()=>{
 const requests=[];const check=spelling.createInputChecker({fetcher:async(url,options)=>{requests.push({url:String(url),options});return new Response(await fs.readFile(new URL('./assets/spelling-en-us.txt',import.meta.url),'utf8'));}});
 await check('pear；youuu');await check('ice');
 assert.equal(requests.length,1);assert.match(requests[0].url,/\/assets\/spelling-en-us\.txt$/);
 assert.equal(requests[0].url.includes('youuu'),false);assert.equal(requests[0].options.body,undefined);
});
test('Q7: bounded waiting and cancellation cannot return a false spelling verdict',async()=>{
 const check=spelling.createInputChecker({fetcher:()=>new Promise(()=>{}),timeoutMs:10});
 const result=await check('pear');assert.equal(result.rows[0].kind,'unavailable');
 const controller=new AbortController();controller.abort();await assert.rejects(()=>check('pear',{signal:controller.signal}));
});
test('Q7: different real words, spelling variants, and several separators use the same dictionary',async()=>{
 const check=spelling.createInputChecker({fetcher:async()=>new Response(await fs.readFile(new URL('./assets/spelling-en-us.txt',import.meta.url),'utf8'))});
 const result=await check("orange。basket；ticket、planet\nwindow\tpear，children;doesn't,ice cream");
 assert.equal(result.rows.length,9);assert(result.rows.every(row=>row.kind==='found'));
 assert.equal((await check('zzqxxuu')).rows[0].kind,'missing');
});
