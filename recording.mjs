// Temporary, device-local recording. Blobs never enter the learning database.
export function createRecorder({current,getStream=()=>navigator.mediaDevices.getUserMedia({audio:true}),
  createMediaRecorder=stream=>new MediaRecorder(stream),createAudio=url=>new Audio(url),
  makeUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url),
  status=()=>{},ready=()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,permissionWaitMs=15000}={}){
  let generation=0,owner=null,stream=null,recorder=null,chunks=[],url=null,clip=null,state='idle',startedAt=0,permissionTimer=null;
  const same=(a,b)=>a&&b&&['sessionId','wordId','phase','group','index','senseId','restarts','attempt'].every(k=>a[k]===b[k]);
  const report=(next,message='')=>{state=next;status(next,message);};
  const release=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;};
  function stopClip(){if(clip){const old=clip;clip=null;old.onended=old.onerror=null;old.pause();}}
  function cancel(){
    generation++;stopClip();
    if(permissionTimer!==null)clearTimer(permissionTimer);permissionTimer=null;
    const old=recorder;recorder=null;
    if(old){old.onstop=old.ondataavailable=old.onerror=null;if(old.state!=='inactive')try{old.stop();}catch{}}
    release();if(url)revokeUrl(url);url=null;owner=null;chunks=[];startedAt=0;report('idle');
  }
  async function start(position){
    if(['requesting','recording','stopping'].includes(state))return;
    cancel();owner={...position};const token=generation;
    const valid=()=>token===generation&&same(current(),owner);
    report('requesting');
    let expired=false,disposed=false,requestTimer=null;
    const discard=acquired=>{if(!disposed){disposed=true;acquired.getTracks().forEach(t=>t.stop());}};
    try{
      const request=Promise.resolve(getStream());
      request.then(acquired=>{if(expired||!valid())discard(acquired);},()=>{});
      const deadline=new Promise((_,reject)=>{requestTimer=setTimer(()=>{expired=true;reject(Error('permission timeout'));},permissionWaitMs);permissionTimer=requestTimer;});
      const acquired=await Promise.race([request,deadline]);
      if(requestTimer!==null)clearTimer(requestTimer);if(permissionTimer===requestTimer)permissionTimer=null;
      if(!valid()||expired){discard(acquired);return;}
      stream=acquired;const instance=createMediaRecorder(stream);recorder=instance;
      const active=()=>valid()&&recorder===instance;
      instance.ondataavailable=e=>{if(active()&&e.data?.size>0)chunks.push(e.data);};
      instance.onerror=()=>{
        if(!active())return;
        instance.onstop=instance.ondataavailable=instance.onerror=null;recorder=null;
        try{if(instance.state!=='inactive')instance.stop();}catch{}
        release();chunks=[];report('failed','录音失败，可自行说出后继续。');
      };
      instance.onstop=()=>{
        if(!active())return;
        instance.onstop=instance.ondataavailable=instance.onerror=null;recorder=null;release();
        if(!chunks.length){report('failed','没有取得可回放录音，可重录或自行说出后继续。');return;}
        try{
          const blob=new Blob(chunks,{type:instance.mimeType||chunks[0].type||''});chunks=[];
          if(!blob.size)throw Error('empty');
          url=makeUrl(blob);report('ready');ready({...owner});
        }catch{report('failed','录音暂时无法回放，可重录或自行说出后继续。');}
      };
      instance.start();startedAt=now();report('recording');
    }catch{
      if(!valid())return;
      release();recorder=null;report('failed',expired?'麦克风授权尚未完成，可重试或先自行说出后继续。':'麦克风不可用，可自行说出后继续。');
    }finally{
      if(requestTimer!==null)clearTimer(requestTimer);if(permissionTimer===requestTimer)permissionTimer=null;
    }
  }
  function finish(){
    if(!recorder||state!=='recording')return;
    report('stopping');
    try{recorder.stop();}catch{cancel();report('failed','停止录音失败，可自行说出后继续。');}
  }
  async function play(){
    if(!url||!same(current(),owner))return;
    stopClip();const audio=createAudio(url),token=generation;clip=audio;
    const valid=()=>token===generation&&clip===audio&&same(current(),owner);
    audio.onended=()=>{if(valid()){stopClip();report('ready');}};
    audio.onerror=()=>{if(valid()){stopClip();report('ready','回放失败，可重试或继续听标准原声。');}};
    try{report('playing');await audio.play();}catch{if(valid()){stopClip();report('ready','回放失败，可重试或继续。');}}
  }
  return {start,finish,play,cancel,
    sync(position){if(owner&&!same(position,owner))cancel();},
    stopPlayback(){stopClip();if(url)report('ready');},
    get state(){return state;},get hasClip(){return !!url;},
    get seconds(){return startedAt?Math.max(0,Math.floor((now()-startedAt)/1000)):0;}
  };
}
