// A full league: every regional team plays every other home and away, `rounds` times.
// Prints a standings table (3 points a win). Run: node tools/league.mjs [rounds]
import { runMatches } from './lib.mjs';
import { TEAMS } from '../js/data/teams.js';

const R = Number(process.argv[2] || 5);
const jobs = [];
for (let r = 0; r < R; r++) for (const h of TEAMS) for (const a of TEAMS) if (h !== a) jobs.push({ home: h, away: a, seed: 20000 + jobs.length });
const t0 = Date.now();
const res = await runMatches(jobs);
const tab = Object.fromEntries(TEAMS.map((t) => [t.id, { t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, sf: 0, sa: 0, xf: 0, xa: 0 }]));
res.forEach((r, i) => {
  const { home, away } = jobs[i], H = tab[home.id], A = tab[away.id], [x, y] = r.score;
  H.p++; A.p++; H.gf += x; H.ga += y; A.gf += y; A.ga += x;
  const [th, ta] = r.teams;
  H.sf += th.shots; H.sa += ta.shots; A.sf += ta.shots; A.sa += th.shots; H.xf += th.xg; H.xa += ta.xg; A.xf += ta.xg; A.xa += th.xg;
  if (x > y) { H.w++; A.l++; H.pts += 3; } else if (x < y) { A.w++; H.l++; A.pts += 3; } else { H.d++; A.d++; H.pts++; A.pts++; }
});
console.log(`${jobs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)}s\n   Team                 P   W   D   L   GF   GA  Pts   shots/match  xG/match  (style)`);
Object.values(tab).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga)).forEach((x, i) => {
  console.log(`${String(i + 1).padStart(2)} ${`${x.t.city} ${x.t.name}`.padEnd(20)} ${[x.p, x.w, x.d, x.l, x.gf, x.ga, x.pts].map((v) => String(v).padStart(4)).join('')}   ${(x.sf / x.p).toFixed(1)}-${(x.sa / x.p).toFixed(1)}    ${(x.xf / x.p).toFixed(1)}-${(x.xa / x.p).toFixed(1)}  (${x.t.coach.style})`);
});
