// Page-side mirror of the match (fed by the worker) + the worker connection.
import { createEngine, unpackFrames } from './engine.js';
import { HALF_SECS } from './sim/pitch.js';

export class MatchView {
  constructor(teams, seed) { this.teams = teams; this.seed = seed; this.players = {}; this.log = []; this.sides = []; this.pens = null; }
  // The log arrives with every record and is revealed by playback time; the rest of the
  // state (stats, who's on the pitch) is applied once that record has been played.
  addLog(state) {
    if (state.logFrom > this.log.length) return;
    this.log.length = state.logFrom;
    this.log.push(...state.log);
  }
  apply(state) {
    for (const id in state.players) this.players[id] = state.players[id];
    this.stats = state.stats; this.score = state.score; this.half = state.half; this.clock = state.clock; this.final = state.final;
    this.sides = state.sides; this.pens = state.pens;
  }
  // seconds since kickoff (0..1200)
  get elapsed() { return (this.half - 1) * HALF_SECS + Math.min(this.clock, HALF_SECS); }
}

// Talks to the Web Worker; falls back to running the engine on the page if workers fail.
export class EngineClient {
  constructor(onMessage, { local = false } = {}) {
    this.onMessage = onMessage;
    this.local = null;
    this.started = false;
    this.lastNew = null;
    if (local) { this.fallback(); return; }
    try {
      this.w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (e) => { this.started = true; onMessage(e.data); };
      this.w.onerror = (e) => { e.preventDefault?.(); if (!this.started) this.fallback(); else onMessage({ type: 'error', message: e.message }); };
    } catch { this.fallback(); }
  }
  fallback() {
    if (this.local) return;
    try { this.w?.terminate(); } catch { /* ignore */ }
    this.w = null;
    this.local = createEngine();
    this.mode = 'page';
    if (this.lastNew) this.send(this.lastNew);
  }
  send(msg) {
    if (msg.type === 'new') this.lastNew = msg;
    if (this.w) { this.w.postMessage(msg); return; }
    setTimeout(() => { for (const r of this.local.handle(msg)) this.onMessage(r.msg); }, 0);
  }
  terminate() { try { this.w?.terminate(); } catch { /* ignore */ } this.w = null; this.onMessage = () => {}; }
}

export const recFrames = (rec) => rec.frames || (rec.frames = unpackFrames(rec.packed));
