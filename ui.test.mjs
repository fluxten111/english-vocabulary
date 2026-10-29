import * as feedback from './sentence-feedback.mjs';
import {createRecorder} from './recording.mjs';
// Controlled integration of actual app source. Capture only the startup audit promise
// so assertions wait for real readiness, rather than an arbitrary number of event-loop turns.
// No real audio or API calls.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import * as core from './core.mjs';import * as content from './content.mjs';
import {createPlayback} from './media.mjs';
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(setImmediate)};
async function setup({phase='sound',secondMissing=false,lookup,mediaDevices,mediaRecorder,auditDelayMs=0,feedbackService=null}={}){
  const db=core.fresh();core.createBatch(db,'worda,wordb','TEST ONLY');const reviews=[];
  const contents=[];
  for(const [i,w]of db.words.entries()){
    const c={checked:true,entryId:w.normalized,senseId:w.normalized+'#1',reviewId:'review-'+i,reviewVersion:'1',cue:'A controlled test cue.',audio:{kind:'dictionary',id:'test-audio',url:'https://example.invalid/test.mp3',source:'TEST ONLY',accent:'US',license:'TEST ONLY'},ipa:'test',ipaAccent:'US',ipaSource:'TEST ONLY',definition:'Test definition.',definitionSource:'TEST ONLY',example:'Test example.',exampleSource:'TEST ONLY',chinese:'测试含义',chineseSource:'TEST ONLY'};
    contents.push(c);w.content=secondMissing&&i===1?null:c;
    reviews.push({id:c.reviewId,version:'1',reviewedBy:'test',reviewedAt:'2026-10-28T00:00:00Z',normalizedForm:w.normalized,provider:'merriam-webster/learners',entryId:c.entryId,senseId:c.senseId,accent:'US',digest:await content.contentDigest(c)});
  }
  db.sessions[0].phase=phase;if(phase.endsWith('Retry'))db.sessions[0].queue=db.words.map(w=>w.id);
  const nodes=new Map, audios=[],ownAudios=[],mediaTimers=new Map;let mediaTimer=0;let rootWrites=0, stored=JSON.stringify(db), preparer;
  const make=key=>{let html='',ownText='';return{key,children:[],dataset:{},value:'',disabled:false,get textContent(){return ownText},set textContent(v){ownText=v;this.children=[]},
    get innerHTML(){return html},set innerHTML(value){html=value;if(key==='#app'){rootWrites++;for(const id of ['#spelling','#sentence','#lesson'])nodes.delete(id)}},
    append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[];this.append(...items)},focus(){},addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){},
    insertAdjacentHTML(pos,text){if(text.includes('id="spelling"'))nodes.set('#spelling',make('#spelling'));if(text.includes('id="sentence"'))nodes.set('#sentence',make('#sentence'));},
  }};
  const document={hidden:false,addEventListener(){},createTextNode(text){return {textContent:text}},querySelector(key){if(key==='#sentenceFeedback'){const find=n=>n.id==='sentenceFeedback'?n:(n.children||[]).map(find).find(Boolean);return [...nodes.values()].map(find).find(Boolean)||null;}if(['#spelling','#sentence','#resumePrepared'].includes(key))return nodes.get(key)||null;if(!nodes.has(key))nodes.set(key,make(key));return nodes.get(key)},querySelectorAll(){return[]},createElement(){return make('button')}};
  const mockFetch=async(url,options)=>url.endsWith('/health')?new Response(JSON.stringify({configured:true,qualityApproved:true})):new Response(JSON.stringify(await feedbackService(JSON.parse(options.body),options)));
  const ctx=vm.createContext({...core,...content,...feedback,sentenceFeedbackConfig:{enabled:!!feedbackService,apiBase:feedbackService?'https://feedback.test':''},createFeedbackClient:options=>feedback.createFeedbackClient({...options,fetcher:mockFetch}),fetch:mockFetch,AbortController,console,document,structuredClone,
    checkReviewedContent:async(...args)=>{if(auditDelayMs)await new Promise(resolve=>setTimeout(resolve,auditDelayMs));return content.checkReviewedContent(...args)},
    localStorage:{getItem:()=>stored,setItem:(k,v)=>stored=v},location:{hash:'#home'},
    window:{addEventListener(){},scrollTo(){}},URL,Blob,setTimeout,clearTimeout,setInterval:()=>0,
    navigator:{mediaDevices:mediaDevices||{getUserMedia:async()=>{throw Error('denied')}}},
    createRecorder:options=>createRecorder({...options,getStream:()=>ctx.navigator.mediaDevices.getUserMedia({audio:true}),createMediaRecorder:stream=>new ctx.MediaRecorder(stream),makeUrl:()=>'blob:test-only',revokeUrl:()=>{},createAudio:url=>{const a={url,pause(){},play:()=>Promise.resolve()};ownAudios.push(a);return a;}}),
    MediaRecorder:mediaRecorder||class{constructor(stream){this.stream=stream;this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive'}},
    reviewedContent:reviews,reviewedLessons:{},contentConfig:{apiBase:'https://test.invalid',automaticQueriesApproved:true,contentRetentionApproved:true},
    createPlayback:options=>createPlayback({...options,setTimer:fn=>{mediaTimers.set(++mediaTimer,fn);return mediaTimer},clearTimer:id=>mediaTimers.delete(id),createAudio:url=>{const a={url,paused:false,play(){this.paused=false;this.onplaying?.();return Promise.resolve()},pause(){this.paused=true;this.onpause?.()}};audios.push(a);return a}}),
    createDictionaryClient:()=>async(word,args)=>{
      if(lookup)return lookup(word,args,contents);
      return content.validatePreparedResponse(word,{schema:1,requestId:args.requestId,wordId:word.id,normalizedForm:word.normalized,provider:'merriam-webster/learners',status:'ready',content:contents[db.words.findIndex(w=>w.id===word.id)]},args.requestId,reviews);
    },
    createPreparer:options=>(preparer=content.createPreparer(options))
  });
  const source=fs.readFileSync(new URL('./app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^void auditStoredContent\(\);$/m,'globalThis.__startupAudit = auditStoredContent();');
  vm.runInContext(source,ctx);await ctx.__startupAudit;await settle();
  const flushPlayback=()=>{for(const [id,fn]of [...mediaTimers]){mediaTimers.delete(id);fn();}};
  vm.runInContext('active=db.sessions[0].id;render()',ctx);flushPlayback();await settle();
  const button=text=>{const all=[];const walk=n=>{all.push(n);for(const c of n.children||[])walk(c)};walk(nodes.get('#lesson'));return all.find(n=>n.textContent===text)};
  return{ctx,nodes,audios,ownAudios,db,contents,reviews,button,element:pred=>{const walk=n=>pred(n)?n:(n.children||[]).map(walk).find(Boolean);return walk(nodes.get('#lesson'));},get preparer(){return preparer},get rootWrites(){return rootWrites},state:()=>JSON.parse(vm.runInContext('JSON.stringify(db)',ctx)),run:code=>{const value=vm.runInContext(code,ctx);flushPlayback();return value}};
}
test('后台内容更新不重建练习区，不清空未提交默写',async()=>{const t=await setup({phase:'spell',secondMissing:true});const field=t.nodes.get('#spelling');field.value='unsaved spelling';const before=t.rootWrites;await t.preparer.run(t.db.batches[0].id);assert.equal(t.rootWrites,before);assert.equal(t.nodes.get('#spelling').value,'unsaved spelling');assert.equal(t.state().events.length,0);assert.equal(t.state().words[1].content.senseId,'wordb#1')});
test('页面集成：连续重播、退出、切换词后旧音频不写记录',async()=>{const t=await setup();const first=t.audios[0],ended=first.onended;const replay=t.button('播放词典录音');await replay.onclick();assert(first.paused);t.run("go('home');db.sessions[0].index=1;active=db.sessions[0].id;render()");ended();assert.equal(t.state().events.length,0);t.audios.at(-1).onended();assert.equal(t.state().events[0].wordId,t.db.words[1].id)});
test('麦克风权限迟到后已离开页面：释放设备，不记录先说',async()=>{let resolve;let stopped=0;const t=await setup({phase:'pronounce',auditDelayMs:40,mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});const record=t.button('录音辅助（可选）');const pending=record.onclick();t.run("go('home')");resolve({getTracks:()=>[{stop:()=>stopped++}]});await pending;assert.equal(stopped,1);assert.equal(t.state().events.length,0)});
test('拒绝麦克风不阻塞自行说出与自评入口',async()=>{const t=await setup({phase:'pronounce'});const record=t.button('录音辅助（可选）');await record.onclick();assert.match(t.element(n=>n.id==='recordStatus').textContent,/麦克风不可用/);const said=t.button('我已自己说出，接着听原音');said.onclick();assert.equal(t.state().sessions[0].said,true)});
test('空句不能被保存按钮隐式当成跳过；主动跳过才记录独立造句与未批改状态',async()=>{
 const t=await setup({phase:'sentence'});
 const save=t.button('保存句子');
 t.nodes.get('#sentence').value='   ';save.onclick();
 assert.equal(t.state().events.length,0);assert.equal(t.state().sessions[0].revealed,false);
 assert.match(t.nodes.get('#error').textContent,/明确点击/);
 const skip=t.button('跳过造句');skip.onclick();
 const event=t.state().events.at(-1);assert.equal(event.skipped,true);assert.equal(event.exerciseType,'independent');assert.equal(event.feedback,'not_evaluated');
});

test('中文可重复显隐，只有一份段落，不重绘页面或改变位置',async()=>{
 const t=await setup({phase:'teach'});const reveal=t.button('显示中文');
 const translation=t.element(n=>n.id==='lessonTranslation');const writes=t.rootWrites;
 assert.equal(translation.hidden,true);reveal.onclick();assert.equal(translation.hidden,false);
 assert.equal(reveal.textContent,'隐藏中文');assert.equal(t.state().events.at(-1).type,'chinese');
 reveal.onclick();assert.equal(translation.hidden,true);reveal.onclick();
 assert.equal(translation.hidden,false);assert.equal(t.rootWrites,writes);
 assert.equal(t.state().sessions[0].phase,'teach');assert.equal(t.state().sessions[0].index,0);
});
test('中文查看保存失败时不假装展开，不写成功历史',async()=>{
 const t=await setup({phase:'teach'});t.run("localStorage.setItem=()=>{throw Error('full')}");
 t.button('显示中文').onclick();assert.equal(t.element(n=>n.id==='lessonTranslation').hidden,true);
 assert.equal(t.state().events.length,0);assert.match(t.nodes.get('#error').textContent,/没有完成/);
});
test('造句保存后移除空输入区，原句事件与继续路径保留',async()=>{
 const t=await setup({phase:'sentence'});t.nodes.get('#sentence').value='My saved sentence.';
 t.button('保存句子').onclick();assert.equal(t.nodes.has('#sentence'),false);
 assert.equal(t.state().events.at(-1).value,'My saved sentence.');assert(t.button('下一步'));
});

test('词典音频结束不会清空尚未提交的默写输入',async()=>{
 const t=await setup({phase:'spell'});t.nodes.get('#spelling').value='unsaved answer';const writes=t.rootWrites;
 await t.button('播放词典录音').onclick();t.audios.at(-1).onended();
 assert.equal(t.nodes.get('#spelling').value,'unsaved answer');assert.equal(t.rootWrites,writes);
 assert.equal(t.state().sessions[0].revealed,false);
});
test('声音提示显隐不重绘，提示事实保存而词典内容不变',async()=>{
 const t=await setup();const before=JSON.stringify(t.state().words[0].content),writes=t.rootWrites;
 t.button('显示中文含义').onclick();assert.equal(t.element(n=>n.id==='soundHint-chinese').hidden,false);
 t.button('隐藏中文含义').onclick();assert.equal(t.element(n=>n.id==='soundHint-chinese').hidden,true);
 assert.equal(t.rootWrites,writes);assert.equal(t.state().events.at(-1).type,'hint');
 assert.equal(JSON.stringify(t.state().words[0].content),before);
});

test('录音结束后回放在同一尝试重绘中保留，自己的回放不冒充标准原声',async()=>{
 let stopped=0;
 const t=await setup({phase:'pronounce',mediaDevices:{getUserMedia:()=>Promise.resolve({getTracks:()=>[{stop:()=>stopped++}]})},mediaRecorder:class{
  constructor(){this.state='inactive';this.mimeType='audio/test'}start(){this.state='recording'}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['TEST RECORDING'])});this.onstop?.()}
 }});
 await t.button('录音辅助（可选）').onclick();t.button('停止录音，接着听原音').onclick();
 assert.equal(stopped,1);assert.equal(t.state().sessions[0].said,true);assert.equal(t.state().sessions[0].listened,false);
 assert.equal(t.button('听我的录音').hidden,false);await t.button('听我的录音').onclick();
 assert.equal(t.ownAudios.length,1);t.ownAudios[0].onended();assert.equal(t.state().sessions[0].listened,false);
 await t.button('播放词典录音').onclick();t.audios.at(-1).onended();assert.equal(t.state().sessions[0].listened,true);
 assert(t.button('✓ 我读对了'));assert(t.button('不确定，稍后再练'));
 t.button('重新录音').onclick();assert.equal(t.state().sessions[0].attempt,1);assert.equal(t.state().sessions[0].said,false);
});
test('发音重练自评后有真实再练与继续入口，不覆盖前次自评',async()=>{
 const t=await setup({phase:'pronounceRetry'});
 t.button('我已自己说出，接着听原音').onclick();await t.button('播放词典录音').onclick();t.audios.at(-1).onended();
 t.button('× 我读错了').onclick();assert.equal(t.state().sessions[0].phase,'pronounceRetry');
 assert.equal(t.state().sessions[0].answer,'wrong');assert(t.button('继续下一词'));
 t.button('这个词再练一次').onclick();assert.equal(t.state().sessions[0].index,0);assert.equal(t.state().sessions[0].said,false);
 assert.equal(t.state().events.filter(e=>e.type==='assess').length,1);
});

