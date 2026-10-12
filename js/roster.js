// Roster rules: 7 starters (GK, 2 DEF, 2 MID, FWD, FLEX) + 6 subs on the bench.
import { POKEMON } from './data/pokemon.js';

export const STARTERS = [
  { key: 'GK', label: 'GK', unit: 'S', pos: ['GK'] },
  { key: 'DEF1', label: 'DEF', unit: 'S', pos: ['DEF'] },
  { key: 'DEF2', label: 'DEF', unit: 'S', pos: ['DEF'] },
  { key: 'MID1', label: 'MID', unit: 'S', pos: ['MID'] },
  { key: 'MID2', label: 'MID', unit: 'S', pos: ['MID'] },
  { key: 'FWD', label: 'FWD', unit: 'S', pos: ['FWD'] },
  { key: 'FLEX', label: 'FLEX', unit: 'S', pos: ['DEF', 'MID', 'FWD'] },
];
// One backup per position, plus two more outfield subs.
export const BENCH = [
  ...['GK', 'DEF', 'MID', 'FWD'].map((p) => ({ key: `b${p}`, label: p, unit: 'B', pos: [p] })),
  { key: 'SUB1', label: 'SUB', unit: 'B', pos: ['DEF', 'MID', 'FWD'] },
  { key: 'SUB2', label: 'SUB', unit: 'B', pos: ['DEF', 'MID', 'FWD'] },
];
export const ALL_SLOTS = [...STARTERS, ...BENCH];
export const SLOT = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, s]));

// The FLEX sets the formation (back line - midfield - attack, keeper not counted).
export const FORMATIONS = {
  DEF: { name: '3-2-1', desc: 'Three at the back: solid, hard to break down, one striker up top' },
  MID: { name: '2-3-1', desc: 'Three in midfield: control the ball and the middle of the pitch' },
  FWD: { name: '2-2-2', desc: 'Two strikers: more bodies in the box, fewer behind the ball' },
};

// Roster values are "slug" or "slug:POS" (multi-position slots need the position).
export function parseCard(value, slotKey) {
  if (!value) return null;
  const [mon, p] = String(value).split(':');
  const slot = SLOT[slotKey];
  const pos = p || slot.pos[0];
  return { mon, pos };
}
export const cardValue = (mon, pos, slotKey) => (SLOT[slotKey].pos.length > 1 ? `${mon}:${pos}` : mon);

export const flexOf = (roster) => parseCard(roster.FLEX, 'FLEX')?.pos || 'MID';
export const formationOf = (roster) => FORMATIONS[flexOf(roster)];

export function validateRoster(roster) {
  const errors = [];
  const seen = new Map();
  for (const s of ALL_SLOTS) {
    const c = parseCard(roster[s.key], s.key);
    if (!c) { errors.push(`${s.unit === 'B' && s.label !== 'SUB' ? 'Backup ' : ''}${s.label} is empty`); continue; }
    if (!POKEMON[c.mon]) { errors.push(`Unknown Pokémon "${c.mon}"`); continue; }
    if (!s.pos.includes(c.pos)) errors.push(`${POKEMON[c.mon].name} can't be a ${c.pos} in the ${s.label} slot`);
    if (seen.has(c.mon)) errors.push(`${POKEMON[c.mon].name} is on the roster twice`);
    seen.set(c.mon, s.key);
  }
  return errors;
}
