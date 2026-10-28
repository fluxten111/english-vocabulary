// Controlled integration of the unmodified app source. No real audio or API calls.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import * as core from './core.mjs';import * as content from './content.mjs';
import {createPlayback} from './media.mjs';
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(setImmediate)};
async function setup({phase='sound',secondMissing=false,lookup,mediaDevices}={}){
  const db=core.fresh();core.createBatch(db,'worda,wordb','TEST ONLY');const reviews=[];
  const contents=[];
  for(const [i,w]of db.words.entries()){
    const c={checked:true,entryId:w.normalized,senseId:w.normalized+'#1',reviewId:'review-'+i,reviewVersion:'1',cue:'A controlled test cue.',audio:{kind:'dictionary',id:'test-audio',url:'https://example.invalid/test.mp3',source:'TEST ONLY',accent:'US',license:'TEST ONLY'},ipa:'test',ipaAccent:'US',ipaSource:'TEST ONLY',definition:'Test definition.',definitionSource:'TEST ONLY',example:'Test example.',exampleSource:'TEST ONLY'};
    contents.push(c);w.content=secondMissing&&i===1?null:c;
    reviews.push({id:c.reviewId,version:'1',reviewedBy:'test',reviewedAt:'2026-10-28T00:00:00Z',normalizedForm:w.normalized,provider:'merriam-webster/learners',entryId:c.entryId,senseId:c.senseId,accent:'US',digest:await content.contentDigest(c)});
  }
  db.sessions[0].phase=phase;
  const nodes=new Map, audios=[];let rootWrites=0, stored=JSON.stringify(db), preparer;
  const make=key=>{let html='';return{key,children:[],dataset:{},value:'',textContent:'',disabled:false,
    get innerHTML(){return html},set innerHTML(value){html=value;if(key==='#app'){rootWrites++;for(const id of ['#spelling','#sentence','#lesson'])nodes.delete(id)}},
    append(n){this.children.push(n)},addEventListener(){},classList:{toggle(){}},setAttribute(){},removeAttribute(){},
    insertAdjacentHTML(pos,text){if(text.includes('id="spelling"'))nodes.set('#spelling',make('#spelling'));if(text.includes('id="sentence"'))nodes.set('#sentence',make('#sentence'));},
  }};
  const document={querySelector(key){if(['#spelling','#sentence','#resumePrepared'].includes(key))return nodes.get(key)||null;if(!nodes.has(key))nodes.set(key,make(key));return nodes.get(key)},querySelectorAll(){return[]},createElement(){return make('button')}};
  const ctx=vm.createContext({...core,...content,console,document,structuredClone,
    localStorage:{getItem:()=>stored,setItem:(k,v)=>stored=v},location:{hash:'#home'},
    window:{addEventListener(){},scrollTo(){}},URL,Blob,setTimeout,clearTimeout,setInterval:()=>0,
    navigator:{mediaDevices:mediaDevices||{getUserMedia:async()=>{throw Error('denied')}}},
    MediaRecorder:class{constructor(stream){this.stream=stream;this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive'}},
    reviewedContent:reviews,contentConfig:{apiBase:'https://test.invalid',automaticQueriesApproved:true,contentRetentionApproved:true},
    createPlayback:options=>createPlayback({...options,createAudio:url=>{const a={url,paused:false,play:()=>Promise.resolve(),pause(){this.paused=true}};audios.push(a);return a}}),
    createDictionaryClient:()=>async(word,args)=>{
      if(lookup)return lookup(word,args,contents);
      return content.validatePreparedResponse(word,{schema:1,requestId:args.requestId,wordId:word.id,normalizedForm:word.normalized,provider:'merriam-webster/learners',status:'ready',content:contents[db.words.findIndex(w=>w.id===word.id)]},args.requestId,reviews);
    },
    createPreparer:options=>(preparer=content.createPreparer(options))
  });
  const source=fs.readFileSync(new URL('./app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,ctx);await settle();
  vm.runInContext('active=db.sessions[0].id;render()',ctx);await settle();
  return{ctx,nodes,audios,db,contents,reviews,get preparer(){return preparer},get rootWrites(){return rootWrites},state:()=>JSON.parse(vm.runInContext('JSON.stringify(db)',ctx)),run:code=>vm.runInContext(code,ctx)};
}
test('后台内容更新不重建练习区，不清空未提交默写',async()=>{const t=await setup({phase:'spell',secondMissing:true});const field=t.nodes.get('#spelling');field.value='unsaved spelling';const before=t.rootWrites;await t.preparer.run(t.db.batches[0].id);assert.equal(t.rootWrites,before);assert.equal(t.nodes.get('#spelling').value,'unsaved spelling');assert.equal(t.state().events.length,0);assert.equal(t.state().words[1].content.senseId,'wordb#1')});
test('页面集成：连续重播、退出、切换词后旧音频不写记录',async()=>{const t=await setup();const first=t.audios[0],ended=first.onended;const replay=t.nodes.get('#lesson').children.find(x=>x.textContent==='播放词典录音');await replay.onclick();assert(first.paused);t.run("go('home');db.sessions[0].index=1;active=db.sessions[0].id;render()");ended();assert.equal(t.state().events.length,0);t.audios.at(-1).onended();assert.equal(t.state().events[0].wordId,t.db.words[1].id)});
test('麦克风权限迟到后已离开页面：释放设备，不记录先说',async()=>{let resolve;let stopped=0;const t=await setup({phase:'pronounce',mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}});const record=t.nodes.get('#lesson').children.find(x=>x.textContent==='录音辅助（可选）');const pending=record.onclick();t.run("go('home')");resolve({getTracks:()=>[{stop:()=>stopped++}]});await pending;assert.equal(stopped,1);assert.equal(t.state().events.length,0)});
test('拒绝麦克风不阻塞自行说出与自评入口',async()=>{const t=await setup({phase:'pronounce'});const record=t.nodes.get('#lesson').children.find(x=>x.textContent==='录音辅助（可选）');await record.onclick();assert.match(t.nodes.get('#mediaStatus').textContent,/麦克风不可用/);const said=t.nodes.get('#lesson').children.find(x=>x.textContent==='我已自己说出，接着听原音');said.onclick();assert.equal(t.state().sessions[0].said,true)});
