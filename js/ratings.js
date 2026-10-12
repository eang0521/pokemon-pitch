// Cards: every card is (Pokémon, position). A card's soccer ratings are that
// Pokémon's own six base stats, each read with a position-specific meaning.
//
// Traits a position doesn't train still come from the matching stat, at a discount
// (a defender who ends up shooting uses his Sp. Atk as Finishing at 85%).
// Mass comes from weight and aerial reach from height, the same for every position.
import { POKEMON } from './data/pokemon.js';

export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
export const OUTFIELD = ['DEF', 'MID', 'FWD'];
export const POS_NAMES = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_SHORT = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

// What each base stat means at each position -> the sim traits it drives.
//   stm stamina · pace top speed · power shot/kick power · tackle · str strength (duels, headers, shielding)
//   ret ball retention · pass passing · vision (seeing the through ball / switch) · finish shot accuracy
//   awr awareness (interceptions, marking) · touch first touch · move off-ball movement · comp composure
//   handling (GK: holding shots) · gkPos (GK: angles, reading through balls) · refl (GK: diving reach, reaction)
export const STAT_MAP = {
  GK: { hp: ['stm'], atk: ['power'], def: ['handling'], spa: ['gkPos'], spd: ['comp'], spe: ['refl'] },
  DEF: { hp: ['stm'], atk: ['tackle'], def: ['str'], spa: ['pass'], spd: ['awr'], spe: ['pace'] },
  MID: { hp: ['stm'], atk: ['power'], def: ['ret'], spa: ['pass', 'vision'], spd: ['touch', 'comp'], spe: ['pace'] },
  FWD: { hp: ['stm'], atk: ['power'], def: ['ret', 'str'], spa: ['finish'], spd: ['move', 'comp'], spe: ['pace'] },
};

// Display labels: what each stat means on this card.
export const STAT_LABELS = {
  GK: { hp: 'Stamina', atk: 'Distribution', def: 'Handling', spa: 'Positioning', spd: 'Composure', spe: 'Reflexes' },
  DEF: { hp: 'Stamina', atk: 'Tackling', def: 'Strength', spa: 'Passing', spd: 'Awareness', spe: 'Pace' },
  MID: { hp: 'Stamina', atk: 'Shot Power', def: 'Ball Retention', spa: 'Passing & Vision', spd: 'First Touch', spe: 'Pace' },
  FWD: { hp: 'Stamina', atk: 'Shot Power', def: 'Hold-up Play', spa: 'Finishing', spd: 'Movement', spe: 'Pace' },
};

// One-line explanations for the in-game stat explainer.
export const STAT_HELP = {
  GK: {
    hp: 'How long they stay sharp. Keepers barely tire, so this rarely matters.',
    atk: 'Kick and throw power: how far goal kicks, punts and throws travel, and how hard they are to read.',
    def: 'Holding on to shots. A strong handler catches what a weaker one parries back into danger.',
    spa: 'Angles and starting position, plus reading through balls early enough to come off the line.',
    spd: 'Nerve in the big moments: penalties, crosses into a crowded box, and 1-on-1s.',
    spe: 'Diving reach and reaction time: how far from their body they can get to a well-placed shot.',
  },
  DEF: {
    hp: 'How long they can keep running before their ratings start to fade.',
    atk: 'Winning the ball in a tackle (and not fouling while doing it).',
    def: 'Shielding, shoulder-to-shoulder duels and headers.',
    spa: 'Passing out from the back: accuracy and weight of build-up passes.',
    spd: 'Reading the game: interceptions, marking, and cutting passing lanes.',
    spe: 'Top speed, for recovery runs and keeping up with fast forwards.',
  },
  MID: {
    hp: 'Midfielders cover the most ground, so stamina matters more here than anywhere.',
    atk: 'How hard they hit the ball, for long-range shots and long passes.',
    def: 'Holding on to the ball under pressure: how hard they are to tackle.',
    spa: 'Pass accuracy, and the vision to see through balls and switches of play.',
    spd: 'First touch and composure: controlling hard passes and making good decisions under pressure.',
    spe: 'Top speed with and without the ball.',
  },
  FWD: {
    hp: 'How long they can keep pressing and making runs.',
    atk: 'Shot power: harder shots are tougher to save from distance.',
    def: 'Hold-up play: shielding the ball with their back to goal and winning duels and headers.',
    spa: 'Finishing: how close to the corners they can place a shot.',
    spd: 'Off-the-ball movement (finding space, timing runs) and composure in front of goal.',
    spe: 'Top speed, for running in behind and beating defenders.',
  },
};

// Default stat behind every trait (used when the card's position doesn't train it).
const GENERIC = {
  stm: 'hp', pace: 'spe', power: 'atk', tackle: 'atk', str: 'def', ret: 'def', pass: 'spa', vision: 'spa',
  finish: 'spa', awr: 'spd', touch: 'spd', move: 'spd', comp: 'spd', handling: 'def', gkPos: 'spa', refl: 'spe',
};
export const TRAITS = Object.keys(GENERIC);
const OFF_POSITION = 0.85;

