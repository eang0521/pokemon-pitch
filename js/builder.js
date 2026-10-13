// Team builder: pick any card (Pokémon + position) for each of the 13 roster slots.
import { POKEMON } from './data/pokemon.js';
import { cardRatings, overall, STAT_KEYS, STAT_SHORT, STAT_LABELS, POS_NAMES } from './ratings.js';
import { STARTERS, BENCH, SLOT, ALL_SLOTS, parseCard, cardValue, validateRoster, FORMATIONS, flexOf } from './roster.js';
import { COACH_PRESETS, COACH_KEYS } from './data/coaches.js';
import { saveCustomTeam, deleteCustomTeam, storageErrorText, lastStorageError } from './storage.js';
import { encodeTeam, shareLink } from './teamcode.js';
import { openModal, copyText } from './modal.js';
import { teamSynergies } from './synergy.js';
import { cardsFor, statBars } from './guide.js';
import { $, $$, esc, typeChips, spriteImg, synergyChips } from './ui.js';

const PAGE = 48;
let state = null;

export function openBuilder(team, { onSave, onClose }) {
  state = {
    team: team ? JSON.parse(JSON.stringify(team)) : blankTeam(),
    isNew: !team, slot: 'GK', flexPos: {}, shown: PAGE, onSave, onClose,
  };
  const t = state.team;
  $('#b-city').value = t.city; $('#b-name').value = t.name; $('#b-abbr').value = t.abbr;
  $('#b-c1').value = t.colors.primary; $('#b-c2').value = t.colors.secondary;
  $('#b-delete').classList.toggle('hidden', state.isNew);
  $('#b-search').value = '';
  renderCoach();
  render();
}

function blankTeam() {
  return {
    id: `u${Math.random().toString(36).slice(2, 9)}`, custom: true,
    city: 'My', name: 'Squad', abbr: 'MY',
    colors: { primary: '#3d7dca', secondary: '#ffcb05' },
    coach: { name: 'Coach You', preset: 'balanced', ...COACH_PRESETS.balanced },
    roster: {},
  };
}

function render() { renderSlots(); renderSummary(); renderBrowser(); }

// ---------------------------------------------------------------- roster slots
const slotName = (s) => (s.unit === 'B' ? (s.label === 'SUB' ? 'Sub' : `Backup ${s.label}`) : s.label);
function slotTile(s) {
  const c = parseCard(state.team.roster[s.key], s.key);
  const sel = state.slot === s.key ? ' sel' : '';
  if (!c || !POKEMON[c.mon]) {
    return `<button type="button" class="b-slot empty${sel}" data-slot="${s.key}"><span class="b-lab">${slotName(s)}${s.pos.length > 1 ? ` <small>${s.pos.join('/')}</small>` : ''}</span><span class="b-empty">Empty — pick a card</span></button>`;
  }
  const p = POKEMON[c.mon];
  const ovr = overall(c.pos, cardRatings(c.mon, c.pos));
  return `<button type="button" class="b-slot${sel}" data-slot="${s.key}">
    <span class="b-lab">${slotName(s)}${s.pos.length > 1 ? ` · ${c.pos}` : ''}</span>
    ${spriteImg(p)}
    <span class="b-nm">${esc(p.name)}</span><span class="b-ovr">${ovr}</span>
  </button>`;
}
function renderSlots() {
  const group = (title, list) => `<div class="b-group"><div class="b-gtitle">${title}</div><div class="b-grid">${list.map(slotTile).join('')}</div></div>`;
  $('#b-slots').innerHTML = group('Starting seven', STARTERS) + group('Bench (one backup per position, plus two subs)', BENCH);
  $$('#b-slots .b-slot').forEach((el) => el.addEventListener('click', () => {
    state.slot = el.dataset.slot; state.shown = PAGE; render();
    if (window.innerWidth < 900) $('.b-browser').scrollIntoView({ behavior: 'smooth' });
  }));
}

