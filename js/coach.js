// In-game coaching. Each coach starts from their tendencies (js/data/coaches.js) and adjusts:
//   - to the score and the clock: chasing a game late means pressing, tempo, directness and
//     pushing up; protecting a lead late means dropping off and slowing it down;
//   - to what's working: long balls vs short passing, crosses, long shots, and how the
//     opponent is hurting them.
// The sim reads the effective values (plus `mentality`, -1 sit deep .. +1 all-out attack).
import { COACH_KEYS } from './data/coaches.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WINDOW = 360; // seconds of play the "what's working" memory covers

export class Coach {
  constructor(base) {
    this.base = { ...base };
    this.learned = Object.fromEntries(COACH_KEYS.map((k) => [k, 0]));
    this.eff = { ...base, mentality: 0 };
    this.mood = 'normal'; // normal | chasing | protecting
    this.log = []; // pass/shot history for learning: { t, kind, ok, shotSoon }
  }

  // A pass by this team, and whether it reached a teammate. Shots soon after a completed
  // pass credit that kind of pass.
  notePass(t, kind, ok) { this.log.push({ t, kind, ok, shot: false }); }
  noteShot(t, d) {
    for (let i = this.log.length - 1; i >= 0 && t - this.log[i].t < 6; i--) if (this.log[i].ok) { this.log[i].shot = true; break; }
    this.log.push({ t, kind: d > 15 ? 'longShot' : 'shot', ok: true });
  }
  noteGoal(t, d) { this.log.push({ t, kind: d > 15 ? 'longGoal' : 'goal', ok: true }); }

  // elapsed: seconds since kickoff; diff: our goals minus theirs. Returns a message when the
  // approach changes in a way worth telling the viewer.
  update(elapsed, diff, opp) {
    const left = Math.max(0, 1200 - elapsed);
    const late = clamp(1 - left / 600, 0, 1); // 0 with 10 minutes left -> 1 at full time
    const L = this.learn(elapsed, opp);
    const e = {};
    for (const k of COACH_KEYS) e[k] = this.base[k] + this.learned[k];
    let mentality = 0, mood = 'normal';
    if (diff < 0 && late > 0) {
      const c = late * (diff <= -2 ? 1.2 : 1);
      mood = c > 0.25 ? 'chasing' : mood;
      e.press += 0.35 * c; e.tempo += 0.3 * c; e.directness += 0.3 * c; e.shootRange += 0.25 * c; e.width += 0.1 * c; e.aggression += 0.15 * c;
      mentality = 0.7 * c;
    } else if (diff > 0 && late > 0) {
      const c = late * (diff === 1 ? 1 : 0.6);
      mood = c > 0.25 ? 'protecting' : mood;
      e.press -= 0.3 * c; e.tempo -= 0.3 * c; e.directness += 0.15 * c; e.shootRange -= 0.1 * c;
      mentality = -0.7 * c;
    }
    for (const k of COACH_KEYS) e[k] = clamp(e[k], 0, 1);
    e.mentality = mentality;
    this.eff = { ...this.base, ...e };
    let msg = null;
    if (mood !== this.mood) {
      if (mood === 'chasing') msg = 'push everyone forward, chasing the game';
      else if (mood === 'protecting') msg = 'drop deeper to protect the lead';
      this.mood = mood;
    }
    return msg || L;
  }

  // Nudge directness / width / shooting range toward what has produced shots lately.
  learn(now, opp) {
    this.log = this.log.filter((x) => now - x.t < WINDOW);
    const of = (kinds) => this.log.filter((x) => kinds.includes(x.kind));
    const rate = (list) => (list.length ? list.filter((x) => x.shot).length / list.length : 0);
    const ground = of(['ground']), long = of(['through', 'lofted']), cross = of(['cross']);
    let msg = null;
    const nudge = (k, by, text) => {
      const v = clamp(this.learned[k] + by, -0.25, 0.25);
      if (Math.abs(v - this.learned[k]) > 1e-9) {
        // tell the viewer once, when the adjustment first becomes a real change of approach
        if (text && Math.abs(v) >= 0.2 && Math.abs(this.learned[k]) < 0.2 && Math.sign(v) === Math.sign(by)) msg = text;
        this.learned[k] = v;
      }
    };
    if (long.length >= 6 && ground.length >= 15) {
      const r = (rate(long) + 0.01) / (rate(ground) + 0.01);
      if (r > 1.4) nudge('directness', 0.05, 'go more direct: the balls in behind are working');
      else if (r < 0.7) nudge('directness', -0.05, 'keep it on the ground: the long balls aren\'t coming off');
    }
    if (cross.length >= 4) {
      const r = rate(cross);
      if (r > 0.35) nudge('width', 0.05, 'get it wide: the crosses are causing problems');
      else if (r < 0.1) nudge('width', -0.05);
    }
    const ls = of(['longShot']), lg = of(['longGoal']);
    if (ls.length >= 5 && !lg.length) nudge('shootRange', -0.05, 'stop shooting from distance and work it closer');
    if (lg.length) nudge('shootRange', 0.05);
    // being cut open by balls in behind: drop the press a little
    if (opp) {
      const theirLong = opp.log.filter((x) => (x.kind === 'through' || x.kind === 'lofted'));
      if (theirLong.length >= 6 && rate(theirLong) > 0.3) nudge('press', -0.05, 'drop off: the press is being played through');
    }
    return msg;
  }
}
