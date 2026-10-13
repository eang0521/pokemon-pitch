// Match: two teams, two halves, the clock, score, restarts, stats and the play-by-play.
// next() advances the simulation one segment (until a stoppage, the end of a half, or
// SEG_MAX seconds) and returns it as a record with frames for the renderer.
import { RNG } from './rng.js';
import { TeamDepth } from './depth.js';
import { MatchSim, TUNE } from './sim/matchSim.js';
import { DT, HALF_SECS } from './sim/pitch.js';

const SEG_MAX = 20; // seconds of game time per record
const FRAME_EVERY = 2; // ticks per recorded frame (0.1 s)
const GOAL_PAUSE = 25; // seconds of celebration before the restart (the clock keeps running)
const COACH_EVERY = 60; // seconds between coaching reviews (plus every stoppage)
const SUB_GAP = 45; // seconds between a team's (non-injury) substitution windows
const HALF_TIME_REST = 12; // energy everyone gets back at half time

const newPlayerStats = () => ({
  goals: 0, assists: 0, shots: 0, sot: 0, xg: 0, passes: 0, cmp: 0, keyPasses: 0, crosses: 0,
  tackles: 0, tacklesWon: 0, ints: 0, saves: 0, conceded: 0, fouls: 0, fouled: 0, yellow: 0, red: 0, touches: 0, ownGoals: 0,
});
const newTeamStats = () => ({
  goals: 0, shots: 0, sot: 0, xg: 0, passes: 0, cmp: 0, tackles: 0, tacklesWon: 0, ints: 0, saves: 0,
  fouls: 0, yellow: 0, red: 0, corners: 0, throwIns: 0, goalKicks: 0, freeKicks: 0, penalties: 0, penGoals: 0,
  possession: 0, woodwork: 0, blocked: 0,
});

export class Match {
  // teams: [home, away]
  constructor(home, away, seed = Math.floor(Math.random() * 1e9), options = {}) {
    this.seed = seed;
    // injuries: rare, knock a player out of the match; knockout: a draw goes to penalties
    this.options = { frames: true, injuries: true, knockout: false, ...options };
    this.rng = new RNG(seed);
    this.teams = [home, away];
    this.players = {};
    this.depth = this.teams.map((t) => new TeamDepth(t, this.players));
    this.score = [0, 0];
    this.half = 1;
    this.clock = 0; // seconds into the half
    this.final = false;
    this.log = [];
    this.recId = 0;
    this.stats = { teams: [newTeamStats(), newTeamStats()], players: {} };
    for (const id in this.players) this.stats.players[id] = newPlayerStats();
    this.sim = new MatchSim({
      sides: [{ depth: this.depth[0], dir: 1 }, { depth: this.depth[1], dir: -1 }],
      rng: this.rng, onEvent: (type, d) => this.onEvent(type, d),
    });
    this.sim.injuries = !!this.options.injuries;
    this.lastSubT = [-999, -999];
    this.restT = 0;
    this.shootout = null;
    this.firstKick = this.rng.chance(0.5) ? 0 : 1;
    this.kickoff(this.firstKick, true);
  }

  get abbr() { return this.teams.map((t) => t.abbr); }
  get elapsed() { return (Math.min(this.half, 2) - 1) * HALF_SECS + Math.min(this.clock, HALF_SECS); }
  kickoff(side, snap) {
    this.sim.setPiece('kickoff', side);
    if (snap) this.sim.snapToSet();
  }

  // ------------------------------------------------------------------ stepping
  next() {
    if (this.final) return null;
    if (this.shootout) return this.nextKick();
    const sim = this.sim;
    const rec = { id: this.recId++, half: this.half, clock0: this.clock, frames: [], logFrom: this.log.length, ids: sim.ents.map((e) => e.id) };
    const rec0 = this.options.frames;
    let ticks = 0;
    const segStart = this.clock;
    while (true) {
      sim.step();
      this.clock += DT;
      if (sim.phase === 'play' && sim.poss >= 0) this.stats.teams[sim.poss].possession += DT;
      if ((this.tickN = (this.tickN || 0) + 1) % 20 === 0) this.tickContext();
      if (rec0 && ticks++ % FRAME_EVERY === 0) rec.frames.push(this.frame());
      if (sim.stop) {
        if (rec0) rec.frames.push(this.frame());
        this.handleStop(sim.stop, rec);
        break;
      }
      if (this.clock >= HALF_SECS) { this.endHalf(rec); break; }
      if (this.clock - segStart >= SEG_MAX && sim.phase === 'play') break;
    }
    rec.clock1 = Math.min(this.clock, HALF_SECS);
    rec.score = [...this.score];
    rec.logTo = this.log.length;
    rec.final = this.final;
    return rec;
  }

