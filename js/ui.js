// Small shared UI helpers: escaping, type chips, sprites, rating colors.
const SPRITE_BASE = 'https://img.pokemondb.net/sprites';

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const TYPE_COLORS = {
  normal: '#9fa19f', fire: '#e62829', water: '#2980ef', electric: '#fac000', grass: '#3fa129', ice: '#3dcef3',
  fighting: '#ff8000', poison: '#9141cb', ground: '#915121', flying: '#81b9ef', psychic: '#ef4179', bug: '#91a119',
  rock: '#afa981', ghost: '#704170', dragon: '#5060e1', dark: '#624d4e', steel: '#60a1b8', fairy: '#ef70ef',
};
export const typeChips = (types) => `<span class="types">${types.map((t) => `<span class="type" style="background:${TYPE_COLORS[t] || '#666'}">${t}</span>`).join('')}</span>`;

export function spriteUrl(player, style = 'home') {
  if (style === 'bw' && player.sprites?.bw) return `${SPRITE_BASE}/black-white/anim/normal/${player.sprites.bw}.gif`;
  return `${SPRITE_BASE}/home/normal/${player.sprites?.home || player.slug}.png`;
}
export const spriteImg = (p, cls = '') => `<img${cls ? ` class="${cls}"` : ''} src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;

// 20..99 rating -> bar color
export const ratingColor = (v) => (v >= 80 ? '#3fb950' : v >= 68 ? '#8bc34a' : v >= 52 ? '#ffcb05' : '#f0883e');
