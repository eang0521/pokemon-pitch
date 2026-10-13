// Headless batch simulation for tuning realism. Run: node tools/sim-test.mjs [matches] [sample]
// Prints league-wide averages; with a second argument, the play-by-play of match #sample.
import { Match } from '../js/match.js';
import { TEAMS } from '../js/data/teams.js';

const N = Number(process.argv[2] || 40);
const SAMPLE = process.argv[3] != null ? Number(process.argv[3]) : null;
const sum = {};
const add = (k, v) => { sum[k] = (sum[k] || 0) + v; };
const res = [0, 0, 0];
let maxGoals = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const h = TEAMS[g % TEAMS.length], a = TEAMS[(g + 1 + Math.floor(g / TEAMS.length)) % TEAMS.length];
  const m = new Match(h, a === h ? TEAMS[(g + 2) % TEAMS.length] : a, 1000 + g, { frames: false });
  const emit = m.sim.emit;
  m.sim.emit = (type, d) => {
    if (type === 'passEnd') {
      const k = d.pass.kind;
      const how = d.complete ? 'ok' : !d.by ? 'out' : d.by.side === d.pass.by.side ? 'miscontrol' : 'lost';
      add(`pass:${k}:${how}`, 1); add(`pass:${k}`, 1);
      if (how === 'lost') { const dt = m.sim.t - d.pass.t; add(`lostAt:${dt < 0.2 ? 'a<0.2s' : dt < 0.6 ? 'b<0.6s' : dt < 1.2 ? 'c<1.2s' : 'd>1.2s'}`, 1); add(`lostBy:${d.by.slot === 'GK' ? 'GK' : m.sim.chaser?.[d.by.side] === d.by ? 'chaser' : 'other'}`, 1); }
      if (d.pass.p != null) { const bk = Math.min(9, Math.floor(d.pass.p * 10)); add(`cal:${bk}`, 1); add(`cal:${bk}:${how}`, 1); add(`cal:${bk}:lane`, d.pass.pLane); add(`cal:${bk}:recv`, d.pass.pRecv); }
    }
    if (type === 'shot' && !d.penalty && !d.header && d.by.gainT != null) {
      const held = m.sim.t - d.by.gainT, carried = Math.hypot(d.by.x - d.by.gainX, d.by.y - d.by.gainY);
      const k = held < 0.6 ? 'firstTime' : carried < 4 ? 'settled' : carried < 12 ? 'carry4-12' : 'carry12+';
      add(`pre:${k}`, 1); add(`pre:${k}:press`, d.press || 0); add(`pre:${k}:d`, d.d);
    }
    if (type === 'shot') { const b = d.penalty ? 'pen' : d.header ? 'head' : d.d < 8 ? '<8' : d.d < 13 ? '8-13' : d.d < 18 ? '13-18' : '18+'; add(`shot:${b}`, 1); m._b = b; }
    if (type === 'shotEnd') add(`shot:${m._b}:${d.result}`, 1);
    emit(type, d);
  };
  const hs = m.handleStop.bind(m);
  m.handleStop = (stop, rec) => {
    if (stop.kind === 'goal') add(`goalKind:${stop.by && stop.by.side === stop.side ? (m.sim.ball.kick?.kind || '?') : 'own goal'}`, 1);
    hs(stop, rec);
  };
  m.playToEnd();
  const [x, y] = m.score;
  res[x > y ? 0 : x === y ? 1 : 2]++;
  maxGoals = Math.max(maxGoals, x + y);
  const T = m.stats.teams;
  for (const k of Object.keys(T[0])) add(k, T[0][k] + T[1][k]);
  const pos = T[0].possession / (T[0].possession + T[1].possession);
  add('possSpread', Math.abs(pos - 0.5) * 2 * 100);
  add('saveable', T[0].sot + T[1].sot - T[0].goals - T[1].goals + T[0].penGoals + T[1].penGoals);
  if (g === SAMPLE) {
    console.log(`Sample: ${m.scoreText()}`);
    for (const l of m.log) if (!l.minor) console.log(`  ${l.half}H ${fmt(l.clock)} ${l.text}`);
  }
}
function fmt(s) { s = Math.floor(s); return `${String(Math.floor(s / 60)).padStart(2, ' ')}:${String(s % 60).padStart(2, '0')}`; }
const per = (k) => (sum[k] / N).toFixed(1);
const pct = (a, b) => `${((100 * (sum[a] || 0)) / (sum[b] || 1)).toFixed(0)}%`;
console.log(`\n${N} matches in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Goals/match ${per('goals')} (max ${maxGoals})  xG/match ${per('xg')}  home/draw/away ${res.map((r) => `${((100 * r) / N).toFixed(0)}%`).join(' / ')}`);
console.log(`Shots/match ${per('shots')}  on target ${per('sot')} (${pct('sot', 'shots')})  blocked ${per('blocked')}  woodwork ${per('woodwork')}  conversion ${pct('goals', 'shots')}`);
console.log(`Saves/match ${per('saves')}  save % ${(100 * sum.saves / (sum.sot - sum.penGoals > 0 ? sum.sot : 1)).toFixed(1)}%`);
console.log(`Passes/match ${per('passes')}  completion ${pct('cmp', 'passes')}  interceptions ${per('ints')}`);
console.log(`Tackles/match ${per('tackles')} (won ${pct('tacklesWon', 'tackles')})  fouls ${per('fouls')}  yellow ${per('yellow')}  red ${per('red')}`);
console.log(`Penalties/match ${per('penalties')} (scored ${pct('penGoals', 'penalties')})  free kicks ${per('freeKicks')}  corners ${per('corners')}  throw-ins ${per('throwIns')}  goal kicks ${per('goalKicks')}`);
console.log(`Possession: average spread from 50/50 ${(sum.possSpread / N).toFixed(1)} pts`);