  frame() {
    const s = this.sim, b = s.ball;
    return {
      t: this.clock,
      b: [b.x, b.y, b.z, b.owner ? b.owner.idx : -1],
      p: s.ents.map((e) => [e.x, e.y, (b.owner === e ? 1 : 0) | (b.owner === e && b.inHands ? 2 : 0) | (e.diving ? 4 : 0) | (e.sentOff ? 8 : 0), e.vx, e.vy]),
    };
  }

  // Once a second: what the synergies need to know (match progress, clutch time), and the coaches.
  tickContext(force = false) {
    const el = this.elapsed;
    this.sim.ctx.progress = el / (2 * HALF_SECS);
    this.sim.ctx.clutch = !!this.shootout || (el >= 2 * HALF_SECS - 300 && Math.abs(this.score[0] - this.score[1]) <= 1);
    if (this.shootout || (!force && el - (this.coachT ?? -999) < COACH_EVERY)) return;
    this.coachT = el;
    if (this.options.coachAdapt === false) return; // tools: coaches stick to their base plan
    this.depth.forEach((D, i) => {
      const msg = D.coach.update(el, this.score[i] - this.score[1 - i], this.depth[1 - i].coach);
      this.sim.sides[i].coach = D.coach.eff;
      if (msg) this.add('coach', i, `${this.teams[i].city} ${msg}.`, { coach: true });
    });
  }
  // Energy bookkeeping, coaching and substitutions at a stoppage (before the restart).
  stoppage(forcedOnly = false) {
    const sim = this.sim, el = this.elapsed;
    const rest = Math.max(0, el - this.restT);
    this.restT = el;
    sim.sides.forEach((S, i) => {
      const D = this.depth[i];
      const on = new Set(S.ents.map((e) => e.id));
      for (const e of S.ents) D.energy[e.id] = e.energy;
      for (const c of D.all()) if (!on.has(c.id)) D.energy[c.id] = Math.min(100, D.energy[c.id] + rest * TUNE.benchRegen);
    });
    this.tickContext(true);
    sim.sides.forEach((S, i) => {
      const D = this.depth[i];
      const window = el - this.lastSubT[i] >= SUB_GAP;
      const plan = D.plan(el, 2, forcedOnly || !window);
      for (const sub of plan) {
        const e = S.ents.find((x) => x.slot === sub.slot);
        if (!e || e.sentOff) continue;
        D.energy[sub.off.id] = e.energy;
        D.apply(sub, el);
        sim.substitute(e, sub.on);
        this.lastSubT[i] = el;
        const why = sub.why === 'injury' ? ' (injured)' : sub.why === 'tired' ? ` (tired, ${Math.round(D.energy[sub.off.id])}% energy)` : '';
        this.add('sub', i, `Substitution, ${this.teams[i].name}: ${sub.on.name} on for ${sub.off.name}${why}.`, { sub: true });
      }
    });
  }

