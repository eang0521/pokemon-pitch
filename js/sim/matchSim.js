// The agent-based match simulation. Every player is an entity with position and
// velocity, acceleration, top speed and turning from their ratings, mass and agility.
// The ball has full 3D state (js/sim/ball.js). Each tick (DT = 0.05 s):
//   1. decisions: the ball carrier picks a pass / shot / dribble / clearance, everyone
//      else positions (shape, runs, support, pressing, marking, chasing a loose ball);
//   2. movement: steering toward targets, body separation, ball physics;
//   3. contact: touches on a free ball (control, deflections, headers, keeper saves),
//      tackles and fouls on the ball carrier, and the ball leaving the pitch.
// Restarts (kickoffs, throw-ins, goal kicks, corners, free kicks, penalties) are set up
// by MatchSim.setPiece(); the match (js/match.js) owns the clock and score.
import {
  L, W, GOAL_W, GOAL_H, GOAL_Y0, GOAL_Y1, POST_R, BALL_R, BOX_D, BOX_W, GA_D, PEN_SPOT, CIRCLE_R, DT,
  clamp, hyp, dist, sigmoid, inBox, goalAngle,
} from './pitch.js';
import { stepBall, predict, planGround, planLofted, BALL } from './ball.js';
import { cardRatings } from '../ratings.js';
import { teamSynergies, playerEffects } from '../synergy.js';
import { fatigueMult } from '../depth.js';

// Tunable constants (tools/sim-test.mjs is the reference for what they produce).
export const TUNE = {
  // movement
  spdBase: 6.15, spdPer: 0.03,
  softCap: 68, // pace / agility ratings above this count for less // top speed m/s = base + pace * per
  accBase: 3.8, accPer: 0.036, // acceleration m/s² = base + agility * per
  dribbleSlow: 0.7,
  dribbleVal: 0.6, // dribbling gains less than a pass to the same spot (slower, defenders recover) // top speed with the ball at your feet
  jog: 0.62, // share of top speed for shape movement
  // energy (per second): base + run * (speed / top speed)^3, scaled by stamina
  drainBase: 0.034, drainRun: 0.21, gkDrain: 0.25, benchRegen: 0.12,
  // decisions
  noise: 0.02, // utility noise for a 0-vision player (scaled down by vision)
  possVal: 0.035, // value of simply having the ball (lost on a turnover)
  progW: 0.04, // value per unit of pitch (0..1) the ball moves forward: going somewhere beats safe recycling
  threatAmp: 0.18, // peak of the positional threat curve (value of having the ball near goal)
  lossW: 0.9, // how much a turnover costs relative to what the pass gains
  shotVal: 0.72, // value of a goal vs the positional threat scale
  holdMin: 0.25, holdTempo: 0.5, // seconds between carrier decisions: min + (1 - tempo) * holdTempo
  // kicking
  passErr: -0.03, passErrPer: 0.0022, // radians of aim error: base + (100 - passing) * per
  shotErr: 0.005, shotErrPer: 0.0028,
  kickPow: 15, kickPowPer: 0.18, // max kick speed m/s = base + power * per
  // contests
  ctrlBase: 1.2, ctrlSlope: 0.55, // control chance = base - slope * (ball speed / (9 + touch * 0.12))
  tackleTry: 0.055, // chance per tick an opponent in range goes in for a tackle
  tackleRange: 1.15,
  block: 0.45, blockRange: 1.6, // a defender in the way when a pass or shot is struck
  tackleBias: 0.7,
  pressCost: 4, // extra sprint energy for pressers, per unit of press
  aggrLunge: 0.9, // tackle-success logit per unit of aggression below 0.5
  frontTry: 1.8, frontBonus: 0.35, // a defender squared up in front goes in more often and wins more // logit offset on tackle success
  foulBase: 0.009, foulAggr: 0.02, foulBehind: 0.05,
  yellow: 0.06, red: 0.004,
  // keepers
  gkReach: 0.3, gkReachPer: 0.008, // standing lateral reach = base + reach * per
  gkDive: 0.34, gkDivePer: 0.012, // extra reach at full stretch of a dive = base + reflexes * per
  gkDiveTime: 0.45, // seconds from the start of a dive to full stretch
  gkTop: 1.55, gkTopPer: 0.011, // highest point they can get a hand to
  gkReact: 0.41, gkReactPer: 0.003, // reaction time = base - reflexes * per
  gkDiveSpd: 2.0, gkDiveSpdPer: 0.03,
  gkHold: 0.02, gkHoldPer: 0.011, // chance to hold a shot = base + handling * per - speed penalty
};

// Formation spots (attacking frame: u = 0 own goal line .. 1 opponent's; v = 0..1 across).
const FORM = {
  DEF: { GK: [0.03, 0.5], DEF1: [0.2, 0.22], FLEX: [0.17, 0.5], DEF2: [0.2, 0.78], MID1: [0.42, 0.3], MID2: [0.42, 0.7], FWD: [0.68, 0.5] },
  MID: { GK: [0.03, 0.5], DEF1: [0.2, 0.3], DEF2: [0.2, 0.7], MID1: [0.43, 0.18], FLEX: [0.38, 0.5], MID2: [0.43, 0.82], FWD: [0.68, 0.5] },
  FWD: { GK: [0.03, 0.5], DEF1: [0.2, 0.3], DEF2: [0.2, 0.7], MID1: [0.42, 0.3], MID2: [0.42, 0.7], FWD: [0.66, 0.35], FLEX: [0.66, 0.65] },
};

const SET_SECS = { kickoff: 1.2, throwIn: 2.5, goalKick: 4, corner: 5.5, freeKick: 4.5, penalty: 5 };

export class MatchSim {
  // sides: [{ depth (TeamDepth), dir (+1 attacks x = L) }]
  constructor({ sides, rng, onEvent = () => {} }) {
    this.rng = rng;
    this.emit = onEvent;
    this.t = 0;
    this.sides = sides.map((s, i) => ({ ...s, i, coach: s.depth.coach.eff, ents: [] }));
    this.ctx = { progress: 0, clutch: false }; // set by the match: share of the match played, clutch time
    this.ents = [];
    for (const S of this.sides) {
      for (const [slot, card] of Object.entries(S.depth.onField)) {
        const e = this.makeEnt(card, slot, S.i);
        S.ents.push(e); this.ents.push(e);
      }
      this.refreshSide(S);
    }
    this.ball = { x: L / 2, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, px: L / 2, py: W / 2, pz: 0, owner: null, inHands: false, lastTouch: null, touchT: 0, kick: null };
    this.phase = 'set';
    this.set = null;
    this.stop = null;
    this.poss = -1;
    this.flight = null; // the pass in the air / on the ground: { from, to, kind }
    this.openPass = null; this.openShot = null;
    this.kickId = 0;
    this.pred = null; this.predT = -1;
  }

  // ------------------------------------------------------------------ entities
  makeEnt(card, slot, side) {
    const e = {
      slot, side, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, tspd: TUNE.jog,
      nextThink: 0, nextDecide: 0, touchCD: 0, tackleCD: 0, stunUntil: 0, slowUntil: 0,
      run: null, mark: null, diving: false, holdUntil: 0, posErr: 0, posErrT: 0,
      sentOff: false, restricted: null, lastFrom: null, lastFromT: -99, mods: {}, boost: null,
    };
    e.idx = this.ents.length;
    this.setCard(e, card, side);
    return e;
  }
  // Put a card in this entity (kickoff, or a substitution).
  setCard(e, card, side = e.side) {
    Object.assign(e, { id: card.id, card, role: card.pos, name: card.name, height: card.height });
    e.energy = this.sides[side]?.depth.energy[card.id] ?? 100;
    e.injured = this.sides[side]?.depth.injured.has(card.id) || false;
    e.lastFrom = null; e.yellow = false; e.run = null; e.mark = null;
    e.r0 = card.ratings;
    this.rateEnt(e);
  }
  // Type synergies for everyone a side has on the pitch (after kickoff, subs and red cards).
  refreshSide(S) {
    const live = this.live(S);
    S.synergy = teamSynergies(live.map((e) => e.card));
    // tools/synergy-calibrate.mjs: force one synergy onto chosen slots
    const ov = S.depth.synOverride;
    if (ov) S.synergy.active = { ...S.synergy.active, [ov.type]: ov.tier };
    for (const e of S.ents) {
      const card = ov && ov.slots.includes(e.slot) && !e.card.types.includes(ov.type) ? { ...e.card, types: [...e.card.types, ov.type] } : e.card;
      const { stat, mods } = playerEffects(card, S.synergy.active);
      e.mods = mods;
      e.r0 = Object.keys(stat).length ? cardRatings(e.card.slug, e.card.pos, stat) : e.card.ratings;
      this.rateEnt(e);
    }
  }
  // Live ratings: synergy-boosted card ratings x fatigue, Grass growth, Dragon clutch, injury.
  rateEnt(e) {
    let m = fatigueMult(e.energy);
    if (e.mods.growth) m *= 1 + e.mods.growth * this.ctx.progress;
    if (e.mods.clutch && this.ctx.clutch) m *= 1 + e.mods.clutch;
    if (e.injured) m *= 0.6;
    const r = {};
    for (const k in e.r0) r[k] = k === 'mass' || k === 'reach' ? e.r0[k] : Math.max(20, Math.round(e.r0[k] * m));
    e.r = r;
    // diminishing returns at the very top, so pure speed can't run a match on its own
    const soft = (v) => (v > TUNE.softCap ? TUNE.softCap + (v - TUNE.softCap) * 0.35 : v);
    e.maxSpd = TUNE.spdBase + soft(r.pace) * TUNE.spdPer;
    e.accel = (TUNE.accBase + soft(r.agi) * TUNE.accPer) * (1 + (e.mods.burst || 0));
    e.headZ = Math.min(3.3, 0.75 + clamp(e.height, 0.2, 4) * 0.75 + (e.mods.reach || 0));
    e.gkReach = TUNE.gkReach + r.reach * TUNE.gkReachPer;
    e.gkDive = TUNE.gkDive + r.refl * TUNE.gkDivePer;
    e.gkTop = TUNE.gkTop + r.reach * TUNE.gkTopPer + (e.mods.reach || 0);
  }
  // Swap a substitute into e's slot: the old player walks off, the new one comes on at halfway.
  substitute(e, card) {
    this.setCard(e, card);
    e.x = L / 2 + (e.side === 0 ? -2 : 2); e.y = -0.5; e.vx = e.vy = 0;
    this.side(e).alive = null;
    this.refreshSide(this.side(e));
  }
  side(e) { return this.sides[e.side]; }
  opp(e) { return this.sides[1 - e.side]; }
  live(S) { return S.alive || (S.alive = S.ents.filter((e) => !e.sentOff)); }
  gk(S) { return S.ents.find((e) => e.slot === 'GK' && !e.sentOff); }

