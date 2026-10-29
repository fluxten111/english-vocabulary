import {test} from 'node:test';import assert from 'node:assert/strict';
import {fresh,createBatch,act,validate,merge,latestSentenceEvent,addSentenceFeedback,reviseSentence} from './core.mjs';
import {reviewedLessons} from './review-catalog.mjs';
import {feedbackRequest,createFeedbackClient,validateFeedbackResponse} from './sentence-feedback.mjs';
async function fixture(){const d=fresh();createBatch(d,'apple','TEST');d.words[0].content=structuredClone(reviewedLessons.apple);const s=d.sessions[0];s.phase='sentence';const event=act(d,s.id,'sentence','I has an apple.');const req=await feedbackRequest(event,d.words[0]);return {d,s,event,req};}
const response=req=>({schema:1,status:'completed',method:'automated_reference',provider:'deepseek',model:'deepseek-flash',requestId:req.requestId,attemptEventId:req.attemptEventId,wordId:req.wordId,senseId:req.senseId,textHash:req.textHash,result:{assessment:'suggestions',targetUsage:'matches_sense',suggestedSentence:'I have an apple.',explanationZh:'主语I搭配have。',issues:[{kind:'grammar',original:'has',suggested:'have',explanationZh:'主谓一致。'}]}});
test('反馈与修订独立追加，原句不覆盖且备份能纯校验、重复合并',async()=>{
 const {d,s,event,req}=await fixture(),original=JSON.stringify(event);addSentenceFeedback(d,s.id,req,'requested');addSentenceFeedback(d,s.id,req,'completed',{response:response(req)});
 reviseSentence(d,s.id,'I have an apple.');reviseSentence(d,s.id,'I have a red apple.');
 assert.equal(JSON.stringify(event),original);assert.equal(latestSentenceEvent(d,s).value,'I have a red apple.');assert(d.events.filter(e=>e.type==='sentenceRevision').every(e=>e.parentEventId===event.id));
 const before=JSON.stringify(d),restored=JSON.parse(before);validate(restored);merge(d,restored);assert.equal(JSON.stringify(d),before);
});
test('修订后旧句反馈拒绝写入；离开造句也拒绝迟到反馈',async()=>{
 const {d,s,req}=await fixture();reviseSentence(d,s.id,'I have an apple.');assert.throws(()=>addSentenceFeedback(d,s.id,req,'completed',{response:response(req)}));
 const freshReq=await feedbackRequest(latestSentenceEvent(d,s),d.words[0]);act(d,s.id,'next');assert.throws(()=>addSentenceFeedback(d,s.id,freshReq,'completed',{response:response(freshReq)}));
});
test('反馈错配句子或词义被拒绝，原句保持不变',async()=>{
 const {req}=await fixture(),answer=response(req);answer.attemptEventId='wrong-event';assert.throws(()=>validateFeedbackResponse(answer,req));answer.attemptEventId=req.attemptEventId;answer.senseId='wrong-sense';assert.throws(()=>validateFeedbackResponse(answer,req));
});
test('超时即返回失败，即使底层请求忽略取消；不得冒充批改成功',async()=>{
 const {req}=await fixture();let deadline,notifyTimer;const timerStarted=new Promise(resolve=>notifyTimer=resolve);
 const call=createFeedbackClient({apiBase:'https://test.invalid',fetcher:()=>new Promise(()=>{}),setTimer:fn=>{deadline=fn;notifyTimer();return 1;},clearTimer:()=>{}})(req);
 const failed=assert.rejects(call,{code:'TIMEOUT'});await timerStarted;assert(deadline);deadline();await failed;
});
test('空模型正文与配额拒绝均作为失败，不产生正确判断',async()=>{
 const {req}=await fixture();for(const [value,status]of [['',200],[JSON.stringify({code:'QUOTA'}),429]]){
 const client=createFeedbackClient({apiBase:'https://test.invalid',fetcher:async()=>new Response(value,{status})});await assert.rejects(client(req));
 }
});
