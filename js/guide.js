// Card guide: what every stat means at every position, how OVR is calculated,
// and a browser to look up any Pokémon's card at each position.
import { POKEMON, POKEMON_LIST } from './data/pokemon.js';
import {
  POSITIONS, POS_NAMES, STAT_KEYS, STAT_SHORT, STAT_MAP, STAT_LABELS, STAT_HELP, OVR_WEIGHTS,
  traitStat, cardRatings, overall, rate, bestPosition,
} from './ratings.js';
import { STARTERS, BENCH, FORMATIONS } from './roster.js';
import { $, $$, esc, typeChips, spriteImg, ratingColor } from './ui.js';
import { openModal } from './modal.js';
import { settings } from './storage.js';

const PAGE = 48;
const state = { pos: settings.get('guidePos', 'FWD'), q: '', sort: 'ovr', shown: PAGE };

// cache: pos -> [{p, r, ovr}]
const cardCache = {};
export function cardsFor(pos) {
  if (!cardCache[pos]) cardCache[pos] = POKEMON_LIST.map((p) => { const r = cardRatings(p.slug, pos); return { p, r, ovr: overall(pos, r) }; });
  return cardCache[pos];
}

// The rating a stat turns into at a position (its first trait there).
const statRating = (pos, k, r) => r[STAT_MAP[pos][k][0]];

// Total OVR weight each base stat (plus height) carries at a position.
function statWeights(pos) {
  const w = {};
  for (const [t, v] of Object.entries(OVR_WEIGHTS[pos])) { const s = traitStat(pos, t); w[s] = (w[s] || 0) + v; }
  return w;
}

export function renderGuide() {
  renderExplainer();
  renderBrowser();
}

// ---------------------------------------------------------------- explainer
function renderExplainer() {
  const pos = state.pos;
  const w = statWeights(pos);
  const pct = (v) => (v ? `${Math.round(v * 100)}%` : '—');
  const rows = STAT_KEYS.map((k) => `<tr>
      <td class="g-stat"><b>${STAT_SHORT[k]}</b></td>
      <td><b>${STAT_LABELS[pos][k]}</b><div class="muted small">${esc(STAT_HELP[pos][k])}</div></td>
      <td class="g-w"><span class="g-wbar"><i style="width:${Math.round((w[k] || 0) * 300)}%"></i></span>${pct(w[k])}</td>
    </tr>`).join('');
  const extra = `<tr class="g-extra"><td class="g-stat"><b>Height</b></td><td><b>Reach</b><div class="muted small">Taller Pokémon win more headers${pos === 'GK' ? ', and keepers cover more of the goal' : ''}.</div></td><td class="g-w"><span class="g-wbar"><i style="width:${Math.round((w.height || 0) * 300)}%"></i></span>${pct(w.height)}</td></tr>
    <tr class="g-extra"><td class="g-stat"><b>Weight</b></td><td><b>Mass</b><div class="muted small">Heavier Pokémon win shoulder-to-shoulder duels but turn more slowly.</div></td><td class="g-w">—</td></tr>`;

  $('#guide-pos').innerHTML = POSITIONS.map((p) => `<button type="button" role="tab" data-gpos="${p}" class="${p === pos ? 'on' : ''}" aria-selected="${p === pos}"><span class="l-long">${POS_NAMES[p]}</span><span class="l-short">${p}</span></button>`).join('');
  $$('#guide-pos [data-gpos]').forEach((b) => b.addEventListener('click', () => {
    state.pos = b.dataset.gpos; state.shown = PAGE; settings.set('guidePos', state.pos); renderGuide();
  }));
  $('#guide-table').innerHTML = `<table class="g-table">
      <thead><tr><th>Stat</th><th>As a ${POS_NAMES[pos].toLowerCase()}</th><th>Share of OVR</th></tr></thead>
      <tbody>${rows}${extra}</tbody></table>`;

  const all = `<table class="g-grid"><thead><tr><th></th>${STAT_KEYS.map((k) => `<th>${STAT_SHORT[k]}</th>`).join('')}</tr></thead><tbody>
    ${POSITIONS.map((p) => `<tr class="${p === pos ? 'on' : ''}"><th>${p}</th>${STAT_KEYS.map((k) => `<td>${STAT_LABELS[p][k]}</td>`).join('')}</tr>`).join('')}
  </tbody></table>`;
  $('#guide-all').innerHTML = all;
}

// ---------------------------------------------------------------- card browser
function renderBrowser() {
  const pos = state.pos;
  const labels = STAT_LABELS[pos];
  const sortSel = $('#g-sort');
  sortSel.innerHTML = `<option value="ovr">Sort: ${pos} overall</option><option value="bst">Sort: base stat total</option>` +
    STAT_KEYS.map((k) => `<option value="${k}">Sort: ${labels[k]} (${STAT_SHORT[k]})</option>`).join('') +
    '<option value="height">Sort: height</option><option value="weight">Sort: weight</option><option value="dex">Sort: Pokédex #</option>';
  sortSel.value = state.sort;
  $('#g-title').textContent = `${POS_NAMES[pos]} cards`;

  const q = state.q.trim().toLowerCase();
  const key = (c) => (state.sort === 'ovr' ? c.ovr : state.sort === 'bst' ? c.p.bst : state.sort === 'dex' ? -c.p.dex
    : state.sort === 'height' || state.sort === 'weight' ? c.p[state.sort] : c.p.stats[state.sort]);
  const list = cardsFor(pos)
    .filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.types.some((t) => t.startsWith(q)) || String(p.dex) === q)
    .slice().sort((a, b) => key(b) - key(a) || b.ovr - a.ovr);
  $('#g-count').textContent = `${list.length} card${list.length === 1 ? '' : 's'}`;
  $('#g-list').innerHTML = (list.slice(0, state.shown).map((c) => cardHtml(c, pos)).join('') || '<p class="muted">No cards match.</p>') +
    (list.length > state.shown ? `<button type="button" id="g-more" class="b-more">Show more (${list.length - state.shown} left)</button>` : '');
  $$('#g-list .b-card').forEach((el) => el.addEventListener('click', () => openCardModal(el.dataset.mon)));
  $('#g-more')?.addEventListener('click', () => { state.shown += PAGE; renderBrowser(); });
}