  handleStop(stop, rec) {
    const sim = this.sim;
    sim.stop = null;
    this.stoppage();
    const T = this.stats.teams;
    if (stop.kind === 'goal') {
      const side = stop.side;
      this.score[side]++;
      T[side].goals++;
      const by = stop.by, last = stop.lastTouch;
      let scorer = by && by.side === side ? by : null;
      const og = !scorer;
      if (og) scorer = last && last.side !== side ? last : by;
      const ps = scorer && this.stats.players[scorer.id];
      if (ps) { if (og) ps.ownGoals++; else ps.goals++; }
      let assist = null;
      if (!og && scorer && scorer.lastFrom && sim.t - scorer.lastFromT < 12 && scorer.lastFrom.side === side) {
        assist = scorer.lastFrom;
        this.stats.players[assist.id].assists++;
      }
      if (this.lastShotPen && !og) T[side].penGoals++;
      if (!og) this.depth[side].coach.noteGoal(this.elapsed, this.lastShotD ?? 10);
      const gk = sim.gk(sim.sides[1 - side]);
      if (gk) this.stats.players[gk.id].conceded++;
      this.add('goal', side, og
        ? `GOAL! Own goal by ${this.nm(scorer)}. ${this.scoreText()}`
        : `GOAL! ${this.nm(scorer)} scores${assist ? ` (assist ${this.nm(assist, false)})` : ''}. ${this.scoreText()}`,
      { by: scorer?.id, assist: assist?.id, og, big: true });
      rec.goal = { side, by: scorer?.id };
      for (const e of sim.ents) { e.lastFrom = null; e.yellowNote = null; }
      this.clock += GOAL_PAUSE;
      if (this.clock >= HALF_SECS) { this.endHalf(rec); return; }
      this.kickoff(1 - side, true);
      return;
    }
    if (stop.kind === 'corner') T[stop.side].corners++;
    if (stop.kind === 'throwIn') T[stop.side].throwIns++;
    if (stop.kind === 'goalKick') T[stop.side].goalKicks++;
    if (stop.kind === 'freeKick') T[stop.side].freeKicks++;
    if (stop.kind === 'penalty') T[stop.side].penalties++;
    const names = { corner: 'Corner', throwIn: 'Throw-in', goalKick: 'Goal kick', freeKick: 'Free kick', penalty: 'PENALTY' };
    this.add(stop.kind, stop.side, `${names[stop.kind]} to ${this.teams[stop.side].name}.`, { minor: stop.kind === 'throwIn' || stop.kind === 'goalKick', big: stop.kind === 'penalty' });
    sim.setPiece(stop.kind, stop.side, stop.x, stop.y);
  }

  endHalf(rec) {
    this.clock = HALF_SECS;
    if (this.half === 1) {
      this.add('half', -1, `Half time. ${this.scoreText()}`, { big: true });
      this.stoppage();
      for (const e of this.sim.ents) e.energy = Math.min(100, e.energy + HALF_TIME_REST);
      for (const D of this.depth) for (const c of D.all()) D.energy[c.id] = Math.min(100, D.energy[c.id] + HALF_TIME_REST);
      this.half = 2;
      this.clock = 0;
      for (const S of this.sim.sides) S.dir = -S.dir;
      this.kickoff(1 - this.firstKick, true);
      rec.halfEnd = 1;
      return;
    }
    rec.halfEnd = 2;
    if (this.options.knockout && this.score[0] === this.score[1]) {
      this.add('full', -1, `Full time: ${this.scoreText()}. It goes to penalties!`, { big: true });
      this.stoppage(true);
      this.startShootout();
      return;
    }
    this.add('full', -1, `Full time. ${this.scoreText()}`, { big: true });
    this.final = true;
  }

