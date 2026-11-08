import test from 'node:test';
import assert from 'node:assert/strict';
import {parse,splitPhraseInput,createBatch,fresh,transaction,validate} from './core.mjs';

test('导入：换词与明确分隔符组合得到相同项目顺序，不依赖固定示例',()=>{
  for(const [left,right]of [['bear','river'],['table','moon'],['well-known','ice cream'],["don't",'pear']])
    for(const separator of [',','，',';','；','、','。','\n','\r\n','\r','\t'])
      assert.deepEqual(parse(left+separator+right),{words:[left,right],duplicates:[],invalid:[]},JSON.stringify(separator));
});
test('导入：先整理横向空白再验证，空格不自动拆词或合并不同行',()=>{
  for(const space of [' ','     ','\u00a0','\u3000','\u2009']){
    assert.deepEqual(parse('ice'+space+'cream'),{words:['ice cream'],duplicates:[],invalid:[]});
    assert.deepEqual(parse('bear'+space+'ice\nriver'),{words:['bear ice','river'],duplicates:[],invalid:[]});
  }
});
test('导入：连字符和撇号属于词内字符，整理后可去重而不改原输入',()=>{
  assert.deepEqual(parse("well-known、well‐known、well‑known、DON’T,don't"),{
    words:['well-known',"DON'T"],duplicates:['well-known','well-known',"don't"],invalid:[]});
  assert.deepEqual(parse('Ice  cream,ice cream'),{words:['Ice cream'],duplicates:['ice cream'],invalid:[]});
});
test('导入：未知符号和不合规项原样报告，不删除字符伪造可导入词',()=>{
  assert.deepEqual(parse('bear/ice、bear—ice、well--known、bad123、zero\u200bwidth、river'),{
    words:['river'],duplicates:[],invalid:['bear/ice','bear—ice','well--known','bad123','zero\u200bwidth']});
  assert.deepEqual(parse('xyzabc'),{words:['xyzabc'],duplicates:[],invalid:[]}); // Format, not a dictionary verdict.
});
test('导入：预览遵守原有单项500字符存储上限，过长项可明确忽略而不阻塞其余项',()=>{
  const boundary='a'.repeat(500),tooLong='b'.repeat(501);
  assert.deepEqual(parse(boundary+'、'+tooLong+',pear'),{words:[boundary,'pear'],duplicates:[],invalid:[tooLong]});
  const db=fresh();assert.throws(()=>createBatch(db,tooLong+',pear','TEST ONLY'),/格式|忽略/);
  createBatch(db,tooLong+',pear','TEST ONLY',false,{ignoreInvalid:true});
  assert.deepEqual(db.words.map(w=>w.surface),['pear']);assert.doesNotThrow(()=>validate(db));
});
test('导入：主动拆分使用同一整理规则，只拆所选项，保留其他原文与连字符',()=>{
  const raw='bear     ice、ice  cream。well-known';
  assert.deepEqual(parse(splitPhraseInput(raw,'bear ice')),{
    words:['bear','ice','ice cream','well-known'],duplicates:[],invalid:[]});
  assert.equal(splitPhraseInput('bear ice、bear ice、ice cream',0),'bear\nice\nbear ice\nice cream');
  assert.deepEqual(parse(splitPhraseInput('well-known ice cream、river',0)),{
    words:['well-known','ice','cream','river'],duplicates:[],invalid:[]});
  assert.throws(()=>splitPhraseInput('well-known、ice cream',0));
  assert.throws(()=>splitPhraseInput('bear/ice、ice cream',0));
});
test('导入：未明确忽略无效项不得部分建批次或新增词',()=>{
  const db=fresh(),before=structuredClone(db);
  assert.throws(()=>createBatch(db,'bear/ice、river','TEST ONLY'),/格式|忽略/);
  assert.deepEqual(db,before);
  const raw='bear/ice、river';
  const batch=createBatch(db,raw,'TEST ONLY',false,{ignoreInvalid:true});
  assert.deepEqual(db.words.map(w=>w.surface),['river']);assert.equal(batch.originalInput,raw);
});
test('导入：确认后的顺序和拆分结果保存，原始输入独立保留并可备份恢复',()=>{
  const original='pear     ice、ice cream。well‑known';
  const confirmed=splitPhraseInput(original,'pear ice');
  const db=fresh();let stored=null;
  const storage={getItem:()=>stored,setItem:(_,value)=>{stored=value}};
  const saved=transaction(storage,db,d=>createBatch(d,confirmed,'TEST ONLY',false,{originalInput:original}));
  const restored=validate(JSON.parse(stored));
  assert.equal(restored.batches[0].originalInput,original);
  assert.deepEqual(restored.words.map(w=>w.surface),['pear','ice','ice cream','well-known']);
  assert.deepEqual(restored.batches[0].wordIds,saved.batches[0].wordIds);
  assert.deepEqual(db,fresh());
});
test('导入：保存失败不新增词表或改旧历史，明确跳过已有词仍按原规则',()=>{
  const db=fresh();createBatch(db,'well-known、river','FIRST');const before=structuredClone(db);
  const storage={getItem:()=>JSON.stringify(db),setItem:()=>{throw Error('full')}};
  assert.throws(()=>transaction(storage,db,d=>createBatch(d,'well‑known、moon','SECOND')));
  assert.deepEqual(db,before);
  const batch=createBatch(db,'well‑known、moon','SECOND',true);
  assert.deepEqual(batch.wordIds,[db.words.find(w=>w.surface==='moon').id]);
  assert.deepEqual(db.batches[0],before.batches[0]);
});
