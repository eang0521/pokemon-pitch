// Card rating distributions by position: spread, top cards, and which base stat
// drives OVR most (so no single stat dominates). Run: node tools/ratings-report.mjs [top]
import { POKEMON_LIST } from '../js/data/pokemon.js';
import { POSITIONS, STAT_KEYS, cardRatings, overall, OVR_WEIGHTS, traitStat, bestPosition } from '../js/ratings.js';

const TOP = Number(process.argv[2] || 8);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
for (const pos of POSITIONS) {
  const cards = POKEMON_LIST.map((p) => ({ p, ovr: overall(pos, cardRatings(p.slug, pos)) })).sort((a, b) => b.ovr - a.ovr);
  const o = cards.map((c) => c.ovr).sort((a, b) => a - b);
  console.log(`\n${pos}  min ${o[0]}  p10 ${pct(o, 0.1)}  p50 ${pct(o, 0.5)}  p90 ${pct(o, 0.9)}  max ${o[o.length - 1]}`);
  const w = {};
  for (const [t, v] of Object.entries(OVR_WEIGHTS[pos])) { const s = traitStat(pos, t); w[s] = (w[s] || 0) + v; }
  console.log('  stat weight:', Object.entries(w).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join('  '));
  console.log('  corr(OVR, stat):', [...STAT_KEYS, 'height', 'weight'].map((k) => `${k} ${corr(cards.map((c) => c.ovr), cards.map((c) => c.p.stats[k] ?? c.p[k])).toFixed(2)}`).join('  '));
  console.log('  top:', cards.slice(0, TOP).map((c) => `${c.p.name} ${c.ovr}`).join(', '));
}
const best = {}; for (const p of POKEMON_LIST) { const b = bestPosition(p.slug); best[b] = (best[b] || 0) + 1; }
console.log('\nBest position share:', best);