  // attacking-frame helpers
  u(si, x) { return this.sides[si].dir > 0 ? x / L : 1 - x / L; }
  X(si, u) { return this.sides[si].dir > 0 ? u * L : L - u * L; }
  goalX(si) { return this.sides[si].dir > 0 ? L : 0; } // the goal side si attacks
  ownX(si) { return this.sides[si].dir > 0 ? 0 : L; }

  // ------------------------------------------------------------------ main loop
  step() {
    this.t += DT;
    const b = this.ball;
    if (this.t >= (this.rateT || 0)) { this.rateT = this.t + 2; for (const e of this.ents) if (!e.sentOff) this.rateEnt(e); }
    if (this.phase === 'set') this.setTick();
    else if (this.phase === 'play') this.playTick();
    for (const e of this.ents) this.integrate(e);
    this.separate();
    b.px = b.x; b.py = b.y; b.pz = b.z;
    if (b.owner) this.attachBall(b.owner);
    else if (this.phase === 'play') stepBall(b, DT);
    if (this.phase === 'play') {
      if (!b.owner) this.touches();
      else this.tackles();
      if (this.phase === 'play') this.boundaries();
    }
  }

  // ------------------------------------------------------------------ movement
  steer(e, tx, ty, frac) {
    let top = e.maxSpd * frac;
    if (this.t < e.stunUntil) top *= 0.35;
    if (this.t < e.slowUntil) top *= 0.75; // Ice: chilled
    if (this.ball.owner === e && !this.ball.inHands) top *= TUNE.dribbleSlow + e.r.ret * 0.0008;
    const dx = tx - e.x, dy = ty - e.y, d = hyp(dx, dy);
    const want = Math.min(top, d * 2.5);
    const dvx = (d > 1e-6 ? (dx / d) * want : 0) - e.vx;
    const dvy = (d > 1e-6 ? (dy / d) * want : 0) - e.vy;
    const dv = hyp(dvx, dvy);
    let lim = e.accel * DT * (e.diving ? 3 : 1);
    if (e.mods.flow) {
      // Water: keep speed through cuts and turns
      const sp = hyp(e.vx, e.vy);
      if (sp > 2 && d > 1e-6 && (e.vx * dx + e.vy * dy) < 0.6 * sp * d) lim *= 1 + e.mods.flow;
    }
    const k = dv > lim ? lim / dv : 1;
    e.vx += dvx * k; e.vy += dvy * k;
  }
  integrate(e) {
    if (e.sentOff) { e.vx = e.vy = 0; return; }
    if (!this.diveOverride(e)) this.steer(e, e.tx, e.ty, e.tspd);
    // energy: running costs more the closer to top speed, stamina stretches it
    const f = Math.min(1.2, hyp(e.vx, e.vy) / (e.maxSpd || 1));
    const stam = (130 - e.r0.stm) / 80;
    const pressing = this.ball.owner && this.ball.owner.side !== e.side && (this.chaser?.[e.side] === e || this.chaser2?.[e.side] === e);
    e.energy = Math.max(0, e.energy - (TUNE.drainBase + TUNE.drainRun * f * f * f * (pressing ? 1 + TUNE.pressCost * this.side(e).coach.press : 1)) * stam * (1 - (e.mods.regen || 0)) * (e.slot === 'GK' ? TUNE.gkDrain : 1) * DT);
    // players stay on the field of play (throw-in takers may stand just over the touchline)
    e.x = clamp(e.x + e.vx * DT, 0.15, L - 0.15);
    e.y = clamp(e.y + e.vy * DT, -1, W + 1);
  }
  diveOverride(e) {
    if (!e.diving) return false;
    // keepers dive: fast lateral movement toward the save point
    const spd = TUNE.gkDiveSpd + e.r.refl * TUNE.gkDiveSpdPer;
    const dx = e.tx - e.x, dy = e.ty - e.y, d = hyp(dx, dy);
    const v = Math.min(spd, d / DT);
    e.vx = d > 1e-6 ? (dx / d) * v : 0; e.vy = d > 1e-6 ? (dy / d) * v : 0;
    return true;
  }
  separate() {
    const E = this.ents;
    for (let i = 0; i < E.length; i++) {
      const a = E[i]; if (a.sentOff) continue;
      for (let j = i + 1; j < E.length; j++) {
        const b = E[j]; if (b.sentOff) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy);
        const min = 0.7;
        if (d > 1e-4 && d < min) {
          const push = (min - d) / 2;
          const ma = a.r.mass, mb = b.r.mass, ka = mb / (ma + mb), kb = ma / (ma + mb);
          a.x -= (dx / d) * push * ka * 2; a.y -= (dy / d) * push * ka * 2;
          b.x += (dx / d) * push * kb * 2; b.y += (dy / d) * push * kb * 2;
        }
      }
    }
  }
  attachBall(e) {
    const b = this.ball;
    if (b.inHands) { b.x = e.x; b.y = e.y; b.z = 1.0; }
    else {
      let fx = e.tx - e.x, fy = e.ty - e.y, f = hyp(fx, fy);
      if (f < 0.3) { fx = this.goalX(e.side) - e.x; fy = 0; f = Math.abs(fx) || 1; }
      b.x = e.x + (fx / f) * 0.45; b.y = e.y + (fy / f) * 0.45; b.z = 0;
    }
    b.vx = e.vx; b.vy = e.vy; b.vz = 0;
  }

  // Seconds for e to get to (x, y), with acceleration from the current velocity.
  timeTo(e, x, y) {
    const dx = x - e.x, dy = y - e.y, d = hyp(dx, dy);
    if (d < 0.35) return 0;
    const vp = (e.vx * dx + e.vy * dy) / d;
    const v = e.maxSpd * (this.t < e.stunUntil ? 0.5 : 1);
    const tAcc = Math.max(0, v - vp) / e.accel;
    const dAcc = ((v + vp) / 2) * tAcc;
    if (d <= dAcc) return (-vp + Math.sqrt(Math.max(0, vp * vp + 2 * e.accel * d))) / e.accel;
    return tAcc + (d - dAcc) / v + (this.t < e.stunUntil ? e.stunUntil - this.t : 0);
  }
  // Earliest point on the predicted ball path that e can reach in time: { t, x, y }.
  intercept(e, pred) {
    const zMax = this.canHandle(e) ? e.gkTop : e.headZ;
    for (const p of pred) {
      if (p.out) break;
      if (p.z > zMax) continue;
      if (this.timeTo(e, p.x, p.y) <= p.t + 0.05) return { t: p.t, x: p.x, y: p.y };
    }
    const last = pred[pred.length - 1];
    if (!last) return { t: 0, x: this.ball.x, y: this.ball.y };
    const x = clamp(last.x, 0.5, L - 0.5), y = clamp(last.y, 0.5, W - 0.5);
    return { t: Math.max(last.t, this.timeTo(e, x, y)), x, y, late: true };
  }
  canHandle(e) { return e.slot === 'GK' && inBox(e.x, e.y, this.ownX(e.side)) && inBox(this.ball.x, this.ball.y, this.ownX(e.side)); }

  // ------------------------------------------------------------------ value model
  // How dangerous a spot is for side si (0.004 .. ~0.3): the chance of it turning into a goal soon.
  threat(si, x, y) {
    const gx = this.goalX(si);
    const dg = hyp(gx - x, W / 2 - y);
    const ang = goalAngle(x, y, gx);
    return 0.004 + TUNE.threatAmp * Math.exp(-dg / 9) * (0.45 + 0.55 * Math.min(1, ang / 0.45)) + 0.03 * this.u(si, x);
  }
  // Expected goals for a shot from (x, y) at side si's goal.
  xg(si, x, y, { header = false, pressure = 0 } = {}) {
    const gx = this.goalX(si);
    const d = hyp(gx - x, W / 2 - y), ang = goalAngle(x, y, gx);
    // fitted to the sim's own shots by tools/xg-fit.mjs
    return sigmoid(-2.14 - 0.037 * d + 2.5 * ang - (header ? 0.2 : 0) - 0.42 * pressure);
  }
  pressureOn(e) {
    let d = 9;
    for (const o of this.live(this.opp(e))) d = Math.min(d, dist(o, e));
    return clamp((3.2 - d) / 2.4, 0, 1);
  }

  // ------------------------------------------------------------------ play
  playTick() {
    const b = this.ball;
    if (!b.owner && (this.t - this.predT > 0.1 || !this.pred)) { this.pred = predict(b, 3.5); this.predT = this.t; }
    if (!this.chaser || this.ball.owner !== this.lastOwner || (this.tick = (this.tick || 0) + 1) % 2 === 0) this.findChasers();
    this.lastOwner = this.ball.owner;
    for (const S of this.sides) if (this.t >= (S.markT || 0)) { S.markT = this.t + 0.5; this.assignMarks(S); }
    for (const e of this.ents) if (!e.sentOff) this.think(e);
  }

  // Who goes for the ball: the receiver of a pass, or each side's quickest player to it.
  findChasers() {
    const b = this.ball;
    this.chaser = [null, null];
    this.chaser2 = [null, null];
    for (const S of this.sides) {
      const ents = this.live(S);
      if (b.owner) {
        if (b.owner.side === S.i || b.inHands) continue;
        // pressers: the closest outfield players to the ball carrier
        // ranked by how fast they can get goal-side of the carrier (chasing from behind is slow)
        const own = this.ownX(S.i), gx = own - b.x, gy = W / 2 - b.y, g = hyp(gx, gy) || 1;
        const gs = { x: b.x + (gx / g) * 1.5 + b.owner.vx * 0.4, y: b.y + (gy / g) * 1.5 + b.owner.vy * 0.4 };
        const ranked = ents.filter((e) => e.slot !== 'GK').map((e) => ({ e, t: this.timeTo(e, gs.x, gs.y) })).sort((p, q) => p.t - q.t);
        this.chaser[S.i] = ranked[0]?.e || null;
        const press = S.coach.press;
        const ballU = this.u(S.i, b.x);
        // a second man: high-pressing teams up the pitch, everyone when the ball is near their goal
        const nearGoal = hyp(b.x - this.ownX(S.i), b.y - W / 2) < 17;
        // (pressing teams start their second man further up the pitch the more they press)
        if (ranked[1] && (nearGoal || (ballU > 0.9 - press * 0.5)) && ranked[1].t < 2.5) this.chaser2[S.i] = ranked[1].e;
        continue;
      }
      let best = null, bt = Infinity;
      for (const e of ents) {
        if (e.slot === 'GK' && !this.gkMayChase(e)) continue;
        const ic = this.intercept(e, this.pred);
        e.ic = ic;
        let t = ic.t;
        if (this.flight && this.flight.to === e) t -= 0.6; // the intended receiver has priority
        if (t < bt) { bt = t; best = e; }
      }
      this.chaser[S.i] = best;
    }
  }
  gkMayChase(e) {
    const ic = this.intercept(e, this.pred);
    e.ic = ic;
    const own = this.ownX(e.side);
    const range = 1.5 + e.r.gkPos * 0.05; // sweeping range beyond the box edge
    return Math.abs(ic.x - own) < BOX_D + range && Math.abs(ic.y - W / 2) < BOX_W / 2 + 2;
  }

  think(e) {
    const b = this.ball;
    if (b.owner === e) return this.carrierThink(e);
    if (e.slot === 'GK') return this.keeperThink(e);
    if (this.chaser[e.side] === e) return this.chase(e);
    if (this.chaser2[e.side] === e) return this.chase(e, true);
    if (this.t < e.nextThink) return;
    e.nextThink = this.t + 0.3 + this.rng.next() * 0.15;
    if (this.poss === e.side) this.attackShape(e); else this.defendShape(e);
  }

  chase(e, second = false) {
    const b = this.ball;
    if (b.owner) {
      // press: get goal-side of the carrier, then close down
      const c = b.owner, own = this.ownX(e.side);
      const gx = own - c.x, gy = W / 2 - c.y, g = hyp(gx, gy) || 1;
      const off = second ? 2.2 : 0.5;
      // pursuit: aim where the carrier will be when we get there, slightly goal-side
      let tau = 0, px = c.x, py = c.y;
      for (let k = 0; k < 3; k++) {
        px = c.x + c.vx * tau + (gx / g) * off; py = c.y + c.vy * tau + (gy / g) * off;
        tau = Math.min(1.2, this.timeTo(e, px, py));
      }
      e.tx = px; e.ty = py;
      e.tspd = second ? 0.9 : 1;
      if (b.inHands) { e.tx = c.x + (gx / g) * 8; e.ty = c.y + (gy / g) * 8; e.tspd = TUNE.jog; }
      return;
    }
    const ic = e.ic || this.intercept(e, this.pred);
    e.tx = ic.x; e.ty = ic.y; e.tspd = 1;
  }

  // ------------------------------------------------------------------ shape
  // Formation spot shifted with the ball: in possession the team pushes up and spreads,
  // out of possession it drops, narrows and slides across toward the ball.
  shapeSpot(e, attacking) {
    const S = this.side(e), b = this.ball;
    const [bu, bv] = FORM[S.depth.flex][e.slot] || [0.4, 0.5];
    const ballU = this.u(e.side, b.x), ballV = b.y / W;
    let u, v;
    if (attacking) {
      u = bu + 0.55 * (ballU - 0.45) + 0.06;
      v = 0.5 + (bv - 0.5) * (1.05 + S.coach.width * 0.45) + (ballV - 0.5) * 0.15;
      if (e.role === 'DEF') u = Math.min(u, ballU - 0.08, this.deepestThreatU(e.side) - 0.02);
      if (e.role === 'FWD') u = Math.max(u, Math.min(0.88, ballU + 0.12));
    } else {
      // hold a line that moves with the ball but stays goal-side of it
      const drop = 0.08 * (1 - S.coach.press);
      u = bu * 0.7 + 0.45 * ballU - 0.05 - drop;
      v = 0.5 + (bv - 0.5) * 0.8 + (ballV - 0.5) * 0.4;
      if (e.role === 'DEF') u = Math.min(u, ballU - 0.04);
      else if (e.role !== 'FWD') u = Math.min(u, ballU + 0.05);
    }
    u += (S.coach.mentality || 0) * 0.07;
    u = clamp(u, 0.06, e.role === 'DEF' ? 0.75 : 0.93);
    v = clamp(v, 0.04, 0.96);
    return { x: this.X(e.side, u), y: v * W };
  }
  // The deepest opponent forward (in si's attacking frame) — defenders stay goal-side of them.
  deepestThreatU(si) {
    let m = 1;
    for (const o of this.live(this.sides[1 - si])) if (o.slot !== 'GK') m = Math.min(m, this.u(si, o.x));
    return Math.max(0.1, m);
  }

  attackShape(e) {
    const b = this.ball, S = this.side(e);
    let spot = this.shapeSpot(e, true);
    const carrier = b.owner && b.owner.side === e.side ? b.owner : null;
    const ballU = this.u(e.side, b.x);
    // runs in behind
    if (e.run && this.t < e.run.until && carrier) { e.tx = e.run.x; e.ty = e.run.y; e.tspd = 1; return; }
    e.run = null;
    if (carrier && (e.role === 'FWD' || (e.role === 'MID' && this.rng.chance(0.4))) && ballU > 0.3 && this.u(e.side, e.x) > ballU - 0.05
      && this.rng.chance(0.12 + S.coach.directness * 0.12 + e.r.move * 0.0015)) {
      const deep = clamp(this.u(e.side, e.x) + 0.15 + this.rng.next() * 0.1, 0.55, 0.9);
      const ry = clamp(e.y + this.rng.range(-6, 6), 4, W - 4);
      e.run = { until: this.t + 2 + this.rng.next(), x: this.X(e.side, deep), y: ry };
      e.tx = e.run.x; e.ty = e.run.y; e.tspd = 1;
      return;
    }
    // midfielders offer short options
    if (carrier && e.role !== 'DEF') {
      const dc = dist(e, carrier);
      if (e.role === 'MID' && dc > 16) spot = { x: spot.x * 0.6 + carrier.x * 0.4, y: spot.y * 0.6 + carrier.y * 0.4 };
    }
    // find space near the spot: away from opponents, with an open lane from the ball
    let best = spot, bs = -Infinity;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2, rr = k === 0 ? 0 : 4;
      const c = { x: clamp(spot.x + Math.cos(a) * rr, 1, L - 1), y: clamp(spot.y + Math.sin(a) * rr, 1, W - 1) };
      let dOpp = 9;
      for (const o of this.live(this.opp(e))) dOpp = Math.min(dOpp, dist(o, c));
      let s = Math.min(dOpp, 7) * (0.4 + e.r.move * 0.006) - 0.35 * dist(c, spot);
      if (carrier) s += this.laneOpen(e.side, carrier, c) * 2.5;
      if (s > bs) { bs = s; best = c; }
    }
    e.tx = best.x; e.ty = best.y;
    e.tspd = dist(e, best) > 6 ? 0.9 : TUNE.jog;
  }
  // 0..1: how open the straight lane from a to c is (distance of the nearest opponent from it).
  laneOpen(si, a, c) {
    let m = 3;
    for (const o of this.live(this.sides[1 - si])) m = Math.min(m, segDist(o.x, o.y, a.x, a.y, c.x, c.y));
    return m / 3;
  }

  // Greedy man-marking: each outfield defender picks up the most dangerous attacker near their zone.
  assignMarks(S) {
    const O = this.sides[1 - S.i];
    const own = this.ownX(S.i);
    const carrier = this.ball.owner;
    const targets = this.live(O).filter((o) => o.slot !== 'GK' && o !== carrier)
      .map((o) => ({ o, threat: hyp(o.x - own, o.y - W / 2) }))
      .filter((q) => q.threat < 34).sort((p, q) => p.threat - q.threat);
    const free = this.live(S).filter((e) => e.slot !== 'GK');
    for (const e of free) e.mark = null;
    for (const { o } of targets) {
      let best = null, bd = Infinity;
      for (const e of free) {
        if (e.mark) continue;
        const z = this.shapeSpot(e, false);
        const d = hyp(z.x - o.x, z.y - o.y) + (e.role === 'FWD' ? 6 : 0);
        if (d < bd) { bd = d; best = e; }
      }
      if (best && bd < 16) best.mark = o;
    }
  }

  defendShape(e) {
    const zone = this.shapeSpot(e, false);
    const m = e.mark;
    if (m && !m.sentOff) {
      const own = this.ownX(e.side);
      const gx = own - m.x, gy = W / 2 - m.y, g = hyp(gx, gy) || 1;
      const tight = 1.2 + g / 14;
      const goalSide = { x: m.x + (gx / g) * tight, y: m.y + (gy / g) * tight };
      const w = clamp(0.35 + e.r.awr * 0.006 + (g < 20 ? 0.15 : 0), 0, 0.95);
      e.tx = goalSide.x * w + zone.x * (1 - w); e.ty = goalSide.y * w + zone.y * (1 - w);
    } else { e.tx = zone.x; e.ty = zone.y; }
    // cut the lane between the ball and the nearest attacker when there's no one to mark
    e.tspd = dist(e, { x: e.tx, y: e.ty }) > 5 ? 0.95 : 0.72;
  }

  // ------------------------------------------------------------------ keeper
  keeperThink(e) {
    const b = this.ball, own = this.ownX(e.side);
    e.diving = e.diving && !b.owner;
    // a shot coming at goal: react, then move (or dive) to the save point
    if (!b.owner && this.ballToGoal(e.side)) {
      const react = Math.max(0.12, TUNE.gkReact - e.r.refl * TUNE.gkReactPer) + (e.guessWrong ? 0.4 : 0) + (b.misread || 0);
      if (this.t - b.touchT < react) return;
      const p = this.savePoint(e);
      if (p) {
        e.tx = p.x; e.ty = p.y; e.tspd = 1;
        const lateral = hyp(p.x - e.x, p.y - e.y);
        if (lateral > e.gkReach * 0.6 && p.t < 0.9 && !e.diving) { e.diving = true; e.diveT = this.t; }
        return;
      }
    }
    if (!b.owner && this.chaser[e.side] === e) { this.chase(e); return; }
    if (this.t < e.nextThink) return;
    e.nextThink = this.t + 0.15;
    // positioning: on the line between the ball and the middle of the goal
    const gx = b.x - own, gy = b.y - W / 2, g = hyp(gx, gy) || 1;
    const sharp = e.r.gkPos;
    if (this.t > e.posErrT) { e.posErr = this.rng.gauss(0, (100 - sharp) * 0.022); e.posErrT = this.t + 1.5; }
    // come further off the line as the ball gets closer (narrowing the angle), but not for long shots
    const out = clamp(0.5 + g * 0.11, 0.5, 2.2 + sharp * 0.02);
    e.tx = own + (gx / g) * out; e.ty = W / 2 + (gy / g) * out + e.posErr;
    e.ty = clamp(e.ty, GOAL_Y0 - 1.5, GOAL_Y1 + 1.5);
    e.tspd = 0.8;
  }
  diveExt(e) { return e.diving ? e.gkDive * clamp((this.t - e.diveT) / TUNE.gkDiveTime, 0, 1) : 0; }
  // Is the free ball heading for side si's goal mouth (a shot or deflection to stop)?
  ballToGoal(si) {
    const b = this.ball, own = this.ownX(si);
    const vxg = own === 0 ? -b.vx : b.vx;
    if (vxg < 4) return false;
    const tCross = Math.abs(own - b.x) / vxg;
    if (tCross > 2.2) return false;
    const y = b.y + b.vy * tCross;
    return y > GOAL_Y0 - 1.2 && y < GOAL_Y1 + 1.2;
  }
  // Where on the ball's path the keeper should go: the first point they can reach, near their line.
  savePoint(e) {
    const pred = this.pred || [];
    const own = this.ownX(e.side);
    let best = null;
    for (const p of pred) {
      if (p.out) break;
      if (Math.abs(p.x - own) > Math.abs(e.x - own) + 0.4) continue; // still in front of the keeper
      best = { ...p };
      if (this.timeTo(e, p.x, p.y) <= p.t || hyp(p.x - e.x, p.y - e.y) < e.gkReach + e.gkDive) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ ball carrier
  carrierThink(e) {
    const b = this.ball;
    e.diving = false;
    if (b.inHands) {
      // keepers / throw-in takers: hold briefly, then release
      e.tx = e.x; e.ty = e.y;
      if (this.t < Math.max(e.nextDecide, e.holdUntil)) return;
      return this.decide(e);
    }
    if (this.t < e.nextDecide) return;
    this.decide(e);
  }

  decide(e) {
    const b = this.ball, S = this.side(e), C = S.coach;
    const restricted = e.restricted;
    const press = this.pressureOn(e);
    const vision = e.r.vision;
    // (team.testNoise: a tools-only multiplier for experiments on decision quality)
    const noise = () => this.rng.gauss(0, TUNE.noise * (1.25 - vision / 100) * (S.depth.team.testNoise ?? 1));
    const opts = [];
    const gx = this.goalX(e.side);
    const K = TUNE.possVal;
    const here = this.threat(e.side, e.x, e.y);
    const handsOrSet = b.inHands || restricted;

    // --- shoot
    const dGoal = hyp(gx - e.x, W / 2 - e.y);
    const range = 16 + C.shootRange * 12 + (e.r.power - 60) * 0.08;
    if ((!handsOrSet || restricted === 'freeKick' || restricted === 'penalty') && (dGoal < range || restricted === 'penalty')) {
      let xg = this.xg(e.side, e.x, e.y, { pressure: press }) * (0.6 + e.r.finish / 125);
      xg *= (1 - this.shotBlockRisk(e) * 0.5) * (1 - this.blockChance(e, gx - e.x, W / 2 - e.y));
      if (restricted === 'freeKick') xg *= 0.55;
      if (restricted === 'penalty') xg = 99;
      // a miss usually hands the ball over (rebounds and corners keep it about a quarter of the time)
      const keepAfter = 0.25 * (here + K) - 0.75 * (this.threat(1 - e.side, L / 2, W / 2) + K);
      opts.push({ type: 'shoot', u: xg * TUNE.shotVal * (0.75 + C.shootRange * 0.5) + (1 - xg) * keepAfter + noise() });
    }
    if (restricted === 'penalty') return this.shoot(e, { penalty: true });

    // --- dribble (or shield)
    if (!handsOrSet) {
      const ax = gx > e.x ? 1 : -1;
      for (const ang of [-1.2, -0.7, -0.3, 0, 0.3, 0.7, 1.2, Math.PI]) {
        const dx = Math.cos(ang) * ax, dy = Math.sin(ang);
        const P = { x: e.x + dx * 5, y: e.y + dy * 5 };
        if (P.x < 0.8 || P.x > L - 0.8 || P.y < 0.8 || P.y > W - 0.8) continue;
        const keep = this.keepChance(e, P);
        const u = keep * (here * (1 - TUNE.dribbleVal) + this.threat(e.side, P.x, P.y) * TUNE.dribbleVal + K)
          - (1 - keep) * (TUNE.lossW * this.threat(1 - e.side, e.x, e.y) + K)
          + (0.5 - C.tempo) * 0.01 + noise();
        opts.push({ type: 'dribble', u, P, keep });
      }
      // clear it: own third under pressure
      if (this.u(e.side, e.x) < 0.33 && press > 0.3) {
        opts.push({ type: 'clear', u: -0.2 * K - TUNE.lossW * this.threat(1 - e.side, this.X(e.side, 0.6), W / 2) + noise() });
      }
    }
    this.bestU = opts.reduce((m, o) => Math.max(m, o.u), -Infinity);
    // --- passes
    const maxD = restricted === 'throwIn' ? 20 : b.inHands ? 30 : 60;
    for (const m of this.live(S)) {
      if (m === e) continue;
      const d0 = dist(e, m);
      if (d0 < 3 || d0 > maxD + 6) continue;
      if (m.slot === 'GK' && (this.u(e.side, e.x) > 0.35 || press < 0.5)) continue;
      const lead = Math.min(1.4, d0 / 13) * 0.7;
      const base = { x: clamp(m.x + m.vx * lead, 1, L - 1), y: clamp(m.y + m.vy * lead, 1, W - 1) };
      if (restricted !== 'throwIn' && !b.inHands) this.passOption(opts, e, m, base, 'ground', here, noise);
      if (d0 > 14 && restricted !== 'throwIn') this.passOption(opts, e, m, base, 'lofted', here, noise);
      if (restricted === 'throwIn' || b.inHands) this.passOption(opts, e, m, base, b.inHands && e.slot === 'GK' && d0 > 22 ? 'lofted' : 'throw', here, noise);
      // through ball into space ahead of a runner
      const mu = this.u(e.side, m.x);
      if (!handsOrSet && m.slot !== 'GK' && m.role !== 'DEF' && mu > this.u(e.side, e.x) - 0.05) {
        const gdx = gx - m.x, gdy = (W / 2 - m.y) * 0.4, gd = hyp(gdx, gdy) || 1;
        const sp = hyp(m.vx, m.vy);
        const dirx = sp > 2 ? (m.vx / sp) * 0.5 + (gdx / gd) * 0.5 : gdx / gd, diry = sp > 2 ? (m.vy / sp) * 0.5 + (gdy / gd) * 0.5 : gdy / gd;
        for (const ahead of [4, 8]) {
          const P = { x: clamp(m.x + dirx * ahead, 1.5, L - 1.5), y: clamp(m.y + diry * ahead, 1.5, W - 1.5) };
          this.passOption(opts, e, m, P, 'through', here, noise);
        }
      }
    }
    // --- crosses from wide areas
    if (!handsOrSet || restricted === 'corner' || restricted === 'freeKick') {
      const eu = this.u(e.side, e.x);
      if ((eu > 0.7 && Math.abs(e.y - W / 2) > 7) || restricted === 'corner') {
        for (const m of this.live(S)) {
          if (m === e || m.slot === 'GK' || !inBox(m.x, m.y, gx)) continue;
          const P = { x: m.x + (gx > 0 ? 0.5 : -0.5), y: m.y };
          this.passOption(opts, e, m, P, 'cross', here, noise);
        }
      }
    }
    if (!opts.length) opts.push({ type: 'clear', u: 0 });
    let best = opts[0];
    for (const o of opts) if (o.u > best.u) best = o;
    if (this.debug) this.debug('decide', { e, best, opts: opts.slice().sort((a, b) => b.u - a.u).slice(0, 5), press });

    const was = e.restricted;
    e.restricted = null;
    if (best.type === 'shoot') return this.shoot(e, { freeKick: was === 'freeKick' });
    if (best.type === 'pass') return this.pass(e, best);
    if (best.type === 'clear') return this.clear(e);
    // dribble
    e.tx = best.P.x; e.ty = best.P.y; e.tspd = 1;
    e.nextDecide = this.t + TUNE.holdMin + (1 - C.tempo) * TUNE.holdTempo * this.rng.range(0.6, 1.2);
  }

  shotBlockRisk(e) {
    const gx = this.goalX(e.side);
    let r = 0;
    for (const o of this.live(this.opp(e))) {
      if (o.slot === 'GK') continue;
      const d = segDist(o.x, o.y, e.x, e.y, gx, W / 2);
      if (d < 1.2 && dist(o, e) < hyp(gx - e.x, W / 2 - e.y)) r = Math.max(r, 1 - d / 1.2);
    }
    return r;
  }
  // Chance a defender right next to the kicker gets a foot to the ball as it's struck,
  // for a kick in direction (dx, dy). Closer and more square-on = more likely.
  blockChance(e, dx, dy) {
    const d0 = hyp(dx, dy) || 1;
    let p = 0;
    for (const o of this.live(this.opp(e))) {
      const ox = o.x - e.x, oy = o.y - e.y, od = hyp(ox, oy);
      if (od > TUNE.blockRange) continue;
      const cos = (ox * dx + oy * dy) / (od * d0 || 1);
      if (cos < 0.3) continue;
      p = Math.max(p, TUNE.block * (1 - od / TUNE.blockRange) * cos * (0.6 + o.r.tackle * 0.008));
    }
    return p;
  }
  // Chance of keeping the ball while dribbling toward P.
  keepChance(e, P) {
    const mid = { x: (e.x + P.x) / 2, y: (e.y + P.y) / 2 };
    let keep = 1;
    for (const o of this.live(this.opp(e))) {
      const d = Math.min(dist(o, mid), dist(o, P) + 0.5, dist(o, e) + 0.3);
      const close = sigmoid((2.4 - d) / 0.55);
      const duel = clamp(0.5 + (o.r.tackle - e.r.ret) / 190 + (o.r.agi - e.r.agi) / 400, 0.15, 0.85);
      keep *= 1 - close * duel * 0.95;
    }
    return keep;
  }

  // Score one pass and add it to the options. kind: ground | lofted | through | cross | throw
  passOption(opts, e, m, P, kind, here, noise) {
    // a pass is never worth more than the threat where it lands plus keeping the ball
    if (kind !== 'cross' && this.threat(e.side, P.x, P.y) + TUNE.possVal + 0.04 < this.bestU) return;
    const plan = this.planKick(e, P, kind);
    if (!plan) return;
    const d = hyp(P.x - e.x, P.y - e.y);
    // where the ball is along the way (for interception risk), in closed form
    const n = pathSamples(e, plan, kind === 'throw' ? 1.2 : 0.02, Math.min(3.5, plan.t + 0.2));
    let pLane = 1 - this.blockChance(e, plan.vx, plan.vy);
    for (const o of this.live(this.opp(e))) {
      // too far from the line to get there in time: skip the detailed check
      if (segDist(o.x, o.y, e.x, e.y, P.x, P.y) > o.maxSpd * (plan.t + 0.45) + 1.5) continue;
      let worst = 0;
      const zMax = o.slot === 'GK' && inBox(P.x, P.y, this.ownX(o.side)) ? o.gkTop : o.headZ;
      const near = hyp(o.x - e.x, o.y - e.y) < TUNE.blockRange + 0.5;
      for (let i = 0; i < n; i++) {
        const t = PT[i];
        if (t < 0.2 && near) continue; // covered by blockChance
        if (PZ[i] > zMax) continue;
        const margin = this.timeTo(o, PX[i], PY[i]) + 0.25 - t;
        if (margin < 0.9) worst = Math.max(worst, sigmoid(-margin / 0.18));
      }
      pLane *= 1 - worst * 0.85;
    }
    const tR = this.timeTo(m, P.x, P.y);
    const pRecv = sigmoid((plan.t + 0.45 - tR) / 0.22);
    const skill = kind === 'throw' ? 70 : e.r.pass;
    const err = Math.max(0.008, TUNE.passErr + (100 - skill) * TUNE.passErrPer) * (1 + this.pressureOn(e) * 0.6) * (kind === 'lofted' || kind === 'cross' ? 1.3 : 1);
    const pAcc = clamp(1 - (err * d) / 3.5, 0.25, 1);
    const pCtrl = kind === 'lofted' ? 0.62 : kind === 'cross' ? 0.8 : 1; // long balls are hard to bring down
    const p = pLane * pRecv * pAcc * pCtrl;
    let gain = this.threat(e.side, P.x, P.y);
    // space around the receiver when the ball gets there
    let open = 9;
    for (const o of this.live(this.opp(e))) open = Math.min(open, Math.max(0, dist(o, P) - o.maxSpd * plan.t * 0.45));
    gain *= 0.65 + 0.35 * Math.min(open, 5) / 5;
    if (kind === 'cross') gain = Math.max(gain, this.xg(e.side, P.x, P.y, { header: true }) * 0.8);
    const C = this.side(e).coach;
    const prog = this.u(e.side, P.x) - this.u(e.side, e.x);
    const K = TUNE.possVal;
    const u = p * (gain + K) - (1 - p) * (TUNE.lossW * this.threat(1 - e.side, (e.x + P.x) / 2, (e.y + P.y) / 2) + K)
      + (TUNE.progW + (C.directness - 0.5) * 0.03) * prog + (kind === 'lofted' ? -0.004 : 0) + noise();
    opts.push({ type: 'pass', u, p, kind, to: m, P, plan, pLane, pRecv });
    if (u > this.bestU) this.bestU = u;
  }

  // Velocity to put the ball at P. Returns { vx, vy, vz, t } or null if out of range.
  planKick(e, P, kind) {
    const dx = P.x - e.x, dy = P.y - e.y, d = hyp(dx, dy) || 0.01;
    const maxV = TUNE.kickPow + e.r.power * TUNE.kickPowPer;
    if (kind === 'ground' || kind === 'through') {
      const v1 = kind === 'through' ? 3 : clamp(3 + d * 0.18, 4, 9);
      const g = planGround(d, v1);
      if (g.v0 > maxV) return null;
      return { vx: (dx / d) * g.v0, vy: (dy / d) * g.v0, vz: 0, t: g.t };
    }
    if (kind === 'throw') {
      if (d > 22) return null;
      const lf = planLofted(Math.max(2, d - 1.6), 0.35);
      if (lf.v > 15) return null;
      return { vx: (dx / d) * lf.vh, vy: (dy / d) * lf.vh, vz: lf.vz, t: lf.t };
    }
    const ang = kind === 'cross' ? 0.42 : kind === 'clear' ? 0.7 : 0.55;
    const lf = planLofted(d, ang);
    if (lf.v > maxV) return null;
    return { vx: (dx / d) * lf.vh, vy: (dy / d) * lf.vh, vz: lf.vz, t: lf.t };
  }

  // Strike the ball with aim error. err: radians (1 sigma) of direction error.
  kick(e, vx, vy, vz, err, kind) {
    const b = this.ball;
    const a = this.rng.gauss(0, err);
    const c = Math.cos(a), s = Math.sin(a);
    const pk = 1 + this.rng.gauss(0, err * 0.8);
    b.owner = null;
    b.vx = (vx * c - vy * s) * pk; b.vy = (vx * s + vy * c) * pk; b.vz = vz * (1 + this.rng.gauss(0, err));
    if (b.inHands) { b.z = kind === 'throw' ? 1.6 : 0.6; b.y = clamp(b.y, 0.2, W - 0.2); b.x = clamp(b.x, 0.2, L - 0.2); }
    b.inHands = false;
    b.lastTouch = e; b.touchT = this.t;
    b.kick = { id: ++this.kickId, by: e, kind, t: this.t };
    e.touchCD = this.t + 0.3;
    e.nextDecide = this.t + 0.5;
    const pBlock = kind === 'clear' || kind === 'throw' ? 0 : this.blockChance(e, b.vx, b.vy);
    let blocker = null;
    for (const o of this.live(this.opp(e))) {
      if (hyp(o.x - b.x, o.y - b.y) < TUNE.blockRange + 0.5) o.touchCD = Math.max(o.touchCD, this.t + 0.2);
      if (e.mods.misread && o.slot !== 'GK') o.touchCD = Math.max(o.touchCD, this.t + e.mods.misread); // Dark: they read it late
    }
    b.misread = e.mods.misread || 0;
    if (pBlock > 0 && this.rng.chance(pBlock)) {
      blocker = this.live(this.opp(e)).filter((o) => hyp(o.x - e.x, o.y - e.y) < TUNE.blockRange).sort((p, q) => dist(p, e) - dist(q, e))[0];
    }
    this.pendingBlock = blocker;
    e.tspd = TUNE.jog;
    this.pred = null;
  }

  pass(e, o) {
    const err = Math.max(0.008, TUNE.passErr + (100 - (o.kind === 'throw' ? 70 : e.r.pass)) * TUNE.passErrPer) * (1 + this.pressureOn(e) * 0.6)
      * (o.kind === 'lofted' || o.kind === 'cross' ? 1.3 : 1);
    this.kick(e, o.plan.vx, o.plan.vy, o.plan.vz, err, o.kind);
    this.flight = { from: e, to: o.to, kind: o.kind };
    const counts = o.kind !== 'throw';
    this.openPass = counts ? { by: e, to: o.to, kind: o.kind, t: this.t, x: e.x, y: e.y, p: o.p, pLane: o.pLane, pRecv: o.pRecv } : null;
    this.emit('pass', { by: e, to: o.to, kind: o.kind, x: e.x, y: e.y, tx: o.P.x, ty: o.P.y, p: o.p, pLane: o.pLane, pRecv: o.pRecv });
    // the receiver runs onto it
    o.to.run = null;
    o.to.nextThink = this.t + 0.2;
    this.applyBlock();
  }

  clear(e) {
    const own = this.ownX(e.side), dir = own === 0 ? 1 : -1;
    const wide = e.y < W / 2 ? -1 : 1;
    const P = { x: clamp(e.x + dir * this.rng.range(22, 34), 2, L - 2), y: clamp(e.y + wide * this.rng.range(2, 10), 3, W - 3) };
    const plan = this.planKick(e, P, 'clear') || this.planKick(e, { x: e.x + dir * 15, y: P.y }, 'clear');
    if (!plan) { this.kick(e, dir * 14, 0, 6, 0.2, 'clear'); }
    else this.kick(e, plan.vx, plan.vy, plan.vz, 0.12, 'clear');
    this.flight = null;
    this.openPass = null;
    this.emit('clear', { by: e, x: e.x, y: e.y });
  }

  shoot(e, { penalty = false, freeKick = false } = {}) {
    const gx = this.goalX(e.side), b = this.ball;
    const keeper = this.gk(this.opp(e));
    const ky = keeper ? keeper.y : W / 2;
    const press = penalty ? 0 : this.pressureOn(e);
    const d = hyp(gx - e.x, W / 2 - e.y);
    // aim: the corner farther from the keeper, closer to the post for better finishers
    const skill = penalty ? (e.r.finish + e.r.comp) / 2 : e.r.finish;
    const margin = 0.2 + (100 - skill) * 0.006;
    const gapL = ky - GOAL_Y0, gapR = GOAL_Y1 - ky;
    const right = this.rng.next() < gapR / (gapL + gapR) + (penalty ? 0 : 0);
    const aimY = right ? GOAL_Y1 - margin : GOAL_Y0 + margin;
    const aimZ = this.rng.chance(0.6) ? 0.3 : 1.4;
    const speed = (14 + e.r.power * 0.17) * this.rng.range(0.88, 1) * (d < 9 ? 0.9 : 1);
    const dx = gx - e.x, dy = aimY - e.y, dd = hyp(dx, dy);
    const T = dd / (speed * 0.93);
    const vz = (aimZ - 0.1 + 0.5 * 9.81 * T * T) / T;
    const err = (TUNE.shotErr + (100 - skill) * TUNE.shotErrPer) * (1 + press * 0.8) * (1 + Math.max(0, speed - 24) * 0.02) * (freeKick ? 1.3 : 1) * (penalty ? 0.55 : 1) * (1 + Math.max(0, d - 12) * 0.04);
    b.z = 0.1;
    this.kick(e, (dx / dd) * speed, (dy / dd) * speed, vz, err, penalty ? 'penalty' : 'shot');
    b.vz *= 1 + this.rng.gauss(0, 0.12);
    this.flight = null; this.openPass = null;
    const xg = penalty ? 0.75 : this.xg(e.side, e.x, e.y, { pressure: press });
    const onTarget = this.willScore(gx);
    this.openShot = { by: e, side: e.side, xg, onTarget, kickId: this.kickId, penalty, x: e.x, y: e.y, d };
    if (penalty && keeper) {
      // the keeper guesses a side; composure decides who wins the mind game
      const pRight = clamp(0.36 + (keeper.r.comp - e.r.comp) * 0.004, 0.15, 0.6);
      keeper.guessWrong = !this.rng.chance(pRight);
    }
    this.emit('shot', { by: e, xg, d, penalty, freeKick, onTarget, x: e.x, y: e.y, press, ang: goalAngle(e.x, e.y, gx) });
    this.applyBlock();
  }
  applyBlock() {
    const o = this.pendingBlock;
    this.pendingBlock = null;
    if (!o) return;
    o.touchCD = 0;
    this.deflect(o, this.rng.range(0.15, 0.4));
  }
  // Would the free ball, untouched, cross side's attacked goal line inside the goal?
  willScore(gx) {
    const pr = predict(this.ball, 3, 0.05, 0.025);
    for (let i = 1; i < pr.length; i++) {
      const a = pr[i - 1], p = pr[i];
      if ((gx === L && p.x >= L) || (gx === 0 && p.x <= 0)) {
        const k = (gx - a.x) / (p.x - a.x || 1e-6);
        const y = a.y + (p.y - a.y) * k, z = a.z + (p.z - a.z) * k;
        return y > GOAL_Y0 + BALL_R && y < GOAL_Y1 - BALL_R && z < GOAL_H - BALL_R;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ contact: free ball
  touches() {
    const b = this.ball;
    const cands = [];
    for (const e of this.ents) {
      if (e.sentOff || this.t < e.touchCD) continue;
      const hands = this.canHandle(e) && !(b.lastTouch?.side === e.side && b.kick?.kind !== 'shot' && b.lastTouch !== e && b.kick?.by?.side === e.side);
      const zMax = hands ? e.gkTop : e.headZ;
      // closest approach of the ball's last step to the player
      const { d, z } = segClosest(e.x, e.y, b.px, b.py, b.pz, b.x, b.y, b.z);
      if (z > zMax) continue;
      let reach = z < 0.8 ? 0.65 : 0.55;
      if (hands) reach = e.gkReach + this.diveExt(e);
      if (d < reach) cands.push({ e, d, z, hands });
    }
    if (!cands.length) return;
    let pick = cands[0];
    if (cands.length > 1) {
      const items = cands.map((c) => ({ ...c, w: (1 / (c.d + 0.2)) * (c.z > 1 ? (c.e.headZ + c.e.r.str * 0.02) : (c.e.r.touch + 40) / 100) * (c.hands ? 2 : 1) }));
      pick = this.rng.weighted(items);
    }
    this.resolveTouch(pick.e, pick.z, pick.hands, pick.d);
  }

  resolveTouch(e, z, hands, d) {
    const b = this.ball;
    const rvx = b.vx - e.vx * 0.5, rvy = b.vy - e.vy * 0.5;
    const v = hyp(rvx, rvy, b.vz);
    if (hands) return this.keeperTouch(e, v, d);
    if (z > 1.3 || (z > 0.9 && this.flight?.to !== e)) return this.header(e, v);
    const intended = this.flight?.to === e;
    const passer = this.flight?.from;
    const weight = intended && passer ? (passer.r.pass - 60) * 0.004 : 0; // a well-weighted pass is easier to take
    const reading = this.flight && passer && passer.side !== e.side ? (e.r.awr - 60) * 0.006 : 0; // defenders who read it
    const diff = v / (9 + e.r.touch * 0.12) + (z > 0.9 ? 0.25 : 0);
    const pC = clamp(TUNE.ctrlBase - TUNE.ctrlSlope * diff + (intended ? 0.08 : 0) + weight + reading, 0.04, 0.98);
    if (this.rng.chance(pC)) return this.gainBall(e, diff);
    if (z < Math.min(1.7, e.height + 0.3) || this.rng.chance(0.5)) return this.deflect(e, 0.25 + this.rng.next() * 0.35);
    e.touchCD = this.t + 0.35; // swung and missed
  }

  gainBall(e, diff = 0, inHands = false) {
    const b = this.ball;
    const prev = b.lastTouch;
    // passes: complete or intercepted
    if (this.openPass) {
      const P = this.openPass;
      this.emit('passEnd', { pass: P, by: e, complete: e.side === P.by.side });
      if (e.side === P.by.side) { e.lastFrom = P.by; e.lastFromT = this.t; }
      else this.emit('interception', { by: e, from: P.by });
      this.openPass = null;
    } else if (prev && prev.side !== e.side && this.poss !== e.side && !this.openShot) this.emit('recovery', { by: e });
    if (this.openShot) this.resolveShot(e.slot === 'GK' && e.side !== this.openShot.side ? 'saved' : e.side !== this.openShot.side ? 'blocked' : 'rebound', e);
    b.owner = e; b.inHands = inHands; b.vx = b.vy = b.vz = 0; b.z = inHands ? 1 : 0;
    b.misread = 0;
    b.lastTouch = e; b.touchT = this.t;
    this.flight = null;
    this.poss = e.side;
    e.run = null;
    e.tx = e.x + e.vx * 0.3; e.ty = e.y + e.vy * 0.3;
    e.nextDecide = this.t + 0.12 + diff * 0.25 + (100 - e.r.touch) * 0.0025;
    e.gainT = this.t; e.gainX = e.x; e.gainY = e.y;
    this.emit('touch', { by: e });
  }

  deflect(e, keep) {
    const b = this.ball;
    const a = this.rng.range(-1.1, 1.1);
    const c = Math.cos(a), s = Math.sin(a);
    const vx = b.vx * keep, vy = b.vy * keep;
    b.vx = vx * c - vy * s; b.vy = vx * s + vy * c;
    b.vz = Math.abs(b.vz) * 0.3 + this.rng.range(0, 2.5);
    b.lastTouch = e; b.touchT = this.t;
    b.misread = 0;
    e.touchCD = this.t + 0.3;
    if (this.openShot && e.side !== this.openShot.side) this.resolveShot('blocked', e);
    if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: e, complete: false }); this.openPass = null; }
    this.flight = null;
    this.pred = null;
    this.emit('deflect', { by: e });
  }

  header(e, v) {
    const b = this.ball, S = this.side(e);
    const gx = this.goalX(e.side), own = this.ownX(e.side);
    const win = clamp(0.55 + e.r.str * 0.004 - v * 0.012 + (e.mods.reach || 0) * 0.4, 0.2, 0.95);
    if (!this.rng.chance(win)) return this.deflect(e, 0.3);
    if (this.openPass && this.openPass.by.side !== e.side) { this.emit('passEnd', { pass: this.openPass, by: e, complete: false }); this.openPass = null; }
    if (this.openShot && e.side !== this.openShot.side) this.resolveShot('blocked', e);
    const dGoal = hyp(gx - e.x, W / 2 - e.y);
    this.emit('header', { by: e });
    if (dGoal < 13 && Math.abs(this.u(e.side, e.x)) > 0.75) {
      // header at goal
      const keeper = this.gk(this.opp(e));
      const ky = keeper ? keeper.y : W / 2;
      const aimY = ky > W / 2 ? GOAL_Y0 + 0.5 : GOAL_Y1 - 0.5;
      const sp = 8 + e.r.str * 0.07;
      const dx = gx - e.x, dy = aimY - e.y, dd = hyp(dx, dy);
      const T = dd / sp;
      const vz = (0.6 - b.z + 0.5 * 9.81 * T * T) / T;
      if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: e, complete: true }); e.lastFrom = this.openPass.by; e.lastFromT = this.t; this.openPass = null; }
      this.kick(e, (dx / dd) * sp, (dy / dd) * sp, vz, 0.06 + (100 - e.r.finish) * 0.0016, 'shot');
      const xg = this.xg(e.side, e.x, e.y, { header: true });
      this.openShot = { by: e, side: e.side, xg, onTarget: this.willScore(gx), kickId: this.kickId, header: true, x: e.x, y: e.y, d: dGoal };
      this.emit('shot', { by: e, xg, d: dGoal, header: true, onTarget: this.openShot.onTarget, x: e.x, y: e.y, press: this.pressureOn(e), ang: goalAngle(e.x, e.y, gx) });
      this.poss = e.side;
      return;
    }
    if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: e, complete: e.side === this.openPass.by.side }); this.openPass = null; }
    // defensive or midfield header: away from danger, toward a teammate if one is near
    const away = own === 0 ? 1 : -1;
    let tx = e.x + away * 14, ty = e.y + this.rng.range(-8, 8);
    const mate = this.live(S).filter((m) => m !== e && m.slot !== 'GK' && dist(m, e) < 18 && (m.x - e.x) * away > -2)
      .sort((p, q) => this.threat(e.side, q.x, q.y) - this.threat(e.side, p.x, p.y))[0];
    if (mate && this.rng.chance(0.55)) { tx = mate.x; ty = mate.y; }
    const dx = tx - e.x, dy = ty - e.y, dd = hyp(dx, dy) || 1;
    const sp = 7 + e.r.str * 0.06;
    this.kick(e, (dx / dd) * sp, (dy / dd) * sp, 3.5, 0.15, 'header');
    this.poss = e.side;
    if (mate) this.flight = { from: e, to: mate, kind: 'header' };
  }

  keeperTouch(e, v, d) {
    const b = this.ball;
    e.diving = false;
    const shot = this.openShot && this.openShot.side !== e.side;
    const stretch = clamp(d / (e.gkReach + e.gkDive), 0, 1);
    e.diving = false;
    if (shot || v > 14) {
      // a save attempt
      const pTouch = clamp(1.0 - stretch * stretch * 0.6 - Math.max(0, v - 22) * 0.03, 0.2, 0.97);
      if (!this.rng.chance(pTouch)) { e.touchCD = this.t + 0.5; return; }
      const pHold = clamp(TUNE.gkHold + e.r.handling * TUNE.gkHoldPer - Math.max(0, v - 12) * 0.03 - stretch * 0.25, 0.04, 0.95);
      if (this.rng.chance(pHold)) {
        this.emit('save', { by: e, held: true, shot: this.openShot });
        if (this.openShot) this.resolveShot('saved', e);
        this.gainBall(e, 0, true);
        e.holdUntil = this.t + 1.5 + (1 - this.side(e).coach.tempo) * 3;
        return;
      }
      // parry: pushed away from goal and to the side
      this.emit('save', { by: e, held: false, shot: this.openShot });
      if (this.openShot) this.resolveShot('saved', e);
      const away = this.ownX(e.side) === 0 ? 1 : -1;
      const side = b.y < e.y ? -1 : 1;
      if (this.rng.chance(0.4)) {
        // tipped around the post or over the bar
        const own = this.ownX(e.side);
        const ty = side < 0 ? GOAL_Y0 - this.rng.range(0.6, 2) : GOAL_Y1 + this.rng.range(0.6, 2);
        const dx = own - b.x, dy = ty - b.y, dd = hyp(dx, dy) || 1;
        const sp = Math.max(5, v * 0.35);
        b.vx = (dx / dd) * sp; b.vy = (dy / dd) * sp; b.vz = b.z > 1.2 ? 3.5 : 1;
      } else {
        const sp = v * this.rng.range(0.2, 0.45);
        const a = this.rng.range(0.4, 1.3);
        b.vx = away * Math.cos(a) * sp; b.vy = side * Math.sin(a) * sp; b.vz = this.rng.range(0.5, 4);
      }
      b.lastTouch = e; b.touchT = this.t;
      e.touchCD = this.t + 0.6;
      this.flight = null; this.pred = null;
      if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: e, complete: false }); this.openPass = null; }
      return;
    }
    // a cross or loose ball: claim it (or punch clear in a crowd)
    const crowd = this.live(this.opp(e)).filter((o) => dist(o, b) < 1.6).length;
    const pClaim = clamp(0.72 + e.r.comp * 0.003 - crowd * 0.12 - (b.z > 1.2 ? 0.05 : 0), 0.2, 0.97);
    if (this.rng.chance(pClaim)) { this.gainBall(e, 0, true); e.holdUntil = this.t + 1.5 + (1 - this.side(e).coach.tempo) * 3; this.emit('claim', { by: e }); return; }
    const away = this.ownX(e.side) === 0 ? 1 : -1;
    b.vx = away * this.rng.range(8, 13); b.vy = this.rng.range(-6, 6); b.vz = this.rng.range(3, 6);
    b.lastTouch = e; b.touchT = this.t; e.touchCD = this.t + 0.5;
    if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: e, complete: false }); this.openPass = null; }
    this.flight = null; this.pred = null;
    this.emit('punch', { by: e });
  }

  resolveShot(result, by) {
    const s = this.openShot;
    if (!s) return;
    this.openShot = null;
    this.emit('shotEnd', { shot: s, result, by });
  }

  // ------------------------------------------------------------------ contact: tackles
  tackles() {
    const b = this.ball, c = b.owner;
    if (b.inHands || !c) return;
    const C = this.opp(c).coach;
    for (const o of this.live(this.opp(c))) {
      if (this.t < o.tackleCD || o.slot === 'GK' && !inBox(o.x, o.y, this.ownX(o.side))) continue;
      // a defender squared up in front of the carrier can lunge from a little further away
      const gxs = this.goalX(c.side) - c.x, gys = W / 2 - c.y, gs = hyp(gxs, gys) || 1;
      const front = ((o.x - c.x) * gxs + (o.y - c.y) * gys) / gs > 0.3;
      const db = dist(o, b);
      if (db > TUNE.tackleRange + (front ? 0.35 : 0)) continue;
      // one man goes in at a time: the presser; the second man covers unless the ball is right at his feet
      if (this.chaser?.[o.side] !== o && db > 0.8) continue;
      if (!this.rng.chance(TUNE.tackleTry * (0.7 + C.aggression * 0.6) * (front ? TUNE.frontTry : 1))) continue;
      this.tackle(o, c, C, front);
      if (b.owner !== c || this.phase !== 'play') return;
    }
  }
  tackle(o, c, C, front = false) {
    const b = this.ball;
    o.tackleCD = this.t + 0.9;
    // from behind: the tackler is on the far side of the carrier from the goal they're attacking
    const gx = this.goalX(c.side);
    const fx = gx - c.x, fy = W / 2 - c.y, f = hyp(fx, fy) || 1;
    const behind = ((o.x - c.x) * fx + (o.y - c.y) * fy) / f > 0.35;
    // synergies: Ground (both ways), Bug (teammates close by), Rock (carrier resists)
    const near = Math.min(3, this.live(this.side(o)).filter((m) => m !== o && dist(m, c) < 3).length);
    const syn = (o.mods.grounded || 0) - (c.mods.grounded || 0) + (o.mods.swarm || 0) * near - (c.mods.sturdy || 0);
    const score = (o.r.tackle - c.r.ret) * 0.02 + (o.r.mass - c.r.mass) * 0.004 - (c.r.agi - o.r.agi) * 0.007 + TUNE.tackleBias - (behind ? 0.6 : 0) + (front ? TUNE.frontBonus : 0) + syn
      + (0.5 - C.aggression) * TUNE.aggrLunge; // aggressive defenders lunge in; patient ones pick their moment
    this.contact(o, c);
    // Ghost: the tackle passes straight through
    if (c.mods.phase && this.rng.chance(c.mods.phase)) { this.emit('tackle', { by: o, on: c, won: false, phase: true }); o.stunUntil = this.t + 0.55; return; }
    const pWin = sigmoid(score);
    const pFoul = clamp(TUNE.foulBase + C.aggression * TUNE.foulAggr + (behind ? TUNE.foulBehind : 0) + (1 - pWin) * 0.05, 0.01, 0.5);
    if (this.rng.chance(pFoul)) { this.maybeInjure(c, 0.012); return this.foul(o, c, behind); }
    if (this.rng.chance(pWin)) {
      this.emit('tackle', { by: o, on: c, won: true });
      this.maybeInjure(c, 0.0012);
      if (this.rng.chance(0.55)) { this.poss = o.side; this.gainBall(o, 0.3); return; }
      // poked loose
      b.owner = null;
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(2.5, 6);
      b.vx = Math.cos(a) * sp + o.vx * 0.3; b.vy = Math.sin(a) * sp + o.vy * 0.3; b.vz = 0;
      b.lastTouch = o; b.touchT = this.t;
      c.touchCD = this.t + 0.4; o.touchCD = this.t + 0.15;
      this.pred = null;
      return;
    }
    // beaten (a lunging tackle leaves the defender on the floor longer)
    this.emit('tackle', { by: o, on: c, won: false });
    this.contact(c, o);
    o.stunUntil = this.t + 0.4 + C.aggression * 0.5;
  }
  // Ice and Poison: whoever a and b barge into pays for it.
  contact(a, b) {
    if (a.mods.chill) b.slowUntil = Math.max(b.slowUntil, this.t + a.mods.chill);
    if (a.mods.toxic) b.energy = Math.max(0, b.energy - a.mods.toxic);
  }
  maybeInjure(e, p) {
    if (!this.injuries || e.injured || !this.rng.chance(p)) return;
    e.injured = true;
    this.side(e).depth.injured.add(e.id);
    this.rateEnt(e);
    this.emit('injury', { by: e });
  }
  foul(o, c, behind) {
    const b = this.ball;
    const own = this.ownX(o.side);
    const pen = inBox(c.x, c.y, own);
    // a professional foul: the carrier was through on goal
    const through = hyp(this.goalX(c.side) - c.x, W / 2 - c.y) < 18 && this.live(this.side(o)).filter((d) => d.slot !== 'GK' && Math.abs(d.x - own) < Math.abs(c.x - own)).length === 0;
    let card = null;
    const r = this.rng.next();
    if (r < TUNE.red + (through ? 0.04 : 0)) card = 'red';
    else if (r < TUNE.red + TUNE.yellow + (behind ? 0.1 : 0) + (through ? 0.25 : 0) + this.side(o).coach.aggression * 0.08) card = 'yellow';
    if (card === 'yellow' && o.yellow) card = 'second';
    this.emit('foul', { by: o, on: c, pen, card, x: c.x, y: c.y });
    if (card === 'yellow') o.yellow = true;
    if (card === 'red' || card === 'second') this.sendOff(o);
    b.owner = null; b.inHands = false; b.vx = b.vy = b.vz = 0;
    this.openPass = null; this.flight = null;
    if (this.openShot) this.resolveShot('blocked', o);
    this.phase = 'dead';
    this.stop = pen ? { kind: 'penalty', side: c.side } : { kind: 'freeKick', side: c.side, x: c.x, y: c.y };
  }
  sendOff(e) {
    if (this.live(this.side(e)).length <= 5) return; // a team never drops below 5 (the match would be abandoned)
    e.sentOff = true;
    this.side(e).alive = null;
    e.x = L / 2; e.y = -2.5; e.vx = e.vy = 0;
    this.side(e).depth.sentOff.add(e.id);
    this.refreshSide(this.side(e));
  }

  // ------------------------------------------------------------------ out of play / goals
  boundaries() {
    const b = this.ball;
    if (b.owner) { b.x = clamp(b.x, 0.05, L - 0.05); b.y = clamp(b.y, 0.05, W - 0.05); return; }
    // goal line: posts and crossbar, then goal / goal kick / corner
    for (const gx of [0, L]) {
      const crossed = gx === 0 ? b.x < 0 && b.px >= 0 : b.x > L && b.px <= L;
      if (!crossed) continue;
      const k = (gx - b.px) / (b.x - b.px || 1e-6);
      const y = b.py + (b.y - b.py) * k, z = b.pz + (b.z - b.pz) * k;
      const postHit = [GOAL_Y0, GOAL_Y1].some((py) => Math.abs(y - py) < POST_R + BALL_R) && z < GOAL_H;
      const barHit = y > GOAL_Y0 && y < GOAL_Y1 && Math.abs(z - GOAL_H) < POST_R + BALL_R;
      if (postHit || barHit) {
        b.x = gx + (gx === 0 ? 0.15 : -0.15);
        b.vx = -b.vx * 0.55; b.vy += this.rng.range(-2, 2);
        if (barHit) b.vz = -Math.abs(b.vz) * 0.4 - 1;
        b.touchT = this.t;
        this.pred = null;
        this.emit('woodwork', { by: this.openShot?.by || b.lastTouch, bar: barHit });
        if (this.openShot) this.openShot.post = true;
        return;
      }
      const defSide = this.ownX(0) === gx ? 0 : 1;
      this.phase = 'dead';
      if (y > GOAL_Y0 && y < GOAL_Y1 && z < GOAL_H) {
        if (this.openShot) this.resolveShot('goal', null);
        this.stop = { kind: 'goal', side: 1 - defSide, by: b.kick?.by, lastTouch: b.lastTouch };
      } else {
        if (this.openShot) this.resolveShot(this.openShot.post ? 'post' : 'missed', null);
        if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: null, complete: false }); this.openPass = null; }
        const corner = b.lastTouch && b.lastTouch.side === defSide;
        this.stop = corner ? { kind: 'corner', side: 1 - defSide, x: gx, y: y < W / 2 ? 0 : W } : { kind: 'goalKick', side: defSide };
      }
      return;
    }
    if (b.y < -BALL_R || b.y > W + BALL_R) {
      this.phase = 'dead';
      if (this.openShot) this.resolveShot('missed', null);
      if (this.openPass) { this.emit('passEnd', { pass: this.openPass, by: null, complete: false }); this.openPass = null; }
      const side = b.lastTouch ? 1 - b.lastTouch.side : 0;
      this.stop = { kind: 'throwIn', side, x: clamp(b.x, 0.5, L - 0.5), y: b.y < 0 ? 0 : W };
    }
  }

  // ------------------------------------------------------------------ set pieces
  // kind: kickoff | throwIn | goalKick | corner | freeKick | penalty. side takes it.
  setPiece(kind, side, x, y) {
    const b = this.ball;
    const S = this.sides[side];
    if (kind === 'kickoff') { x = L / 2; y = W / 2; }
    if (kind === 'goalKick') { x = this.ownX(side) + (this.ownX(side) === 0 ? 2 : -2); y = W / 2 + this.rng.range(-3, 3); }
    if (kind === 'penalty') { const gx = this.goalX(side); x = gx === L ? L - PEN_SPOT : PEN_SPOT; y = W / 2; }
    if (kind === 'corner') { x = x === 0 ? 0.4 : L - 0.4; y = y === 0 ? 0.4 : W - 0.4; }
    if (kind === 'throwIn') y = y === 0 ? -0.3 : W + 0.3;
    Object.assign(b, { x, y, z: 0, vx: 0, vy: 0, vz: 0, px: x, py: y, pz: 0, owner: null, inHands: false, kick: null });
    this.flight = null; this.openPass = null; this.openShot = null;
    this.poss = side;
    this.phase = 'set';
    this.stop = null;
    for (const e of this.ents) { e.diving = false; e.guessWrong = false; e.run = null; e.restricted = null; }
    const taker = this.pickTaker(kind, S, x, y);
    this.set = { kind, side, x, y, taker, readyAt: this.t + SET_SECS[kind] * this.rng.range(0.85, 1.3) };
    this.setTargets();
    this.emit('setPiece', { kind, side, taker, x, y });
  }
  pickTaker(kind, S, x, y) {
    const live = this.live(S).filter((e) => e.slot !== 'GK');
    if (kind === 'goalKick') return this.gk(S) || live[0];
    if (kind === 'penalty') return live.slice().sort((a, b) => (b.r.finish + b.r.comp) - (a.r.finish + a.r.comp))[0];
    if (kind === 'kickoff') return live.find((e) => e.role === 'FWD') || live[0];
    if (kind === 'corner') return live.slice().sort((a, b) => b.r.pass - a.r.pass)[0];
    // throw-ins and free kicks: the nearest outfield player (free kicks near goal: the best shooter)
    if (kind === 'freeKick' && hyp(this.goalX(S.i) - x, W / 2 - y) < 24) return live.slice().sort((a, b) => b.r.finish + b.r.power - a.r.finish - a.r.power)[0];
    return live.slice().sort((a, b) => hyp(a.x - x, a.y - y) - hyp(b.x - x, b.y - y))[0];
  }
  // Where everyone stands for the restart.
  setTargets() {
    const { kind, side, x, y, taker } = this.set;
    const b = this.ball;
    for (const S of this.sides) {
      const att = S.i === side;
      for (const e of this.live(S)) {
        let spot;
        if (e === taker) {
          // stand just behind the ball, facing the pitch
          const fx = kind === 'throwIn' ? 0 : (this.goalX(side) - x), fy = kind === 'throwIn' ? (y < 0 ? 1 : -1) : (W / 2 - y);
          const f = hyp(fx, fy) || 1;
          spot = { x: x - (fx / f) * 0.5, y: y - (fy / f) * 0.5 };
        } else if (kind === 'kickoff') {
          const [fu, fv] = FORM[S.depth.flex][e.slot] || [0.3, 0.5];
          spot = { x: this.X(S.i, Math.min(fu, 0.45)), y: fv * W };
        } else if (e.slot === 'GK') {
          spot = { x: this.ownX(S.i) + (this.ownX(S.i) === 0 ? 0.5 : -0.5), y: W / 2 };
        } else if (kind === 'corner') {
          spot = this.cornerSpot(e, att);
        } else {
          spot = this.shapeSpot(e, att);
        }
        if (e !== taker) spot = this.keepAway(e, spot, att);
        e.setSpot = spot;
        e.tx = spot.x; e.ty = spot.y; e.tspd = 0.8;
      }
    }
    b.x = x; b.y = y;
  }
  cornerSpot(e, att) {
    const { side } = this.set;
    const gx = this.goalX(side), inward = gx === L ? -1 : 1;
    const mates = this.live(this.sides[att ? side : 1 - side]).filter((m) => m.slot !== 'GK' && m !== this.set.taker);
    if (att) {
      // the tallest and the forwards attack the box; the rest stay back
      const order = mates.slice().sort((a, b) => (b.role === 'FWD') - (a.role === 'FWD') || b.headZ - a.headZ);
      const k = order.indexOf(e);
      const spots = [[3.5, -3], [6.5, 0], [4.5, 3.5], [11, 1]];
      if (k < spots.length && k < mates.length - 1) return { x: gx + inward * spots[k][0], y: W / 2 + spots[k][1] * (this.set.y < W / 2 ? 1 : -1) };
      return { x: this.X(side, 0.45), y: W / 2 + (k % 2 ? 6 : -6) };
    }
    // defenders: mark the attackers in the box, goal-side
    const own = gx;
    if (e.mark && inBox(e.mark.setSpot?.x ?? e.mark.x, e.mark.setSpot?.y ?? e.mark.y, own)) {
      const m = e.mark.setSpot || e.mark;
      return { x: m.x + inward * -0.8 * -1 + (own === L ? 0.8 : -0.8), y: m.y };
    }
    const k = mates.indexOf(e);
    const zone = [[1.5, this.set.y < W / 2 ? -2.5 : 2.5], [5.5, 0], [4, -2], [4, 2], [9, 0], [12, 4]][k % 6];
    return { x: own + inward * zone[0], y: W / 2 + zone[1] };
  }
  // Opponents stand back from the ball (and out of the box for goal kicks and penalties).
  keepAway(e, spot, att) {
    const { kind, x, y, side } = this.set;
    let p = { ...spot };
    if (kind === 'penalty') {
      const gx = this.goalX(side), inward = gx === L ? -1 : 1;
      if (e.slot !== 'GK') p = { x: gx + inward * (BOX_D + 1.5 + (e.idx % 3)), y: W / 2 + ((e.idx % 7) - 3) * 3 };
      return p;
    }
    if (att) return p;
    const need = kind === 'throwIn' ? 2 : kind === 'kickoff' ? CIRCLE_R + 0.5 : 5;
    const d = hyp(p.x - x, p.y - y);
    if (d < need) { const k = need / (d || 1); p = { x: x + (p.x - x) * k || x + need, y: y + (p.y - y) * k }; }
    if (kind === 'goalKick') {
      const own = this.ownX(side);
      if (inBox(p.x, p.y, own)) p.x = own + (own === 0 ? BOX_D + 1 : -(BOX_D + 1));
    }
    if (kind === 'kickoff') {
      const half = L / 2;
      if (this.ownX(e.side) === 0) p.x = Math.min(p.x, half - 0.5); else p.x = Math.max(p.x, half + 0.5);
    }
    p.x = clamp(p.x, 0.5, L - 0.5); p.y = clamp(p.y, 0.5, W - 0.5);
    return p;
  }
  // Teleport everyone to their restart spots (kickoffs after a goal and at the half).
  snapToSet() {
    for (const e of this.ents) {
      if (e.sentOff || !e.setSpot) continue;
      e.x = e.setSpot.x; e.y = e.setSpot.y; e.vx = e.vy = 0;
    }
    const t = this.set.taker;
    t.x = this.ball.x - (this.goalX(t.side) > this.ball.x ? 0.5 : -0.5); t.y = this.ball.y;
  }

  setTick() {
    const s = this.set, b = this.ball;
    if (s.kind === 'corner') { if (this.t >= (s.markT || 0)) { s.markT = this.t + 0.5; this.assignMarks(this.sides[1 - s.side]); this.setTargets(); } }
    const tk = s.taker;
    tk.tx = tk.setSpot.x; tk.ty = tk.setSpot.y; tk.tspd = 0.9;
    const near = hyp(tk.x - tk.setSpot.x, tk.y - tk.setSpot.y) < 0.6;
    if (near && this.t >= s.readyAt) {
      // take it
      this.phase = 'play';
      const hands = s.kind === 'throwIn';
      b.owner = tk; b.inHands = hands; b.lastTouch = tk; b.touchT = this.t;
      if (hands) { b.x = tk.x; b.y = tk.y; }
      tk.restricted = s.kind === 'goalKick' ? 'goalKick' : s.kind === 'kickoff' ? 'kickoff' : s.kind;
      tk.nextDecide = this.t; tk.holdUntil = 0;
      if (s.kind === 'goalKick') { tk.restricted = null; b.inHands = true; tk.holdUntil = this.t; }
      this.set = null;
      this.decide(tk);
      if (s.kind === 'kickoff' && b.owner === tk) {
        // kickoffs always go to a teammate
        tk.restricted = null;
      }
    }
  }
}

