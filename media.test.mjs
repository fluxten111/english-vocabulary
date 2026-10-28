import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayback} from './media.mjs';
function setup(){const list=[],events=[],statuses=[];let pos={sessionId:'a',wordId:'apple',phase:'sound',group:0,index:0,senseId:'fruit'};const createAudio=url=>{const a={url,paused:false,play:()=>Promise.resolve(),pause(){a.paused=true}};list.push(a);return a};const p=createPlayback({createAudio,current:()=>pos,complete:x=>events.push(x),status:x=>statuses.push(x)});return {p,list,events,statuses,get pos(){return pos},set pos(x){pos=x}}}
test('重播先停止旧音频，退出后旧回调不可写入新词',async()=>{const t=setup();await t.p.play('a',t.pos);const ended=t.list[0].onended;await t.p.play('b',t.pos);assert(t.list[0].paused);t.p.stop();t.pos={...t.pos,sessionId:'b',wordId:'pear'};await t.p.play('c',t.pos);ended();assert.equal(t.events.length,0);t.list[2].onended();assert.equal(t.events[0].wordId,'pear')});
test('同一音频结束只能确认一次',async()=>{const t=setup();await t.p.play('a',t.pos);const ended=t.list[0].onended;ended();ended();assert.equal(t.events.length,1)});
test('即使同词，阶段或词义变更也拒绝旧音频',async()=>{const t=setup();await t.p.play('a',t.pos);const ended=t.list[0].onended;t.pos={...t.pos,phase:'pronounce'};ended();assert.equal(t.events.length,0)});
test('播放失败不生成已听事件',async()=>{const t=setup();await t.p.play('a',t.pos);const ended=t.list[0].onended;t.list[0].onerror();ended();assert.equal(t.events.length,0);assert(t.statuses.includes('failed'))});
