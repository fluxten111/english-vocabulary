import {reviewedContent} from './review-catalog.mjs';
import {norm} from './core.mjs';
import {reviewedResult} from './dictionary-provider.mjs';
const respond=(body,status,origin)=>new Response(JSON.stringify(body),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'Access-Control-Allow-Origin':origin,'Vary':'Origin',
  'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type',
  'X-Content-Type-Options':'nosniff'
}});
export function createWorker({fetcher=fetch,reviews=reviewedContent}={}) {
  return {async fetch(request,env){
    const allowed=env.ALLOWED_ORIGIN||'https://fluxten111.github.io';
    const origin=request.headers.get('Origin');
    if(origin!==allowed)return respond({code:'ORIGIN_DENIED'},403,allowed);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'
    }});
    const path=new URL(request.url).pathname;
    const configured=!!env.MW_API_KEY&&env.MW_AUTOMATIC_QUERIES_APPROVED==='true'&&env.MW_RETENTION_APPROVED==='true'&&!!env.QUOTA;
    if(path==='/health'&&request.method==='GET')return respond({configured,reviewedWords:reviews.length},200,allowed);
    if(path!=='/lookup'||request.method!=='POST')return respond({code:'NOT_FOUND'},404,allowed);
    if(!env.MW_API_KEY||!env.QUOTA)return respond({code:'UNCONFIGURED'},503,allowed);
    if(env.MW_AUTOMATIC_QUERIES_APPROVED!=='true'||env.MW_RETENTION_APPROVED!=='true')
      return respond({code:'PERMISSION_REQUIRED'},503,allowed);
    let body;
    try{const text=await request.text();if(text.length>2048)throw Error();body=JSON.parse(text);
      if(!body||!['requestId','wordId'].every(k=>typeof body[k]==='string'&&/^[\w-]{1,100}$/.test(body[k]))||
        typeof body.word!=='string'||body.word.length>500||!/^[a-zA-Z]+(?:[ '\-’][a-zA-Z]+)*$/.test(body.word.trim()))throw Error();
    }catch{return respond({code:'INVALID_REQUEST'},400,allowed);}
    const quota=await env.QUOTA.getByName('learners').fetch('https://quota.internal/check',{method:'POST'});
    if(!quota.ok)return respond({code:'QUOTA'},429,allowed);
    const controller=new AbortController();
    const relay=()=>controller.abort();request.signal.addEventListener('abort',relay,{once:true});
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      if(request.signal.aborted)controller.abort();
      const url=new URL('https://www.dictionaryapi.com/api/v3/references/learners/json/'+encodeURIComponent(norm(body.word)));
      url.searchParams.set('key',env.MW_API_KEY);
      const upstream=await fetcher(url,{signal:controller.signal,headers:{Accept:'application/json'}});
      if(!upstream.ok)return respond({code:upstream.status===429?'QUOTA':'LOOKUP_FAILED'},upstream.status===429?429:502,allowed);
      const text=await upstream.text();if(text.length>1000000)throw Error('oversized');
      const result=await reviewedResult({raw:JSON.parse(text),wordId:body.wordId,word:body.word,requestId:body.requestId,reviews});
      return respond(result,200,allowed);
    }catch{return respond({code:controller.signal.aborted?'REQUEST_TIMEOUT':'LOOKUP_FAILED'},502,allowed);}
    finally{clearTimeout(timer);request.signal.removeEventListener('abort',relay);}
  }};
}
export default createWorker();
// This global budget is serialized in one Durable Object, not a per-browser counter.
export class DictionaryQuota {
  constructor(state){this.state=state;}
  async fetch(){
    const now=Date.now(),day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
    const allowed=await this.state.storage.transaction(async storage=>{
      const old=await storage.get('budget')||{};
      const current={day,minute,daily:old.day===day?old.daily:0,recent:old.minute===minute?old.recent:0};
      if(current.daily>=900||current.recent>=60)return false;
      current.daily++;current.recent++;await storage.put('budget',current);return true;
    });
    return new Response(allowed?'ok':'quota',{status:allowed?200:429});
  }
}
