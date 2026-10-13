// Frame-by-frame trace of a stretch of one match: ball state, carrier decisions (with the
// top options they weighed) and every event.
// Run: node tools/trace-match.mjs [seed] [fromSec] [toSec] [home] [away] [every]
//   times are seconds of match time (0..1200); every = print a position line every N ticks
import { Match } from '../js/match.js';
import { TEAMS } from '../js/data/teams.js';
import { HALF_SECS } from '../js/sim/pitch.js';

const [seed = 1, from = 0, to = 30, home = 'kanto', away = 'johto', every = 10] = process.argv.slice(2);
const T = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];
const m = new Match(T(home), T(away), Number(seed), { frames: false });
const sim = m.sim;
const now = () => (m.half - 1) * HALF_SECS + m.clock;
const inWin = () => now() >= Number(from) && now() <= Number(to);
const f1 = (v) => v.toFixed(1);
const who = (e) => (e ? `${m.teams[e.side].abbr}:${e.name}(${e.slot})` : '-');
const stamp = () => `${String(Math.floor(now() / 60)).padStart(2)}:${(now() % 60).toFixed(2).padStart(5, '0')}`;

sim.debug = (type, d) => {
  if (!inWin()) return;
  if (type === 'decide') {
    const desc = (o) => `${o.type}${o.kind ? `/${o.kind}` : ''}${o.to ? `→${o.to.name}` : ''}${o.p != null ? ` p${f1(o.p * 100)}` : ''} u${(o.u * 1000).toFixed(0)}`;
    console.log(`${stamp()}   DECIDE ${who(d.e)} press ${f1(d.press)}: ${d.opts.map(desc).join(' | ')}`);
  }
};
const onEvent = sim.emit;
sim.emit = (type, d) => {
  if (inWin() && type !== 'touch') {
    const brief = Object.entries(d).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}=${typeof v === 'number' ? f1(v) : v}`).join(' ');
    console.log(`${stamp()} * ${type} ${who(d.by)}${d.to ? ` → ${who(d.to)}` : ''}${d.on ? ` on ${who(d.on)}` : ''} ${brief}`);
  }
  onEvent(type, d);
};
let tick = 0;
const step = sim.step.bind(sim);
sim.step = () => {
  step();
  if (inWin() && tick++ % Number(every) === 0) {
    const b = sim.ball;
    console.log(`${stamp()} ball ${f1(b.x)},${f1(b.y)},${f1(b.z)} v${f1(Math.hypot(b.vx, b.vy))} owner ${who(b.owner)} ${sim.phase}`);
  }
};
while (!m.final && now() <= Number(to)) {
  const rec = m.next();
  if (!rec) break;
  for (const l of m.log.slice(rec.logFrom, rec.logTo)) if (inWin()) console.log(`        LOG ${l.text}`);
}
