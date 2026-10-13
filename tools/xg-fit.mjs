// Fit the xG model to the sim: play N matches, log every open-play shot with its features
// (distance, goal angle, header, pressure) and whether it went in, then fit a logistic
// regression. Paste the coefficients into MatchSim.xg(). Run: node tools/xg-fit.mjs [matches]
import { Match } from '../js/match.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 60);
const shots = [];
for (let g = 0; g < N; g++) {
  const m = new Match(TEAMS[g % 8], TEAMS[(g + 1 + (g >> 3)) % 8 === g % 8 ? (g + 2) % 8 : (g + 1 + (g >> 3)) % 8], 5000 + g, { frames: false });
  const emit = m.sim.emit;
  let cur = null;
  m.sim.emit = (type, d) => {
    if (type === 'shot' && !d.penalty) { cur = { d: d.d, ang: d.ang, head: d.header ? 1 : 0, press: d.press || 0, fk: d.freeKick ? 1 : 0, xg: d.xg, goal: 0 }; shots.push(cur); }
    if (type === 'shotEnd' && cur && d.result === 'goal') cur.goal = 1;
    emit(type, d);
  };
  m.playToEnd();
}
const feats = (s) => [1, s.d, s.ang, s.head, s.press];
const sig = (x) => 1 / (1 + Math.exp(-x));
let w = [0, 0, 0, 0, 0];
for (let it = 0; it < 4000; it++) {
  const gr = w.map(() => 0);
  for (const s of shots) { const f = feats(s); const e = sig(f.reduce((a, v, i) => a + v * w[i], 0)) - s.goal; f.forEach((v, i) => { gr[i] += e * v; }); }
  w = w.map((v, i) => v - (0.5 * gr[i]) / shots.length * (i === 1 ? 0.02 : 1));
}
console.log(`${shots.length} shots, ${shots.filter((s) => s.goal).length} goals (${(100 * shots.filter((s) => s.goal).length / shots.length).toFixed(1)}%)`);
console.log(`fit: logit = ${w[0].toFixed(3)} + ${w[1].toFixed(4)}·d + ${w[2].toFixed(3)}·angle + ${w[3].toFixed(3)}·header + ${w[4].toFixed(3)}·pressure`);
const buckets = [[0, 6], [6, 9], [9, 12], [12, 15], [15, 20], [20, 99]];
for (const [a, b] of buckets) {
  const sel = shots.filter((s) => s.d >= a && s.d < b);
  if (!sel.length) continue;
  const fitXg = sel.reduce((t, s) => t + sig(feats(s).reduce((x, v, i) => x + v * w[i], 0)), 0) / sel.length;
  const oldXg = sel.reduce((t, s) => t + s.xg, 0) / sel.length;
  console.log(`  ${a}-${b} m: n ${sel.length}  actual ${(100 * sel.filter((s) => s.goal).length / sel.length).toFixed(1)}%  fitted ${(100 * fitXg).toFixed(1)}%  current model ${(100 * oldXg).toFixed(1)}%`);
}
