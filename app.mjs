import {createFeedbackClient,feedbackRequest} from './sentence-feedback.mjs?v=20261029-opt-final';
import {createRecorder} from './recording.mjs?v=20261029-opt-final';
import {fresh,parse,norm,createBatch,session,currentId,ready,act,validate,merge,transaction,latestSentenceEvent,addSentenceFeedback,reviseSentence} from './core.mjs?v=20261029-opt-final';
import {createPlayback} from './media.mjs?v=20261029-opt-final';
import {createPreparer,createDictionaryClient,checkReviewedContent,canonical,preparationMessage} from './content.mjs?v=20261029-opt-final';
import {contentConfig,sentenceFeedbackConfig} from './config.mjs?v=20261029-opt-final';
import {reviewedContent,reviewedLessons} from './review-catalog.mjs?v=20261029-opt-final';
const $=s=>document.querySelector(s), app=$('#app'), error=$('#error');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db=fresh(),active=null,resumeId=null,draft='',name='',preview=null,incoming=null,loadFailed=false,filter='all';
let pageEpoch=0,mediaControls=null,recordControls=null;
const checkedContent=new Map();
try { const raw=localStorage.getItem('vocab-v01'); if(raw)db=validate(JSON.parse(raw)); }
catch(e){loadFailed=true;error.textContent='现有记录读取失败，已停止写入以保护数据。请先导出原始备份：'+e.message;}
const titles={sound:'声音与意义',pronounce:'先说后听',pronounceRetry:'发音再练一次',teach:'拼写与用法',sentence:'试着造句 · 可跳过',spell:'先写，再揭晓',spellRetry:'拼写再练一次'};
const phases=['sound','pronounce','teach','sentence','spell'];
const page=()=>['home','lists','new','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'home';
function stop(){pageEpoch++;playback.stop();recorder.sync(currentPosition());if(feedbackJob&&!sameAttempt(currentPosition(),feedbackJob.owner))cancelFeedback();}

function update(fn,{background=false}={}){if(loadFailed)return false;try{db=transaction(localStorage,db,fn);if(!background)error.textContent='';return true;}catch(e){error.textContent='尚未确认保存，当前动作没有完成。请保留此页面并重试。'+e.message;return false;}}
function button(text,fn,parent=app,cls=''){const b=document.createElement('button');b.textContent=text;b.className=cls;b.onclick=fn;b.disabled=loadFailed;parent.append(b);return b;}
function go(p){active=null;resumeId=null;if(location.hash==='#'+p)render();else location.hash=p;}
function currentPosition(){
  const session=db.sessions.find(x=>x.id===active);
  if(!session||session.status==='completed')return null;
  const word=db.words.find(w=>w.id===currentId(db,session));
  return {sessionId:session.id,wordId:word?.id,phase:session.phase,group:session.group,index:session.index,senseId:word?.content?.senseId,restarts:session.restarts||0,attempt:session.attempt||0};
}
const playback=createPlayback({current:currentPosition,
  complete:owner=>{
    if(!update(d=>act(d,owner.sessionId,'listened')))return;
    if(owner.phase.startsWith('pronounce'))render();
    else if(owner.phase==='sound'&&mediaControls?.next)mediaControls.next.disabled=loadFailed;
    // Teaching, sentence and spelling input must survive an audio ending event.
  },
  status:paintMedia
});
function paintMedia(state){
  const el=$('#mediaStatus');
  if(el)el.textContent=({scheduled:'即将播放…',loading:'正在加载词典录音…',playing:'正在播放',paused:'已暂停',ended:'播放完毕',failed:'录音播放失败，位置已保留。请重试。'})[state]||'';
  if(mediaControls){mediaControls.pause.hidden=!['playing','loading'].includes(state);mediaControls.resume.hidden=state!=='paused';}
}
const recorder=createRecorder({current:currentPosition,status:paintRecording,ready:owner=>{
  if(update(d=>act(d,owner.sessionId,'said')))render();
}});
function usable(word,phase='teach'){
  return !!word&&ready(word,phase)&&checkedContent.get(word.id)===canonical(word.content);
}
async function auditStoredContent(){
  const items=db.words.filter(w=>w.content);
  for(const word of items){
    const fingerprint=canonical(word.content);
    try{await checkReviewedContent(word,word.content,reviewedContent);
      if(canonical(db.words.find(w=>w.id===word.id)?.content)===fingerprint)checkedContent.set(word.id,fingerprint);
    }catch{checkedContent.delete(word.id);}
  }
  paintPreparation();
  // Old failed preparation is not evidence that newly checked content is unavailable.
  // Prepare known lessons in batch order, preserving IDs, positions and history.
  for(const batch of db.batches){
    if(batch.wordIds.some(id=>{const word=db.words.find(w=>w.id===id);return word&&!usable(word)&&Object.hasOwn(reviewedLessons,word.normalized);}))
      await preparer.run(batch.id,{retry:true});
  }
}
const preparer=createPreparer({
  getBatch:id=>db.batches.find(b=>b.id===id),
  getWords:id=>{const batch=db.batches.find(b=>b.id===id);return batch?batch.wordIds.map(wid=>db.words.find(w=>w.id===wid)):[];},
  usable,lookup:createDictionaryClient(contentConfig,{reviews:reviewedContent,lessons:reviewedLessons}),
  commit:(batchId,requested,result,guard)=>{
    guard();
    const current=db.words.find(w=>w.id===requested.id);
    if(current?.normalized===requested.normalized&&canonical(current.content)===canonical(result.content)){
      checkedContent.set(current.id,canonical(current.content));return true;
    }
    if(!current||current.normalized!==requested.normalized||canonical(current.content)!==canonical(requested.content))
      throw Object.assign(Error('词条已更新，旧查询结果未写入。'),{code:'INVALID_RESPONSE'});
    const saved=update(next=>{guard();const word=next.words.find(w=>w.id===requested.id);
      if(!word||word.normalized!==requested.normalized||canonical(word.content)!==canonical(requested.content))
        throw Error('词条已更新，未覆盖内容。');
      word.content=structuredClone(result.content);
    },{background:true});
    if(saved)checkedContent.set(requested.id,canonical(result.content));
    return saved;
  },
  publish:(batchId,status)=>{
    const saved=update(next=>{const batch=next.batches.find(b=>b.id===batchId);
      if(!batch)throw Error('词表不存在。');batch.preparation=status;},{background:true});
    paintPreparation(status,batchId);return saved;
  }
});
function startPreparation(batchId,retry=false){
  if(loadFailed)return;
  void preparer.run(batchId,{retry}).catch(e=>{error.textContent='内容准备已停止：'+e.message;});
}
function progressMarkup(batchId){return `<section class="preparation" data-preparation="${escape(batchId)}" aria-label="学习内容准备状态"></section>`;}
function paintPreparation(latest=null,batchId=null){
  for(const box of document.querySelectorAll('[data-preparation]')){
    const id=box.dataset.preparation,batch=db.batches.find(b=>b.id===id);if(!batch)continue;
    const current=preparer.status(id);
    let status=id===batchId&&latest?latest:current||batch.preparation;
    if(!current&&status?.status==='preparing')status={...status,status:'interrupted',code:'INTERRUPTED'};
    const total=batch.wordIds.length,complete=batch.wordIds.filter(wid=>usable(db.words.find(w=>w.id===wid))).length;
    const localCount=batch.wordIds.filter(wid=>Object.hasOwn(reviewedLessons,db.words.find(w=>w.id===wid)?.normalized)).length;
    const remoteConfigured=!!contentConfig.apiBase&&contentConfig.automaticQueriesApproved&&contentConfig.contentRetentionApproved;
    const configured=remoteConfigured||localCount>0;
    const busy=status?.status==='preparing'&&preparer.isRunning(id);
    const configurationCode=complete===total||localCount>0?null:!contentConfig.apiBase?'UNCONFIGURED':!configured?'REVIEW_REQUIRED':null;
    let message=busy?'正在准备已核对的学习内容。':complete===total?'本批内容已就绪，可以开始学习。':configurationCode?preparationMessage(configurationCode):status?.code?preparationMessage(status.code):status?.needsReview?'部分词的可靠录音或教学内容待补充；已就绪的内容和当前位置均已保留。':configured?'词表已保存，可以准备学习内容。':'这些词的学习内容尚待核对；当前没有准备任务正在运行。';
    const elapsed=busy?Math.min(150,Math.floor((Date.now()-status.startedAt)/1000)):Math.floor((status?.elapsedMs||0)/1000);
    const details=busy?`已用 ${elapsed} 秒 · 本轮最多 150 秒${status.estimateMs!==null?` · 预计查询还需约 ${Math.ceil(status.estimateMs/1000)} 秒`:' · 剩余时间正在估算'}`:status?.status==='timeout'?'本轮已结束；重试只处理未完成部分。':'';
    const baseKey=canonical({status:status?.status,code:status?.code,complete,total,finished:status?.finished,needsReview:status?.needsReview,failed:status?.failed,busy,configured});
    if(box.dataset.view===baseKey){const time=box.querySelector('.prep-time-live');if(time)time.textContent=details;continue;}
    box.dataset.view=baseKey;
    box.innerHTML=`<div class="prep-heading"><strong>${busy?'正在准备':complete===total?'内容已就绪':status?.status==='timeout'?'准备超时，已停止等待':!configured?'尚未开始内容准备':'内容准备状态'}</strong><span>${complete} / ${total} 词就绪</span></div><progress max="${total}" value="${complete}" aria-label="已就绪词数"></progress><p role="status">${escape(message)}</p>${details?`<p class="prep-time prep-time-live">${escape(details)}</p>`:''}${status&&!['UNCONFIGURED','PERMISSION_REQUIRED'].includes(status.code)?`<p class="prep-time">已处理 ${Math.max(0,Math.min(total,(status.finished||0)-(status.blocked||0)))} / ${total} · 待核对 ${status.needsReview||0} · 失败或缺项 ${status.failed||0}${status.blocked?` · 未开始 ${status.blocked}`:''}</p>`:''}<div class="row"><button class="text-button" data-prepare="${escape(id)}" ${busy||!configured||loadFailed?'disabled':''}>${status?'重试未完成内容':'准备学习内容'}</button>${!configured?'<button class="text-button" data-go="settings">查看接入步骤 →</button>':''}</div>`;
    if(active){const session=db.sessions.find(s=>s.id===active),word=session&&db.words.find(w=>w.id===currentId(db,session));
      if(session?.batchId===id&&usable(word,session.phase)&&$('#resumePrepared')===null){
        button('内容已就绪，进入当前练习',()=>render(),box,'primary').id='resumePrepared';
      }
    }
  }
}
const art=`<div class="book-art" aria-hidden="true"><div class="book-back"></div><div class="book-front">Aa</div><span class="art-spark">✧</span></div>`;
function rail(s){let idx=s?(s.status==='completed'?phases.length:phases.indexOf(s.phase.replace('Retry',''))):-1;return `<aside class="rail"><section class="panel"><h2>${s?'本组学习步骤':'这一组，怎么学'}</h2><p class="caption">先声音与意义，再一步步提取</p><ol class="learning-path">${[['听','声音与意义','听发音，联系情境'],['说','先说后听','自己说出，再听原音'],['读','拼写与用法','联系词形、释义和例句'],['用','试着造句','写一句，也可以跳过'],['写','拼写默写','先提交，再揭晓']].map(([mark,title,help],i)=>`<li class="${i===idx?'current':i<idx?'done':''}"><span class="step-num">${i<idx?'✓':mark}</span><div><div class="step-name">${title}</div><div class="step-help">${help}</div></div></li>`).join('')}</ol></section><section class="panel local-panel"><h2>每一步，都为你保留</h2><p>确认后的进度保存在这台设备。下次打开，接着上次的位置继续。</p><button class="text-button" data-go="settings">备份学习记录 <span aria-hidden="true">↗</span></button></section></aside>`;}
function heading(title,subtitle='',eyebrow='',action=false){return `<div class="page-heading"><div>${eyebrow?`<p class="eyebrow">${eyebrow}</p>`:''}<h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div>${action?'<button data-go="new">＋ 添加词表</button>':''}</div>`;}
function batchCards(batches,add=false){return batches.map(b=>{const pending=db.sessions.filter(s=>s.batchId===b.id&&s.status!=='completed');const initial=db.sessions.find(s=>s.batchId===b.id&&!s.replay);const state=b.completedAt?'首次已完成':initial?.status==='new'?'还未开始':'学习中';const samples=b.wordIds.slice(0,4).map(id=>db.words.find(w=>w.id===id)?.surface).join(' · ');return `<article class="batch-card"><div class="batch-top"><div class="batch-cover" aria-hidden="true">Aa</div><span class="status-pill ${b.completedAt?'green':''}">${state}</span></div><h3>${escape(b.name)}</h3><p class="sub">${b.wordIds.length} 个词 <span aria-hidden="true">·</span> ${Math.ceil(b.wordIds.length/10)} 组</p><p class="sample">${escape(samples)}</p><div class="card-action"><small>${pending[0]?`第 ${pending[0].group+1} 组 · ${titles[pending[0].phase]}`:'词表与首次记录已保留'}</small>${pending[0]?`<button class="text-button" data-resume="${pending[0].id}">${pending[0].replay?'继续再练':'开始学习'} →</button>`:`<button class="text-button" data-replay="${b.id}">再练一遍 →</button>`}</div>${pending.length>1?pending.slice(1).map(s=>`<button class="text-button" data-resume="${s.id}">继续${s.replay?'手动再练':'首次学习'}</button>`).join(''):''}${b.completedAt&&pending.length?`<button class="text-button" data-replay="${b.id}">另开一次再练</button>`:''}<details class="batch-details"><summary>查看原词表</summary>${b.wordIds.map(id=>escape(db.words.find(w=>w.id===id)?.surface)).join(' · ')}</details></article>`;}).join('')+(add?'<button class="add-tile" data-go="new"><span class="plus">＋</span><span>添加一份新词表</span><small>学你真正需要的词</small></button>':'');}
function renderHome(){const pending=[...db.sessions].reverse().find(s=>s.status!=='completed'),b=pending?db.batches.find(b=>b.id===pending.batchId):null;const completed=db.batches.length&&!b;const focusTitle=b?escape(b.name):completed?'换一组词，继续探索':'从你的第一份词表开始';const focusDescription=b?`每组最多 10 词，按自己的节奏完成。`:completed?'已学词表都在，也可以随时再练一遍。':'课本里的生词、生活里遇到的表达，都可以。';app.innerHTML=heading('今天，学一点新东西。','不必一口气学很多，接着自己的节奏来。','我的学习',true)+`<div class="dashboard"><div class="main-column"><section class="focus-card">${art}<div class="focus-content"><p class="focus-label">${b?(pending.status==='new'?'准备开始':'接着上次学'):'你的词汇，由你选择'}</p><h2>${focusTitle}</h2><p>${focusDescription}</p>${b?`<div class="focus-meta"><span>${b.wordIds.length} 个词</span><span>${Math.ceil(b.wordIds.length/10)} 组</span></div>`:''}<div class="focus-actions">${b?`<button class="primary" data-resume="${pending.id}">${pending.status==='new'?'开始学习':'继续学习'} <span aria-hidden="true">→</span></button>`:'<button class="primary" data-go="new">＋ 添加词表</button>'}${db.batches.length?'<button class="text-button" data-go="lists">查看我的词表</button>':''}</div></div>${b?`<div class="focus-steps" aria-label="已完成 ${pending.group} 组，共 ${Math.ceil(b.wordIds.length/10)} 组">${Array.from({length:Math.ceil(b.wordIds.length/10)},(_,i)=>`<i class="${i<pending.group?'done':''}"></i>`).join('')}</div>`:''}</section>${b?progressMarkup(b.id):''}<p class="source-note"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M10 8v5 M10 5.5v1"/></svg><span>学习内容就绪情况与接入说明，可在下方进度及备份与设置中查看。</span></p><div class="section-title"><h2>我的词表</h2><button class="text-button" data-go="lists">查看全部 <span aria-hidden="true">→</span></button></div><div class="batch-grid">${batchCards([...db.batches].reverse().slice(0,3),true)}</div></div>${rail()}</div>`;}
function renderLists(){const batches=[...db.batches].reverse().filter(b=>filter==='all'||(filter==='done'?b.completedAt:!b.completedAt));app.innerHTML=heading('我的词表','未完成的接着学，学过的随时再练。','把遇见的词，慢慢变成自己的',true)+`<div class="list-filters" role="group" aria-label="词表筛选">${[['all','全部'],['learning','待学'],['done','已学']].map(([f,t])=>`<button data-filter="${f}" class="${filter===f?'selected':''}" aria-pressed="${filter===f}">${t}</button>`).join('')}</div>${batches.length?`<div class="batch-grid list-grid">${batchCards(batches,true)}</div>`:`<div class="empty-list"><h3>${filter==='done'?'还没有完成的词表':filter==='learning'?'没有未完成的词表':'你的词表会保存在这里'}</h3><p>${filter==='done'?'完整学完一批词后，就能在这里找到并再练。':'添加自己的词，不用重新整理，也能随时继续。'}</p><button class="primary" data-go="new">添加词表</button></div>`}`;}
function renderForm(){app.innerHTML=heading('添加自己的词表','确认后先保存，再开始学习。','我的词表 / 添加词表')+`<section class="panel form-panel"><h2>想学哪些词？</h2><p>每行一个词，也支持逗号分隔的英文单词或短语。</p><label class="field-label">词表名称<input id="name" type="text" maxlength="100" value="${escape(name)}" placeholder="例如：这周的课堂词汇"></label><label class="field-label">单词或短语<textarea id="words" placeholder="在这里粘贴你的词表">${escape(draft)}</textarea></label><p class="helper">保留你的输入顺序，去除重复，每组最多 10 词。</p><div class="form-footer"><label class="upload-button">↥ 从文件添加<input id="wordfile" type="file" accept=".txt,.csv,text/plain,text/csv" aria-label="上传词表"></label><button id="check" class="primary">检查词表 →</button></div><p class="helper">支持 UTF-8 的 .txt 或 .csv 文件，最大 2MB。</p><div id="parsed" aria-live="polite"></div></section>`;$('#words').oninput=e=>{draft=e.target.value;preview=null;$('#parsed').innerHTML='';};$('#name').oninput=e=>name=e.target.value;$('#wordfile').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2000000)throw Error('词表超过 2MB，请分成小份。');draft=await file.text();name ||=file.name;renderForm();}catch(e){error.textContent=e.message;}};$('#check').onclick=()=>{preview=parse(draft);showParse();};$('#check').disabled=loadFailed;}
function showParse(){const existing=preview.words.filter(s=>db.words.some(w=>w.normalized===norm(s)));$('#parsed').innerHTML=`<div class="parse-result"><h3>检查好了，共 ${preview.words.length} 个有效词</h3><p>将按原顺序分为 ${Math.ceil(preview.words.length/10)} 组，每组最多 10 词。</p><p>批内重复 ${preview.duplicates.length} 项：${escape(preview.duplicates.join('、')||'无')}</p><p>无效 ${preview.invalid.length} 项：${escape(preview.invalid.join('、')||'无')}</p><p>与已有词重复 ${existing.length} 项：${escape(existing.join('、')||'无')}</p><label><input id="skip" type="checkbox"> 跳过已有词（不选则复用词条，保留原历史）</label><div id="confirmAction"></div></div>`;const b=button('确认并保存词表',()=>{if(!preview.words.length)return;const skip=$('#skip').checked;let batchId;if(update(d=>{batchId=createBatch(d,draft,name,skip).id;})){draft='';name='';preview=null;go('home');startPreparation(batchId);}},$('#confirmAction'),'primary');b.disabled=!preview.words.length||loadFailed;}
function renderResume(){const s=db.sessions.find(s=>s.id===resumeId);app.innerHTML=heading('继续你的学习','','回到自己的节奏')+`<section class="panel resume-panel"><h2>从上次的位置继续？</h2><p>每一步确认后的进度都已为你保留。</p><div class="resume-location">第 ${s.group+1} 组 · ${titles[s.phase]} · 第 ${s.index+1} 个词</div><p>也可以从头再学：当前位置会重置，原词表和真实历史仍保留。</p>${progressMarkup(s.batchId)}<div id="resumeActions" class="row"></div></section>`;button('继续学习 →',()=>{active=resumeId;resumeId=null;render();},$('#resumeActions'),'primary');button('从头再学',()=>{if(update(d=>{const old=d.sessions.find(x=>x.id===resumeId);const replacement=session(d.batches.find(b=>b.id===old.batchId),old.replay);Object.assign(old,replacement,{id:old.id,restarts:old.restarts+1});})){active=resumeId;resumeId=null;render();}},$('#resumeActions'));button('返回',()=>{resumeId=null;render();},$('#resumeActions'),'subtle');}
function render(){stop();mediaControls=null;recordControls=null;feedbackAttach=null;$('#main').classList.toggle('studying',!!active);const p=page();document.querySelectorAll('[data-page]').forEach(a=>{const selected=a.dataset.page===(p==='new'?'lists':p);a.classList.toggle('active',selected);if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});$('#pageLabel').textContent=active?'词汇练习':resumeId?'继续学习':({home:'我的学习',lists:'我的词表',new:'添加词表',settings:'备份与设置'}[p]);document.title='词间 · '+$('#pageLabel').textContent;$('#settingsPanel').hidden=p!=='settings'||!!active||!!resumeId;app.hidden=p==='settings'&&!active&&!resumeId;app.innerHTML='';if(active)renderStudy();else if(resumeId)renderResume();else if(p==='home')renderHome();else if(p==='lists')renderLists();else if(p==='new')renderForm();paintPreparation();window.scrollTo(0,0);}
app.addEventListener('click',e=>{const target=e.target.closest('button');if(!target)return;if(target.dataset.go)go(target.dataset.go);else if(target.dataset.prepare)startPreparation(target.dataset.prepare,true);else if(target.dataset.resume){resumeId=target.dataset.resume;render();const session=db.sessions.find(s=>s.id===resumeId);if(session&&!db.batches.find(b=>b.id===session.batchId).preparation)startPreparation(session.batchId);}else if(target.dataset.replay){let sid;if(update(d=>{const s=session(d.batches.find(b=>b.id===target.dataset.replay),true);d.sessions.push(s);sid=s.id;})){active=sid;render();}}else if(target.dataset.filter){filter=target.dataset.filter;renderLists();}});
function perform(type,value='',options){if(update(d=>act(d,active,type,value,options)))render();}
function paintRecording(state,message=''){
  if(!recordControls)return;
  const busy=['requesting','recording','stopping'].includes(state);
  recordControls.status.textContent=message||({idle:'录音仅在当前页面临时使用，不上传。',requesting:'正在请求麦克风…',recording:`正在录音 · ${recorder.seconds} 秒`,stopping:'正在准备回放…',ready:'录音已就绪，可听自己的声音并与标准原声比较。',playing:'正在播放你的录音',failed:'麦克风不可用，可自行说出后继续。'})[state]||'';
  recordControls.start.disabled=busy||loadFailed;
  recordControls.finish.hidden=state!=='recording';
  recordControls.replay.hidden=!recorder.hasClip;recordControls.replay.disabled=busy||loadFailed;
  recordControls.stopReplay.hidden=state!=='playing';
}
function recordingControls(parent,s){
  const panel=document.createElement('div');panel.className='recording-panel';parent.append(panel);
  const message=document.createElement('p');message.id='recordStatus';message.className='lesson-help';message.setAttribute('role','status');panel.append(message);
  const actions=document.createElement('div');actions.className='recording-actions';panel.append(actions);
  const start=button(s.said||recorder.hasClip?'重新录音':'录音辅助（可选）',()=>{
    if(s.said||recorder.hasClip){
      if(!update(d=>act(d,active,'rerecord')))return;
      recorder.cancel();render();
    }
    playback.stop();return recorder.start(currentPosition());
  },actions,'subtle');
  const finish=button('停止录音，接着听原音',()=>recorder.finish(),actions);
  const replay=button('听我的录音',()=>{playback.stop();void recorder.play();},actions);
  const stopReplay=button('停止回放',()=>recorder.stopPlayback(),actions,'subtle');
  recordControls={start,finish,replay,stopReplay,status:message};paintRecording(recorder.state);
}
function soundHints(content,controls,w){
  const hints=document.createElement('div');hints.className='hint-controls';content.append(hints);
  for(const [kind,label,text]of [['chinese','中文含义',w.content.chinese&&w.content.chineseSource?w.content.chinese+' · '+w.content.chineseSource:''],['spelling','英文拼写',w.surface]]){
    if(!text)continue;
    const area=document.createElement('p');area.id='soundHint-'+kind;area.className='sound-hint';area.hidden=true;area.textContent=text;content.append(area);
    const toggle=button('显示'+label,()=>{
      if(area.hidden&&!update(d=>act(d,active,'hint',kind)))return;
      area.hidden=!area.hidden;toggle.textContent=(area.hidden?'显示':'隐藏')+label;toggle.setAttribute('aria-expanded',String(!area.hidden));
    },hints,'subtle');
    toggle.setAttribute('aria-controls',area.id);toggle.setAttribute('aria-expanded','false');
  }
}
const feedbackClient=createFeedbackClient({apiBase:sentenceFeedbackConfig.apiBase});
let feedbackReady=false,feedbackPreparing=false,feedbackAttach=null,feedbackJob=null,feedbackUnsaved=null;
const sameAttempt=(a,b)=>a&&b&&['sessionId','wordId','phase','group','index','senseId','restarts','attempt'].every(k=>a[k]===b[k]);
function cancelFeedback(){if(feedbackJob){feedbackJob.controller.abort();feedbackJob=null;}feedbackUnsaved=null;}
function feedbackIsCurrent(job){
  const s=db.sessions.find(x=>x.id===job.owner.sessionId);
  return feedbackJob===job&&sameAttempt(currentPosition(),job.owner)&&s&&latestSentenceEvent(db,s)?.id===job.request.attemptEventId;
}
async function checkSentence(event,word,panel){
  if(feedbackPreparing||feedbackJob||!feedbackReady)return;
  feedbackPreparing=true;
  let request;
  try{request=await feedbackRequest(event,word);}catch(e){paintSentenceFeedback(panel);const message=document.createElement('p');message.textContent=e.message;panel.append(message);return;}finally{feedbackPreparing=false;}
  if(feedbackJob||!feedbackReady)return;
  const owner=currentPosition(),s=db.sessions.find(x=>x.id===owner?.sessionId);
  if(!s||latestSentenceEvent(db,s)?.id!==event.id)return;
  if(!update(d=>addSentenceFeedback(d,owner.sessionId,request,'requested')))return;
  const job={owner,request,controller:new AbortController()};feedbackJob=job;feedbackUnsaved=null;
  panel.textContent='正在检查本句，最多等待20秒；原句已保存，可直接继续。';
  try{
    const response=await feedbackClient(request,{signal:job.controller.signal});
    if(!feedbackIsCurrent(job))return;
    if(!update(d=>addSentenceFeedback(d,owner.sessionId,request,'completed',{response}))){
      feedbackUnsaved={request,response,owner};feedbackJob=null;paintSentenceFeedback(panel);return;
    }
    feedbackJob=null;paintSentenceFeedback(panel);
  }catch(e){
    if(!feedbackIsCurrent(job))return;
    update(d=>addSentenceFeedback(d,owner.sessionId,request,e.code==='CANCELLED'?'cancelled':'failed',{code:e.code||'SERVICE_FAILED'}));
    feedbackJob=null;paintSentenceFeedback(panel);
  }
}
function paintSentenceFeedback(panel){
  const s=db.sessions.find(x=>x.id===active),original=s&&latestSentenceEvent(db,s);
  if(!s||!original||!original.value.trim())return;
  const word=db.words.find(w=>w.id===original.wordId);
  panel.replaceChildren();
  const note=document.createElement('p');note.className='lesson-help';note.textContent=feedbackReady?'本句与目标词义会发送至 DeepSeek；词间后端最多缓存24小时。反馈供参考，首次原句保留在本机。':'已保存的反馈供参考；检查服务暂不可用，仍可继续学习。';panel.append(note);
  if(feedbackUnsaved&&sameAttempt(currentPosition(),feedbackUnsaved.owner)&&feedbackUnsaved.request.attemptEventId===original.id){
    const message=document.createElement('p');message.textContent='原句已保存，反馈尚未保存。可以重试保存，无需再次调用模型。';panel.append(message);
    button('重试保存反馈',()=>{
      const value=feedbackUnsaved;
      if(update(d=>addSentenceFeedback(d,s.id,value.request,'completed',{response:value.response}))){feedbackUnsaved=null;paintSentenceFeedback(panel);}
    },panel);return;
  }
  const feedback=[...db.events].reverse().find(e=>e.type==='sentenceFeedback'&&e.attemptEventId===original.id);
  if(feedback?.status==='completed'){
    const value=feedback.response.result;
    const title=document.createElement('h3');title.textContent=value.assessment==='uncertain'&&['different_sense','missing'].includes(value.targetUsage)?'目标词使用提示':({suggestions:'修改建议',no_clear_issue:'未发现明确问题',uncertain:'暂不能确定'})[value.assessment];panel.append(title);
    const usage=document.createElement('p');usage.className='lesson-help';usage.textContent='目标词义：'+({matches_sense:'与本课词义相符',different_sense:'使用了其他词义',missing:'尚未使用目标词',uncertain:'需要更多语境'})[value.targetUsage];panel.append(usage);
    if(value.assessment==='suggestions'){
      const suggestion=document.createElement('blockquote');suggestion.lang='en';suggestion.textContent=value.suggestedSentence;panel.append(suggestion);
    }
    const reason=document.createElement('p');reason.textContent=value.explanationZh;panel.append(reason);
    for(const issue of value.issues){const p=document.createElement('p');p.className='feedback-issue';p.textContent=`${({grammar:'语法',word_use:'用词',clarity:'表达'})[issue.kind]}：${issue.explanationZh}`;panel.append(p);}
    const source=document.createElement('p');source.className='lesson-source';source.textContent=`DeepSeek · ${feedback.response.model} · 自动参考反馈`;panel.append(source);
  }else if(feedback){
    const state=document.createElement('p');state.textContent=feedback.status==='requested'?'上次检查已中断，可重新检查；原句已保存。':'原句已保存，暂时无法检查，可重试或继续。';panel.append(state);
  }
  if(feedbackReady)button(feedback?.status==='completed'?'再次检查这句':'检查这句（DeepSeek）',()=>void checkSentence(original,word,panel),panel,'subtle');
  button('修改我的句子',()=>{
    const edit=document.createElement('textarea');edit.value=original.value;edit.setAttribute('aria-label','修改后的句子');panel.append(edit);
    button('保存修订',()=>{
      if(!edit.value.trim()){error.textContent='修订不能为空，原句已保留。';return;}
      cancelFeedback();if(update(d=>reviseSentence(d,s.id,edit.value)))render();
    },panel);edit.focus();
  },panel,'subtle');
  if(original.type==='sentenceRevision'){
    const root=db.events.find(e=>e.id===original.parentEventId),details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');
    summary.textContent='查看首次原句';text.textContent=root?.value||'';details.append(summary,text);panel.append(details);
  }
}
function attachSentenceFeedback(content,controls,s,w){
  const owner=currentPosition();
  let panel;
  feedbackAttach=()=>{
    if(!sameAttempt(currentPosition(),owner))return;
    const prior=s.revealed&&latestSentenceEvent(db,s);
    const hasSaved=prior&&(prior.type==='sentenceRevision'||db.events.some(e=>e.type==='sentenceFeedback'&&e.attemptEventId===prior.id));
    if(!feedbackReady&&!hasSaved)return;
    if(!panel){panel=document.createElement('section');panel.className='sentence-feedback';content.append(panel);}
    if(!s.revealed){
      feedbackAttach=null;
      const note=document.createElement('p');note.className='lesson-help';note.textContent='检查会把本句及目标词义发送给 DeepSeek，词间后端最多缓存24小时；可只保存或跳过。';panel.append(note);
      button('保存并检查（DeepSeek）',()=>{
        const value=$('#sentence').value;if(!value.trim()){error.textContent='请先写一句，或选择跳过。';return;}
        let event;if(!update(d=>{event=act(d,active,'sentence',value);}))return;
        render();const target=$('#sentenceFeedback');if(target)void checkSentence(event,w,target);
      },controls,'subtle');
    }else{
      panel.id='sentenceFeedback';paintSentenceFeedback(panel);
    }
  };
  feedbackAttach();
}
async function probeSentenceFeedback(){
  const status=$('#feedbackServiceStatus'),limits=$('#feedbackLimits'),retry=$('#feedbackReconnect');
  if(!sentenceFeedbackConfig.enabled||!sentenceFeedbackConfig.apiBase){status.textContent='暂未启用；原句可照常保存或跳过。';retry.disabled=true;return;}
  status.textContent='正在确认连接…';retry.disabled=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  try{
    const response=await fetch(sentenceFeedbackConfig.apiBase.replace(/\/$/,'')+'/health',{signal:controller.signal});
    const value=await response.json();feedbackReady=response.ok&&value.configured===true&&value.qualityApproved===true;
    status.textContent=feedbackReady?(value.testOnly?'DeepSeek 测试连接（仅固定样例）':'DeepSeek 已连接，可选检查已启用。'):'服务尚未启用；原句可照常保存或跳过。';
    const cap=value.limits;limits.textContent=cap&&[cap.monthlyCny,cap.dailyChecks,cap.monthlyChecks].every(n=>Number.isFinite(n)&&n>0)?`全站合计：每月最多 ¥${cap.monthlyCny}，每天 ${cap.dailyChecks} 次、每月 ${cap.monthlyChecks} 次。达到任一限额即停止，不自动充值。`:'';
    if(feedbackReady)feedbackAttach?.();
  }catch{feedbackReady=false;status.textContent='服务暂不可用；已保存的句子和反馈仍保留。';}finally{clearTimeout(timer);retry.disabled=false;}
}
function renderStudy(){
  const s=db.sessions.find(x=>x.id===active),b=db.batches.find(x=>x.id===s.batchId);
  app.innerHTML=(s.status==='completed'?heading('这一批，练习完成。'):'' )+
    `<div class="study-layout"><section class="panel study-card"><div class="study-top"><span>第 ${s.group+1} / ${Math.ceil(b.wordIds.length/10)} 组</span><span class="status">已确认位置已保存</span></div><h2 class="lesson-title">${s.status==='completed'?'本次练习回顾':titles[s.phase]}</h2><div id="lesson" class="lesson-body"></div><div id="exitLesson" class="lesson-actions"></div></section>${rail(s)}</div>`;
  const lesson=$('#lesson');
  button('退出练习',()=>go('home'),$('#exitLesson'),'subtle');
  if(s.status==='completed'){
    const events=db.events.filter(e=>e.sessionId===s.id);
    const pronunciation=new Set(events.filter(e=>e.phase==='pronounce'&&e.type==='assess'&&e.value!=='correct').map(e=>e.wordId)).size;
    const spelling=new Set(events.filter(e=>e.phase==='spell'&&e.type==='spell'&&!e.correct).map(e=>e.wordId)).size;
    lesson.innerHTML=`<h3>完成 ${b.wordIds.length} 个词 · ${Math.ceil(b.wordIds.length/10)} 组</h3><p>必要步骤与本次弱项重练已完成。</p><p>本次发音需再巩固 ${pronunciation} 词，拼写需再巩固 ${spelling} 词。</p><p>原词表与每次尝试均已保留。完成一次练习不代表长期掌握，可以之后再练。</p>`;
    button('再练一遍',()=>{let sid;if(update(d=>{const next=session(d.batches.find(x=>x.id===b.id),true);d.sessions.push(next);sid=next.id;})){active=sid;render();}},lesson,'primary');
    button('返回我的学习',()=>go('home'),lesson);return;
  }
  const w=db.words.find(x=>x.id===currentId(db,s)),c=w.content;
  if(!usable(w,s.phase)){
    lesson.innerHTML=`<div class="waiting"><div class="waiting-icon" aria-hidden="true">♬</div><h2>这一步还不能开始</h2><p>本组第 ${s.index+1} 个词的可靠录音、词义或教学内容尚未就绪。当前位置已保留。</p></div>${progressMarkup(s.batchId)}`;return;
  }
  const context=`<p class="cue lesson-cue" lang="en">${escape(c.cue)}</p>`;
  lesson.innerHTML=(['teach','sentence'].includes(s.phase)?`<details class="lesson-context"><summary>查看情境提示</summary>${context}</details>`:context)+
    `<p id="mediaStatus" class="media-status" role="status" aria-live="polite"></p>`;
  const meta=document.createElement('div');meta.className='lesson-meta';
  meta.innerHTML=`<p class="status lesson-source">${escape(c.audio.source)} · ${c.audio.accent==='US'?'美音':'英音'}</p>`;lesson.append(meta);
  const audio=document.createElement('div');audio.className='audio-controls';meta.append(audio);
  const content=document.createElement('div');content.className='lesson-content';lesson.append(content);
  const controls=document.createElement('div');controls.className='lesson-controls';lesson.append(controls);
  if(!s.phase.startsWith('pronounce')||s.said){
    const play=button('播放词典录音',()=>{recorder.stopPlayback();return playback.play(c.audio.url,currentPosition());},audio,'audio-play');
    const pause=button('暂停播放',()=>playback.pause(),audio,'subtle');
    const resume=button('继续播放',()=>playback.resume(),audio,'subtle');
    mediaControls={play,pause,resume};paintMedia(playback.state);
  }
  if(s.phase==='sound'){
    soundHints(content,controls,w);
    const next=button('下一个',()=>perform('next'),controls,'primary');next.disabled=!s.listened||loadFailed;
    if(mediaControls)mediaControls.next=next;
    if(!s.listened&&!document.hidden)playback.schedule(c.audio.url,currentPosition(),1000);
  }else if(s.phase.startsWith('pronounce')){
    if(s.phase==='pronounceRetry'&&s.revealed){
      content.insertAdjacentHTML('beforeend',`<p class="assessment-result">${s.answer==='correct'?'本次自评：读对了。':s.answer==='wrong'?'本次自评：仍需练习。':'本次自评：仍不确定。'} 本次记录已保存。</p><p class="lesson-help">本组必要重练已完成。可再练一次，也可继续，不会无限卡住。</p>`);
      button('这个词再练一次',()=>perform('retry'),controls);
      button('继续下一词',()=>perform('next'),controls,'primary');
    }else{
      if(!s.said)button('我已自己说出，接着听原音',()=>{
        if(['requesting','recording','stopping'].includes(recorder.state))recorder.cancel();else recorder.stopPlayback();
        perform('said');
      },controls,'primary');
      recordingControls(content,s);
      if(s.said&&s.listened){
        const choices=document.createElement('div');choices.className='assessment-choices';controls.append(choices);
        for(const [label,value,cls]of [['✓ 我读对了','correct','assessment-correct'],['× 我读错了','wrong','assessment-wrong'],[s.phase==='pronounce'?'不确定，稍后再练':'仍不确定','unsure','assessment-unsure']])
          button(label,()=>perform('assess',value,{hold:s.phase==='pronounceRetry'}),choices,cls);
        if(s.phase==='pronounce')content.insertAdjacentHTML('beforeend','<p class="lesson-help">读错或不确定的词，会在本组结束前再练一次。</p>');
      }
    }
  }else if(s.phase==='teach'){
    content.insertAdjacentHTML('beforeend',`<div class="word-heading"><h3 class="answer" lang="en">${escape(w.surface)}</h3><p class="lesson-ipa">/${escape(c.ipa)}/ <span class="lesson-source">${escape(c.ipaAccent)}</span></p></div><p class="lesson-definition" lang="en">${escape(c.definition)}</p><p class="lesson-example" lang="en">${escape(c.example)}</p>${c.usage?`<p class="lesson-usage"><span class="lesson-label">常见用法</span> ${escape(c.usage)}</p>`:''}<details class="lesson-sources"><summary>内容来源与说明</summary><p class="lesson-source">词性：${escape(c.partOfSpeech||'未提供')}<br>音标：${escape(c.ipaSource)}<br>释义：${escape(c.definitionSource)}<br>例句：${escape(c.exampleSource)}${c.usageSource?'<br>用法：'+escape(c.usageSource):''}<br>音频：${escape(c.audio.license)}</p></details>`);
    if(c.chinese&&c.chineseSource){
      const translation=document.createElement('p');translation.className='translation';translation.id='lessonTranslation';translation.hidden=true;translation.textContent=c.chinese+' · '+c.chineseSource;content.append(translation);
      const reveal=button('显示中文',()=>{
        if(translation.hidden&&!update(d=>act(d,active,'chinese')))return;
        translation.hidden=!translation.hidden;
        reveal.textContent=translation.hidden?'显示中文':'隐藏中文';
        reveal.setAttribute('aria-expanded',String(!translation.hidden));
      },controls,'subtle');
      reveal.setAttribute('aria-expanded','false');reveal.setAttribute('aria-controls',translation.id);
    }else content.append(document.createTextNode('暂无已核对中文释义'));
    button('下一步',()=>perform('next'),controls,'primary');
  }else if(s.phase==='sentence'){
    content.insertAdjacentHTML('beforeend',`<p class="lesson-example" lang="en">${escape(c.example)}</p><p class="lesson-prompt">${escape(c.sentencePrompt||'写一句自己的表达。')}</p>`);
    if(!s.revealed){
      content.insertAdjacentHTML('beforeend','<label class="sentence-label" for="sentence">写一句自己的表达</label><textarea id="sentence" aria-label="写一句自己的表达"></textarea><p class="lesson-help">可只保存，也可明确跳过；造句不阻塞学习。</p>');
      button('保存句子',()=>{const value=$('#sentence').value;if(!value.trim()){error.textContent='请先写一句，或明确点击“跳过造句”。';return;}perform('sentence',value);},controls,'primary');
      button('跳过造句',()=>perform('sentence',''),controls,'subtle');
    }else{
      content.insertAdjacentHTML('beforeend',`<p>已保存${s.answer?'你的句子':'跳过记录'}。</p>${s.answer?`<blockquote lang="en">${escape(s.answer)}</blockquote>`:''}<p class="lesson-help">可以对照上方示例，继续下一项。</p>`);
      button('下一步',()=>perform('next'),controls,'primary');
    }
    attachSentenceFeedback(content,controls,s,w);
  }else{
    if(!s.revealed){
      content.insertAdjacentHTML('beforeend','<label class="spelling-label">输入你听到的词<input id="spelling" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label>');
      button('提交并揭晓',()=>perform('spell',$('#spelling').value),controls,'primary');
    }else{
      content.insertAdjacentHTML('beforeend',`<p>你的答案：${escape(s.answer)}</p><p class="answer" lang="en">${escape(w.surface)}</p><p>${norm(s.answer)===w.normalized?'这次拼写正确。':'这次有差异。首轮拼错会安排至少一次重练。'}</p>`);
      if(s.phase==='spellRetry')button('这个词再练一次',()=>perform('retry'),controls);
      button('下一步',()=>perform('next'),controls,'primary');
    }
  }
}
$('#settingsPanel').addEventListener('click',e=>{const b=e.target.closest('button[data-go]');if(b)go(b.dataset.go);});
document.querySelectorAll('.sidebar a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();go(a.dataset.page||'home');}));
$('#export').onclick=()=>{const text=loadFailed?localStorage.getItem('vocab-v01'):JSON.stringify(db,null,2);const url=URL.createObjectURL(new Blob([text||''],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='词间学习备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('#import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>20000000)throw Error('备份超过 20MB。');incoming=validate(JSON.parse(await f.text()));merge(db,incoming);$('#importPreview').innerHTML=`<p>备份预览：${incoming.words.length} 词，${incoming.batches.length} 批，${incoming.sessions.length} 次学习，${incoming.events.length} 条记录。相同记录不重复导入。</p>`;button('确认合并导入',()=>{if(update(d=>{Object.assign(d,merge(d,incoming))})){incoming=null;$('#importPreview').textContent='导入已保存。';active=null;checkedContent.clear();void auditStoredContent();
render()}},$('#importPreview'),'primary')}catch(e){incoming=null;$('#importPreview').textContent='未导入，现有记录保持不变：'+e.message}};
window.addEventListener('hashchange',()=>{active=null;resumeId=null;render();});
$('#feedbackReconnect').onclick=()=>void probeSentenceFeedback();
render();
void probeSentenceFeedback();
void auditStoredContent();
setInterval(()=>{paintPreparation();if(recorder.state==='recording')paintRecording('recording');},1000);
window.addEventListener('pagehide',()=>{stop();recorder.cancel();for(const batch of db.batches)preparer.cancel(batch.id);});

window.addEventListener('beforeunload',e=>{const pending=$('#spelling')?.value||$('#sentence')?.value||draft;if(pending){e.preventDefault();e.returnValue=''}});
window.addEventListener('storage',e=>{if(e.key==='vocab-v01'){loadFailed=true;stop();error.textContent='另一个页面已更新学习记录，请刷新本页，避免覆盖较新的位置。'}});

document.addEventListener('visibilitychange',()=>{if(document.hidden){playback.stop();if(['requesting','recording','stopping'].includes(recorder.state))recorder.cancel();else recorder.stopPlayback();}});
