import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as core from './core.mjs';
import {reviewedLessons} from './review-catalog.mjs';

function fixture(forms='apple,ice,pear',missing=['ice']) {
  const db=core.fresh();core.createBatch(db,forms,'TEST ONLY ready queue');
  for(const w of db.words)w.content=missing.includes(w.normalized)?null:structuredClone(reviewedLessons[w.normalized]);
  return db;
}
const ids=db=>{const s=db.sessions[0],group=db.batches[0].wordIds.slice(s.group*10,s.group*10+10);return db.words.filter(w=>group.includes(w.id)&&!s.studyPlan?.done.includes(w.id)&&core.ready(w,'teach')).map(w=>w.id);};
function defer(db,verified=ids(db)) {
  assert.equal(typeof core.deferUnavailable,'function','缺少主动先学就绪词的核心入口');
  return core.deferUnavailable(db,db.sessions[0].id,verified);
}
function step(db,{wrongPronunciation=false,wrongSpelling=false}={}) {
  const s=db.sessions[0],word=db.words.find(w=>w.id===core.currentId(db,s));
  assert(core.ready(word,'teach'),'No invented content for unavailable words');
  if(s.phase==='sound'){core.act(db,s.id,'listened');core.act(db,s.id,'next');}
  else if(s.phase.startsWith('pronounce')){core.act(db,s.id,'said');core.act(db,s.id,'listened');core.act(db,s.id,'assess',wrongPronunciation?'wrong':'correct');}
  else if(s.phase==='teach')core.act(db,s.id,'next');
  else if(s.phase==='sentence'){core.act(db,s.id,'sentence','');core.act(db,s.id,'next');}
  else{core.act(db,s.id,'spell',wrongSpelling?'incorrect':word.surface);core.act(db,s.id,'next');}
}
function untilBlocked(db){for(let i=0;i<300;i++){const s=db.sessions[0];if(s.status==='completed'||!core.ready(db.words.find(w=>w.id===core.currentId(db,s)),'teach'))return;step(db);core.validate(JSON.parse(JSON.stringify(db)));}throw Error('unexpected study loop');}

