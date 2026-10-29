export const FEEDBACK_WAIT_MS=20000;
export const feedbackError=(code,message)=>Object.assign(Error(message||code),{code});
const text=(s,max)=>typeof s==='string'&&Array.from(s).length<=max;
const identifier=s=>text(s,100)&&/^[\w-]+$/.test(s);
export async function sentenceHash(sentence){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sentence));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function feedbackRequest(event,word,requestId=crypto.randomUUID()){
  const req={schema:1,requestId,attemptEventId:event.id,wordId:word.id,senseId:word.content.senseId,
    word:word.surface,definition:word.content.definition,sentence:event.value,textHash:await sentenceHash(event.value)};
  await validateFeedbackRequest(req);return req;
}
export async function validateFeedbackRequest(req){
  if(!req||req.schema!==1||!['requestId','attemptEventId','wordId'].every(k=>identifier(req[k]))||
    !text(req.senseId,500)||!req.senseId||!text(req.word,100)||!req.word||
    !text(req.definition,1000)||!req.definition||!text(req.sentence,500)||!req.sentence.trim()||
    req.textHash!==await sentenceHash(req.sentence))throw feedbackError('INVALID_REQUEST','句子检查请求无效或超过500字符。原句仍可只保存。');
  return req;
}
export function validateAssessment(result,sentence){
  if(!result||!['suggestions','no_clear_issue','uncertain'].includes(result.assessment)||
    !['matches_sense','different_sense','missing','uncertain'].includes(result.targetUsage)||
    !text(result.suggestedSentence,700)||!text(result.explanationZh,1200)||!result.explanationZh||
    !Array.isArray(result.issues)||result.issues.length>8)throw feedbackError('INVALID_RESULT','批改结果不完整，暂不能判断。');
  for(const issue of result.issues){
    if(!issue||!['grammar','word_use','clarity'].includes(issue.kind)||!text(issue.original,500)||
      !text(issue.suggested,500)||!text(issue.explanationZh,400)||!issue.explanationZh||
      (issue.original&&!sentence.includes(issue.original)))throw feedbackError('INVALID_RESULT','批改结果与原句不符，暂不能判断。');
  }
  if(result.assessment==='no_clear_issue'&&(result.issues.length||result.targetUsage!=='matches_sense'))throw feedbackError('INVALID_RESULT','批改判断不一致，暂不能判断。');
  if(result.assessment==='suggestions'&&(!result.issues.length||!result.suggestedSentence.trim()))throw feedbackError('INVALID_RESULT','批改建议缺失，暂不能判断。');
  return {assessment:result.assessment,targetUsage:result.targetUsage,suggestedSentence:result.suggestedSentence,
    explanationZh:result.explanationZh,issues:result.issues.map(i=>({kind:i.kind,original:i.original,suggested:i.suggested,explanationZh:i.explanationZh}))};
}
export function validateFeedbackResponse(response,req){
  if(!response||response.schema!==1||response.status!=='completed'||response.method!=='automated_reference'||
    !text(response.model,100)||!response.model||response.provider!=='deepseek'||
    ['requestId','attemptEventId','wordId','senseId','textHash'].some(k=>response[k]!==req[k]))throw feedbackError('INVALID_RESPONSE','反馈对应的句子或词义不一致，已拒绝使用。');
  return {...response,result:validateAssessment(response.result,req.sentence)};
}
export function createFeedbackClient({apiBase,fetcher=fetch,setTimer=setTimeout,clearTimer=clearTimeout,waitMs=FEEDBACK_WAIT_MS}={}){
  return async(req,{signal}={})=>{
    if(!apiBase)throw feedbackError('UNCONFIGURED','句子检查尚未接通，原句可照常保存。');
    await validateFeedbackRequest(req);
    const controller=new AbortController();let timer,rejectCancel;
    const cancelled=new Promise((_,reject)=>{rejectCancel=reject;});
    const cancel=()=>{controller.abort();rejectCancel(feedbackError('CANCELLED','检查已取消。'));};
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    const timeout=new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(feedbackError('TIMEOUT','检查超时；原句已保留，可重试或继续。'));},waitMs);});
    const task=(async()=>{
      if(controller.signal.aborted)throw feedbackError('CANCELLED','检查已取消。');
      const response=await fetcher(apiBase.replace(/\/$/,'')+'/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req),signal:controller.signal});
      const body=await response.text();if(body.length>30000)throw feedbackError('INVALID_RESPONSE','反馈过长，暂不能判断。');
      let value;try{value=JSON.parse(body);}catch{throw feedbackError('INVALID_RESPONSE','反馈格式无效，暂不能判断。');}
      if(!response.ok)throw feedbackError(value.code||'SERVICE_FAILED',({QUOTA:'已达到检查额度，原句已保存。',UNCONFIGURED:'句子检查尚未接通。',QUALITY_PENDING:'批改质量检查尚未完成，暂不开放。'})[value.code]||'暂时无法检查，原句已保留。');
      return validateFeedbackResponse(value,req);
    })();
    try{return await Promise.race([task,timeout,cancelled]);}
    finally{clearTimer(timer);signal?.removeEventListener('abort',cancel);}
  };
}
