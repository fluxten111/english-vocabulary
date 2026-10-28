import {test} from 'node:test';import assert from 'node:assert/strict';
import {fresh,createBatch,validate,ready,merge,transaction,save} from './core.mjs';
const fixture=()=>{const d=fresh();createBatch(d,'apple','one');return d};
test('损坏内容字段导入前拒绝，ready 不抛异常',()=>{const d=fixture();d.words[0].content={checked:true,senseId:'a',cue:{bad:1}};assert.throws(()=>validate(d));assert.equal(ready(d.words[0],'sound'),false);const local=fixture(),before=JSON.stringify(local);assert.throws(()=>merge(local,d));assert.equal(JSON.stringify(local),before)});
test('拒绝错误类型及不安全音频网址',()=>{for(const content of [[],1,'bad',{cue:123},{audio:{url:'javascript:alert(1)'}},{audio:{accent:'BAD'}},{checked:'true'}]){const d=fixture();d.words[0].content=content;assert.throws(()=>validate(d))}});
test('空内容旧词表仍可导入',()=>{const d=fixture();assert.deepEqual(merge(fresh(),JSON.parse(JSON.stringify(d))).batches,d.batches)});
test('历史不能冒用另一个批次',()=>{const d=fixture();createBatch(d,'pear','two');d.events.push({id:'event',sessionId:d.sessions[0].id,batchId:d.batches[1].id,wordId:d.words[1].id});assert.throws(()=>validate(d))});
test('准备记录校验拒绝非数字计数，兼容缺少可选字段的记录',()=>{const d=fixture();d.batches[0].preparation={runId:'run',status:'unconfigured',code:'UNCONFIGURED',startedAt:0,deadlineAt:150000,elapsedMs:0,total:1,ready:0,finished:1,pending:0,needsReview:0,failed:1,estimateMs:null,items:{[d.words[0].id]:{status:'failed',code:'UNCONFIGURED'}}};assert.doesNotThrow(()=>validate(d));d.batches[0].preparation.failed='<img>';assert.throws(()=>validate(d))});