function renderSummary() {
  const r = state.team.roster;
  const form = FORMATIONS[flexOf(r)];
  const starters = STARTERS.map((s) => parseCard(r[s.key], s.key)).filter((c) => c && POKEMON[c.mon]);
  const avg = starters.length ? Math.round(starters.reduce((a, c) => a + overall(c.pos, cardRatings(c.mon, c.pos)), 0) / starters.length) : '—';
  const syn = teamSynergies(starters.map((c) => POKEMON[c.mon]));
  const errors = validateRoster(r);
  const filled = ALL_SLOTS.filter((s) => r[s.key]).length;
  $('#b-summary').innerHTML = `<div class="b-sum-row">
      <div><span class="muted">Formation</span> <b>${form.name}</b><div class="muted small">${esc(form.desc)}</div></div>
      <div><span class="muted">Starting OVR</span> <b>${avg}</b></div>
      <div><span class="muted">Cards</span> <b>${filled}/${ALL_SLOTS.length}</b></div>
    </div>
    <div class="b-syn"><span class="muted small">Synergies (starting seven)</span> ${synergyChips(syn.counts, syn.active)}</div>
    ${errors.length && filled ? `<div class="b-errors">${errors.slice(0, 3).map(esc).join(' · ')}${errors.length > 3 ? ` · +${errors.length - 3} more` : ''}</div>` : ''}`;
}

// ---------------------------------------------------------------- card browser
function currentPos() {
  const s = SLOT[state.slot];
  if (s.pos.length === 1) return s.pos[0];
  const c = parseCard(state.team.roster[s.key], s.key);
  return state.flexPos[s.key] || c?.pos || 'MID';
}

function renderBrowser() {
  const s = SLOT[state.slot];
  const pos = currentPos();
  $('#b-title').textContent = `${slotName(s)} — choose a ${POS_NAMES[pos].toLowerCase()} card`;
  $('#b-postabs').innerHTML = s.pos.length > 1
    ? s.pos.map((p) => `<button type="button" data-pos="${p}" class="${p === pos ? 'on' : ''}">${p}</button>`).join('') +
      (s.key === 'FLEX' ? `<span class="muted small">The FLEX sets the formation: DEF = 3-2-1 · MID = 2-3-1 · FWD = 2-2-2</span>` : '<span class="muted small">Subs can be any outfield position</span>')
    : '';
  $$('#b-postabs [data-pos]').forEach((b) => b.addEventListener('click', () => { state.flexPos[s.key] = b.dataset.pos; state.shown = PAGE; renderBrowser(); }));

  const labels = STAT_LABELS[pos];
  const sortSel = $('#b-sort');
  const prev = sortSel.value || 'ovr';
  sortSel.innerHTML = `<option value="ovr">Sort: ${pos} overall</option><option value="bst">Sort: base stat total</option>` +
    STAT_KEYS.map((k) => `<option value="${k}">Sort: ${labels[k]} (${STAT_SHORT[k]})</option>`).join('') +
    '<option value="height">Sort: height</option><option value="weight">Sort: weight</option><option value="dex">Sort: Pokédex #</option>';
  sortSel.value = [...sortSel.options].some((o) => o.value === prev) ? prev : 'ovr';
  $('#b-legend').innerHTML = `As a <b>${pos}</b>: ${STAT_KEYS.map((k) => `<span class="lg"><span class="muted">${STAT_SHORT[k]}</span> = ${labels[k]}</span>`).join(' ')}`;

  const q = $('#b-search').value.trim().toLowerCase();
  const cap = Number($('#b-cap').value);
  const sort = sortSel.value;
  const onRoster = new Map();
  for (const sl of ALL_SLOTS) { const c = parseCard(state.team.roster[sl.key], sl.key); if (c) onRoster.set(c.mon, sl); }
  let list = cardsFor(pos).filter(({ p }) => p.bst <= cap && (!q || p.name.toLowerCase().includes(q) || p.types.some((t) => t.startsWith(q)) || String(p.dex) === q));
  const key = (c) => (sort === 'ovr' ? c.ovr : sort === 'bst' ? c.p.bst : sort === 'dex' ? -c.p.dex : sort === 'height' || sort === 'weight' ? c.p[sort] : c.p.stats[sort]);
  list = list.slice().sort((a, b) => key(b) - key(a) || b.ovr - a.ovr);
  const current = parseCard(state.team.roster[s.key], s.key);
  const html = list.slice(0, state.shown).map(({ p, r, ovr }) => {
    const taken = onRoster.get(p.slug);
    const isHere = current && current.mon === p.slug && current.pos === pos;
    return `<button type="button" class="b-card${taken && !isHere ? ' taken' : ''}${isHere ? ' here' : ''}" data-mon="${p.slug}" ${taken && !isHere ? 'disabled' : ''}>
      <div class="bc-top">${spriteImg(p)}
        <div class="bc-id"><b>${esc(p.name)}</b> <span class="muted">#${p.dex}</span><br>${typeChips(p.types)} <span class="muted small">BST ${p.bst}</span></div>
        <div class="bc-ovr"><span>${ovr}</span><small>${pos}</small></div></div>
      <div class="bc-stats">${statBars(p, pos, r)}</div>
      ${taken && !isHere ? `<div class="bc-taken">On the roster (${slotName(taken)})</div>` : isHere ? '<div class="bc-taken here">In this slot</div>' : ''}
    </button>`;
  }).join('');
  $('#b-list').innerHTML = (html || '<p class="muted">No cards match.</p>') +
    (list.length > state.shown ? `<button type="button" id="b-more" class="b-more">Show more (${list.length - state.shown} left)</button>` : '');
  $$('#b-list .b-card:not([disabled])').forEach((el) => el.addEventListener('click', () => pick(el.dataset.mon)));
  $('#b-more')?.addEventListener('click', () => { state.shown += PAGE; renderBrowser(); });
}

