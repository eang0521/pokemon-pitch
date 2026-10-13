// Type synergies. Count each type among the 7 players a team has on the pitch (dual types
// count for both). At 2 / 4 / 6 the synergy reaches tier I / II / III, and every Pokémon of
// that type on the pitch gets the effect. Substitutions and red cards can switch them on or off.
//
// Magnitudes live in SYNERGY_VALUES (one number per tier) so balance can be re-tuned from
// simulation (tools/synergy-calibrate.mjs) without touching logic.

export const TIER_COUNTS = [2, 4, 6];

export const SYNERGIES = {
  normal: { name: 'Normal', kind: 'adapt', title: 'Adaptable', desc: 'No weak spots: each Pokémon\'s below-average base stats are pulled up toward its own average.' },
  fighting: { name: 'Fighting', kind: 'stat', stat: 'atk', title: 'Brawler', desc: 'Boosts Attack: tackling, shot power and distribution, by position.' },
  steel: { name: 'Steel', kind: 'stat', stat: 'def', title: 'Iron', desc: 'Boosts Defense: strength, ball retention, hold-up play and handling, by position.' },
  psychic: { name: 'Psychic', kind: 'stat', stat: 'spa', title: 'Vision', desc: 'Boosts Sp. Atk: passing vision, finishing and keeper positioning, by position.' },
  fairy: { name: 'Fairy', kind: 'stat', stat: 'spd', title: 'Grace', desc: 'Boosts Sp. Def: first touch, awareness, movement and composure, by position.' },
  electric: { name: 'Electric', kind: 'stat', stat: 'spe', title: 'Charge', desc: 'Boosts Speed: pace (and a keeper\'s reflexes).' },
  dragon: { name: 'Dragon', kind: 'mech', key: 'clutch', title: 'Outrage', desc: 'Clutch: every rating rises in the last five minutes of a close match, and in penalty shootouts.' },
  fire: { name: 'Fire', kind: 'mech', key: 'burst', title: 'Burst', desc: 'Faster acceleration: explosive first steps, runs in behind and recovery sprints.' },
  water: { name: 'Water', kind: 'mech', key: 'flow', title: 'Flow', desc: 'Flowing dribbles: keep their speed through cuts and turns, with or without the ball.' },
  grass: { name: 'Grass', kind: 'mech', key: 'growth', key2: 'regen', title: 'Photosynthesis', desc: 'Grows into the match: a ratings boost that builds to full time, plus slower tiring.' },
  ice: { name: 'Ice', kind: 'mech', key: 'chill', title: 'Chill', desc: 'Opponents they tackle or barge into are briefly slowed.' },
  poison: { name: 'Poison', kind: 'mech', key: 'toxic', title: 'Toxic', desc: 'Opponents they tackle or barge into lose extra energy.' },
  ground: { name: 'Ground', kind: 'mech', key: 'grounded', title: 'Grounded', desc: 'Win more ground duels: better tackling, and harder to tackle.' },
  flying: { name: 'Flying', kind: 'mech', key: 'reach', title: 'Reach', desc: 'Aerial reach: win more headers, and keepers reach higher.' },
  bug: { name: 'Bug', kind: 'mech', key: 'swarm', title: 'Swarm', desc: 'Press in numbers: stronger tackles for each teammate close by.' },
  rock: { name: 'Rock', kind: 'mech', key: 'sturdy', title: 'Sturdy', desc: 'Not knocked off the ball: shrug off challenges and keep the ball.' },
  ghost: { name: 'Ghost', kind: 'mech', key: 'phase', title: 'Phase', desc: 'Chance that tackles on them pass straight through.' },
  dark: { name: 'Dark', kind: 'mech', key: 'misread', title: 'Feint', desc: 'Opponents react late to their passes and shots.' },
};

// Per-tier magnitudes. Stat types: fraction added to the base stat.
// Mechanics: see comments (units used by the sim).
export const SYNERGY_VALUES = {
  normal: [0.14, 0.28, 0.44], // Adaptable: fraction of the gap to the Pokémon's own average stat closed
  fighting: [0.06, 0.12, 0.19],
  steel: [0.06, 0.12, 0.19],
  psychic: [0.1, 0.2, 0.32],
  fairy: [0.055, 0.11, 0.17],
  electric: [0.07, 0.14, 0.22],
  clutch: [0.08, 0.16, 0.26], // rating multiplier bonus in clutch time
  burst: [0.017, 0.035, 0.06], // acceleration multiplier bonus
  flow: [0.03, 0.06, 0.1], // extra turning (acceleration) when changing direction
  growth: [0.015, 0.03, 0.05], // rating bonus reached by full time (0 at kickoff)
  regen: [0.08, 0.15, 0.25], // Grass: energy drain reduction
  chill: [0.8, 1.6, 2.6], // seconds an opponent is slowed after a tackle or barge
  toxic: [1.5, 3, 5], // extra energy an opponent loses per tackle or barge
  grounded: [0.04, 0.08, 0.13], // logit bonus in tackles (for and against)
  reach: [0.09, 0.18, 0.3], // metres of extra aerial reach
  swarm: [0.17, 0.35, 0.55], // logit bonus per nearby teammate in a tackle (up to 3)
  sturdy: [0.15, 0.3, 0.5], // logit bonus resisting tackles
  phase: [0.075, 0.15, 0.25], // chance a tackle on them misses
  misread: [0.045, 0.09, 0.15], // seconds of extra reaction time for opponents on their passes and shots
};

export const valueOf = (type, tier) => {
  const s = SYNERGIES[type];
  const vals = SYNERGY_VALUES[s.kind === 'mech' ? s.key : type];
  return tier > 0 ? vals[tier - 1] : 0;
};

export function tierFor(count) {
  let t = 0;
  TIER_COUNTS.forEach((n, i) => { if (count >= n) t = i + 1; });
  return t;
}

// cards: the players on the pitch. Returns { counts, active: {type: tier} }
export function teamSynergies(cards) {
  const counts = {};
  for (const c of cards) for (const t of c.types) counts[t] = (counts[t] || 0) + 1;
  const active = {};
  for (const t in counts) { const tier = tierFor(counts[t]); if (tier && SYNERGIES[t]) active[t] = tier; }
  return { counts, active };
}

// Per-player effects: { stat: {atk: .., ...} (fractions on base stats), mods: {burst, flow, ...} }
export function playerEffects(card, active) {
  const stat = {}, mods = {};
  for (const t of card.types) {
    const tier = active[t];
    if (!tier) continue;
    const s = SYNERGIES[t];
    if (s.kind === 'stat') stat[s.stat] = (stat[s.stat] || 0) + valueOf(t, tier);
    else if (s.kind === 'adapt' && card.base) {
      // lift every below-average base stat part of the way to the Pokémon's average
      const avg = Object.values(card.base).reduce((a, b) => a + b, 0) / 6;
      for (const k in card.base) {
        if (card.base[k] < avg) stat[k] = (stat[k] || 0) + (valueOf(t, tier) * (avg - card.base[k])) / card.base[k];
      }
    } else mods[s.key] = (mods[s.key] || 0) + valueOf(t, tier);
    if (s.key2) mods[s.key2] = (mods[s.key2] || 0) + SYNERGY_VALUES[s.key2][tier - 1];
  }
  return { stat, mods };
}

export const tierName = (tier) => ['', 'I', 'II', 'III'][tier] || '';
