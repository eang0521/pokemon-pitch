// Match: two teams, two halves, the clock, score, restarts, stats and the play-by-play.
// next() advances the simulation one segment (until a stoppage, the end of a half, or
// SEG_MAX seconds) and returns it as a record with frames for the renderer.
import { RNG } from './rng.js';
import { TeamDepth } from './depth.js';
import { MatchSim } from './sim/matchSim.js';
import { DT, HALF_SECS } from './sim/pitch.js';

const SEG_MAX = 20; // seconds of game time per record
const FRAME_EVERY = 2; // ticks per recorded frame (0.1 s)
const GOAL_PAUSE = 25; // seconds of celebration before the restart (the clock keeps running)

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
    this.options = { frames: true, ...options };
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
    this.firstKick = this.rng.chance(0.5) ? 0 : 1;
    this.kickoff(this.firstKick, true);
  }

  get abbr() { return this.teams.map((t) => t.abbr); }
  kickoff(side, snap) {
    this.sim.setPiece('kickoff', side);
    if (snap) this.sim.snapToSet();
  }

  // ------------------------------------------------------------------ stepping
  next() {
    if (this.final) return null;
    const sim = this.sim;
    const rec = { id: this.recId++, half: this.half, clock0: this.clock, frames: [], logFrom: this.log.length, ids: sim.ents.map((e) => e.id) };
    const rec0 = this.options.frames;
    let ticks = 0;
    const segStart = this.clock;
    while (true) {
      sim.step();
      this.clock += DT;
      if (sim.phase === 'play' && sim.poss >= 0) this.stats.teams[sim.poss].possession += DT;
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

  handleStop(stop, rec) {
    const sim = this.sim;
    sim.stop = null;
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
      this.half = 2;
      this.clock = 0;
      for (const S of this.sim.sides) S.dir = -S.dir;
      this.kickoff(1 - this.firstKick, true);
      rec.halfEnd = 1;
      return;
    }
    this.add('full', -1, `Full time. ${this.scoreText()}`, { big: true });
    this.final = true;
    rec.halfEnd = 2;
  }

  // ------------------------------------------------------------------ events -> stats + log
  nm(e, team = true) { return e ? `${e.name}${team ? ` (${this.teams[e.side].abbr})` : ''}` : 'someone'; }
  scoreText() { return `${this.teams[0].abbr} ${this.score[0]}–${this.score[1]} ${this.teams[1].abbr}`; }
  add(type, side, text, extra = {}) {
    this.log.push({ half: this.half, clock: Math.min(this.clock, HALF_SECS), type, side, text, rec: this.recId - 1, ...extra });
  }

  onEvent(type, d) {
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
