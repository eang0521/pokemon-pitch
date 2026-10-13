// One team in a match: its 13 cards, who is on the pitch in which slot, energy, injuries,
// and the coach. Substitutions are rolling (players can come back on, as in most
// small-sided football), made at stoppages.
import { buildCard } from './ratings.js';
import { STARTERS, BENCH, parseCard, flexOf } from './roster.js';
import { COACH_PRESETS } from './data/coaches.js';
import { Coach } from './coach.js';

// Fatigue
export const FRESH = 75; // ratings start to fade below this energy
export const fatigueMult = (energy) => (energy >= FRESH ? 1 : Math.max(0.6, 1 - (FRESH - energy) * 0.006));
const SUB_GAIN = 4; // a change has to be worth this much effective OVR
const MIN_BACK = 80; // a substituted player needs this much energy to come back on
const SLOT_COOLDOWN = 90; // seconds before the same slot changes again

export class TeamDepth {
  constructor(team, registry) {
    this.team = team;
    this.cards = {};
    for (const s of [...STARTERS, ...BENCH]) {
      const c = parseCard(team.roster[s.key], s.key);
      const card = buildCard(c.mon, c.pos, { id: `${team.id}-${s.key}`, teamId: team.id, slot: s.key, bonus: team.bonus?.[s.key] });
      this.cards[s.key] = card;
      registry[card.id] = card;
    }
    this.flex = flexOf(team.roster);
    this.coachBase = { ...COACH_PRESETS.balanced, ...(team.coach || {}) };
    this.coach = new Coach(this.coachBase);
    // slot on the pitch -> card (subs take over a slot)
    this.onField = Object.fromEntries(STARTERS.map((s) => [s.key, this.cards[s.key]]));
    this.energy = Object.fromEntries(Object.values(this.cards).map((c) => [c.id, 100]));
    this.sentOff = new Set();
    this.injured = new Set();
    this.slotChanged = {};
    this.subs = 0;
  }
  all() { return Object.values(this.cards); }
  bench() {
    const on = new Set(Object.values(this.onField).map((c) => c.id));
    return this.all().filter((c) => !on.has(c.id));
  }
  value(card) { return card.ovr * fatigueMult(this.energy[card.id]) * (this.injured.has(card.id) ? 0.5 : 1); }

  // Pick substitutions at a stoppage. now: seconds since kickoff. Returns [{ slot, off, on, why }].
  plan(now, maxSubs = 2, forcedOnly = false) {
    const out = [];
    const bench = this.bench().filter((c) => !this.injured.has(c.id) && !this.sentOff.has(c.id));
    for (const [slot, cur] of Object.entries(this.onField)) {
      if (out.length >= maxSubs) break;
      if (this.sentOff.has(cur.id)) continue;
      const hurt = this.injured.has(cur.id);
      if (forcedOnly && !hurt) continue;
      if (!hurt && now - (this.slotChanged[slot] ?? -999) < SLOT_COOLDOWN) continue;
      const gk = cur.pos === 'GK';
      let best = null, bv = this.value(cur) + (hurt ? -999 : SUB_GAIN);
      for (const c of bench) {
        if ((c.pos === 'GK') !== gk || out.some((o) => o.on === c)) continue;
        if (this.energy[c.id] < MIN_BACK && !hurt) continue;
        const v = this.value(c) - (c.pos !== cur.pos ? 6 : 0);
        if (v > bv) { bv = v; best = c; }
      }
      if (best) out.push({ slot, off: cur, on: best, why: hurt ? 'injury' : this.energy[cur.id] < FRESH ? 'tired' : 'fresh legs' });
    }
    return out;
  }
  apply(sub, now) {
    this.onField[sub.slot] = sub.on;
    this.slotChanged[sub.slot] = now;
    this.subs++;
  }
}