const feedbackAnswer=req=>({schema:1,status:'completed',method:'automated_reference',provider:'deepseek',model:'deepseek-flash',requestId:req.requestId,attemptEventId:req.attemptEventId,wordId:req.wordId,senseId:req.senseId,textHash:req.textHash,result:{assessment:'suggestions',targetUsage:'matches_sense',suggestedSentence:'I have worda.',explanationZh:'主语I应使用have。',issues:[{kind:'grammar',original:'has',suggested:'have',explanationZh:'主谓一致。'}]}});
test('可选真实接口路径先保存原句，再独立保存反馈并保留继续入口',async()=>{
 const t=await setup({phase:'sentence',feedbackService:async req=>feedbackAnswer(req)});
 t.nodes.get('#sentence').value='I has worda.';t.button('保存并检查（DeepSeek）').onclick();await settle();
 const events=t.state().events;assert.equal(events.find(e=>e.type==='sentence').value,'I has worda.');assert.equal(events.at(-1).status,'completed');assert(t.button('下一步'));assert(t.element(n=>n.textContent==='修改建议'));
});
test('快速重复点击只发起一次检查，不重复调用服务',async()=>{
 let calls=0,resolve;const t=await setup({phase:'sentence',feedbackService:req=>{calls++;return new Promise(r=>resolve=()=>r(feedbackAnswer(req)));}});
 t.nodes.get('#sentence').value='I has worda.';t.button('保存句子').onclick();const check=t.button('检查这句（DeepSeek）');check.onclick();check.onclick();await settle();assert.equal(calls,1);resolve();await settle();assert.equal(t.state().events.filter(e=>e.status==='completed').length,1);
});
test('退出后迟到反馈不写入其他阶段，原句仍保留',async()=>{
 let resolve;const t=await setup({phase:'sentence',feedbackService:req=>new Promise(r=>resolve=()=>r(feedbackAnswer(req)))});
 t.nodes.get('#sentence').value='I has worda.';t.button('保存并检查（DeepSeek）').onclick();await settle();t.run("go('home')");resolve();await settle();
 assert.equal(t.state().events.filter(e=>e.status==='completed').length,0);assert.equal(t.state().events.find(e=>e.type==='sentence').value,'I has worda.');
});
test('反馈保存失败可仅重试保存，无需第二次外部调用',async()=>{
 let calls=0,resolve;const t=await setup({phase:'sentence',feedbackService:req=>{calls++;return new Promise(r=>resolve=()=>r(feedbackAnswer(req)));}});
 t.nodes.get('#sentence').value='I has worda.';t.button('保存并检查（DeepSeek）').onclick();await settle();t.run("const restoreStore=localStorage.setItem;localStorage.setItem=()=>{throw Error('full')}");resolve();await settle();
 assert(t.button('重试保存反馈'));assert.equal(t.state().events.filter(e=>e.status==='completed').length,0);t.run('localStorage.setItem=restoreStore');t.button('重试保存反馈').onclick();assert.equal(calls,1);assert.equal(t.state().events.at(-1).status,'completed');
});
test('超过检查长度仍保存原句并保留修改和继续入口，不调用模型',async()=>{
 let calls=0;const t=await setup({phase:'sentence',feedbackService:async req=>{calls++;return feedbackAnswer(req)}});
 t.nodes.get('#sentence').value='a'.repeat(501);t.button('保存并检查（DeepSeek）').onclick();await settle();
 assert.equal(calls,0);assert.equal(t.state().events.find(e=>e.type==='sentence').value.length,501);assert(t.button('修改我的句子'));assert(t.button('下一步'));assert(t.element(n=>n.textContent.includes('超过500')));
});
test('服务暂不可用仍能查看已保存反馈，不展示外部检查按钮',async()=>{
 const t=await setup({phase:'sentence',feedbackService:async req=>feedbackAnswer(req)});
 t.nodes.get('#sentence').value='I has worda.';t.button('保存并检查（DeepSeek）').onclick();await settle();t.run('feedbackReady=false;render()');
 assert(t.element(n=>n.textContent==='修改建议'));assert.equal(t.button('再次检查这句'),undefined);assert(t.button('下一步'));
});
