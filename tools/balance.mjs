// Balance experiments (all CPU cores).
//   node tools/balance.mjs stats [n]     +40 to one base stat for every player at one position, vs an
//                                        unmodified copy: which stats matter most where (compare OVR_WEIGHTS)
//   node tools/balance.mjs extremes [n]  extreme custom teams (speedsters, a giant keeper, heavyweights,
//                                        tiny, glass cannons...) against the regional teams
//   node tools/balance.mjs ovr [n]       does OVR predict results? one starter swapped for a random card
import { runMatches } from './lib.mjs';
import { TEAMS } from '../js/data/teams.js';
import { POKEMON_LIST, POKEMON } from '../js/data/pokemon.js';
import { ALL_SLOTS, STARTERS, parseCard, cardValue } from '../js/roster.js';
import { POSITIONS, STAT_KEYS, STAT_LABELS, OVR_WEIGHTS, traitStat, cardOverall } from '../js/ratings.js';
import { RNG } from '../js/rng.js';

const mode = process.argv[2] || 'stats';
const N = Number(process.argv[3] || 48);
const t0 = Date.now();
const se = `±${(100 / Math.sqrt(N)).toFixed(0)}% ≈ 1 s.e.`;
const edgeOf = (list) => {
  let e = 0, gd = 0;
  for (const { r, j } of list) { const s = j.xs; e += Math.sign(r.score[s] - r.score[1 - s]); gd += r.score[s] - r.score[1 - s]; }
  return { edge: (100 * e) / list.length, gd: gd / list.length };
};
const pick = (res, jobs, f) => jobs.map((j, i) => ({ j, r: res[i] })).filter(({ j }) => f(j));
// Team X (modified) vs its unmodified copy, alternating home and away.
function mirrorJobs(make, n, seed0) {
  const jobs = [];
  for (let g = 0; g < n; g++) {
    const T = TEAMS[g % TEAMS.length], flip = g % 2;
    const X = { ...make(T), id: `${T.id}-x` }, B = { ...T, id: `${T.id}-b` };
    jobs.push({ home: flip ? B : X, away: flip ? X : B, seed: seed0 + g, xs: flip ? 1 : 0, options: { injuries: false } });
  }
  return jobs;
}

if (mode === 'stats') {
  const all = [];
  // optional filter, e.g. "MID:spa,DEF:spa"
  const only = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
  for (const pos of POSITIONS) {
    for (const k of STAT_KEYS) {
      if (only && !only.has(`${pos}:${k}`)) continue;
      const make = (T) => {
        const bonus = {};
        for (const s of ALL_SLOTS) { const c = parseCard(T.roster[s.key], s.key); if (c?.pos === pos) bonus[s.key] = { [k]: 40 }; }
        return { ...T, bonus };
      };
      for (const j of mirrorJobs(make, N, 30000)) all.push({ ...j, pos, k });
    }
  }
  const res = await runMatches(all);
  console.log(`${all.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)}s. Edge from +40 to one base stat for every player at a position (${se}); (w = share of OVR):`);
  for (const pos of POSITIONS) {
    const w = {};
    for (const [t, v] of Object.entries(OVR_WEIGHTS[pos])) { const st = traitStat(pos, t); w[st] = (w[st] || 0) + v; }
    const row = STAT_KEYS.filter((k) => !only || only.has(`${pos}:${k}`)).map((k) => `${STAT_LABELS[pos][k]} ${edgeOf(pick(res, all, (j) => j.pos === pos && j.k === k)).edge.toFixed(0)}% (w${Math.round((w[k] || 0) * 100)})`);
    if (row.length) console.log(`  ${pos.padEnd(4)} ${row.join('  ')}`);
  }
}

