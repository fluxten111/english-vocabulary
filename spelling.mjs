import {parse,scanInput,norm} from './core.mjs?v=20261108-input-r5';
import {dictionaryInfo} from './spelling-data.mjs';

// Spelling evidence only: never set teaching content or learning progress here.
export function inspectInput(raw,lexicon) {
  const parsed=parse(raw),valid=new Set(parsed.words.map(norm)),seen=new Set();
  const rows=[];
  for(const item of scanInput(raw)){
    const key=norm(item.text);
    if(valid.has(key)&&seen.has(key))continue;
    seen.add(key);
    let kind,message;
    if(!valid.has(key)){
      kind='invalid';message=item.text.length>500?'这一项太长，请缩短到500个字符以内。':'输入格式不对。多个单词请用逗号或换行分开，例如 bear，ice。';
    }else if(!lexicon){
      kind='unavailable';message='暂时无法查询词典，请稍后再次点击“检查词表”。';
    }else if(lexicon.has(key)){
      kind='found';message='词典中已查到。';
    }else if(key.includes(' ')){
      const missing=key.split(' ').filter(part=>!lexicon.has(part));
      kind=missing.length?'missing':'phrase';
      message=missing.length?`没有查到“${[...new Set(missing)].join('、')}”，请检查拼写。`:
        `你是否想输入多个单词？请在上方输入框改成 ${item.text.split(' ').join('，')}。如果本来就是短语，可以保留。`;
    }else{
      kind='missing';message='没有查到这个单词，请检查拼写。';
    }
    rows.push({...item,kind,message});
  }
  return {...parsed,rows,canSave:parsed.words.length>0&&parsed.invalid.length===0};
}

export function createInputChecker({fetcher=fetch,timeoutMs=12000}={}) {
  let lexicon=null,loading=null;
  async function load(){
    if(lexicon)return lexicon;
    if(!loading)loading=(async()=>{
      const controller=new AbortController();let timer;
      try{
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Dictionary timeout'));},timeoutMs);});
        const read=(async()=>{
          const response=await fetcher(new URL('./assets/spelling-en-us.txt',import.meta.url),{signal:controller.signal});
          if(!response.ok)throw Error('Dictionary unavailable');
          const text=await response.text();if(text.length>4000000)throw Error('Dictionary too large');
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
          const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
          if(hash!==dictionaryInfo.sha256)throw Error('Dictionary integrity mismatch');
          const words=text.trimEnd().split('\n');
          if(words.length!==dictionaryInfo.entries)throw Error('Dictionary incomplete');
          return new Set(words);
        })();
        lexicon=await Promise.race([read,timeout]);return lexicon;
      }finally{clearTimeout(timer);loading=null;}
    })();
    return loading;
  }
  return async(raw,{signal}={})=>{
    if(signal?.aborted)throw signal.reason||Error('Cancelled');
    const parsed=parse(raw);
    if(!parsed.words.length)return inspectInput(raw,new Set());
    let words;
    try{words=await load();}catch{words=null;}
    if(signal?.aborted)throw signal.reason||Error('Cancelled');
    return inspectInput(raw,words);
  };
}