// Ball positions along a planned kick every 0.15 s (ground: rolling friction in closed form;
// air: ballistic, ignoring drag). Written into PX/PY/PZ/PT; returns the number of samples.
const PX = new Float64Array(32), PY = new Float64Array(32), PZ = new Float64Array(32), PT = new Float64Array(32);
function pathSamples(e, plan, z0, until) {
  const v = hyp(plan.vx, plan.vy) || 1e-6, ux = plan.vx / v, uy = plan.vy / v;
  const n = Math.min(32, Math.ceil(until / 0.15));
  const air = plan.vz > 0;
  const k = BALL.mu / BALL.c, c = BALL.c, stop = v / c - k * Math.log((v + k) / k) / c;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) * 0.15;
    let s, z = 0;
    if (air) { s = v * t; z = Math.max(0, z0 + plan.vz * t - 4.905 * t * t); }
    else s = Math.min(stop, ((v + k) * (1 - Math.exp(-c * t))) / c - k * t);
    PX[i] = e.x + ux * s; PY[i] = e.y + uy * s; PZ[i] = z; PT[i] = t;
  }
  return n;
}
// Distance from point (px, py) to segment (ax, ay)-(bx, by).
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const k = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return hyp(px - (ax + dx * k), py - (ay + dy * k));
}
// Closest approach of the ball's step a->b (3D) to a player standing at (px, py): { d (horizontal), z }.
function segClosest(px, py, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const k = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 1;
  return { d: hyp(px - (ax + dx * k), py - (ay + dy * k)), z: az + (bz - az) * k };
}
