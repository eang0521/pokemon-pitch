// Ball physics without spin: rolling friction on the ground, gravity and bounces in
// the air. The same step function drives the sim and the look-ahead predictions,
// so players read the ball exactly as it will move (until someone touches it).
import { G, hyp, clamp, L, W } from './pitch.js';

export const BALL = {
  mu: 1.0, // rolling resistance (m/s² of deceleration at any speed)
  c: 0.22, // speed-proportional ground drag (1/s)
  drag: 0.006, // air drag (per metre: a = drag · v²)
  bounce: 0.5, // vertical restitution
  bounceFric: 0.82, // horizontal speed kept on a bounce
};

export function stepBall(b, dt) {
  if (b.z > 0 || b.vz > 0) {
    const s = hyp(b.vx, b.vy, b.vz);
    const k = 1 - BALL.drag * s * dt;
    b.vx *= k; b.vy *= k; b.vz *= k;
    b.vz -= G * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.5) { b.vz = -b.vz * BALL.bounce; b.vx *= BALL.bounceFric; b.vy *= BALL.bounceFric; } else b.vz = 0;
    }
  } else {
    const s = hyp(b.vx, b.vy);
    if (s > 0) {
      const ns = Math.max(0, s - (BALL.mu + BALL.c * s) * dt);
      b.vx *= ns / s; b.vy *= ns / s;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
}

// Future positions of a free ball: [{t, x, y, z, s}] every `step` seconds up to `horizon`,
// stopping early when it leaves the pitch or comes to rest.
export function predict(b, horizon = 3.5, step = 0.1, dt = 0.05) {
  const q = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz };
  const out = [];
  const per = Math.round(step / dt);
  for (let i = 1, n = Math.round(horizon / dt); i <= n; i++) {
    stepBall(q, dt);
    if (i % per === 0) out.push({ t: i * dt, x: q.x, y: q.y, z: q.z, s: hyp(q.vx, q.vy) });
    if (q.x < -0.5 || q.x > L + 0.5 || q.y < -0.5 || q.y > W + 0.5) { out.push({ t: i * dt, x: q.x, y: q.y, z: q.z, s: hyp(q.vx, q.vy), out: true }); break; }
    if (q.z === 0 && q.vz === 0 && q.vx === 0 && q.vy === 0) { out.push({ t: i * dt, x: q.x, y: q.y, z: 0, s: 0, rest: true }); break; }
  }
  return out;
}

// Ground pass: initial speed so the ball covers distance d and still has speed v1
// when it gets there. Closed form of dv/dt = -(mu + c·v). Returns { v0, t }.
const K = () => BALL.mu / BALL.c;
export function groundTravel(v0, v1) {
  const k = K(), c = BALL.c;
  const t = Math.log((v0 + k) / (v1 + k)) / c;
  return { d: (v0 - v1) / c - k * t, t };
}
export function planGround(d, v1) {
  let lo = v1, hi = 45;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (groundTravel(mid, v1).d < d) lo = mid; else hi = mid; }
  return { v0: hi, t: groundTravel(hi, v1).t };
}
// How long a ground ball kicked at v0 takes to cover d (Infinity if it stops short).
export function groundTime(v0, d) {
  const k = K(), c = BALL.c;
  const stop = groundTravel(v0, 0).d;
  if (d >= stop) return Infinity;
  let lo = 0, hi = groundTravel(v0, 0).t;
  for (let i = 0; i < 28; i++) {
    const t = (lo + hi) / 2;
    const x = ((v0 + k) * (1 - Math.exp(-c * t))) / c - k * t;
    if (x < d) lo = t; else hi = t;
  }
  return hi;
}

// Lofted ball landing (first bounce) at distance d with launch angle `ang` (radians),
// corrected for air drag by a quick simulation. Returns { v, vz, vh, t }.
export function planLofted(d, ang) {
  let v = Math.sqrt((d * G) / Math.sin(2 * ang));
  for (let it = 0; it < 4; it++) {
    const got = loftRange(v, ang);
    v *= clamp(Math.sqrt(d / Math.max(0.5, got.d)), 0.8, 1.25);
  }
  const r = loftRange(v, ang);
  return { v, vh: v * Math.cos(ang), vz: v * Math.sin(ang), t: r.t };
}
function loftRange(v, ang) {
  const q = { x: 0, y: 0, z: 0.01, vx: v * Math.cos(ang), vy: 0, vz: v * Math.sin(ang) };
  let t = 0;
  while (t < 8) { stepBall(q, 0.02); t += 0.02; if (q.z === 0 || q.vz < 0 && q.z < 0.02) break; }
  return { d: q.x, t };
}
