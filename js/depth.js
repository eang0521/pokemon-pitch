// One team in a match: its 13 cards, who is on the pitch in which slot, energy, and coach.
import { buildCard } from './ratings.js';
import { STARTERS, BENCH, parseCard, flexOf } from './roster.js';
import { COACH_PRESETS } from './data/coaches.js';

export class TeamDepth {
  constructor(team, registry) {
    this.team = team;
    this.cards = {};
    for (const s of [...STARTERS, ...BENCH]) {
      const c = parseCard(team.roster[s.key], s.key);
      const card = buildCard(c.mon, c.pos, { id: `${team.id}-${s.key}`, teamId: team.id, slot: s.key });
      this.cards[s.key] = card;
      registry[card.id] = card;
    }
    this.flex = flexOf(team.roster);
    this.coach = { ...COACH_PRESETS.balanced, ...(team.coach || {}) };
    // slot on the pitch -> card (subs take over a slot)
    this.onField = Object.fromEntries(STARTERS.map((s) => [s.key, this.cards[s.key]]));
    this.bench = BENCH.map((s) => this.cards[s.key]);
    this.energy = Object.fromEntries(Object.values(this.cards).map((c) => [c.id, 100]));
    this.sentOff = new Set();
  }
  all() { return Object.values(this.cards); }
}
