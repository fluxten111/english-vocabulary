// Parse only the requested headword's senses; never mix first definitions/examples.
import {norm} from './core.mjs';
import {contentDigest,checkReviewedContent} from './content.mjs';
export function audioUrl(audioId) {
  if(typeof audioId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(audioId))throw Error('Invalid audio id');
  const folder=audioId.startsWith('bix')?'bix':audioId.startsWith('gg')?'gg':/^[a-z]/i.test(audioId)?audioId[0].toLowerCase():'number';
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${folder}/${encodeURIComponent(audioId)}.mp3`;
}
export function plain(value) {
  if(typeof value!=='string')return '';
  return value.replace(/\{(?:a_link|d_link|et_link|i_link|mat|sx)\|([^|}]+)[^}]*\}/g,'$1')
    .replace(/\{dxt\|([^|}]+)[^}]*\}/g,'$1').replace(/\{bc\}/g,'')
    .replace(/\{ldquo\}|\{rdquo\}/g,'"').replace(/\{[^}]*\}/g,'').trim();
}
export function candidatesFor(raw,normalizedForm) {
  if(!Array.isArray(raw)||raw.every(x=>typeof x==='string'))return [];
  const candidates=[];
  for(const entry of raw){
    if(!entry||typeof entry!=='object'||typeof entry.meta?.id!=='string')continue;
    const headword=entry.hwi?.hw?.replace(/\*/g,'');
    if(typeof headword!=='string'||norm(headword)!==normalizedForm)continue;
    const pronunciations=(entry.hwi?.prs||[]).filter(p=>typeof p.ipa==='string'&&p.sound?.audio)
      .map(p=>({ipa:p.ipa,audioId:p.sound.audio,label:[p.l,p.l2].filter(Boolean).join(' ')}));
    const walk=(value,path)=>{
      if(!Array.isArray(value))return;
      if(value[0]==='sense'&&value[1]&&typeof value[1]==='object'){
        const sense=value[1],dt=Array.isArray(sense.dt)?sense.dt:[];
        const definition=dt.filter(x=>x[0]==='text').map(x=>plain(x[1])).join(' ');
        const examples=dt.filter(x=>x[0]==='vis'&&Array.isArray(x[1])).flatMap(x=>x[1]).map(x=>plain(x.t)).filter(Boolean);
        const senseId=entry.meta.id+'#'+(typeof sense.sn==='string'?sense.sn:'path:'+path.join('.'));
        if(definition)candidates.push({entryId:entry.meta.id,senseId,definition,examples,pronunciations});
        if(sense.sdsense)walk(['sense',sense.sdsense],[...path,'sdsense']);
        return;
      }
      value.forEach((x,i)=>walk(x,[...path,i]));
    };
    for(let i=0;i<(entry.def||[]).length;i++)walk(entry.def[i].sseq,[i]);
  }
  return candidates;
}
export function assembleReviewedContent(candidate,record) {
  const pronunciation=candidate.pronunciations.find(p=>p.audioId===record.audioId);
  if(!pronunciation||!Number.isInteger(record.exampleIndex)||record.exampleIndex<0||
    !candidate.examples[record.exampleIndex]||typeof record.cue!=='string'||
    typeof record.license!=='string'||!record.license)throw Error('Incomplete review');
  const source='Merriam-Webster Learner’s Dictionary · '+candidate.senseId;
  const content={checked:true,entryId:candidate.entryId,senseId:candidate.senseId,
    reviewId:record.id,reviewVersion:record.version,cue:record.cue,
    audio:{kind:'dictionary',id:pronunciation.audioId,url:audioUrl(pronunciation.audioId),
      source:'Merriam-Webster Learner’s Dictionary',accent:'US',license:record.license},
    ipa:pronunciation.ipa,ipaAccent:'US',ipaSource:source,
    definition:candidate.definition,definitionSource:source,
    example:candidate.examples[record.exampleIndex],exampleSource:source};
  if(typeof record.chinese==='string'&&record.chinese&&typeof record.chineseSource==='string'&&record.chineseSource)
    Object.assign(content,{chinese:record.chinese,chineseSource:record.chineseSource});
  return content;
}
export async function reviewedResult({raw,wordId,word,requestId,reviews}) {
  const normalizedForm=norm(word),candidates=candidatesFor(raw,normalizedForm);
  const envelope={schema:1,requestId,wordId,normalizedForm,provider:'merriam-webster/learners'};
  if(!candidates.length)return{...envelope,status:'not_found'};
  for(const record of reviews.filter(r=>r.normalizedForm===normalizedForm)){
    const candidate=candidates.find(c=>c.entryId===record.entryId&&c.senseId===record.senseId);
    if(!candidate)continue;
    try{
      // The public review catalogue keeps a digest, not copied dictionary definitions/examples.
      const content=assembleReviewedContent(candidate,record);
      await checkReviewedContent({id:wordId,normalized:normalizedForm},content,reviews);
      return{...envelope,status:'ready',content};
    }catch{continue;}
  }
  return{...envelope,status:'review_required',candidateCount:candidates.length};
}
