import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,createBatch,act,validate,merge} from './core.mjs';
import {reviewedLessons,reviewedContent} from './review-catalog.mjs';
import {checkReviewedContent} from './content.mjs';
function fixture(){const d=fresh();createBatch(d,'apple','TEST');d.words[0].content=structuredClone(reviewedLessons.apple);return d;}
test('声音阶段的显式提示只追加事实，不改变词典内容、位置或自评',async()=>{
  const d=fixture(),s=d.sessions[0],before=JSON.stringify(d.words[0].content);
  act(d,s.id,'hint','chinese');act(d,s.id,'hint','spelling');
  assert.equal(JSON.stringify(d.words[0].content),before);assert.equal(s.phase,'sound');assert.equal(s.index,0);assert.equal(s.listened,false);
  assert.equal(d.events.length,2);assert.equal(d.events[0].hintKind,'chinese');
  await checkReviewedContent(d.words[0],d.words[0].content,reviewedContent);validate(d);
});
test('提示不能绕过阶段或凭空显示缺失中文，失败不产生成功事件',()=>{
  const d=fixture(),s=d.sessions[0];s.phase='pronounce';assert.throws(()=>act(d,s.id,'hint','spelling'));
  s.phase='sound';delete d.words[0].content.chinese;assert.throws(()=>act(d,s.id,'hint','chinese'));assert.equal(d.events.length,0);
});
test('额外发音重练先保存自评，再明确选择继续或再练，刷新后不丢结果',()=>{
  const d=fixture(),s=d.sessions[0];s.phase='pronounceRetry';s.queue=[d.words[0].id];
  act(d,s.id,'said');act(d,s.id,'listened');act(d,s.id,'assess','unsure',{hold:true});
  assert.equal(s.phase,'pronounceRetry');assert.equal(s.revealed,true);assert.equal(s.answer,'unsure');
  const count=d.events.length;assert.throws(()=>act(d,s.id,'assess','wrong',{hold:true}));assert.equal(d.events.length,count);
  const restored=validate(JSON.parse(JSON.stringify(d)));assert.equal(restored.sessions[0].answer,'unsure');
  act(d,s.id,'retry');assert.equal(s.attempt,1);assert.equal(s.said,false);assert.equal(s.listened,false);
  act(d,s.id,'said');act(d,s.id,'listened');act(d,s.id,'assess','wrong',{hold:true});act(d,s.id,'next');
  assert.equal(s.phase,'teach');assert.equal(d.events.filter(e=>e.type==='assess').length,2);
});
test('重录建立新尝试并要求重新先说后听，旧自评不被覆盖',()=>{
  const d=fixture(),s=d.sessions[0];s.phase='pronounce';act(d,s.id,'said');act(d,s.id,'listened');
  act(d,s.id,'rerecord');assert.equal(s.attempt,1);assert.equal(s.said,false);assert.equal(s.listened,false);
  assert.throws(()=>act(d,s.id,'assess','correct'));assert.throws(()=>act(d,s.id,'listened'));
  assert.equal(d.events.filter(e=>e.type==='said').length,1);
});
test('旧备份没有尝试字段仍可导入，校验及重复合并不会回填或制造冲突',()=>{
  const d=fixture();delete d.sessions[0].attempt;const before=JSON.stringify(d);
  validate(d);merge(d,JSON.parse(before));assert.equal(JSON.stringify(d),before);
  const incoming=JSON.parse(before);incoming.sessions[0].attempt=-1;assert.throws(()=>validate(incoming));
});