function pick(mon) {
  const s = SLOT[state.slot];
  state.team.roster[s.key] = cardValue(mon, currentPos(), s.key);
  // advance to the next empty slot
  const next = ALL_SLOTS.find((x) => !state.team.roster[x.key]);
  if (next) { state.slot = next.key; state.shown = PAGE; $('#b-search').value = ''; }
  render();
}

// ---------------------------------------------------------------- coach
function renderCoach() { coachControls($('#b-coach'), state.team.coach); }

const SLIDERS = { tempo: 'Tempo', press: 'Pressing', width: 'Width', directness: 'Directness', shootRange: 'Shooting range', aggression: 'Tackling aggression' };
// Coach tendency controls (name, preset + sliders). Edits `coach` in place.
export function coachControls(el, coach, onChange = () => {}) {
  const c = coach;
  const slider = (k) => `<label class="cs"><span>${SLIDERS[k]}</span><input type="range" min="0" max="100" value="${Math.round(c[k] * 100)}" data-k="${k}"><b>${Math.round(c[k] * 100)}</b></label>`;
  el.classList.add('coach-ctl');
  el.innerHTML = `
    <label class="cs"><span>Coach name</span><input type="text" maxlength="24" value="${esc(c.name || '')}" data-name></label>
    <label class="cs"><span>Preset</span><select data-preset>${Object.entries(COACH_PRESETS).map(([k, v]) => `<option value="${k}" ${c.preset === k ? 'selected' : ''}>${v.style}</option>`).join('')}</select></label>
    ${COACH_KEYS.map(slider).join('')}
    <p class="muted small">Coaches still adapt during the match: chasing a game late they press and push up, protecting a lead they drop off, and they lean toward whatever is creating chances.</p>`;
  el.querySelector('[data-name]').addEventListener('input', (e) => { c.name = e.target.value; onChange(); });
  el.querySelector('[data-preset]').addEventListener('change', (e) => {
    Object.assign(c, COACH_PRESETS[e.target.value], { preset: e.target.value });
    coachControls(el, c, onChange); onChange();
  });
  el.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    c[r.dataset.k] = Number(r.value) / 100; r.nextElementSibling.textContent = r.value;
    c.style = `${COACH_PRESETS[c.preset]?.style || 'Custom'} (custom)`;
    onChange();
  }));
}

