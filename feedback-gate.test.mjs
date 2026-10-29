import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeedbackWorker} from './sentence-feedback-worker.mjs';
import {feedbackRequest,createFeedbackClient,validateAssessment} from './sentence-feedback.mjs';
const origin='https://fluxten111.github.io';
const env={ALLOWED_ORIGIN:origin,FEEDBACK_ENABLED:'false',FEEDBACK_QUALITY_APPROVED:'false',FEEDBACK_MONTHLY_CNY_LIMIT:'0'};
const request=(path,body,site=origin)=>new Request('https://worker.test'+path,{method:body===undefined?'GET':'POST',headers:{Origin:site,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const closedWorker=()=>createFeedbackWorker({fetcher:()=>{assert.fail('关闭状态不得调用模型');}});
test('造句服务初始关闭，健康检查不报告已接通',async()=>{
 const response=await closedWorker().fetch(request('/health'),env),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.configured,false);assert.equal(body.qualityApproved,false);
});
test('仅保存密钥、零预算和关闭开关均不能调用模型',async()=>{
 const response=await closedWorker().fetch(request('/feedback',{}),{...env,DEEPSEEK_API_KEY:'TEST_ONLY'});
 assert.equal(response.status,503);assert.equal((await response.json()).code,'UNCONFIGURED');
});
test('质量门未批准时，配置完整也不能开放正式批改',async()=>{
 const response=await closedWorker().fetch(request('/feedback',{}),{...env,FEEDBACK_ENABLED:'true',DEEPSEEK_API_KEY:'TEST_ONLY',FEEDBACK_MONTHLY_CNY_LIMIT:'1',FEEDBACK_BUDGET:{}});
 assert.equal(response.status,503);assert.equal((await response.json()).code,'QUALITY_PENDING');
});
test('错误来源被拒绝，允许来源的预检返回无正文204',async()=>{
 const worker=closedWorker();assert.equal((await worker.fetch(request('/health',undefined,'https://other.test'),env)).status,403);
 const response=await worker.fetch(new Request('https://worker.test/feedback',{method:'OPTIONS',headers:{Origin:origin}}),env);
 assert.equal(response.status,204);assert.equal(await response.text(),'');
});
test('缺少端点时客户端不发送原句',async()=>{
 let called=false;await assert.rejects(createFeedbackClient({apiBase:'',fetcher:()=>{called=true;}})({}),{code:'UNCONFIGURED'});assert.equal(called,false);
});
test('已取消的请求不调用外部服务',async()=>{
 const req=await feedbackRequest({id:'event-1',value:'I has a book.'},{id:'word-1',surface:'book',content:{senseId:'book-noun',definition:'Pages for reading.'}});
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(createFeedbackClient({apiBase:'https://worker.test',fetcher:()=>{called=true;}})(req,{signal:controller.signal}),{code:'CANCELLED'});assert.equal(called,false);
});
test('无问题判断不能同时包含错误建议或错误词义',()=>{
 const value={assessment:'no_clear_issue',targetUsage:'different_sense',suggestedSentence:'I have a book.',explanationZh:'测试',issues:[]};
 assert.throws(()=>validateAssessment(value,'I have a book.'),{code:'INVALID_RESULT'});
});
test('正式服务未启用前固定样例接口也保持关闭',async()=>{
 const response=await closedWorker().fetch(request('/benchmark',{caseId:'e01'}),{...env,DEEPSEEK_API_KEY:'TEST_ONLY'});
 assert.equal(response.status,503);assert.equal((await response.json()).code,'UNCONFIGURED');
});
test('测试模式不接受35条以外的句子，正式模式不暴露样例接口',async()=>{
 const req=await feedbackRequest({id:'event-1',value:'I has an apple.'},{id:'word-1',surface:'apple',content:{senseId:'apple-noun',definition:'A fruit.'}});
 const configured={...env,FEEDBACK_ENABLED:'true',FEEDBACK_QUALITY_APPROVED:'true',DEEPSEEK_API_KEY:'TEST_ONLY',FEEDBACK_MONTHLY_CNY_LIMIT:'1',FEEDBACK_BUDGET:{getByName(){assert.fail('拒绝的请求不得占用额度')}}};
 const worker=closedWorker();assert.equal((await worker.fetch(request('/feedback',req),configured)).status,400);assert.equal((await worker.fetch(request('/benchmark',{caseId:'e01'}),configured)).status,404);
});
test('模型失败不回传密钥或冒充正确，仍结算保守预留',async()=>{
 const req=await feedbackRequest({id:'event-1',value:'I has a book.'},{id:'word-1',surface:'book',content:{senseId:'book-noun',definition:'Pages for reading.'}});let settled=false;
 const configured={...env,FEEDBACK_ENABLED:'true',FEEDBACK_QUALITY_APPROVED:'true',FEEDBACK_TEST_ONLY:'false',DEEPSEEK_API_KEY:'TEST_SECRET_DO_NOT_RETURN',FEEDBACK_MONTHLY_CNY_LIMIT:'1',FEEDBACK_BUDGET:{getByName(name){assert.equal(name,'production-v1');return {async fetch(url){if(url.endsWith('/settle'))settled=true;return new Response(JSON.stringify(url.endsWith('/reserve')?{reserved:true}:{saved:true}));}}}}};
 const worker=createFeedbackWorker({fetcher:async()=>new Response('TEST_SECRET_DO_NOT_RETURN',{status:401})});
 const response=await worker.fetch(request('/feedback',req),configured),body=await response.text();assert.equal(response.status,502);assert.equal(JSON.parse(body).code,'PROVIDER_FAILED');assert(!body.includes('TEST_SECRET'));assert(settled);
});
