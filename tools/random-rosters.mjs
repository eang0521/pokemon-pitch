// Stress test: random 13-card rosters from the whole Pokédex (each card at its best position
// where possible), random coaches. Checks the sim never crashes or runs away, and reports
// averages plus which kinds of teams win. Run: node tools/random-rosters.mjs [matches] [seed]
import { Match } from '../js/match.js';
import { RNG } from '../js/rng.js';
import { POKEMON_LIST } from '../js/data/pokemon.js';
import { ALL_SLOTS, cardValue, validateRoster } from '../js/roster.js';
import { cardOverall } from '../js/ratings.js';
import { COACH_PRESETS, coach } from '../js/data/coaches.js';

const N = Number(process.argv[2] || 30);
const rng = new RNG(Number(process.argv[3] || 99));
const presets = Object.keys(COACH_PRESETS);

function randomTeam(i) {
  const roster = {}, used = new Set();
  for (const s of ALL_SLOTS) {
    let p; do p = rng.pick(POKEMON_LIST); while (used.has(p.slug));
    used.add(p.slug);
    roster[s.key] = cardValue(p.slug, s.pos.length > 1 ? rng.pick(s.pos) : s.pos[0], s.key);
  }
  return { id: `r${i}`, city: 'Random', name: `R${i}`, abbr: `R${i % 100}`, colors: { primary: '#888', secondary: '#fff' }, coach: coach('AI', rng.pick(presets)), roster };
}
const strength = (t) => {
  const v = ['GK', 'DEF1', 'DEF2', 'MID1', 'MID2', 'FWD', 'FLEX'].map((k) => { const [m, p] = t.roster[k].split(':'); return cardOverall(m, p || k.replace(/\d/, '')); });
  return v.reduce((a, b) => a + b) / v.length;
};
let goals = 0, shots = 0, crashes = 0, upsets = 0, decided = 0, maxG = 0, draws = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const A = randomTeam(2 * g), B = randomTeam(2 * g + 1);
  if (validateRoster(A.roster).length || validateRoster(B.roster).length) throw new Error('bad roster');
  try {
    const m = new Match(A, B, 7000 + g, { frames: false });
    let n = 0;
    while (m.next()) if (++n > 5000) throw new Error('runaway match');
    const [x, y] = m.score;
    goals += x + y; maxG = Math.max(maxG, x + y);
    shots += m.stats.teams[0].shots + m.stats.teams[1].shots;
    if (x === y) draws++;
    else { decided++; if ((x > y) !== (strength(A) > strength(B))) upsets++; }
  } catch (e) { crashes++; console.log(`match ${g} crashed: ${e.stack}`); }
}
console.log(`${N} random-roster matches in ${((Date.now() - t0) / 1000).toFixed(1)}s: crashes ${crashes}`);
console.log(`goals/match ${(goals / N).toFixed(1)} (max ${maxG})  shots/match ${(shots / N).toFixed(1)}  draws ${draws}  the weaker XI (by starter OVR) won ${upsets}/${decided}`);