  // ------------------------------------------------------------------ penalty shootout
  startShootout() {
    const order = this.sim.sides.map((S) => {
      const live = S.ents.filter((e) => !e.sentOff);
      return [...live.filter((e) => e.slot !== 'GK').sort((a, b) => (b.r.finish + b.r.comp) - (a.r.finish + a.r.comp)), ...live.filter((e) => e.slot === 'GK')];
    });
    this.shootout = { score: [0, 0], taken: [0, 0], order, next: this.rng.chance(0.5) ? 0 : 1 };
    this.half = 3; this.clock = 0;
    this.sim.shootout = true;
  }
  // One kick of the shootout, played out by the sim (the keeper really has to save it).
  nextKick() {
    const so = this.shootout, sim = this.sim, side = so.next;
    const taker = so.order[side][so.taken[side] % so.order[side].length];
    sim.sides[side].dir = 1; sim.sides[1 - side].dir = -1; // every kick at the same goal
    sim.setPiece('penalty', side);
    sim.set.taker = taker;
    sim.setTargets(); sim.snapToSet();
    sim.set.readyAt = sim.t + 1.2;
    this.tickContext(true);
    const rec = { id: this.recId++, half: 3, clock0: 0, frames: [], logFrom: this.log.length, ids: sim.ents.map((e) => e.id), kick: true };
    let ticks = 0, kickT = null, scored = false;
    const t0 = sim.t;
    for (;;) {
      sim.step();
      if (this.options.frames && ticks++ % 2 === 0) rec.frames.push({ ...this.frame(), t: 0 });
      if (kickT == null && sim.openShot) kickT = sim.t;
      if (sim.stop) { scored = sim.stop.kind === 'goal'; sim.stop = null; break; }
      if (kickT != null && sim.t - kickT > 2.2) break;
      if (sim.t - t0 > 10) break;
    }
    sim.phase = 'dead'; sim.openShot = null;
    so.taken[side]++;
    if (scored) so.score[side]++;
    const keeper = sim.gk(sim.sides[1 - side]);
    this.add('pen', side, `${scored ? '✅' : '❌'} ${this.nm(taker)} ${scored ? 'scores' : this.lastSave ? `is denied by ${keeper?.name || 'the keeper'}` : 'misses'}. Penalties: ${this.teams[0].abbr} ${so.score[0]}–${so.score[1]} ${this.teams[1].abbr}`, { big: true, scored });
    this.lastSave = false;
    // decided? (best of five, then sudden death)
    const [a, b] = so.score, [ta, tb] = so.taken;
    const left = (t) => Math.max(0, 5 - t);
    const done = (ta >= 5 && tb >= 5 && ta === tb && a !== b) || (ta <= 5 && tb <= 5 && (a > b + left(tb) || b > a + left(ta)));
    so.next = 1 - side;
    rec.pens = [...so.score];
    if (done) {
      const w = a > b ? 0 : 1;
      this.add('full', -1, `${this.teams[w].city} ${this.teams[w].name} win ${Math.max(a, b)}–${Math.min(a, b)} on penalties!`, { big: true });
      this.final = true;
      this.pens = [a, b];
      sim.shootout = false;
    }
    rec.clock1 = 0; rec.score = [...this.score]; rec.logTo = this.log.length; rec.final = this.final;
    return rec;
  }

  // ------------------------------------------------------------------ events -> stats + log
  nm(e, team = true) { return e ? `${e.name}${team ? ` (${this.teams[e.side].abbr})` : ''}` : 'someone'; }
  scoreText() { return `${this.teams[0].abbr} ${this.score[0]}–${this.score[1]} ${this.teams[1].abbr}`; }
  add(type, side, text, extra = {}) {
    this.log.push({ half: this.half, clock: Math.min(this.clock, HALF_SECS), type, side, text, rec: this.recId - 1, ...extra });
  }