const kinds = ['ground', 'through', 'lofted', 'cross', 'header'];
const NL = '\n   ';
console.log('Passes by kind (per match):' + NL + kinds.filter((k) => sum[`pass:${k}`]).map((k) => `${k} ${per(`pass:${k}`)} [ok ${pct(`pass:${k}:ok`, `pass:${k}`)} lost ${pct(`pass:${k}:lost`, `pass:${k}`)} miscontrol ${pct(`pass:${k}:miscontrol`, `pass:${k}`)} out ${pct(`pass:${k}:out`, `pass:${k}`)}]`).join(NL));
console.log('Shots by distance (per match):' + NL + ['<8', '8-13', '13-18', '18+', 'head', 'pen'].map((b) => `${b} ${per(`shot:${b}`)} (goal ${pct(`shot:${b}:goal`, `shot:${b}`)}, saved ${pct(`shot:${b}:saved`, `shot:${b}`)}, blocked ${pct(`shot:${b}:blocked`, `shot:${b}`)})`).join(NL));
console.log('Pass calibration (estimated p -> actual):' + NL + [...Array(10).keys()].filter((b) => sum[`cal:${b}`]).map((b) => `p ${b / 10}-${(b + 1) / 10}: n ${per(`cal:${b}`)} ok ${pct(`cal:${b}:ok`, `cal:${b}`)} lost ${pct(`cal:${b}:lost`, `cal:${b}`)} (lane est ${(sum[`cal:${b}:lane`] / sum[`cal:${b}`]).toFixed(2)} recv est ${(sum[`cal:${b}:recv`] / sum[`cal:${b}`]).toFixed(2)})`).join(NL));
console.log('Lost passes, time after the kick: ' + Object.keys(sum).filter((k) => k.startsWith('lostAt:')).sort().map((k) => `${k.slice(8)} ${per(k)}`).join('  ') + '   by: ' + Object.keys(sum).filter((k) => k.startsWith('lostBy:')).map((k) => `${k.slice(7)} ${per(k)}`).join('  '));
console.log('Goals by last kick: ' + Object.keys(sum).filter((k) => k.startsWith('goalKind:')).map((k) => `${k.slice(9)} ${per(k)}`).join('  '));
console.log('Before open-play shots: ' + ['firstTime', 'settled', 'carry4-12', 'carry12+'].map((k) => `${k} ${per(`pre:${k}`)} (press ${(sum[`pre:${k}:press`] / sum[`pre:${k}`]).toFixed(2)}, ${(sum[`pre:${k}:d`] / sum[`pre:${k}`]).toFixed(1)} m)`).join('  '));
