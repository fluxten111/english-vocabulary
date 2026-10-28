import {ready, norm, validateContent} from './core.mjs?v=20261028-learning-entry';
export const MAX_WAIT_MS = 150000;
export const REQUEST_WAIT_MS = 15000;
export class PreparationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code,message) => new PreparationError(code,message);
const cancelled = () => fail('CANCELLED','本轮准备已停止。');
const messages = {
  UNCONFIGURED:'词典服务尚未配置，当前没有正在运行的准备任务。',
  PERMISSION_REQUIRED:'词典自动查询和内容保存的使用范围尚未确认，当前未发送查询。',
  DEADLINE:'本轮准备已达到 150 秒上限，已结束等待。已成功的内容保留。',
  REQUEST_TIMEOUT:'词典响应超时，请稍后重试。',
  LOOKUP_FAILED:'词典查询失败，请检查网络后重试。',
  SAVE_FAILED:'内容尚未确认保存，已停止准备。请先处理保存问题。',
  INVALID_RESPONSE:'返回内容与请求或核对记录不一致，未作为学习内容使用。',
  REVIEW_REQUIRED:'这个词的可靠录音或教学内容尚待补充核对；当前位置已保留。',
  NOT_FOUND:'词典没有找到匹配词条。',
  QUOTA:'词典查询额度或频率已达上限，请稍后再试。',
  INTERRUPTED:'上次准备已中断；没有任务正在后台运行，可重试未完成内容。'
};
export const preparationMessage = code => messages[code] || '内容暂未准备好。';
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
}
export async function contentDigest(content) {
  const bytes = new TextEncoder().encode(canonical(content));
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function checkReviewedContent(word, content, reviews) {
  try{validateContent(content);}catch{throw fail('INVALID_RESPONSE',messages.INVALID_RESPONSE);}
  const record = reviews.find(r => r.id === content?.reviewId && r.version === content?.reviewVersion);
  if (!record || !record.reviewedBy || !Number.isFinite(Date.parse(record.reviewedAt)) ||
    record.normalizedForm !== word.normalized || record.provider !== 'merriam-webster/learners' ||
    record.entryId !== content.entryId || record.senseId !== content.senseId ||
    record.accent !== 'US' || content.audio?.accent !== record.accent ||
    record.digest !== await contentDigest(content)) {
    throw fail('INVALID_RESPONSE',messages.INVALID_RESPONSE);
  }
  if (!ready({...word,content},'sound') || !ready({...word,content},'teach'))
    throw fail('INVALID_RESPONSE','已核对内容仍有必要字段缺失。');
  return content;
}
export async function validatePreparedResponse(word, response, requestId, reviews) {
  if (!response || response.schema !== 1 || response.requestId !== requestId ||
    response.wordId !== word.id || response.normalizedForm !== word.normalized ||
    response.provider !== 'merriam-webster/learners') throw fail('INVALID_RESPONSE',messages.INVALID_RESPONSE);
  if (['review_required','not_found'].includes(response.status)) return response;
  if (response.status !== 'ready') throw fail('INVALID_RESPONSE',messages.INVALID_RESPONSE);
  await checkReviewedContent(word,response.content,reviews);
  return response;
}
export function createDictionaryClient(config, {fetcher = fetch, reviews = [], lessons = {}} = {}) {
  function remotePreflight() {
    if (!config.apiBase) throw fail('UNCONFIGURED',messages.UNCONFIGURED);
    if (!config.automaticQueriesApproved || !config.contentRetentionApproved)
      throw fail('PERMISSION_REQUIRED',messages.PERMISSION_REQUIRED);
    let endpoint;
    try { endpoint = new URL(config.apiBase); }
    catch { throw fail('UNCONFIGURED',messages.UNCONFIGURED); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw fail('UNCONFIGURED',messages.UNCONFIGURED);
    return endpoint;
  }
  // Reviewed original teaching text and links to verified dictionary recordings
  // are usable independently of permissions for automated dictionary queries.
  function preflight() { if (Object.keys(lessons).length) return; return remotePreflight(); }
  const lookup = async (word,{signal,requestId}) => {
    if (signal?.aborted) throw signal.reason || cancelled();
    const local=Object.hasOwn(lessons,word.normalized) ? lessons[word.normalized] : null;
    if(local) return validatePreparedResponse(word,{schema:1,requestId,wordId:word.id,
      normalizedForm:word.normalized,provider:'merriam-webster/learners',status:'ready',content:structuredClone(local)},requestId,reviews);
    if(Object.keys(lessons).length && (!config.apiBase || !config.automaticQueriesApproved || !config.contentRetentionApproved))
      return {schema:1,requestId,wordId:word.id,normalizedForm:word.normalized,provider:'merriam-webster/learners',status:'review_required'};
    const endpoint=remotePreflight();
    const response = await fetcher(endpoint.href.replace(/\/$/,'')+'/lookup',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({requestId,wordId:word.id,word:word.surface}),signal
    });
    if (!response.ok) {
      let code = response.status === 429 ? 'QUOTA' : 'LOOKUP_FAILED';
      try { const body = await response.json(); if (messages[body.code]) code = body.code; } catch {}
      throw fail(code,messages[code]);
    }
    const text = await response.text();
    if (text.length > 1000000) throw fail('INVALID_RESPONSE',messages.INVALID_RESPONSE);
    let body;try { body = JSON.parse(text); } catch { throw fail('INVALID_RESPONSE',messages.INVALID_RESPONSE); }
    return validatePreparedResponse(word,body,requestId,reviews);
  };
  lookup.preflight=preflight;
  return lookup;
}
// Abort races also release a task when a third-party promise ignores its signal.
function abortable(factory,signal) {
  return new Promise((resolve,reject) => {
    if (signal.aborted) {reject(signal.reason || cancelled());return;}
    const onAbort = () => {cleanup();reject(signal.reason || cancelled());};
    const cleanup = () => signal.removeEventListener('abort',onAbort);
    signal.addEventListener('abort',onAbort,{once:true});
    Promise.resolve().then(factory).then(value => {cleanup();resolve(value);},error => {cleanup();reject(error);});
  });
}
export function createPreparer({getBatch,getWords,usable,lookup,commit,publish,
  now = () => Date.now(),setTimer = setTimeout,clearTimer = clearTimeout,makeId = () => crypto.randomUUID()}) {
  const jobs = new Map();
  function snapshot(job) {
    const states = [...job.items.values()];
    const readyCount = getWords(job.batchId).filter(w=>usable(w)).length;
    const finished = states.filter(x => !['queued','loading'].includes(x.status)).length;
    const elapsedMs = Math.max(0,Math.min(MAX_WAIT_MS,now()-job.startedAt));
    const pending = states.length-finished;
    const estimateMs = finished >= 2 && pending > 0 ? Math.min(Math.max(0,job.deadlineAt-now()),Math.ceil(elapsedMs/finished*pending)) : null;
    return {runId:job.runId,status:job.status,code:job.code,startedAt:job.startedAt,
      deadlineAt:job.deadlineAt,elapsedMs,total:states.length,ready:readyCount,finished,
      pending,blocked:states.filter(x=>x.status==='blocked').length,needsReview:states.filter(x=>x.status==='review_required').length,
      failed:states.filter(x=>['failed','timeout','not_found'].includes(x.status)).length,
      estimateMs,items:Object.fromEntries([...job.items].map(([id,x])=>[id,{...x}]))};
  }
  function owns(job) {return jobs.get(job.batchId) === job;}
  function live(job) {
    if (!owns(job) || job.controller.signal.aborted) throw cancelled();
    if (now() >= job.deadlineAt) throw fail('DEADLINE',messages.DEADLINE);
  }
  function emit(job) {
    if (!owns(job)) return;
    const result = publish(job.batchId,snapshot(job));
    if (result === false) throw fail('SAVE_FAILED',messages.SAVE_FAILED);
  }
  function cancel(batchId) {
    const job=jobs.get(batchId);if(!job || job.status!=='preparing')return;
    job.status='cancelled';job.code='INTERRUPTED';job.controller.abort(cancelled());
  }
  async function one(job,word) {
    if (usable(word)) {job.items.set(word.id,{status:'ready'});return;}
    for (let attempt=0;attempt<2;attempt++) {
      live(job);
      const slot={status:'loading',attempt:attempt+1};job.items.set(word.id,slot);emit(job);
      const controller=new AbortController();
      const parentAbort=()=>controller.abort(job.controller.signal.reason || cancelled());
      job.controller.signal.addEventListener('abort',parentAbort,{once:true});
      const remaining=Math.min(REQUEST_WAIT_MS,job.deadlineAt-now());
      const timer=setTimer(()=>controller.abort(fail('REQUEST_TIMEOUT',messages.REQUEST_TIMEOUT)),Math.max(0,remaining));
      const requestId=makeId();
      try {
        const result=await abortable(()=>lookup(word,{signal:controller.signal,requestId}),controller.signal);
        live(job);
        if(result.status==='ready') {
          // Commit must recheck the current word identity/content before writing.
          const committed=await commit(job.batchId,word,result,()=>live(job));
          live(job);if(committed===false)throw fail('SAVE_FAILED',messages.SAVE_FAILED);
          job.items.set(word.id,{status:'ready'});
        } else job.items.set(word.id,{status:result.status,code:result.status==='not_found'?'NOT_FOUND':'REVIEW_REQUIRED'});
        emit(job);return;
      } catch(error) {
        if(job.controller.signal.aborted || !owns(job))throw error;
        if(error.code==='SAVE_FAILED')throw error;
        const retryable=['REQUEST_TIMEOUT','LOOKUP_FAILED'].includes(error.code || 'LOOKUP_FAILED');
        if(retryable && attempt===0 && now()<job.deadlineAt)continue;
        job.items.set(word.id,{status:'failed',code:error.code || 'LOOKUP_FAILED'});emit(job);
        if(['UNCONFIGURED','PERMISSION_REQUIRED','QUOTA'].includes(error.code))throw error;
        return;
      } finally {clearTimer(timer);job.controller.signal.removeEventListener('abort',parentAbort);}
    }
  }
  async function pool(job,words) {
    let index=0;
    const worker=async()=>{while(index<words.length){live(job);const word=words[index++];await one(job,word);}};
    await Promise.all(Array.from({length:Math.min(2,words.length)},worker));
  }
  function run(batchId,{retry=false}={}) {
    const current=jobs.get(batchId);
    if(current?.status==='preparing'&&!retry)return current.promise;
    if(current?.status==='preparing')cancel(batchId);
    const batch=getBatch(batchId), words=getWords(batchId);
    if(!batch)throw Error('词批次不存在。');
    const previous=batch.preparation;
    const startedAt=!retry && previous?.status==='preparing' && Number.isFinite(previous.startedAt) ? Math.min(now(),previous.startedAt) : now();
    const job={batchId,runId:makeId(),controller:new AbortController(),startedAt,deadlineAt:startedAt+MAX_WAIT_MS,
      status:'preparing',code:null,items:new Map(words.map(w=>[w.id,{status:usable(w)?'ready':'queued'}]))};
    jobs.set(batchId,job);
    const timer=setTimer(()=>job.controller.abort(fail('DEADLINE',messages.DEADLINE)),Math.max(0,job.deadlineAt-now()));
    job.promise=(async()=>{
      try {
        lookup.preflight?.();live(job);emit(job);
        await pool(job,words.slice(0,5));
        await pool(job,words.slice(5));
        live(job);job.status=words.every(w=>usable(getWords(batchId).find(x=>x.id===w.id)))?'ready':'partial';
      } catch(error) {
        if(!owns(job))return snapshot(job);
        const code=job.controller.signal.reason?.code || error.code || 'LOOKUP_FAILED';
        job.code=code;job.status=code==='DEADLINE'?'timeout':code==='CANCELLED'?'cancelled':code==='UNCONFIGURED'?'unconfigured':'failed';
        job.controller.abort(error);
        for(const [id,item]of job.items)if(['queued','loading'].includes(item.status))job.items.set(id,{status:item.status==='queued'?'blocked':job.status==='timeout'?'timeout':'failed',code});
      } finally {
        clearTimer(timer);
        if(owns(job)) {try{emit(job);}catch{job.status='failed';job.code='SAVE_FAILED';}}
      }
      return snapshot(job);
    })();
    return job.promise;
  }
  return {run,cancel,isRunning:id=>jobs.get(id)?.status==='preparing',status:id=>jobs.has(id)?snapshot(jobs.get(id)):null};
}