test('Q3 input: explicit split affects only chosen phrase and keeps other phrases',()=>{
  assert.equal(typeof core.splitPhraseInput,'function','缺少主动确认拆分入口');
  assert.deepEqual(core.parse('pear ice,ice cream').words,['pear ice','ice cream']);
  const edited=core.splitPhraseInput('pear ice，ice cream','pear ice');
  assert.deepEqual(core.parse(edited).words,['pear','ice','ice cream']);
  assert.throws(()=>core.splitPhraseInput('apple','apple'));
});
test('Q3 deployment: changed core exports use the new page cache version',()=>{
  const index=readFileSync(new URL('./index.html',import.meta.url),'utf8'),app=readFileSync(new URL('./app.mjs',import.meta.url),'utf8');
  assert.equal(app.match(/from ['"]\.\/core\.mjs(\?[^'"]*)/)[1],index.match(/app\.mjs(\?[^"']*)/)[1]);
});
test('Q3a: confirmed apple prefix survives; pear completes all five phases while ice remains pending',()=>{
  const db=fixture(),s=db.sessions[0],original=structuredClone(db.batches[0]);
  step(db);const prefix=structuredClone(db.events);defer(db);
  assert.equal(s.phase,'sound');assert.equal(core.currentId(db,s),db.words[2].id);
  assert.deepEqual(db.events.slice(0,prefix.length),prefix);assert.deepEqual(db.batches[0],original);
  untilBlocked(db);assert.equal(s.status,'active');assert.equal(s.group,0);assert.equal(s.phase,'sound');
  assert.equal(core.currentId(db,s),db.words[1].id);assert.equal(db.batches[0].completedAt,null);
  for(const w of [db.words[0],db.words[2]])assert.deepEqual(new Set(db.events.filter(e=>e.wordId===w.id).map(e=>e.phase)),new Set(['sound','pronounce','teach','sentence','spell']));
  assert.equal(db.events.some(e=>e.wordId===db.words[1].id&&e.type==='listened'),false);
  assert.deepEqual(new Set(s.studyPlan.done),new Set([db.words[0].id,db.words[2].id]));
});
test('Q3a: missing first, middle and last items never complete a batch',()=>{
  for(const forms of ['ice,apple,pear','apple,ice,pear','apple,pear,ice']){
    const db=fixture(forms);untilBlocked(db);defer(db);untilBlocked(db);
    assert.equal(db.sessions[0].status,'active');assert.equal(db.batches[0].completedAt,null);
    assert.equal(db.words.find(w=>w.id===core.currentId(db,db.sessions[0])).surface,'ice');
  }
});
test('Q3a: all missing and unverified ready IDs cannot create a successful action',()=>{
  assert.equal(typeof core.deferUnavailable,'function');
  const db=fixture('ice,crystal',['ice','crystal']),before=JSON.stringify(db);
  assert.throws(()=>defer(db,[]));assert.equal(JSON.stringify(db),before);
  assert.throws(()=>defer(db,db.words.map(w=>w.id)));assert.equal(JSON.stringify(db),before);
});
test('Q3a: completing postponed genuine book resumes its full path without repeating done words',()=>{
  const db=fixture('apple,book,pear',['book']);step(db);defer(db);untilBlocked(db);
  const before=db.events.length,doneIds=[db.words[0].id,db.words[2].id];
  db.words[1].content=structuredClone(reviewedLessons.book);untilBlocked(db);
  assert.equal(db.sessions[0].status,'completed');assert(db.batches[0].completedAt);
  assert.equal(db.sessions[0].studyPlan,undefined);
  assert.equal(db.events.slice(before).some(e=>doneIds.includes(e.wordId)),false);
  assert.deepEqual(new Set(db.events.slice(before).map(e=>e.phase)),new Set(['sound','pronounce','teach','sentence','spell']));
});
test('Q3a: wrong pronunciation before a missing word retains required retry in current wave',()=>{
  const db=fixture('apple,book,pear',[]),s=db.sessions[0];
  while(s.phase==='sound')step(db);
  step(db,{wrongPronunciation:true});db.words[1].content=null;defer(db);
  const seen=[];for(let i=0;i<100&&core.ready(db.words.find(w=>w.id===core.currentId(db,s)),'teach');i++){seen.push([s.phase,core.currentId(db,s)]);step(db);}
  assert(seen.some(([phase,id])=>phase==='pronounceRetry'&&id===db.words[0].id));
  assert.equal(db.batches[0].completedAt,null);
});
test('Q3a: postponed pronunciation retry debt survives restoration and later content preparation',()=>{
  let db=fixture('apple,book',[]),s=db.sessions[0];
  while(s.phase==='sound')step(db);
  while(s.phase==='pronounce')step(db,{wrongPronunciation:true});
  assert.equal(s.phase,'pronounceRetry');db.words[0].content=null;defer(db);untilBlocked(db);
  db=core.validate(JSON.parse(JSON.stringify(db)));s=db.sessions[0];const start=db.events.length;
  db.words[0].content=structuredClone(reviewedLessons.apple);untilBlocked(db);
  assert(db.events.slice(start).some(e=>e.wordId===db.words[0].id&&e.phase==='pronounceRetry'));
  assert.equal(s.status,'completed');
});
test('Q3a: postponed spelling retry debt is not silently discarded',()=>{
  const db=fixture('apple,book',[]),s=db.sessions[0];
  while(s.phase!=='spell')step(db);
  while(s.phase==='spell')step(db,{wrongSpelling:true});
  db.words[0].content=null;defer(db);untilBlocked(db);const start=db.events.length;
  db.words[0].content=structuredClone(reviewedLessons.apple);untilBlocked(db);
  assert(db.events.slice(start).some(e=>e.wordId===db.words[0].id&&e.phase==='spellRetry'));
  assert.equal(s.status,'completed');
});
test('Q3a: queue survives backup roundtrip and repeated import; failed save leaves input untouched',()=>{
  const db=fixture();step(db);defer(db);const copy=core.validate(JSON.parse(JSON.stringify(db)));
  assert.deepEqual(core.merge(core.fresh(),copy),copy);assert.deepEqual(core.merge(copy,copy),copy);
  const original=fixture();step(original);const before=JSON.stringify(original);
  assert.throws(()=>core.transaction({getItem:()=>null,setItem(){throw Error('disk full');}},original,d=>defer(d)));
  assert.equal(JSON.stringify(original),before);
});
test('Q3a: corrupt, duplicate, foreign-group or incomplete partitions are rejected',()=>{
  const db=fixture();step(db);defer(db);
  for(const mutate of [p=>p.active.push(p.pending[0]),p=>p.pending=[],p=>p.done.push('foreign'),p=>p.group++,p=>p.active=[],p=>p.pronounceWeak=['foreign']]){
    const bad=structuredClone(db);mutate(bad.sessions[0].studyPlan);assert.throws(()=>core.validate(bad));
  }
});
test('Q3a: original ten-word group boundaries and original ordering remain intact',()=>{
  const forms=['apple','book','chair','river','garden','window','pencil','basket','blanket','ticket','pear'];
  const db=fixture(forms.join(','),['book']),s=db.sessions[0],original=[...db.batches[0].wordIds];
  step(db);defer(db);untilBlocked(db);assert.equal(s.group,0);
  db.words[1].content=structuredClone(reviewedLessons.book);
  for(let i=0;i<100&&s.group===0;i++)step(db);
  assert.equal(s.group,1);assert.deepEqual(core.groupWords(db,s),[db.words[10].id]);
  assert.deepEqual(db.batches[0].wordIds,original);assert.equal(s.studyPlan,undefined);
});
test('Q3a: multiple preparation waves keep done words complete and finish only after final pending word',()=>{
 const db=fixture('apple,book,pear',['book','pear']),s=db.sessions[0];step(db);defer(db);untilBlocked(db);
 assert.deepEqual(s.studyPlan.done,[db.words[0].id]);const count=db.events.filter(e=>e.wordId===db.words[0].id).length;
 db.words[2].content=structuredClone(reviewedLessons.pear);defer(db);untilBlocked(db);
 assert.equal(s.status,'active');assert.equal(db.batches[0].completedAt,null);assert.equal(s.studyPlan.done.length,2);
 db.words[1].content=structuredClone(reviewedLessons.book);untilBlocked(db);assert.equal(s.status,'completed');
 assert.equal(db.events.filter(e=>e.wordId===db.words[0].id).length,count);
});
test('Q3a: sound-only readiness cannot join a five-stage learning queue',()=>{
 const db=fixture('ice,book,pear',['ice']);db.words[1].content.definition='';
 assert(core.ready(db.words[1],'sound'));assert(!core.ready(db.words[1],'teach'));
 assert.throws(()=>defer(db,[db.words[1].id]));defer(db,[db.words[2].id]);
 assert.deepEqual(core.groupWords(db,db.sessions[0]),[db.words[2].id]);
});
test('Q3a: forged done entries without five-stage history cannot survive import',()=>{
 const db=fixture();step(db);defer(db);const p=db.sessions[0].studyPlan;
 p.done.push(p.active.shift());assert.throws(()=>core.validate(db),/伪造已完成/);
});
test('Q3a compatibility: new queues carry a version old clients reject; legacy backups still import',()=>{
 const legacy=fixture(),newer=structuredClone(legacy);step(newer);defer(newer);
 assert.equal(newer.schema,2,'Old readers must not silently interpret a subset index as original order');
 assert.equal(core.validate(structuredClone(legacy)).schema,1);
 const bad=structuredClone(newer);bad.schema=1;assert.throws(()=>core.validate(bad));
 const merged=core.merge(core.fresh(),newer);assert.equal(merged.schema,2);assert.deepEqual(merged.sessions,newer.sessions);
});
