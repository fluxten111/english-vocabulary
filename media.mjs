// Every task belongs to one learning attempt. UI-only changes need not restart audio.
export function createPlayback({createAudio = url => new Audio(url), current, complete,
  status = () => {}, setTimer = setTimeout, clearTimer = clearTimeout}) {
  let player = null, pending = null, generation = 0, playRequest = 0, state = 'idle', owner = null, started = false;
  const same = (a,b) => a && b && ['sessionId','wordId','phase','group','index','senseId','restarts','attempt']
    .every(k => a[k] === b[k]);
  const report = next => { state = next; status(next); };
  function stop() {
    generation++;playRequest++;
    if(pending !== null) clearTimer(pending);
    pending = null;
    if(player) {
      const previous = player;
      player = null;
      previous.onended = previous.onerror = previous.onplaying = previous.onwaiting = previous.onpause = null;
      previous.pause();
    }
    owner = null; started = false;
    report('idle');
  }
  function prepare(url, position) {
    stop();
    owner = {...position};
    const token = generation, audio = createAudio(url);
    player = audio;
    const valid = () => token === generation && player === audio && same(current(),owner);
    audio.onplaying = () => { if(valid()&&state!=='paused') { started = true; report('playing'); } };
    audio.onwaiting = () => { if(valid() && state !== 'paused') report('loading'); };
    audio.onpause = () => { if(valid() && started && !audio.ended) report('paused'); };
    audio.onerror = () => { if(valid()) {stop();report('failed');} };
    audio.onended = () => {
      if(!valid() || !started) return;
      const finished = owner;
      audio.onended = audio.onerror = audio.onplaying = audio.onwaiting = audio.onpause = null;
      player = null; owner = null; started = false;
      report('ended');
      complete(finished);
    };
    return {audio,valid};
  }
  async function start(audio, valid) {
    if(!valid()) return;
    const request=++playRequest;
    report('loading');
    try {
      await audio.play();
      if(valid()&&request===playRequest) { started = true; if(state !== 'paused') report('playing'); }
    } catch {
      if(valid()&&request===playRequest&&state!=='paused') {stop();report('failed');}
    }
  }
  function play(url, position) {
    const task = prepare(url,position);
    return start(task.audio,task.valid);
  }
  function schedule(url,position,delayMs=1000) {
    if(pending !== null && same(owner,position)) return;
    const task = prepare(url,position);
    // Preloading is a hint; it cannot count as playback or completion.
    task.audio.preload = 'auto';
    report('scheduled');
    pending = setTimer(() => {
      pending = null;
      if(task.valid()) void start(task.audio,task.valid);
    },delayMs);
  }
  function pause() {
    if(!player || !same(current(),owner) || !['playing','loading'].includes(state)) return;
    playRequest++;player.pause(); report('paused');
  }
  async function resume() {
    if(!player || !same(current(),owner) || state !== 'paused') return;
    const audio = player, token = generation;
    const valid = () => token === generation && player === audio && same(current(),owner);
    return start(audio,valid);
  }
  return {play,schedule,pause,resume,stop,get state(){return state;}};
}
