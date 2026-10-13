// Pitch + token rendering. The pitch and overlay are canvases; players are DOM tokens so
// animated GIF sprites keep animating. On a tall stage (portrait phones) the pitch is drawn
// vertically, with the length running up the screen.
import { L, W, GOAL_Y0, GOAL_Y1, BOX_D, BOX_W, GA_D, GA_W, PEN_SPOT, CIRCLE_R } from './sim/pitch.js';
import { spriteUrl } from './ui.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const M = 2.5; // metres of grass drawn around the pitch
export { spriteUrl };

export class PitchRenderer {
  constructor({ stage, field, overlay, tokens, onPlayerTap }) {
    this.stage = stage; this.field = field; this.overlay = overlay; this.tokensEl = tokens;
    this.onPlayerTap = onPlayerTap;
    this.fctx = field.getContext('2d');
    this.octx = overlay.getContext('2d');
    this.tokens = new Map();
    this.view = 'broadcast'; // 'broadcast' (follows the ball) | 'full' (whole pitch)
    this.spriteStyle = 'home';
    this.cx = L / 2; this.cy = W / 2;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(stage);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(200, r.width); this.h = Math.max(120, r.height);
    for (const c of [this.field, this.overlay]) { c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr); }
    this.fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vertical = this.h > this.w * 1.05;
    this.lastScale = null;
  }

  // px per metre and how much of the pitch is in view
  layout() {
    const along = this.vertical ? this.h : this.w, across = this.vertical ? this.w : this.h;
    const full = Math.min(along / (L + 2 * M), across / (W + 2 * M));
    this.s = this.view === 'full' ? full : Math.max(full, Math.min(along / 32, across / 23));
    this.halfAlong = along / 2 / this.s; this.halfAcross = across / 2 / this.s;
  }
  setCamera(bx, by, snap) {
    let tx = bx, ty = by;
    if (this.view === 'full') { tx = L / 2; ty = W / 2; }
    const clampC = (v, half, len) => (half * 2 >= len + 2 * M ? len / 2 : clamp(v, -M + half, len + M - half));
    tx = clampC(tx, this.halfAlong, L); ty = clampC(ty, this.halfAcross, W);
    const k = snap ? 1 : 0.08;
    this.cx += (tx - this.cx) * k; this.cy += (ty - this.cy) * (snap ? 1 : 0.06);
  }
  // world (metres, z up) -> screen px
  pt(X, Y, z = 0) {
    const s = this.s;
    if (this.vertical) return { x: (Y - this.cy) * s + this.w / 2, y: this.h / 2 - (X - this.cx) * s - z * s * 0.55 };
    return { x: (X - this.cx) * s + this.w / 2, y: (Y - this.cy) * s + this.h / 2 - z * s * 0.55 };
  }

  // ------------------------------------------------------------------ pitch
  drawPitch(ctx, teams, leftSide) {
    const s = this.s;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#1a5c2e';
    ctx.fillRect(0, 0, this.w, this.h);
    // mowing stripes across the length
    const N = 12;
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = i % 2 ? '#2a8a45' : '#2f944b';
      this.rect(ctx, (L / N) * i, 0, (L / N) * (i + 1), W, true);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.88)';
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    this.rect(ctx, 0, 0, L, W);
    this.line(ctx, L / 2, 0, L / 2, W);
    this.circle(ctx, L / 2, W / 2, CIRCLE_R);
    this.dot(ctx, L / 2, W / 2, 0.25);
    for (const gx of [0, L]) {
      const inw = gx === 0 ? 1 : -1;
      this.rect(ctx, gx, W / 2 - BOX_W / 2, gx + inw * BOX_D, W / 2 + BOX_W / 2);
      this.rect(ctx, gx, W / 2 - GA_W / 2, gx + inw * GA_D, W / 2 + GA_W / 2);
      this.dot(ctx, gx + inw * PEN_SPOT, W / 2, 0.2);
      // the D at the top of the box
      this.arc(ctx, gx + inw * PEN_SPOT, W / 2, 4, gx === 0 ? -0.93 : Math.PI - 0.93, gx === 0 ? 0.93 : Math.PI + 0.93);
      for (const cy of [0, W]) this.arc(ctx, gx, cy, 1, 0, Math.PI * 2, true);
    }
    // goals: net behind the line, posts on it
    for (const gx of [0, L]) {
      const out = gx === 0 ? -1 : 1;
      const team = teams?.[gx === 0 ? leftSide : 1 - leftSide];
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      this.rect(ctx, gx, GOAL_Y0, gx + out * 1.3, GOAL_Y1, true);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      for (let y = GOAL_Y0; y <= GOAL_Y1 + 0.01; y += 0.5) this.line(ctx, gx, y, gx + out * 1.3, y);
      ctx.restore();
      ctx.strokeStyle = team ? team.colors.primary : '#fff';
      ctx.lineWidth = Math.max(2, s * 0.2);
      this.line(ctx, gx + out * 1.3, GOAL_Y0, gx + out * 1.3, GOAL_Y1);
        this.dot(ctx, gx, GOAL_Y0, 0.16); this.dot(ctx, gx, GOAL_Y1, 0.16);
      ctx.strokeStyle = 'rgba(255,255,255,.88)'; ctx.lineWidth = Math.max(1.5, s * 0.12);
    }
  }
  line(ctx, x0, y0, x1, y1) { const a = this.pt(x0, y0), b = this.pt(x1, y1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  rect(ctx, x0, y0, x1, y1, fill = false) {
    const a = this.pt(x0, y0), b = this.pt(x1, y1);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    if (fill) ctx.fillRect(x, y, w + 0.5, h + 0.5); else ctx.strokeRect(x, y, w, h);
  }
  circle(ctx, X, Y, r) { const c = this.pt(X, Y); ctx.beginPath(); ctx.arc(c.x, c.y, r * this.s, 0, Math.PI * 2); ctx.stroke(); }
  dot(ctx, X, Y, r) { const c = this.pt(X, Y); ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1.5, r * this.s), 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); }
  // arc in world angles (0 = +x), converted for the vertical view
  arc(ctx, X, Y, r, a0, a1, clip = false) {
    const c = this.pt(X, Y);
    ctx.save();
    if (clip) { const a = this.pt(0, 0), b = this.pt(L, W); ctx.beginPath(); ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); ctx.clip(); }
    ctx.beginPath();
    if (this.vertical) ctx.arc(c.x, c.y, r * this.s, -Math.PI / 2 - a1, -Math.PI / 2 - a0);
    else ctx.arc(c.x, c.y, r * this.s, a0, a1);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ tokens
  // ids: card ids in frame order; teamOf(id) -> { side, team, color, gk }
  ensureTokens(ids, game) {
    const want = new Set(ids);
    for (const [id, t] of this.tokens) t.el.style.display = want.has(id) ? '' : 'none';
    for (const id of ids) {
      let t = this.tokens.get(id);
      const pl = game.players[id];
      if (!pl) continue;
      if (!t) {
        const el = document.createElement('div');
        el.className = 'token';
        el.innerHTML = `<div class="base"></div><img alt="${pl.name}" draggable="false" /><span class="label">${pl.name}</span>`;
        const kit = game.kits[pl.teamId];
        const base = el.querySelector('.base');
        base.style.background = hexA(pl.pos === 'GK' ? kit.gk : kit.main, 0.9);
        base.style.borderColor = pl.pos === 'GK' ? kit.main : kit.trim;
        el.querySelector('.label').style.background = kit.main;
        const img = el.querySelector('img');
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { if (!img.dataset.fallback) { img.dataset.fallback = '1'; img.src = spriteUrl(pl, 'home'); } };
        this.tokensEl.appendChild(el);
        el.dataset.pid = id;
        if (this.onPlayerTap) {
          el.addEventListener('mouseenter', () => this.onPlayerTap(id, el));
          el.addEventListener('mouseleave', () => this.onPlayerTap(null));
          el.addEventListener('click', (e) => { e.stopPropagation(); this.onPlayerTap(id, el, true); });
        }
        t = { el, img, base, pl, style: null, flip: false };
        this.tokens.set(id, t);
      }
      if (t.style !== this.spriteStyle) {
        t.style = this.spriteStyle;
        t.img.dataset.fallback = '';
        t.img.src = spriteUrl(pl, this.spriteStyle);
        t.el.classList.toggle('bw', this.spriteStyle === 'bw' && !!pl.sprites?.bw);
      }
    }
    this.lastScale = null;
  }
  sizeTokens() {
    const size = clamp(this.s * 2.3, 20, 76);
    for (const t of this.tokens.values()) {
      const sz = size * Math.pow(clamp(t.pl.height, 0.3, 4), 0.22);
      t.img.style.width = `${sz}px`; t.img.style.height = `${sz}px`;
      t.base.style.width = `${size * 0.56}px`; t.base.style.height = `${size * 0.3}px`;
    }
  }

  // ------------------------------------------------------------------ frame
  // frames: unpacked record frames (every 0.1 s); ft: seconds into them
  draw(frames, ids, ft, game, opts = {}) {
    if (!frames?.length) return;
    this.layout();
    const fi = clamp(ft / 0.1, 0, frames.length - 1);
    const i0 = Math.floor(fi), i1 = Math.min(frames.length - 1, i0 + 1), k = fi - i0;
    const A = frames[i0], B = frames[i1];
    const lerp = (a, b) => a + (b - a) * k;
    // jumps (restarts after a goal) shouldn't be smoothed
    const jump = Math.hypot(B.b[0] - A.b[0], B.b[1] - A.b[1]) > 6;
    const bx = jump ? A.b[0] : lerp(A.b[0], B.b[0]), by = jump ? A.b[1] : lerp(A.b[1], B.b[1]), bz = jump ? A.b[2] : lerp(A.b[2], B.b[2]);
    this.setCamera(bx, by, opts.snap);
    if (this.lastScale !== this.s) { this.sizeTokens(); this.lastScale = this.s; }
    this.drawPitch(this.fctx, game.teams, opts.leftSide ?? 0);

    const ctx = this.octx;
    ctx.clearRect(0, 0, this.w, this.h);
    const owner = A.b[3];
    ids.forEach((id, idx) => {
      const t = this.tokens.get(id);
      if (!t) return;
      const pa = A.p[idx], pb = B.p[idx];
      if (!pa) return;
      const off = pa[2] & 8;
      t.el.style.display = off ? 'none' : '';
      if (off) return;
      const J = jump || Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 4;
      const X = J ? pa[0] : lerp(pa[0], pb[0]), Y = J ? pa[1] : lerp(pa[1], pb[1]);
      const P = this.pt(X, Y);
      t.el.style.transform = `translate(${P.x.toFixed(1)}px, ${P.y.toFixed(1)}px)`;
      t.el.style.zIndex = String(Math.round(P.y));
      // face the way they're moving across the screen
      const vx = this.vertical ? lerp(pa[4], pb[4]) : lerp(pa[3], pb[3]);
      let faceRight = t.flip;
      if (Math.abs(vx) > 0.5) faceRight = vx > 0;
      if (faceRight !== t.flip) { t.flip = faceRight; t.img.classList.toggle('flip', faceRight); }
      t.el.classList.toggle('carrier', owner === idx);
      t.el.classList.toggle('dive', !!(pa[2] & 4));
    });

    // ball: shadow on the grass, the ball lifted by its height
    const G = this.pt(bx, by), U = this.pt(bx, by, bz);
    const r = Math.max(4.5, this.s * (0.3 + Math.min(bz, 6) * 0.035));
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(G.x, G.y, r * 0.95, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    this.ballOnly(ctx, U.x, U.y, r);
  }
  ballOnly(ctx, x, y, r) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
// Kit colours for a match: the away side switches to its second colour if the main ones clash.
export function kitsFor(teams) {
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const near = (a, b) => { const p = rgb(a), q = rgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 110; };
  const [h, a] = teams;
  const awayMain = near(h.colors.primary, a.colors.primary) ? a.colors.secondary : a.colors.primary;
  const awayTrim = awayMain === a.colors.primary ? a.colors.secondary : a.colors.primary;
  return {
    [h.id]: { main: h.colors.primary, trim: h.colors.secondary, gk: '#3a3f47' },
    [a.id]: { main: awayMain, trim: awayTrim, gk: '#e0e0e0' },
  };
}
