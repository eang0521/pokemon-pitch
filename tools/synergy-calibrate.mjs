// Win-rate edge of every type synergy. Each regional team plays an identical copy of itself,
// with one side given the synergy at a forced tier on four of its outfield players; the edge
// is (wins - losses) / matches for that side. Sides alternate home/away.
// Run: node tools/synergy-calibrate.mjs [matches per type] [types: all|fire,water,..] [tier]
import { runMatches } from './lib.mjs';
import { TEAMS } from '../js/data/teams.js';
import { SYNERGIES } from '../js/synergy.js';

const N = Number(process.argv[2] || 160);
const types = !process.argv[3] || process.argv[3] === 'all' ? Object.keys(SYNERGIES) : process.argv[3].split(',');
const tier = Number(process.argv[4] || 2);
const SLOTS = ['DEF1', 'MID1', 'FWD', 'FLEX'];
const jobs = [];
for (const type of ['none', ...types]) {
  for (let g = 0; g < N; g++) {
    const T = TEAMS[g % TEAMS.length];
    const copy = { ...T, id: `${T.id}-b` };
    const synSide = g % 2; // the synergy side alternates home and away
    jobs.push({ type, synSide, home: T, away: copy, seed: 9000 + g, options: { injuries: false },
      override: type === 'none' ? null : { side: synSide, type, tier, slots: SLOTS } });
  }
}
const t0 = Date.now();
const res = await runMatches(jobs, { onProgress: (d, n) => { if (d % 200 === 0) process.stdout.write(`\r${d}/${n}`); } });
console.log(`\r${jobs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)}s (tier ${tier}, ${N} per type)`);
const by = {};
res.forEach((r, i) => {
  const j = jobs[i], me = j.synSide, b = (by[j.type] ||= { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  const [x, y] = [r.score[me], r.score[1 - me]];
  if (x > y) b.w++; else if (x < y) b.l++; else b.d++;
  b.gf += x; b.ga += y;
});
const rows = Object.entries(by).map(([t, b]) => ({ t, edge: (b.w - b.l) / N, ...b }));
for (const r of rows.sort((a, b) => b.edge - a.edge)) {
  console.log(`${r.t.padEnd(9)} edge ${(r.edge * 100).toFixed(1).padStart(5)}%  W-D-L ${r.w}-${r.d}-${r.l}  goals ${(r.gf / N).toFixed(2)}-${(r.ga / N).toFixed(2)}`);
}
console.log(`(±${(100 / Math.sqrt(N)).toFixed(0)}% is about one standard error)`);
