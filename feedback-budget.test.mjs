import {test} from 'node:test';import assert from 'node:assert/strict';
import {FeedbackBudget} from './sentence-feedback-worker.mjs';
function fixture(){
 const values=new Map();let alarm=null,tail=Promise.resolve();
 const storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));},async getAlarm(){return alarm;},async setAlarm(v){alarm=v;},async list({prefix}){return new Map([...values].filter(([k])=>k.startsWith(prefix)));},async delete(k){values.delete(k);},transaction(fn){const task=tail.then(()=>fn(storage));tail=task.catch(()=>{});return task;}};
 const service=new FeedbackBudget({storage});
 const call=async(path,body)=>{const response=await service.fetch(new Request('https://budget.test/'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,...await response.json()};};
 const reserve=(key='a',requestId='request-a',extra={})=>call('reserve',{key:key.repeat(64),requestId,reserve:10000,limit:10000,daily:50,monthly:1000,...extra});
 const settle=(extra={})=>call('settle',{key:'a'.repeat(64),requestId:'request-a',cost:2000,...extra});
 return {storage,service,reserve,settle,call};
}
test('并发请求共用金额上限，不会各自通过检查后超额',async()=>{
 const t=fixture(),out=await Promise.all([t.reserve(),t.reserve('b','request-b')]);
 assert.deepEqual(out.map(x=>x.status).sort(),[200,429]);assert.equal((await t.storage.get('budget')).spent,10000);
});
test('相同内容进行中拒绝重复扣费；缓存完成结果不再占额度',async()=>{
 const t=fixture();await t.reserve();assert.equal((await t.reserve()).code,'IN_PROGRESS');
 await t.settle({payload:{result:{assessment:'uncertain'}}});
 const cached=await t.reserve('a','request-new');assert(cached.cached);assert.equal((await t.storage.get('budget')).daily,1);assert.equal((await t.storage.get('budget')).spent,2000);
});
test('失败保守预留与迟到结算不损坏金额记录',async()=>{
 const t=fixture();await t.reserve();await t.settle({cost:10000});
 assert.equal((await t.reserve()).code,'PREVIOUS_REQUEST');assert.equal((await t.settle({cost:0})).code,'STALE_REQUEST');
 assert.equal((await t.storage.get('budget')).spent,10000);
});
test('每天次数限制与月金额限制分别生效',async()=>{
 const t=fixture();await t.reserve('a','request-a',{daily:1,limit:100000});await t.settle();
 assert.equal((await t.reserve('b','request-b',{daily:1,limit:100000})).code,'QUOTA');
 assert.equal((await t.storage.get('budget')).daily,1);
});
test('24小时后清理模型缓存，不清除额度账目',async()=>{
 const t=fixture();await t.reserve();await t.settle({payload:{result:{}}});
 const key='job:'+'a'.repeat(64),job=await t.storage.get(key);job.expires=Date.now()-1;await t.storage.put(key,job);await t.service.alarm();
 assert.equal(await t.storage.get(key),undefined);assert.equal((await t.storage.get('budget')).spent,2000);
});
