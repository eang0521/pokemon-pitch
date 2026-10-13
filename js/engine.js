// Match engine host: runs a Match and turns its output into compact messages.
// Used inside the Web Worker (js/worker.js) and as an in-page fallback.
import { Match } from './match.js';

// Frames -> one Float32Array: per frame [t, bx, by, bz, owner, (x, y, flag, vx, vy) * n]
export function packFrames(frames) {
  if (!frames?.length) return { n: 0, stride: 0, data: new Float32Array(0) };
  const n = frames[0].p.length, stride = 5 + n * 5;
  const data = new Float32Array(frames.length * stride);
  frames.forEach((f, i) => {
    const o = i * stride;
    data[o] = f.t; data[o + 1] = f.b[0]; data[o + 2] = f.b[1]; data[o + 3] = f.b[2]; data[o + 4] = f.b[3];
    for (let k = 0; k < n; k++) { const p = f.p[k], q = o + 5 + k * 5; data[q] = p[0]; data[q + 1] = p[1]; data[q + 2] = p[2]; data[q + 3] = p[3]; data[q + 4] = p[4]; }
  });
  return { n, stride, data };
}
export function unpackFrames(pk) {
  const { n, stride, data } = pk;
  const out = [];
  for (let o = 0; o < data.length; o += stride) {
    const p = [];
    for (let k = 0; k < n; k++) { const q = o + 5 + k * 5; p.push([data[q], data[q + 1], data[q + 2], data[q + 3], data[q + 4]]); }
    out.push({ t: data[o], b: [data[o + 1], data[o + 2], data[o + 3], data[o + 4]], p });
  }
  return out;
}

export function createEngine() {
  let match = null, sentPlayers = new Set(), sentLog = 0;

  // Only what changed since the last message: new players, new log lines.
  function stateOf() {
    const m = match;
    const players = {};
    for (const id in m.players) if (!sentPlayers.has(id)) { players[id] = { ...m.players[id] }; sentPlayers.add(id); }
    const log = m.log.slice(sentLog);
    const logFrom = sentLog;
    sentLog = m.log.length;
    return {
      score: [...m.score], half: m.half, clock: m.clock, final: m.final,
      stats: JSON.parse(JSON.stringify(m.stats)), log, logFrom, players,
      sides: m.sim.sides.map((S) => ({
        dir: S.dir,
        onField: Object.fromEntries(S.ents.map((e) => [e.slot, e.id])),
        sentOff: S.ents.filter((e) => e.sentOff).map((e) => e.id),
        flex: S.depth.flex,
      })),
      energy: Object.assign({}, ...m.depth.map((d) => d.energy)),
    };
  }

  function recMsg(rec) {
    const packed = packFrames(rec.frames);
    const { frames, ...rest } = rec;
    return { rec: { ...rest, packed }, transfer: [packed.data.buffer] };
  }

  // Run until done() is true, sending records in batches (for replays) and progress.
  function simUntil(done) {
    const out = [];
    let batch = [], transfer = [], rec;
    while (!match.final && !done() && (rec = match.next())) {
      const r = recMsg(rec);
      batch.push(r.rec); transfer.push(...r.transfer);
      if (batch.length >= 20) { out.push({ msg: { type: 'batch', recs: batch, progress: progress() }, transfer }); batch = []; transfer = []; }
    }
    out.push({ msg: { type: 'batch', recs: batch, progress: 1 }, transfer });
    out.push({ msg: match.final ? { type: 'final', state: stateOf() } : { type: 'simmed', state: stateOf() } });
    return out;
  }
  const progress = () => Math.min(0.99, ((match.half - 1) * 600 + match.clock) / 1200);

  return {
    handle(msg) {
      if (msg.type === 'new') {
        match = new Match(msg.home, msg.away, msg.seed, msg.options || {});
        sentPlayers = new Set(); sentLog = 0;
        return [{ msg: { type: 'init', teams: match.teams, seed: match.seed, state: stateOf() } }];
      }
      if (!match) return [];
      if (msg.type === 'next') {
        const rec = match.next();
        if (!rec) return [{ msg: { type: 'final', state: stateOf() } }];
        const { rec: r, transfer } = recMsg(rec);
        return [{ msg: { type: 'rec', rec: r, state: stateOf() }, transfer }];
      }
      // sim to the end of the current half, or to the end of the match
      if (msg.type === 'simToHalf') { const h = match.half; return simUntil(() => match.half !== h); }
      if (msg.type === 'simToEnd') return simUntil(() => false);
      return [];
    },
  };
}
