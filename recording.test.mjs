import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecorder} from './recording.mjs';
function fixture({getStream,empty=false}={}){
  let pos={sessionId:'s',wordId:'w',senseId:'sense',phase:'pronounce',group:0,index:0,restarts:0,attempt:0},stopped=0;
  const instances=[],ready=[],revoked=[],audios=[],statuses=[];
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  const r=createRecorder({current:()=>pos,getStream:getStream||(()=>Promise.resolve(stream)),
    createMediaRecorder:()=>{const instance={state:'inactive',mimeType:'audio/test',start(){this.state='recording';},stop(){this.state='inactive';if(!empty)this.ondataavailable?.({data:new Blob(['CONTROLLED RECORDING TEST'])});this.onstop?.();}};instances.push(instance);return instance;},
    makeUrl:blob=>'blob:test-'+blob.size,revokeUrl:url=>revoked.push(url),ready:owner=>ready.push(owner),status:(...value)=>statuses.push(value),
    createAudio:url=>{const a={url,pause(){},play:()=>Promise.resolve()};audios.push(a);return a;}});
  return{r,instances,ready,revoked,audios,statuses,stream,get stopped(){return stopped;},get pos(){return pos;},set pos(p){pos=p;}};
}
test('非空录音停止后才就绪，设备已释放，普通重绘不删除临时回放',async()=>{
  const t=fixture();await t.r.start(t.pos);assert.equal(t.r.state,'recording');assert.equal(t.ready.length,0);
  t.r.finish();assert.equal(t.r.hasClip,true);assert.equal(t.ready.length,1);assert.equal(t.stopped,1);
  t.r.sync({...t.pos});assert.equal(t.r.hasClip,true);assert.equal(t.revoked.length,0);
  await t.r.play();assert.equal(t.r.state,'playing');t.audios[0].onended();assert.equal(t.r.state,'ready');
  assert.equal(t.ready.length,1);
});
test('新尝试即使仍是同一个词也释放旧录音，旧回调不能再就绪',async()=>{
  const t=fixture();await t.r.start(t.pos);const lateData=t.instances[0].ondataavailable,lateStop=t.instances[0].onstop;
  t.pos={...t.pos,attempt:1};t.r.sync(t.pos);lateData({data:new Blob(['late'])});lateStop();
  assert.equal(t.r.hasClip,false);assert.equal(t.ready.length,0);assert.equal(t.stopped,1);
});
test('权限迟到时已经取消：只释放设备，不开启录音',async()=>{
  let resolve;const t=fixture({getStream:()=>new Promise(r=>resolve=r)});const pending=t.r.start(t.pos);
  t.r.cancel();resolve(t.stream);await pending;assert.equal(t.instances.length,0);assert.equal(t.stopped,1);
});
test('空录音失败不生成就绪，拒绝权限保留可继续状态',async()=>{
  const t=fixture({empty:true});await t.r.start(t.pos);t.r.finish();assert.equal(t.r.state,'failed');assert.equal(t.ready.length,0);
  const denied=fixture({getStream:()=>Promise.reject(Error('denied'))});await denied.r.start(denied.pos);
  assert.equal(denied.r.state,'failed');assert.equal(denied.ready.length,0);
});
test('离开后撤销回放地址，重录不会累积旧地址或麦克风',async()=>{
  const t=fixture();await t.r.start(t.pos);t.r.finish();const first=t.r.hasClip;
  await t.r.start(t.pos);assert(first);assert.equal(t.revoked.length,1);t.r.finish();t.r.cancel();
  assert.equal(t.revoked.length,2);assert.equal(t.r.hasClip,false);assert.equal(t.stopped,2);
});
test('授权没有结果时结束等待，迟到设备仅释放，不开始录音',async()=>{
  let deadline,resolve,stopped=0,started=0;
  const pos={sessionId:'s'};
  const r=createRecorder({current:()=>pos,getStream:()=>new Promise(r=>resolve=r),
    createMediaRecorder:()=>{started++;return {};},setTimer:fn=>{deadline=fn;return 1;},clearTimer:()=>{}});
  const pending=r.start(pos);deadline();await pending;assert.equal(r.state,'failed');
  resolve({getTracks:()=>[{stop:()=>stopped++}]});await Promise.resolve();await Promise.resolve();
  assert.equal(stopped,1);assert.equal(started,0);
});
