import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayback} from './media.mjs';
function fixture(){
  let now=0,id=0,pos={sessionId:'s',wordId:'w',phase:'sound',group:0,index:0,senseId:'fruit',attempt:0};
  const timers=new Map,audios=[],events=[];
  const player=createPlayback({current:()=>pos,complete:p=>events.push(p),
    setTimer:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id),
    createAudio:()=>{const a={currentTime:0,playCalls:0,pause(){this.onpause?.();},play(){this.playCalls++;this.onplaying?.();return Promise.resolve();}};audios.push(a);return a;}});
  return {player,audios,events,timers,get pos(){return pos;},set pos(p){pos=p;},
    tick(ms){now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}}};
}
test('卡片停顿一秒，预加载不算听完，同一卡片不反复重启倒计时',async()=>{
  const t=fixture();t.player.schedule('audio',t.pos);t.tick(999);
  assert.equal(t.audios[0].playCalls,0);assert.equal(t.events.length,0);
  t.player.schedule('audio',t.pos);assert.equal(t.audios.length,1);
  t.tick(1);await Promise.resolve();assert.equal(t.audios[0].playCalls,1);
  assert.equal(t.events.length,0);t.audios[0].onended();assert.equal(t.events.length,1);
});
test('手动播放取消待播，即使被取消的计时回调迟到也不能再响',async()=>{
  const t=fixture();t.player.schedule('audio',t.pos);const late=[...t.timers.values()][0].fn;
  await t.player.play('audio',t.pos);late();t.tick(1000);
  assert.equal(t.audios[0].playCalls,0);assert.equal(t.audios[1].playCalls,1);
});
test('退出取消自动播放，暂停空播放器不会显示已暂停',()=>{
  const t=fixture();t.player.pause();assert.equal(t.player.state,'idle');
  t.player.schedule('audio',t.pos);t.player.stop();t.tick(1000);
  assert.equal(t.audios[0].playCalls,0);assert.equal(t.events.length,0);
});
test('继续复用暂停的播放器与时间，暂停不确认已听',async()=>{
  const t=fixture();await t.player.play('audio',t.pos);t.audios[0].currentTime=.37;
  t.player.pause();assert.equal(t.player.state,'paused');assert.equal(t.events.length,0);
  await t.player.resume();assert.equal(t.audios.length,1);assert.equal(t.audios[0].currentTime,.37);
  assert.equal(t.audios[0].playCalls,2);t.audios[0].onended();assert.equal(t.events.length,1);
});
test('同词同阶段的新尝试不能被旧音频确认，失效暂停音频不能继续',async()=>{
  const t=fixture();await t.player.play('audio',t.pos);const late=t.audios[0].onended;
  t.player.pause();t.pos={...t.pos,attempt:1};await t.player.resume();late();
  assert.equal(t.audios[0].playCalls,1);assert.equal(t.events.length,0);
});
test('加载时暂停引起的旧 play 拒绝，不会破坏稍后的继续播放',async()=>{
  const calls=[];let a;
  const p=createPlayback({current:()=>({sessionId:'s'}),complete:()=>{},createAudio:()=>a={pause(){},play(){return new Promise((resolve,reject)=>calls.push({resolve,reject}));}}});
  const first=p.play('audio',{sessionId:'s'});p.pause();assert.equal(p.state,'paused');
  const second=p.resume();calls[0].reject(Error('AbortError'));await first;assert.equal(p.state,'loading');
  calls[1].resolve();await second;assert.equal(p.state,'playing');
});
