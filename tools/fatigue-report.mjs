// Energy and substitutions: where players end up by position and stamina, and how often
// coaches change things. Run: node tools/fatigue-report.mjs [matches]
import { Match } from '../js/match.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 12);
const byPos = {}, byStm = {};
let subs = 0, injuries = 0, tiredSubs = 0, coachMsgs = 0, halfE = [];
for (let g = 0; g < N; g++) {
  const m = new Match(TEAMS[g % 8], TEAMS[(g + 3) % 8], 300 + g, { frames: false });
  while (m.next()) {
    if (m.half === 2 && !halfE.done) { /* energy at the half */ }
  }
  for (const S of m.sim.sides) {
    for (const e of S.ents) {
      if (e.sentOff) continue;
      const k = e.role, s = e.r0.stm < 50 ? 'stamina <50' : e.r0.stm < 70 ? 'stamina 50-69' : 'stamina 70+';
      (byPos[k] ||= []).push(e.energy); (byStm[s] ||= []).push(e.energy);
    }
  }
  for (const l of m.log) {
    if (l.type === 'sub') { subs++; if (/tired/.test(l.text)) tiredSubs++; }
    if (l.type === 'injury') injuries++;
    if (l.type === 'coach') coachMsgs++;
  }
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0);
const min = (a) => Math.min(...a).toFixed(0);
console.log(`${N} matches. Energy of the players on the pitch at full time:`);
for (const [k, v] of Object.entries(byPos)) console.log(`  ${k.padEnd(4)} avg ${avg(v)}%  min ${min(v)}%`);
for (const [k, v] of Object.entries(byStm).sort()) console.log(`  ${k.padEnd(14)} avg ${avg(v)}%  min ${min(v)}%`);
console.log(`Subs per team per match ${(subs / N / 2).toFixed(1)} (tired ${(tiredSubs / N / 2).toFixed(1)})  injuries/match ${(injuries / N).toFixed(2)}  coach changes/match ${(coachMsgs / N).toFixed(1)}`);
