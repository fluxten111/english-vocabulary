// A player belongs to one exact saved learning position, never to a global page.
export function createPlayback({createAudio = url => new Audio(url), current, complete, status = () => {}}) {
  let player = null;
  let generation = 0;
  const same = (a, b) => a && b && a.sessionId === b.sessionId &&
    a.wordId === b.wordId && a.phase === b.phase && a.group === b.group &&
    a.index === b.index && a.senseId === b.senseId;
  function stop() {
    generation++;
    if (!player) return;
    const previous = player;
    player = null;
    previous.onended = previous.onerror = previous.onplaying = null;
    previous.pause();
  }
  async function play(url, position) {
    stop();
    const token = generation;
    const owner = {...position};
    const audio = createAudio(url);
    player = audio;
    const valid = () => generation === token && player === audio && same(current(), owner);
    audio.onplaying = () => { if (valid()) status('playing'); };
    audio.onerror = () => { if (valid()) {stop();status('failed');} };
    audio.onended = () => {
      if (!valid()) return;
      // Disarm before persisting: duplicate/queued ended events cannot write twice.
      audio.onended = null;
      player = null;
      complete(owner);
    };
    status('loading');
    try { await audio.play(); }
    catch { if (valid()) {stop();status('failed');} }
  }
  return {play, stop, pause() { player?.pause(); status('paused'); }};
}
