// Provisional regional teams: each slot gets the best card from that region's Pokédex
// (BST <= 600, so no box legendaries), preferring Pokémon whose best position matches.
// Writes js/data/teams.js. Run: node tools/build-teams.mjs
import { writeFileSync } from 'node:fs';
import { POKEMON_LIST } from '../js/data/pokemon.js';
import { cardOverall, bestPosition } from '../js/ratings.js';
import { ALL_SLOTS, cardValue } from '../js/roster.js';

const REGIONS = [
  { id: 'kanto', city: 'Kanto', name: 'Kings', abbr: 'KAN', dex: [1, 151], colors: ['#c62828', '#f9c74f'], coach: ['Coach Oak', 'balanced'], flex: 'MID' },
  { id: 'johto', city: 'Johto', name: 'Jets', abbr: 'JOH', dex: [152, 251], colors: ['#1e88e5', '#cfd8dc'], coach: ['Coach Elm', 'counter'], flex: 'FWD' },
  { id: 'hoenn', city: 'Hoenn', name: 'Hurricanes', abbr: 'HOE', dex: [252, 386], colors: ['#00897b', '#1a237e'], coach: ['Coach Birch', 'wingPlay'], flex: 'MID' },
  { id: 'sinnoh', city: 'Sinnoh', name: 'Blizzard', abbr: 'SIN', dex: [387, 493], colors: ['#263238', '#81d4fa'], coach: ['Coach Rowan', 'parkBus'], flex: 'DEF' },
  { id: 'unova', city: 'Unova', name: 'Volts', abbr: 'UNO', dex: [494, 649], colors: ['#fdd835', '#212121'], coach: ['Coach Juniper', 'highPress'], flex: 'FWD' },
  { id: 'kalos', city: 'Kalos', name: 'Royals', abbr: 'KAL', dex: [650, 721], colors: ['#6a1b9a', '#f48fb1'], coach: ['Coach Sycamore', 'possession'], flex: 'MID' },
  { id: 'alola', city: 'Alola', name: 'Tides', abbr: 'ALO', dex: [722, 809], colors: ['#ef6c00', '#4dd0e1'], coach: ['Coach Kukui', 'counter'], flex: 'FWD' },
  { id: 'galar', city: 'Galar', name: 'Gales', abbr: 'GAL', dex: [810, 905], colors: ['#8e1b3a', '#ffca28'], coach: ['Coach Magnolia', 'longBall'], flex: 'DEF' },
];
const SUB_POS = { SUB1: 'MID', SUB2: 'DEF' };

const out = REGIONS.map((R) => {
  const pool = POKEMON_LIST.filter((p) => p.dex >= R.dex[0] && p.dex <= R.dex[1] && p.bst <= 600);
  const best = new Map(pool.map((p) => [p.slug, bestPosition(p.slug)]));
  const used = new Set(), roster = {};
  for (const s of ALL_SLOTS) {
    const pos = s.key === 'FLEX' ? R.flex : SUB_POS[s.key] || s.pos[0];
    const rank = (p) => cardOverall(p.slug, pos) + (best.get(p.slug) === pos ? 4 : 0);
    const pick = pool.filter((p) => !used.has(p.slug)).sort((a, b) => rank(b) - rank(a))[0];
    used.add(pick.slug);
    roster[s.key] = cardValue(pick.slug, pos, s.key);
  }
  return { id: R.id, city: R.city, name: R.name, abbr: R.abbr, colors: { primary: R.colors[0], secondary: R.colors[1] }, coach: R.coach, roster };
});

const body = out.map((t) => `  {
    id: '${t.id}', city: '${t.city}', name: '${t.name}', abbr: '${t.abbr}',
    colors: { primary: '${t.colors.primary}', secondary: '${t.colors.secondary}' },
    coach: coach('${t.coach[0]}', '${t.coach[1]}'),
    roster: ${JSON.stringify(t.roster).replace(/"([A-Z0-9a-z]+)":/g, '$1: ').replace(/"/g, "'").replace(/,/g, ', ')},
  },`).join('\n');
writeFileSync(new URL('../js/data/teams.js', import.meta.url), `// The 8 regional AI teams (13-card rosters).
// Rosters use the card format from js/roster.js: 'slug', or 'slug:POS' for FLEX / SUB slots.
// The FLEX sets the formation: DEF = 3-2-1, MID = 2-3-1, FWD = 2-2-2.
import { coach } from './coaches.js';
export { COACH_PRESETS } from './coaches.js';

export const TEAMS = [
${body}
];
`);
for (const t of out) console.log(t.abbr, Object.values(t.roster).join(' '));