if (mode === 'extremes') {
  // a full 13-card team: the best cards by `score` at each slot's position
  const build = (name, score, filter = () => true) => {
    const roster = {}, used = new Set();
    for (const s of ALL_SLOTS) {
      const pos = s.pos.length > 1 ? (s.key === 'FLEX' || s.key === 'SUB1' ? 'MID' : 'DEF') : s.pos[0];
      const p = POKEMON_LIST.filter((q) => !used.has(q.slug) && filter(q, pos)).sort((a, b) => score(b, pos) - score(a, pos))[0];
      used.add(p.slug);
      roster[s.key] = cardValue(p.slug, pos, s.key);
    }
    return { id: name.toLowerCase().replace(/\W+/g, '-'), city: name, name: '', abbr: name.slice(0, 3).toUpperCase(), colors: { primary: '#888888', secondary: '#ffffff' }, coach: TEAMS[0].coach, roster };
  };
  const capped = (p) => p.bst <= 600;
  const teams = [
    build('Speedsters', (p) => p.stats.spe + p.bst * 0.05, capped),
    build('Heavyweights', (p) => p.weight, capped),
    build('Giants', (p) => p.height, capped),
    build('Tiny', (p) => -p.height + p.bst * 0.002, capped),
    build('Glass cannons', (p) => p.stats.atk + p.stats.spa - p.stats.def - p.stats.spd - p.stats.hp, capped),
    build('Walls', (p) => p.stats.def + p.stats.spd + p.stats.hp, capped),
    { ...TEAMS[0], id: 'kanto-wailord', city: 'Kanto + Wailord in goal', name: '', roster: { ...TEAMS[0].roster, GK: 'wailord' } },
    { ...TEAMS[0], id: 'kanto-joltik', city: 'Kanto + Joltik in goal', name: '', roster: { ...TEAMS[0].roster, GK: 'joltik' } },
    build('Best OVR (BST ≤ 600)', (p, pos) => cardOverall(p.slug, pos), capped),
  ];
  const jobs = [];
  teams.forEach((X, ti) => {
    for (let g = 0; g < N; g++) {
      const opp = TEAMS[g % TEAMS.length], flip = g % 2;
      jobs.push({ home: flip ? opp : X, away: flip ? X : opp, seed: 31000 + g, xs: flip ? 1 : 0, ti, options: { injuries: false } });
    }
  });
  const res = await runMatches(jobs);
  console.log(`${jobs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)}s. Each team vs the 8 regional teams (${se}):`);
  teams.forEach((X, ti) => {
    const { edge, gd } = edgeOf(pick(res, jobs, (j) => j.ti === ti));
    const xi = STARTERS.map((s) => { const c = parseCard(X.roster[s.key], s.key); return cardOverall(c.mon, c.pos); });
    console.log(`  ${X.city.padEnd(26)} edge ${edge.toFixed(0).padStart(4)}%  goal diff ${gd.toFixed(2).padStart(5)}  starting OVR ${(xi.reduce((a, b) => a + b) / 7).toFixed(1)}  (${STARTERS.map((s) => POKEMON[parseCard(X.roster[s.key], s.key).mon].name).join(', ')})`);
  });
}

if (mode === 'ovr') {
  // swap one starter for a random card at the same position; regress the result on the OVR change
  const rng = new RNG(5);
  const jobs = [];
  for (const pos of POSITIONS) {
    const slots = STARTERS.filter((s) => s.pos.length === 1 && s.pos[0] === pos);
    for (let g = 0; g < N; g++) {
      const T = TEAMS[g % TEAMS.length], slot = slots[g % slots.length];
      let p;
      do p = rng.pick(POKEMON_LIST); while (Object.values(T.roster).some((v) => v.split(':')[0] === p.slug) || p.bst > 600);
      const cur = parseCard(T.roster[slot.key], slot.key);
      const dOvr = cardOverall(p.slug, pos) - cardOverall(cur.mon, pos);
      const X = { ...T, id: `${T.id}-x`, roster: { ...T.roster, [slot.key]: p.slug } }, B = { ...T, id: `${T.id}-b` };
      const flip = g % 2;
      jobs.push({ home: flip ? B : X, away: flip ? X : B, seed: 32000 + g, xs: flip ? 1 : 0, pos, dOvr, options: { injuries: false } });
    }
  }
  const res = await runMatches(jobs);
  console.log(`${jobs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)}s. Goal difference per OVR point when one starter is swapped:`);
  for (const pos of POSITIONS) {
    const pts = pick(res, jobs, (j) => j.pos === pos).map(({ j, r }) => [j.dOvr, r.score[j.xs] - r.score[1 - j.xs]]);
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    console.log(`  ${pos.padEnd(4)} slope ${(sxy / sxx).toFixed(3)} goals per OVR point  (r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(2)}, n ${pts.length})`);
  }
}