export function statBars(p, pos, r) {
  return STAT_KEYS.map((k) => {
    const v = statRating(pos, k, r);
    return `<div class="sb-row" title="${STAT_LABELS[pos][k]}: base ${STAT_SHORT[k]} ${p.stats[k]} → rating ${v}"><span class="sb-l">${STAT_LABELS[pos][k]}</span><span class="sb-bar"><i style="width:${v}%;background:${ratingColor(v)}"></i></span><span class="sb-v">${v}</span></div>`;
  }).join('');
}

function cardHtml({ p, r, ovr }, pos) {
  return `<button type="button" class="b-card" data-mon="${p.slug}">
    <div class="bc-top">${spriteImg(p)}
      <div class="bc-id"><b>${esc(p.name)}</b> <span class="muted">#${p.dex}</span><br>${typeChips(p.types)} <span class="muted small">BST ${p.bst}</span></div>
      <div class="bc-ovr"><span>${ovr}</span><small>${pos}</small></div></div>
    <div class="bc-stats">${statBars(p, pos, r)}</div>
  </button>`;
}

// One Pokémon at every position, side by side.
export function openCardModal(slug) {
  const p = POKEMON[slug];
  const best = bestPosition(slug);
  const cols = POSITIONS.map((pos) => {
    const r = cardRatings(slug, pos), ovr = overall(pos, r);
    return `<div class="cm-pos${pos === best ? ' best' : ''}">
      <div class="cm-head"><span class="cm-p">${pos}</span><span class="cm-ovr">${ovr}</span>${pos === best ? '<span class="cm-best">Best</span>' : ''}</div>
      <div class="bc-stats">${statBars(p, pos, r)}</div>
    </div>`;
  }).join('');
  const r = cardRatings(slug, 'MID');
  openModal(`<div class="cm-top">${spriteImg(p, 'cm-img')}<div><h3>${esc(p.name)} <span class="muted">#${p.dex}</span></h3>
      ${typeChips(p.types)} <span class="muted small">BST ${p.bst} · ${p.height} m (reach ${r.reach}) · ${p.weight} kg (mass ${r.mass}) · agility ${r.agi}</span>
      <div class="muted small cm-base">Base stats: ${STAT_KEYS.map((k) => `${STAT_SHORT[k]} <b>${p.stats[k]}</b>`).join(' · ')}</div></div></div>
    <div class="cm-grid">${cols}</div>
    <p class="muted small">Every Pokémon can play every position. Each base stat turns into a 20–99 rating, and what that rating does depends on the position.</p>
    <div class="modal-actions"><button type="button" class="ghost" data-close>Close</button></div>`, null, { wide: true });
}

export function wireGuide() {
  $('#g-search').addEventListener('input', (e) => { state.q = e.target.value; state.shown = PAGE; renderBrowser(); });
  $('#g-sort').addEventListener('change', (e) => { state.sort = e.target.value; state.shown = PAGE; renderBrowser(); });
  // the static part of the explainer: rating curve, rosters and formations
  const ex = [40, 80, 100, 140, 200].map((x) => `${x} → ${rate(x)}`).join(' · ');
  $('#guide-formula').innerHTML = `
    <p><b>Ratings.</b> Each base stat becomes a 20–99 rating: <code>35 + (stat − 40) × 0.55</code>, with a soft cap above 140 (only +0.08 per point after that), so outliers like Shuckle's 230 Defense don't break the physics. For example ${ex}.</p>
    <p><b>Untrained traits.</b> A position only trains six traits. Anything else a player has to do still comes from the matching stat at <b>85%</b>: a defender who shoots uses Sp. Atk as Finishing at 85%, and a forward who has to tackle uses Attack at 85%.</p>
    <p><b>OVR</b> is a weighted average of the ratings that matter most at the position (the “Share of OVR” column). Weight and height aren't base stats: <b>mass</b> comes from weight (duels, turning) and <b>reach</b> from height (headers, and how much goal a keeper covers). <b>Agility</b> mixes Speed with lightness.</p>`;
  $('#guide-roster').innerHTML = `
    <p><b>7-a-side.</b> Every team starts ${STARTERS.map((s) => s.label).join(', ')}. The <b>FLEX</b> can be a defender, midfielder or forward, and sets the formation:</p>
    <ul>${Object.entries(FORMATIONS).map(([k, f]) => `<li><b>FLEX ${k} → ${f.name}</b>: ${esc(f.desc)}</li>`).join('')}</ul>
    <p><b>Bench.</b> One backup each at ${BENCH.filter((s) => s.pos.length === 1).map((s) => s.label).join(', ')}, plus two more outfield subs: ${STARTERS.length + BENCH.length} cards in all, with no Pokémon twice.</p>`;
}
