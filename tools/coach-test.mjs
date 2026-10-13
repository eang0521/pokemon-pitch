// Do the coaches' in-game adjustments matter? The same fixtures and seeds are played with
// adapting coaches and with coaches frozen on their base plan. Reports, for teams trailing
// with 8 minutes left: how often they equalise or win, and their late shots; and each
// preset's record against the field. Run: node tools/coach-test.mjs [matches]
// With "presets": every coaching preset against every other, on identical rosters
// (so only the coaching differs). Run: node tools/coach-test.mjs [matches per pair] presets
import { runMatches } from './lib.mjs';
import { TEAMS } from '../js/data/teams.js';
import { COACH_PRESETS, coach } from '../js/data/coaches.js';
import { HALF_SECS } from '../js/sim/pitch.js';

const N = Number(process.argv[2] || 200);
if (process.argv[3] === 'presets') {
  const P = Object.keys(COACH_PRESETS), jobs = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (let g = 0; g < N; g++) {
    const T = TEAMS[g % TEAMS.length], flip = g % 2;
    const A = { ...T, id: `${T.id}-a`, coach: coach('A', P[flip ? j : i]) }, B = { ...T, id: `${T.id}-b`, coach: coach('B', P[flip ? i : j]) };
    jobs.push({ home: A, away: B, seed: 6000 + g, options: { injuries: false }, a: flip ? j : i, b: flip ? i : j });
  }
  const t0 = Date.now();
  const res = await runMatches(jobs);
  const pts = Object.fromEntries(P.map((p) => [p, { w: 0, d: 0, l: 0, gf: 0, ga: 0 }]));
  res.forEach((r, k) => {
    const j = jobs[k], [x, y] = r.score;
    const A = pts[P[j.a]], B = pts[P[j.b]];
    A.gf += x; A.ga += y; B.gf += y; B.ga += x;
    if (x > y) { A.w++; B.l++; } else if (x < y) { A.l++; B.w++; } else { A.d++; B.d++; }
  });
  console.log(`${jobs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)}s (identical rosters, only the coaching differs)`);
  for (const [p, x] of Object.entries(pts).sort((a, b) => (b[1].w - b[1].l) - (a[1].w - a[1].l))) {
    const n = x.w + x.d + x.l;
    console.log(`  ${COACH_PRESETS[p].style.padEnd(15)} W-D-L ${x.w}-${x.d}-${x.l}  edge ${((100 * (x.w - x.l)) / n).toFixed(1).padStart(5)}%  goals/match ${(x.gf / n).toFixed(2)}-${(x.ga / n).toFixed(2)}`);
  }
  process.exit(0);
}
const fixtures = [];
for (let g = 0; g < N; g++) {
  const h = TEAMS[g % 8], a = TEAMS[(g + 1 + (g >> 3)) % 8 === g % 8 ? (g + 2) % 8 : (g + 1 + (g >> 3)) % 8];
  fixtures.push({ home: h, away: a, seed: 4000 + g });
}
const run = (adapt) => runMatches(fixtures.map((f) => ({ ...f, options: { coachAdapt: adapt, injuries: false }, wantLog: true })));
const analyse = (res) => {
  let trailing = 0, saved = 0, lateShots = 0, leadShots = 0, msgs = 0;
  for (const r of res) {
    const at = (t) => { const sc = [0, 0]; for (const l of r.log) if (l.type === 'goal' && (l.half - 1) * HALF_SECS + l.clock <= t) sc[l.side]++; return sc; };
    const s12 = at(720);
    msgs += r.log.filter((l) => l.type === 'coach').length;
    if (s12[0] === s12[1]) continue;
    const behind = s12[0] < s12[1] ? 0 : 1;
    trailing++;
    if (r.score[behind] >= r.score[1 - behind]) saved++;
    for (const l of r.log) if (l.type === 'shot' && (l.half - 1) * HALF_SECS + l.clock > 720) { if (l.side === behind) lateShots++; else leadShots++; }
  }
  return { trailing, saved, lateShots, leadShots, msgs };
};
const t0 = Date.now();
const [on, off] = [await run(true), await run(false)];
console.log(`${N} fixtures x2 in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const [name, res] of [['adapting', on], ['frozen', off]]) {
  const a = analyse(res);
  console.log(`${name.padEnd(9)} trailing at 12:00: ${a.trailing}, drew or won ${a.saved} (${((100 * a.saved) / a.trailing).toFixed(0)}%)  last-8-min shots trailing/leading ${(a.lateShots / a.trailing).toFixed(1)}/${(a.leadShots / a.trailing).toFixed(1)}  coach notes/match ${(a.msgs / N).toFixed(1)}`);
}
// preset records (adapting)
const rec = {};
on.forEach((r, i) => {
  const f = fixtures[i];
  [[f.home, 0], [f.away, 1]].forEach(([t, s]) => {
    const k = t.coach.style, x = (rec[k] ||= { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    const [a, b] = [r.score[s], r.score[1 - s]];
    x[a > b ? 'w' : a < b ? 'l' : 'd']++; x.gf += a; x.ga += b;
  });
});
for (const [k, x] of Object.entries(rec)) console.log(`  ${k.padEnd(15)} W-D-L ${x.w}-${x.d}-${x.l}  goals ${x.gf}-${x.ga}`);