  onEvent(type, d) {
    if (this.shootout) { if (type === 'save') this.lastSave = true; return; } // shootout kicks aren't match stats
    const P = this.stats.players, T = this.stats.teams;
    const ps = (e) => P[e.id];
    switch (type) {
      case 'pass': {
        if (d.kind === 'throw') break;
        ps(d.by).passes++; T[d.by.side].passes++;
        if (d.kind === 'cross') ps(d.by).crosses++;
        this.add('pass', d.by.side, `${this.nm(d.by, false)} ${d.kind === 'cross' ? 'crosses' : d.kind === 'through' ? 'plays a through ball' : d.kind === 'lofted' ? 'goes long' : 'passes'} to ${this.nm(d.to, false)}.`, { minor: true, by: d.by.id });
        break;
      }
      case 'passEnd':
        if (d.complete) { ps(d.pass.by).cmp++; T[d.pass.by.side].cmp++; }
        this.depth[d.pass.by.side].coach.notePass(this.elapsed, d.pass.kind, d.complete);
        break;
      case 'injury':
        this.add('injury', d.by.side, `🚑 ${this.nm(d.by)} is hurt and will need to come off.`, { by: d.by.id });
        break;
      case 'interception':
        ps(d.by).ints++; T[d.by.side].ints++;
        this.add('int', d.by.side, `${this.nm(d.by)} intercepts.`, { minor: true, by: d.by.id });
        break;
      case 'touch': ps(d.by).touches++; break;
      case 'shot': {
        const s = ps(d.by);
        s.shots++; s.xg += d.xg; T[d.by.side].shots++; T[d.by.side].xg += d.xg;
        this.lastShotPen = !!d.penalty;
        this.lastShotD = d.d;
        this.depth[d.by.side].coach.noteShot(this.elapsed, d.d);
        if (d.by.lastFrom && this.sim.t - d.by.lastFromT < 4) ps(d.by.lastFrom).keyPasses++;
        const how = d.penalty ? 'takes the penalty' : d.header ? `heads at goal from ${Math.round(d.d)} m` : d.freeKick ? `shoots from a free kick, ${Math.round(d.d)} m out` : `shoots from ${Math.round(d.d)} m`;
        this.add('shot', d.by.side, `${this.nm(d.by)} ${how}…`, { by: d.by.id, xg: d.xg });
        break;
      }
      case 'shotEnd': {
        const s = d.shot, side = s.side;
        const onT = d.result === 'goal' || d.result === 'saved';
        if (onT) { ps(s.by).sot++; T[side].sot++; }
        if (d.result === 'blocked') T[side].blocked++;
        const words = { saved: `saved by ${this.nm(d.by, false)}`, blocked: `blocked by ${this.nm(d.by, false)}`, missed: s.post ? 'off the woodwork and wide' : 'wide', post: 'off the woodwork and out' };
        if (d.result !== 'goal' && words[d.result]) this.add('shotEnd', side, `…${words[d.result]}.`, { minor: d.result === 'blocked', result: d.result, xg: s.xg, by: d.by?.id, shooter: s.by.id });
        break;
      }
      case 'save': {
        ps(d.by).saves++; T[d.by.side].saves++;
        break;
      }
      case 'woodwork': if (d.by) T[d.by.side].woodwork++; this.add('woodwork', d.by?.side ?? -1, `Off the ${d.bar ? 'crossbar' : 'post'}!`); break;
      case 'tackle':
        ps(d.by).tackles++; T[d.by.side].tackles++;
        if (d.won) { ps(d.by).tacklesWon++; T[d.by.side].tacklesWon++; }
        this.add('tackle', d.by.side, d.won ? `${this.nm(d.by)} wins the ball from ${this.nm(d.on, false)}.` : `${this.nm(d.on)} skips past ${this.nm(d.by, false)}.`, { minor: true });
        break;
      case 'foul': {
        ps(d.by).fouls++; ps(d.on).fouled++; T[d.by.side].fouls++;
        this.add('foul', d.by.side, `Foul by ${this.nm(d.by)} on ${this.nm(d.on, false)}${d.pen ? ' in the box' : ''}.`, { by: d.by.id });
        if (d.card === 'yellow') { ps(d.by).yellow++; T[d.by.side].yellow++; this.add('card', d.by.side, `🟨 Yellow card: ${this.nm(d.by)}.`, { card: 'yellow', by: d.by.id }); }
        if (d.card === 'second') { ps(d.by).yellow++; ps(d.by).red++; T[d.by.side].red++; this.add('card', d.by.side, `🟨🟥 Second yellow: ${this.nm(d.by)} is sent off!`, { card: 'red', by: d.by.id, big: true }); }
        if (d.card === 'red') { ps(d.by).red++; T[d.by.side].red++; this.add('card', d.by.side, `🟥 Straight red card: ${this.nm(d.by)} is sent off!`, { card: 'red', by: d.by.id, big: true }); }
        break;
      }
      case 'claim': this.add('claim', d.by.side, `${this.nm(d.by)} claims it.`, { minor: true }); break;
      case 'punch': this.add('punch', d.by.side, `${this.nm(d.by)} punches clear.`, { minor: true }); break;
      default: break;
    }
  }

  // Run to the end (headless).
  playToEnd() { while (this.next()); return this; }
}