// ---------------------------------------------------------------- actions
function autoFill() {
  const cap = Number($('#b-cap').value);
  const r = state.team.roster;
  const used = new Set(ALL_SLOTS.map((s) => parseCard(r[s.key], s.key)?.mon).filter(Boolean));
  for (const s of ALL_SLOTS) {
    if (r[s.key]) continue;
    const pos = s.pos.length > 1 ? (state.flexPos[s.key] || (s.key === 'FLEX' ? 'MID' : s.key === 'SUB1' ? 'MID' : 'DEF')) : s.pos[0];
    const best = cardsFor(pos).filter(({ p }) => p.bst <= cap && !used.has(p.slug)).sort((a, b) => b.ovr - a.ovr)[0];
    if (best) { r[s.key] = cardValue(best.p.slug, pos, s.key); used.add(best.p.slug); }
  }
  render();
}

function readIdentity() {
  const t = state.team;
  t.city = $('#b-city').value.trim() || 'My';
  t.name = $('#b-name').value.trim() || 'Squad';
  t.abbr = ($('#b-abbr').value.trim() || t.name.slice(0, 3)).toUpperCase().slice(0, 3);
  t.colors = { primary: $('#b-c1').value, secondary: $('#b-c2').value };
  t.coach.style = t.coach.style || COACH_PRESETS[t.coach.preset]?.style || 'Custom';
  return t;
}

function save() {
  const t = readIdentity();
  const errors = validateRoster(t.roster);
  if (errors.length) { alert(`Finish your roster first:\n• ${errors.slice(0, 8).join('\n• ')}`); return; }
  if (!saveCustomTeam(t)) { alert(storageErrorText(lastStorageError())); return; }
  state.onSave(t);
}

export function wireBuilder() {
  $('#b-search').addEventListener('input', () => { state.shown = PAGE; renderBrowser(); });
  $('#b-sort').addEventListener('change', () => { state.shown = PAGE; renderBrowser(); });
  $('#b-cap').addEventListener('change', () => { state.shown = PAGE; renderBrowser(); });
  $('#b-auto').addEventListener('click', autoFill);
  $('#b-clear').addEventListener('click', () => { if (confirm('Clear every slot?')) { state.team.roster = {}; state.slot = 'GK'; render(); } });
  $('#b-save').addEventListener('click', save);
  $('#b-share').addEventListener('click', () => {
    const t = readIdentity();
    const errors = validateRoster(t.roster);
    const code = encodeTeam(t), link = shareLink(code);
    openModal(`<h3>Share ${esc(t.city)} ${esc(t.name)}</h3>
      ${errors.length ? `<p class="b-errors">This roster isn't complete yet (${errors.length} issue${errors.length > 1 ? 's' : ''}). Friends can still import it and finish it.</p>` : ''}
      <p class="muted small">Anyone can paste this code into “Import a team code”, or open the link.</p>
      <textarea class="code" readonly rows="4">${code}</textarea>
      <div class="modal-actions"><button type="button" class="primary" id="m-copy-code">Copy code</button><button type="button" id="m-copy-link">Copy link</button><button type="button" class="ghost" data-close>Close</button></div>`, (d) => {
      d.querySelector('#m-copy-code').onclick = (e) => copyText(code, e.target);
      d.querySelector('#m-copy-link').onclick = (e) => copyText(link, e.target);
      d.querySelector('textarea').onclick = (e) => e.target.select();
    });
  });
  $('#b-cancel').addEventListener('click', () => state.onClose());
  $('#b-delete').addEventListener('click', () => {
    if (confirm(`Delete ${state.team.city} ${state.team.name}?`)) {
      if (!deleteCustomTeam(state.team.id)) { alert(storageErrorText(lastStorageError())); return; }
      state.onClose(true);
    }
  });
}
