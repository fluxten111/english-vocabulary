export const norm=s=>s.trim().toLowerCase().replace(/[’]/g,"'").replace(/\s+/g,' ');
export const id=()=>crypto.randomUUID();
export const fresh=()=>({schema:1,revision:0,words:[],batches:[],sessions:[],events:[]});
export function parse(raw){const words=[],duplicates=[],invalid=[];const seen=new Set;for(const token of raw.split(/[\n,;，；\t]+/)){const s=token.trim();if(!s)continue;if(!/^[a-zA-Z]+(?:[ '\-’][a-zA-Z]+)*$/.test(s)){invalid.push(s);continue}const n=norm(s);if(seen.has(n))duplicates.push(s);else{seen.add(n);words.push(s)}}return{words,duplicates,invalid}}
export function createBatch(db,raw,name,skipExisting=false){const p=parse(raw);const wordIds=[];for(const surface of p.words){let w=db.words.find(w=>w.normalized===norm(surface));if(w&&skipExisting)continue;if(!w){w={id:id(),surface,normalized:norm(surface),content:null};db.words.push(w)}wordIds.push(w.id)}if(!wordIds.length)throw Error('没有可建立批次的词。');const b={id:id(),name:name||'我的词表',originalInput:raw,wordIds,createdAt:new Date().toISOString(),completedAt:null};db.batches.push(b);db.sessions.push(session(b));return b}
export function session(b,replay=false){return{id:id(),batchId:b.id,replay,status:'new',group:0,phase:'sound',index:0,queue:[],weak:[],revealed:false,said:false,listened:false,answer:'',startedAt:null,completedAt:null,restarts:0}}
export const groupWords=(db,s)=>db.batches.find(b=>b.id===s.batchId).wordIds.slice(s.group*10,s.group*10+10);
export const currentId=(db,s)=>s.phase.endsWith('Retry')?s.queue[s.index]:groupWords(db,s)[s.index];
const isText = (v, max = 20000) => typeof v === 'string' && v.length <= max;
const secureUrl = v => {
  if (!isText(v, 3000)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
};
export function validateContent(c) {
  if (c === null || c === undefined) return;
  if (typeof c !== 'object' || Array.isArray(c)) throw Error('学习内容结构损坏。');
  if (c.checked !== undefined && typeof c.checked !== 'boolean') throw Error('内容核对标记损坏。');
  for (const k of ['senseId','cue','ipa','ipaAccent','ipaSource','definition','definitionSource',
    'example','exampleSource','chinese','chineseSource','entryId','reviewId','reviewVersion']) {
    if (c[k] !== undefined && !isText(c[k])) throw Error('学习内容字段损坏：' + k);
  }
  if (c.audio !== undefined && c.audio !== null) {
    if (typeof c.audio !== 'object' || Array.isArray(c.audio)) throw Error('录音信息损坏。');
    for (const k of ['kind','url','source','accent','license','id']) {
      if (c.audio[k] !== undefined && !isText(c.audio[k],3000)) throw Error('录音字段损坏：' + k);
    }
    if (c.audio.url && !secureUrl(c.audio.url)) throw Error('录音网址必须为有效的 HTTPS 网址。');
    if (c.audio.accent && !['US','UK'].includes(c.audio.accent)) throw Error('录音口音标记损坏。');
  }
}
export function ready(w, phase) {
  try { validateContent(w?.content); } catch { return false; }
  const c = w?.content;
  if (!c || c.checked !== true || !c.senseId || !isText(w?.normalized)) return false;
  const sound = c.audio?.kind === 'dictionary' && secureUrl(c.audio.url) &&
    c.audio.source && ['US','UK'].includes(c.audio.accent) && c.audio.license && c.cue &&
    !norm(c.cue).includes(w.normalized) && !/[\u3400-\u9fff]/.test(c.cue);
  if (!sound) return false;
  if (['teach','sentence','spell','spellRetry'].includes(phase)) return Boolean(
    c.ipa && c.ipaAccent === c.audio.accent && c.ipaSource && c.definition &&
    c.definitionSource && c.example && c.exampleSource);
  return true;
}
function change(s,phase){s.phase=phase;s.index=0;s.weak=[];s.queue=[]}
function next(db,s){s.index++;s.said=false;s.listened=false;s.revealed=false;s.answer='';const count=s.phase.endsWith('Retry')?s.queue.length:groupWords(db,s).length;if(s.index<count)return;switch(s.phase){case'sound':change(s,'pronounce');break;case'pronounce':if(s.weak.length){s.queue=[...s.weak];s.phase='pronounceRetry';s.index=0}else change(s,'teach');break;case'pronounceRetry':change(s,'teach');break;case'teach':change(s,'sentence');break;case'sentence':change(s,'spell');break;case'spell':if(s.weak.length){s.queue=[...s.weak];s.phase='spellRetry';s.index=0}else finishGroup(db,s);break;case'spellRetry':finishGroup(db,s)}}
function finishGroup(db,s){const b=db.batches.find(b=>b.id===s.batchId);if((s.group+1)*10<b.wordIds.length){s.group++;change(s,'sound')}else{s.status='completed';s.completedAt=new Date().toISOString();if(!s.replay&&!b.completedAt)b.completedAt=s.completedAt}}
export function act(db,sid,type,value=''){const s=db.sessions.find(s=>s.id===sid);if(!s||s.status==='completed')throw Error('练习已结束。');const wid=currentId(db,s),w=db.words.find(w=>w.id===wid);if(!ready(w,s.phase))throw Error('当前内容待核对，位置已保留。');const phase=s.phase;const allowed={said:['pronounce','pronounceRetry'],assess:['pronounce','pronounceRetry'],spell:['spell','spellRetry'],sentence:['sentence'],chinese:['teach'],retry:['pronounceRetry','spellRetry']};if(allowed[type]&&!allowed[type].includes(phase))throw Error('当前阶段不能执行此动作。');const event={id:id(),sessionId:s.id,batchId:s.batchId,wordId:wid,phase,type,value,at:new Date().toISOString()};if(type==='said'){s.said=true}else if(type==='listened'){if(phase.startsWith('pronounce')&&!s.said)throw Error('请先自己说，再听录音。');s.listened=true}else if(type==='assess'){if(!s.said||!s.listened||!['correct','wrong','unsure'].includes(value))throw Error('请先说、听，再自评。');if(phase==='pronounce'&&value!=='correct')s.weak.push(wid);next(db,s)}else if(type==='spell'){if(!phase.startsWith('spell')||s.revealed||!value.trim())throw Error('请先输入拼写。');s.answer=value;s.revealed=true;event.correct=norm(value)===w.normalized;if(phase==='spell'&&!event.correct)s.weak.push(wid)}else if(type==='next'){if(phase==='sound'&&!s.listened)throw Error('请先听录音。');if(phase==='sentence'&&!s.revealed)throw Error('请保存句子或明确跳过。');if(phase.startsWith('spell')&&!s.revealed)throw Error('请先提交拼写。');if(phase.startsWith('pronounce'))throw Error('请完成自评。');next(db,s)}else if(type==='sentence'){if(phase!=='sentence')throw Error('阶段不符。');s.revealed=true;s.answer=value;event.skipped=!value.trim()}else if(type==='retry'){if(!phase.endsWith('Retry'))throw Error('仅弱项复测可额外重练。');s.said=false;s.listened=false;s.revealed=false;s.answer=''}else if(type==='chinese'){if(phase!=='teach')throw Error('尚不能显示中文。')}else throw Error('未知操作。');s.status=s.status==='completed'?'completed':'active';s.startedAt ||=event.at;db.events.push(event);return event}
export function validate(db) {
  if (!db || db.schema !== 1 || !Number.isInteger(db.revision) || db.revision < 0)
    throw Error('备份版本不支持。');
  for (const key of ['words','batches','sessions','events']) {
    if (!Array.isArray(db[key]) || db[key].length > 200000) throw Error('备份结构不正确。');
    const ids = new Set();
    for (const x of db[key]) {
      if (!x || !isText(x.id,100) || !x.id || ids.has(x.id)) throw Error('备份有重复或无效编号。');
      ids.add(x.id);
    }
  }
  const words = new Map(db.words.map(w => [w.id,w]));
  const batches = new Map(db.batches.map(b => [b.id,b]));
  const sessions = new Map(db.sessions.map(s => [s.id,s]));
  for (const w of db.words) {
    if (!isText(w.surface,500) || !w.surface || w.normalized !== norm(w.surface)) throw Error('词条损坏。');
    validateContent(w.content);
  }
  for (const b of db.batches) {
    if (!isText(b.name,500) || !isText(b.originalInput,5000000) || !Array.isArray(b.wordIds) ||
      !b.wordIds.length || new Set(b.wordIds).size !== b.wordIds.length ||
      b.wordIds.some(id => !words.has(id))) throw Error('批次损坏。');
    if (b.preparation !== undefined) {
      const p=b.preparation;
      if (!p || typeof p !== 'object' || Array.isArray(p) ||
        !['preparing','ready','partial','failed','timeout','cancelled','unconfigured','interrupted'].includes(p.status) ||
        !isText(p.runId,100) || !Number.isFinite(p.startedAt) || !Number.isFinite(p.deadlineAt) ||
        p.deadlineAt-p.startedAt!==150000 || !Number.isFinite(p.elapsedMs) || p.elapsedMs<0 || p.elapsedMs>150000 ||
        ['total','ready','finished','pending','needsReview','failed'].some(k=>!Number.isInteger(p[k])||p[k]<0||p[k]>b.wordIds.length) ||
        (p.blocked!==undefined&&(!Number.isInteger(p.blocked)||p.blocked<0||p.blocked>b.wordIds.length)) ||
        p.total!==b.wordIds.length || (p.code!==null&&!isText(p.code,100)) ||
        (p.estimateMs!==null&&(!Number.isFinite(p.estimateMs)||p.estimateMs<0||p.estimateMs>150000)) ||
        !p.items || typeof p.items!=='object' || Array.isArray(p.items)) throw Error('内容准备记录损坏。');
      for (const [wordId,item] of Object.entries(p.items)) {
        if (!b.wordIds.includes(wordId) || !item ||
          !['queued','loading','ready','review_required','not_found','failed','timeout','blocked'].includes(item.status) ||
          (item.code!==undefined&&!isText(item.code,100)) ||
          (item.attempt!==undefined&&![1,2].includes(item.attempt))) throw Error('单词准备状态损坏。');
      }
    }

  }
  for (const s of db.sessions) {
    const b = batches.get(s.batchId);
    if (!b || !['new','active','completed'].includes(s.status) ||
      !['sound','pronounce','pronounceRetry','teach','sentence','spell','spellRetry'].includes(s.phase) ||
      !Number.isInteger(s.group) || s.group < 0 || s.group >= Math.ceil(b.wordIds.length/10) ||
      !Number.isInteger(s.index) || s.index < 0 || !Array.isArray(s.queue) || !Array.isArray(s.weak) ||
      s.queue.some(x => !b.wordIds.includes(x)) || s.weak.some(x => !b.wordIds.includes(x)) ||
      !isText(s.answer ?? '')) throw Error('学习位置损坏。');
    const flags = ['revealed','said','listened'];
    if (flags.some(k => typeof s[k] !== 'boolean')) throw Error('学习动作状态损坏。');
    if (s.status !== 'completed' && !currentId(db,s)) throw Error('学习位置越界。');
  }
  for (const e of db.events) {
    const s = sessions.get(e.sessionId), b = batches.get(e.batchId);
    if (!s || !b || s.batchId !== b.id || !b.wordIds.includes(e.wordId) || !words.has(e.wordId))
      throw Error('练习历史与词批次不一致。');
  }
  return db;
}
export function merge(local,incoming){validate(incoming);const out=structuredClone(local),conflicts=[];for(const key of ['words','batches','sessions','events'])for(const x of incoming[key]){const old=out[key].find(y=>y.id===x.id);if(old&&JSON.stringify(old)!==JSON.stringify(x))conflicts.push(key+': '+x.id);else if(!old)out[key].push(x)}if(conflicts.length)throw Error(`有 ${conflicts.length} 条相同编号但内容不同的记录，未导入；请保留两份备份后处理。`);validate(out);return out}
export function save(storage,db){validate(db);const text=JSON.stringify(db);storage.setItem('vocab-v01',text);if(storage.getItem('vocab-v01')!==text)throw Error('保存后读回不一致。');return db}
export function transaction(storage,db,fn){const stored=storage.getItem('vocab-v01');if(stored&&JSON.parse(stored).revision!==db.revision)throw Error('其他页面已更新学习记录，请刷新后继续。');const copy=structuredClone(db);fn(copy);copy.revision++;save(storage,copy);return copy}