// How much each trait matters for the card's overall (each row sums to 1).
export const OVR_WEIGHTS = {
  GK: { refl: 0.3, gkPos: 0.22, handling: 0.2, comp: 0.12, power: 0.06, reach: 0.06, stm: 0.04 },
  DEF: { tackle: 0.24, awr: 0.24, str: 0.18, pace: 0.16, pass: 0.1, stm: 0.08 },
  MID: { pass: 0.26, touch: 0.2, ret: 0.14, pace: 0.14, power: 0.12, stm: 0.14 },
  FWD: { finish: 0.26, pace: 0.2, power: 0.18, move: 0.16, ret: 0.12, stm: 0.08 },
};
// Plain-words names for the traits in OVR_WEIGHTS that aren't a base stat.
export const TRAIT_NAMES = {
  stm: 'Stamina', pace: 'Pace', power: 'Power', tackle: 'Tackling', str: 'Strength', ret: 'Retention', pass: 'Passing',
  vision: 'Vision', finish: 'Finishing', awr: 'Awareness', touch: 'First touch', move: 'Movement', comp: 'Composure',
  handling: 'Handling', gkPos: 'Positioning', refl: 'Reflexes', reach: 'Reach (height)', mass: 'Mass (weight)', agi: 'Agility',
};
// Which base stat drives each OVR_WEIGHTS trait at a position (for the explainer).
export const traitStat = (pos, trait) => {
  if (trait === 'reach') return 'height';
  for (const k of STAT_KEYS) if (STAT_MAP[pos][k].includes(trait)) return k;
  return GENERIC[trait];
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Base stat -> 20..99 rating. Linear through the normal range, soft-capped above 140
// so outliers (Shuckle's 230 Defense, Blissey's 255 HP) don't break the physics.
export function rate(x) {
  const v = x <= 140 ? 35 + (x - 40) * 0.55 : 90 + (x - 140) * 0.08;
  return clamp(Math.round(v), 20, 99);
}

export function massRating(kg) {
  return clamp(Math.round(20 + Math.log10(Math.max(kg, 0.5)) * 28), 20, 99);
}
// Aerial reach from height: 0.3 m -> ~30, 1.0 m -> ~55, 2.0 m -> ~76, very tall Pokémon cap out.
export function reachRating(m) {
  return clamp(Math.round(55 + Math.log2(Math.max(m, 0.1)) * 21), 20, 99);
}

// Base stats plus any flat per-card bonus, e.g. { atk: 8 }.
export function cardBase(slug, bonus = null) {
  const s = POKEMON[slug].stats;
  if (!bonus) return s;
  const out = { ...s };
  for (const k in bonus) if (k in out) out[k] = Math.min(255, out[k] + bonus[k]);
  return out;
}

// statBoost: optional { atk: 0.16, ... } fractions added to base stats (type synergies)
// bonus: optional flat base-stat bonus on this card
export function cardRatings(slug, pos, statBoost = null, bonus = null) {
  const p = POKEMON[slug];
  if (!p) throw new Error(`Unknown Pokémon: ${slug}`);
  let s = cardBase(slug, bonus);
  if (statBoost) { s = { ...s }; for (const k in statBoost) s[k] = Math.round(s[k] * (1 + statBoost[k])); }
  const map = STAT_MAP[pos];
  const trained = {};
  for (const k of STAT_KEYS) for (const trait of map[k]) trained[trait] = rate(s[k]);
  const r = {};
  for (const trait in GENERIC) {
    r[trait] = trained[trait] ?? clamp(Math.round(rate(s[GENERIC[trait]]) * OFF_POSITION), 20, 99);
  }
  r.mass = massRating(p.weight);
  r.reach = reachRating(p.height);
  // agility: quickness from Speed, lighter bodies change direction faster
  r.agi = clamp(Math.round(0.7 * rate(s.spe) + 0.3 * (110 - r.mass)), 20, 99);
  return r;
}

export function overall(pos, r) {
  const w = OVR_WEIGHTS[pos];
  let v = 0;
  for (const k in w) v += w[k] * r[k];
  return Math.round(v);
}

export function cardOverall(slug, pos, bonus = null) { return overall(pos, cardRatings(slug, pos, null, bonus)); }

// The position a Pokémon rates highest at (ties go to the earlier position).
export function bestPosition(slug, positions = POSITIONS) {
  let best = positions[0], bv = -1;
  for (const pos of positions) { const v = cardOverall(slug, pos); if (v > bv) { bv = v; best = pos; } }
  return best;
}

// A card instance on a team
export function buildCard(slug, pos, extra = {}) {
  const p = POKEMON[slug];
  const bonus = extra.bonus && Object.keys(extra.bonus).length ? extra.bonus : null;
  const ratings = cardRatings(slug, pos, null, bonus);
  const base = cardBase(slug, bonus);
  return {
    slug, pos, name: p.name, types: p.types, height: p.height, weight: p.weight, dex: p.dex,
    sprites: p.sprites, base, bst: Object.values(base).reduce((a, b) => a + b, 0), ratings, ovr: overall(pos, ratings), ...extra, bonus,
  };
}

// Type synergies live in js/synergy.js.
