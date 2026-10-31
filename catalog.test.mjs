import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewedContent,reviewedLessons} from './review-catalog.mjs';
import {createDictionaryClient,checkReviewedContent,createPreparer} from './content.mjs';
import {fresh,createBatch,ready,act,currentId,validate} from './core.mjs';
const words='apple book chair river garden window pencil basket blanket ticket planet orange'.split(' ');
test('正式十三词均有可验证的词义、原站录音、同口音IPA与原创教学内容',async()=>{
 assert.equal(Object.keys(reviewedLessons).length,13);
 for(const normalized of [...words,'pear']){
  const content=reviewedLessons[normalized];
  await checkReviewedContent({id:normalized,normalized},content,reviewedContent);
  assert.equal(content.audio.accent,'US');assert.match(content.audio.url,/^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\//);
  assert(!content.cue.toLowerCase().includes(normalized));assert(!/[\u3400-\u9fff]/.test(content.cue));
  assert.match(content.definitionSource,/原创/);assert.match(content.exampleSource,/原创/);assert(content.chinese);
 }
 assert.equal(reviewedLessons.orange.audio.id,'orange01');assert.equal(reviewedLessons.orange.senseId,'orange#1');
 assert.equal(reviewedLessons.planet.senseId,'planet#1');
});
test('真实已核对词不被远程用途开关阻塞，准备12词时不发API请求',async()=>{
 let requests=0;
 const lookup=createDictionaryClient({apiBase:'',automaticQueriesApproved:false,contentRetentionApproved:false},{reviews:reviewedContent,lessons:reviewedLessons,fetcher:()=>{requests++;throw Error('Unexpected API request')}});
 const db=fresh(),batch=createBatch(db,words.join(','),'真实测试词');
 const p=createPreparer({getBatch:()=>batch,getWords:()=>db.words,usable:w=>ready(w,'teach'),lookup,
  commit:async(id,w,r,guard)=>{guard();w.content=r.content;return true},publish:(id,s)=>{batch.preparation=s}});
 const start=Date.now(),result=await p.run(batch.id);
 assert.equal(result.status,'ready');assert.equal(result.ready,12);assert.equal(requests,0);
 assert(Date.now()-start<1000);assert.equal(p.isRunning(batch.id),false);validate(db);
});
test('未知词明确待核对，不发送未经允许的远程请求，不伪装成就绪',async()=>{
 let requests=0;const lookup=createDictionaryClient({automaticQueriesApproved:false},{reviews:reviewedContent,lessons:reviewedLessons,fetcher:()=>requests++});
 const r=await lookup({id:'unknown',normalized:'unreviewedword',surface:'unreviewedword'},{requestId:'r'});
 assert.equal(r.status,'review_required');assert(!r.content);assert.equal(requests,0);
});
test('目录内内容损坏仍被摘要校验拒绝，不能借本地目录跳过核对',async()=>{
 const lessons={apple:{...reviewedLessons.apple,ipa:'incorrect'}};
 const lookup=createDictionaryClient({}, {reviews:reviewedContent,lessons});
 await assert.rejects(()=>lookup({id:'w',normalized:'apple',surface:'Apple'},{requestId:'r'}),e=>e.code==='INVALID_RESPONSE');
});
test('真实12词可完成两组全部必要阶段与发音、拼写弱项重练，历史可恢复',()=>{
 const db=fresh(),batch=createBatch(db,words.join(','),'真实词表');for(const w of db.words)w.content=structuredClone(reviewedLessons[w.normalized]);
 const s=db.sessions[0];let guard=0;
 while(s.status!=='completed'){
  if(++guard>250)throw Error('Learning did not finish');
  const word=db.words.find(w=>w.id===currentId(db,s));
  if(s.phase==='sound'){act(db,s.id,'listened');act(db,s.id,'next')}
  else if(s.phase.startsWith('pronounce')){act(db,s.id,'said');act(db,s.id,'listened');act(db,s.id,'assess',s.phase==='pronounce'&&s.index===0?'unsure':'correct')}
  else if(s.phase==='teach'){act(db,s.id,'chinese');act(db,s.id,'next')}
  else if(s.phase==='sentence'){act(db,s.id,'sentence',s.index===0?'':word.content.example);act(db,s.id,'next')}
  else{act(db,s.id,'spell',s.phase==='spell'&&s.index===0?'incorrect':word.surface);act(db,s.id,'next')}
  validate(JSON.parse(JSON.stringify(db)));
 }
 assert.equal(s.group,1);assert(batch.completedAt);assert(db.events.some(e=>e.phase==='pronounceRetry'));assert(db.events.some(e=>e.phase==='spellRetry'));
 assert.equal(db.words.length,12);assert(db.events.length>60);
});

test('当前十三词均有逐图核对来源与许可，源文件存在且不含目标答案的替代文字',async()=>{
 const fs=await import('node:fs');
 for(const [word,c]of Object.entries(reviewedLessons)){
  assert(c.visual,word);assert.equal(c.visual.senseId,c.senseId);assert(!c.visual.alt.toLowerCase().includes(word));assert(c.visual.author);assert.match(c.visual.sourcePage,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);assert(fs.existsSync(new URL(c.visual.src,import.meta.url)),c.visual.src);
 }
});
test('旧核对版本继续可验证，保留旧备份兼容路径',async()=>{
 for(const c of Object.values(reviewedLessons)){
  const record=reviewedContent.find(r=>r.id===c.reviewId&&r.version===c.reviewVersion);
  assert(record.supersedes?.length);for(const old of record.supersedes)assert(reviewedContent.some(r=>r.id===old.id&&r.version===old.version));
 }
});
