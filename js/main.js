// UI controller: screens, the matchup picker, match playback, scorebug and panels.
import { TEAMS } from './data/teams.js';
import { POKEMON } from './data/pokemon.js';
import { renderGuide, wireGuide, statBars } from './guide.js';
import { MatchView, EngineClient, recFrames } from './client.js';
import { PitchRenderer, kitsFor } from './render.js';
import { parseCard, formationOf } from './roster.js';
import { POS_NAMES } from './ratings.js';
import { HALF_SECS } from './sim/pitch.js';
import { $, $$, esc, typeChips, spriteUrl, synergyChips } from './ui.js';
import { matchRating } from './rating.js';
import { teamSynergies } from './synergy.js';
import { fatigueMult } from './depth.js';
import { settings } from './storage.js';

const PLAYBACK = 3; // 1× speed = three seconds of match time per real second (a match takes ~7 minutes)
const allTeams = () => TEAMS;
const findTeam = (id) => allTeams().find((t) => t.id === id);
const clockText = (s) => { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const elapsedOf = (l) => (l.half - 1) * HALF_SECS + l.clock;

// ==========================================================================
// Screens
const SCREENS = ['setup', 'guide', 'game'];
function showScreen(name) {
  if (!SCREENS.includes(name)) name = 'setup';
  for (const id of SCREENS) $(`#${id}`).classList.toggle('hidden', id !== name);
  $$('.modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === name || (name === 'game' && b.dataset.mode === 'setup')));
  $('#btn-new').classList.toggle('hidden', name !== 'game');
  if (name === 'guide') renderGuide();
  if (name !== 'game') { setPlaying(false); setTheater(false); }
  if (name !== 'game') settings.set('screen', name);
  window.scrollTo(0, 0);
}
$$('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === 'setup' && ctl.game && !$('#game').classList.contains('hidden')) return;
  if (b.dataset.mode === 'setup' && ctl.game) { showScreen('game'); return; }
  history.replaceState(null, '', b.dataset.mode === 'guide' ? '#cards' : location.pathname);
  showScreen(b.dataset.mode);
}));
$$('[data-goto]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); showScreen(b.dataset.goto); }));
$('#btn-new').addEventListener('click', () => {
  ctl.client?.terminate(); ctl.client = null; ctl.game = null;
  history.replaceState(null, '', location.pathname);
  showScreen('setup'); renderTeamGrid();
});

// ==========================================================================
// Setup
const sel = { home: null, away: null };
function renderTeamGrid() {
  const grid = $('#team-grid');
  grid.innerHTML = allTeams().map(teamCardHtml).join('');
  grid.querySelectorAll('.team-card').forEach((el) => {
    el.addEventListener('click', () => pickTeam(el.dataset.team));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTeam(el.dataset.team); } });
  });
  syncSetup();
}
function teamCardHtml(t) {
  const stars = ['FWD', 'FLEX', 'MID1'].map((k) => POKEMON[parseCard(t.roster[k], k)?.mon]).filter(Boolean);
  const c = t.coach;
  const meter = (label, v) => `<span>${label}</span><div class="meter"><span style="width:${Math.round(v * 100)}%"></span></div>`;
  return `<div class="team-card" data-team="${t.id}" role="button" tabindex="0">
    <div class="band" style="background:linear-gradient(120deg, ${t.colors.primary}, ${t.colors.primary} 60%, ${t.colors.secondary})">
      ${stars.map((p) => `<img src="${spriteUrl(p)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">`).join('')}
      <span class="abbr">${esc(t.abbr)}</span>
    </div>
    <div class="info">
      <div class="tname">${esc(t.city)} ${esc(t.name)}</div>
      <div class="coach">${esc(c.name)} · ${esc(c.style)} · ${formationOf(t.roster).name}</div>
      <div class="sets">${synergyChips(...Object.values(teamSyn(t)), { compact: true, onlyActive: true }) || '<span class="muted small">No synergies</span>'}</div>
      <div class="meters">${meter('Tempo', c.tempo)}${meter('Press', c.press)}${meter('Direct', c.directness)}${meter('Width', c.width)}</div>
      <div class="card-foot"><span class="pick"></span></div>
    </div>
  </div>`;
}
function teamSyn(t) {
  const cards = ['GK', 'DEF1', 'DEF2', 'MID1', 'MID2', 'FWD', 'FLEX'].map((k) => POKEMON[parseCard(t.roster[k], k).mon]);
  const { counts, active } = teamSynergies(cards);
  return { counts, active };
}
function pickTeam(id) {
  if (sel.home === id) sel.home = null;
  else if (sel.away === id) sel.away = null;
  else if (!sel.home) sel.home = id;
  else if (!sel.away) sel.away = id;
  else sel.away = id;
  syncSetup();
}
function syncSetup() {
  for (const k of ['home', 'away']) {
    const t = sel[k] && findTeam(sel[k]);
    const el = $(`#slot-${k}`);
    el.classList.toggle('filled', !!t);
    el.querySelector('.slot-name').textContent = t ? `${t.city} ${t.name}` : 'Select a team';
  }
  $$('.team-card').forEach((el) => {
    const id = el.dataset.team;
    el.classList.toggle('sel-home', sel.home === id);
    el.classList.toggle('sel-away', sel.away === id);
    el.querySelector('.pick').textContent = sel.home === id ? 'HOME' : sel.away === id ? 'AWAY' : '';
  });
  $('#btn-start').disabled = !(sel.home && sel.away);
}
$('#btn-random').addEventListener('click', () => {
  const ids = allTeams().map((t) => t.id);
  sel.home = ids[Math.floor(Math.random() * ids.length)];
  do sel.away = ids[Math.floor(Math.random() * ids.length)]; while (sel.away === sel.home);
  syncSetup();
});
$('#btn-start').addEventListener('click', () => {
  const seed = Number($('#seed').value) || Math.floor(Math.random() * 1e9);
  startMatch(findTeam(sel.home), findTeam(sel.away), seed);
});
for (const [id, key, d] of [['#opt-injuries', 'injuries', true], ['#opt-knockout', 'knockout', false]]) {
  $(id).checked = settings.get(key, d);
  $(id).addEventListener('change', (e) => settings.set(key, e.target.checked));
}
const matchOptions = () => ({ injuries: $('#opt-injuries').checked, knockout: $('#opt-knockout').checked });

// ==========================================================================
// Match controller. The match runs in a Web Worker (js/worker.js); the page keeps a
// mirror (MatchView) and plays back records (segments of play) as they arrive.
const ctl = {
  game: null, client: null, renderer: null, playing: false, speed: settings.get('speed', 1),
  cur: null, ft: 0, hold: 0, queue: [], requested: 0, noMore: false, finalState: null, history: [], replay: null,
  shown: 0, simming: false, finished: false,
  opts: { names: settings.get('names', false), passes: settings.get('passes', false), sprites: settings.get('sprites', 'home'), camera: settings.get('camera', 'broadcast') },
};
window.__pps = ctl;

function startMatch(home, away, seed, options = matchOptions()) {
  if (!home || !away) return;
  ctl.options = options;
  ctl.client?.terminate();
  Object.assign(ctl, { game: null, cur: null, ft: 0, hold: 0, queue: [], requested: 0, noMore: false, finalState: null, history: [], replay: null, shown: 0, simming: false, finished: false, lastCaption: null });
  showScreen('game');
  $('#final').classList.add('hidden');
  $('#tokens').innerHTML = '';
  hideReplayBadge();
  if (!ctl.renderer) ctl.renderer = new PitchRenderer({ stage: $('#stage'), field: $('#field'), overlay: $('#overlay'), tokens: $('#tokens'), onPlayerTap: showPlayerCard });
  else ctl.renderer.tokens.clear();
  ctl.renderer.spriteStyle = ctl.opts.sprites;
  ctl.renderer.view = ctl.opts.camera;
  syncCamBtn();
  history.replaceState(null, '', `?home=${home.id}&away=${away.id}&seed=${seed}${options.knockout ? '&ko=1' : ''}${options.injuries ? '' : '&inj=0'}`);
  $('#lastplay').innerHTML = '<span class="muted">Setting up the match…</span>';
  ctl.client = new EngineClient(onEngineMessage);
  ctl.client.send({ type: 'new', home, away, seed, options });
  setPlaying(false);
}

function requestMore() {
  while (!ctl.noMore && ctl.queue.length + ctl.requested < 2) { ctl.requested++; ctl.client.send({ type: 'next' }); }
}

function onEngineMessage(m) {
  if (m.type === 'error') { console.error(m.message); $('#lastplay').innerHTML = `<span class="b-errors">Simulation error: ${esc(m.message.split('\n')[0])}</span>`; return; }
  if (m.type === 'init') {
    ctl.game = new MatchView(m.teams, m.seed);
    ctl.game.kits = kitsFor(m.teams);
    ctl.game.addLog(m.state); ctl.game.apply(m.state);
    renderScorebug();
    $('#lastplay').innerHTML = `<span class="muted">${esc(m.teams[0].city)} ${esc(m.teams[0].name)} vs ${esc(m.teams[1].city)} ${esc(m.teams[1].name)}. Press <b>Play</b> to kick off. (Seed ${m.seed}${ctl.client.mode === 'page' ? ', running on the page' : ''})</span>`;
    renderPanels();
    requestMore();
    return;
  }
  if (m.type === 'rec') {
    ctl.requested = Math.max(0, ctl.requested - 1);
    m.rec.state = m.state;
    ctl.game.addLog(m.state);
    ctl.history[m.rec.id] = m.rec;
    if (ctl.simming) return; // a sim in progress skips over it
    ctl.queue.push(m.rec);
    if (!ctl.cur) loadNext();
    requestMore();
    return;
  }
  if (m.type === 'batch') {
    for (const r of m.recs) { ctl.history[r.id] = r; ctl.simLast = r; }
    const p = $('#sim-progress'); if (p) p.textContent = `Simulating… ${Math.round(m.progress * 100)}%`;
    return;
  }
  if (m.type === 'simmed' || m.type === 'final') {
    ctl.requested = 0;
    ctl.game.addLog(m.state);
    if (m.type === 'final') { ctl.noMore = true; ctl.finalState = m.state; }
    if (ctl.simming) { finishSim(m.state); return; }
    if (!ctl.cur || ctl.atEnd) loadNext();
  }
}

// Apply the mirror state carried by a record once it has been played (stats can't run ahead).
function applyRecState(rec) {
  for (let id = 0; id <= rec.id; id++) {
    const r = ctl.history[id];
    if (r?.state) { ctl.game.apply(r.state); delete r.state; }
  }
}

function loadNext() {
  if (!ctl.game) return;
  ctl.atEnd = false;
  if (!ctl.queue.length) {
    if (ctl.noMore) { if (ctl.cur) applyRecState(ctl.cur); if (ctl.finalState) ctl.game.apply(ctl.finalState); onFinal(); return; }
    ctl.atEnd = !!ctl.cur;
    requestMore();
    return;
  }
  if (ctl.cur) { applyRecState(ctl.cur); delete ctl.cur.frames; }
  const rec = ctl.queue.shift();
  recFrames(rec);
  const first = !ctl.cur;
  ctl.cur = rec; ctl.ft = 0;
  ctl.renderer.ensureTokens(rec.ids, ctl.game);
  draw(first);
  requestMore();
}

const recDur = (rec) => Math.max(0, (rec.frames.length - 1) * 0.1);
// match time (seconds since kickoff) at the current playback position
function nowElapsed(rec = ctl.cur, ft = ctl.ft) {
  if (!rec) return 0;
  const f = rec.frames[Math.min(rec.frames.length - 1, Math.floor(ft / 0.1))];
  return (rec.half - 1) * HALF_SECS + Math.min(HALF_SECS, f ? f.t : rec.clock0);
}

function advance(dt) {
  if (!ctl.game) return;
  if (ctl.replay) return advanceReplay(dt);
  if (!ctl.cur || ctl.finished) return;
  if (ctl.hold > 0) { ctl.hold -= dt; if (ctl.hold <= 0) $('#toast').classList.add('hidden'); return; }
  if (ctl.atEnd) { if (ctl.queue.length || ctl.noMore) loadNext(); return; }
  ctl.ft += dt * PLAYBACK * ctl.speed;
  catchUpLog();
  if (ctl.ft >= recDur(ctl.cur)) {
    ctl.ft = recDur(ctl.cur);
    const rec = ctl.cur;
    applyRecState(rec);
    catchUpLog(Infinity);
    renderPanels();
    if (rec.goal) { showToast('GOAL!'); ctl.hold = 2.4; }
    else if (rec.kick) ctl.hold = 1.2;
    else if (rec.halfEnd === 2 && !rec.final) { showToast('Penalties!'); ctl.hold = 2; }
    else if (rec.halfEnd === 1) { showToast('Half time', true); ctl.hold = 1.6; }
    loadNext();
  }
}

// Reveal log lines (play-by-play, captions, toasts, score) up to the playback position.
function catchUpLog(upto = nowElapsed()) {
  const g = ctl.game, log = g.log;
  let changed = false;
  while (ctl.shown < log.length && (upto === Infinity ? log[ctl.shown].rec <= ctl.cur.id : log[ctl.shown].half < 3 && elapsedOf(log[ctl.shown]) <= upto + 0.05 && log[ctl.shown].rec <= ctl.cur.id)) {
    const l = log[ctl.shown++];
    changed = true;
    if (l.minor) continue;
    showCaption(l);
    if (l.type === 'woodwork') showToast('Off the woodwork!', true);
    else if (l.type === 'shotEnd' && l.result === 'saved' && l.xg >= 0.15) showToast('Great save!', true);
    else if (l.type === 'card' && l.card === 'red') showToast('Red card!', true);
    else if (l.type === 'penalty') showToast('Penalty!', true);
    else if (l.type === 'pen') showToast(l.scored ? 'Scored!' : 'Missed!', true);
    else if (l.type === 'injury') showToast('Injury', true);
  }
  if (changed) { renderScorebug(); renderPBP(); }
}

function draw(snap = false) {
  const rec = ctl.replay ? ctl.replay.rec : ctl.cur;
  if (!rec?.frames || !ctl.renderer) return;
  const ft = ctl.replay ? ctl.replay.ft : ctl.ft;
  ctl.renderer.draw(rec.frames, rec.ids, ft, ctl.game, { snap, leftSide: rec.half === 1 ? 0 : 1 });
}

let lastT = performance.now(), lastRaf = 0;
function frame(now, fromTimer = false) {
  if (!fromTimer) lastRaf = now;
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (ctl.playing) advance(dt);
  if (!$('#game').classList.contains('hidden')) { draw(); renderClock(); }
  if (!fromTimer) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// fallback when rAF is paused (occluded windows): keep the match moving
setInterval(() => { const now = performance.now(); if (now - lastRaf > 250) frame(now, true); }, 50);

function setPlaying(on) {
  ctl.playing = on;
  $('#btn-play').textContent = on ? '❚❚ Pause' : '▶ Play';
}
$('#btn-play').addEventListener('click', () => {
  if (ctl.finished && !ctl.replay) return;
  setPlaying(!ctl.playing);
});

// ---- sims
function startSim(type, text) {
  if (!ctl.game || ctl.finished || ctl.simming) return;
  if (ctl.replay) endReplay();
  ctl.simming = true;
  setPlaying(false);
  ctl.queue = [];
  const el = $('#final');
  el.innerHTML = `<h3 id="sim-progress">Simulating…</h3><div class="stars">${esc(text)}</div>`;
  el.classList.remove('hidden');
  ctl.client.send({ type });
}
$('#btn-simh').addEventListener('click', () => startSim('simToHalf', 'Skipping to the end of this half.'));
$('#btn-sim').addEventListener('click', () => startSim('simToEnd', 'The rest of the match is being simulated in the background.'));
function finishSim(state) {
  ctl.simming = false;
  ctl.queue = []; ctl.requested = 0; ctl.atEnd = false;
  const last = ctl.simLast || ctl.cur;
  for (const r of ctl.history) if (r) delete r.state;
  ctl.game.apply(state);
  if (last) { recFrames(last); ctl.cur = last; ctl.ft = recDur(last); ctl.renderer.ensureTokens(last.ids, ctl.game); }
  ctl.shown = ctl.game.log.length;
  $('#final').classList.add('hidden');
  renderScorebug(); renderPBP(); renderPanels();
  draw(true);
  if (ctl.noMore) { onFinal(); return; }
  $('#lastplay').innerHTML = `<span class="muted">Simulated to ${ctl.game.half === 2 && ctl.game.clock < 1 ? 'half time' : clockText(ctl.game.elapsed)}. Press <b>Play</b> to keep watching.</span>`;
  ctl.atEnd = true;
  requestMore();
}

function onFinal() {
  if (ctl.finished) return;
  ctl.finished = true;
  setPlaying(false);
  const g = ctl.game;
  ctl.shown = g.log.length;
  renderScorebug(); renderPBP(); renderPanels();
  const [h, a] = g.score;
  const pens = g.pens;
  const winner = h !== a ? g.teams[h > a ? 0 : 1] : pens ? g.teams[pens[0] > pens[1] ? 0 : 1] : null;
  const potm = playersRated(g)[0];
  const scorers = g.log.filter((l) => l.type === 'goal').map((l) => `${clockText(elapsedOf(l))} ${l.text.replace(/^GOAL! /, '').replace(/\. [A-Z]{2,3} \d+–\d+ [A-Z]{2,3}$/, '')}`);
  const hi = highlightItems(), nHi = hi.length ? hi[hi.length - 1].m + 1 : 0;
  $('#lastplay').innerHTML = `<span class="lp-dd">20:00</span>Full time. ${esc(g.teams[0].abbr)} ${h}–${a} ${esc(g.teams[1].abbr)}${pens ? ` (${pens[0]}–${pens[1]} on penalties)` : ''}`;
  const el = $('#final');
  el.innerHTML = `<h3>${winner ? `${esc(winner.city)} ${esc(winner.name)} win!` : "It's a draw"}</h3>
    <div class="fscore">${g.teams[0].abbr} ${h} — ${a} ${g.teams[1].abbr}</div>
    ${pens ? `<div class="fpens">${pens[0]}–${pens[1]} on penalties</div>` : ''}
    ${potm ? `<div class="potm">Player of the match: <b>${esc(potm.p.name)}</b> (${esc(g.teams.find((t) => t.id === potm.p.teamId).abbr)}) · ${potm.r.toFixed(1)}</div>` : ''}
    <div class="stars">${scorers.map(esc).join('<br>') || 'No goals.'}</div>
    <div class="final-btns">
      ${nHi ? `<button class="primary" id="btn-fhi" type="button">▶ Watch highlights (${nHi})</button>` : ''}
      <button id="btn-rematch" type="button">Rematch (new seed)</button><button id="btn-box" type="button">View stats</button></div>`;
  el.classList.remove('hidden');
  $('#btn-rematch').onclick = () => startMatch(g.teams[0], g.teams[1], Math.floor(Math.random() * 1e9), ctl.options);
  $('#btn-box').onclick = () => { el.classList.add('hidden'); selectTab('box'); $('.panel').scrollIntoView({ behavior: 'smooth' }); };
  if (nHi) $('#btn-fhi').onclick = () => startReplay(highlightItems(), 'Highlights');
}

// ==========================================================================
// Replays & highlights
// A clip around one log line: the build-up (up to 8 s, reaching into the previous record)
// and a moment after.
function clipFor(l, before = 8, after = 2.5) {
  const rec = ctl.history[l.rec];
  if (!rec) return [];
  const T = l.clock - rec.clock0;
  const dur = (rec.packed.data.length / rec.packed.stride - 1) * 0.1;
  const out = [{ rec, from: Math.max(0, T - before), to: Math.min(dur, T + after) }];
  const prev = ctl.history[l.rec - 1];
  if (T - before < 0 && prev && prev.half === rec.half && Math.abs(prev.clock1 - rec.clock0) < 0.5) {
    const pd = (prev.packed.data.length / prev.packed.stride - 1) * 0.1;
    out.unshift({ rec: prev, from: Math.max(0, pd + (T - before)), to: pd });
  }
  return out;
}
// Goals, penalties, red cards, the woodwork, and saves from big chances — up to the moment watched.
function highlightItems() {
  const g = ctl.game;
  const items = [];
  for (const l of g.log.slice(0, ctl.shown)) {
    const big = l.type === 'goal' || l.type === 'woodwork' || (l.type === 'card' && l.card === 'red')
      || (l.type === 'shotEnd' && l.result === 'saved' && l.xg >= 0.2);
    if (big) { const m = items.length ? items[items.length - 1].m + 1 : 0; items.push(...clipFor(l, l.type === 'goal' ? 9 : 6).map((c) => ({ ...c, text: l.text, m }))); }
  }
  return items;
}
function startReplay(items, label = 'Replay') {
  if (!items.length) return;
  if (!ctl.replay) ctl.replay = { saved: { playing: ctl.playing } };
  Object.assign(ctl.replay, { items, i: -1, label });
  $('#final').classList.add('hidden');
  $('#toast').classList.add('hidden');
  nextReplayItem();
  setPlaying(true);
}
function nextReplayItem() {
  const R = ctl.replay;
  if (++R.i >= R.items.length) return endReplay();
  const it = R.items[R.i];
  recFrames(it.rec);
  R.rec = it.rec; R.ft = it.from; R.to = it.to;
  ctl.renderer.ensureTokens(it.rec.ids, ctl.game);
  const n = R.items[R.items.length - 1].m + 1;
  showReplayBadge(`${R.label}${n > 1 ? ` ${it.m + 1}/${n}` : ''}`, it.text);
  draw(true);
}
function advanceReplay(dt) {
  const R = ctl.replay;
  R.ft += dt * PLAYBACK * ctl.speed * 0.7; // replays run a touch slower
  if (R.ft >= R.to) nextReplayItem();
}
function endReplay() {
  const R = ctl.replay;
  if (!R) return;
  ctl.replay = null;
  hideReplayBadge();
  if (ctl.cur) { recFrames(ctl.cur); ctl.renderer.ensureTokens(ctl.cur.ids, ctl.game); }
  setPlaying(ctl.finished ? false : R.saved.playing);
  draw(true);
  if (ctl.finished) $('#final').classList.remove('hidden');
}
function showReplayBadge(label, text) {
  let b = $('#replay-badge');
  if (!b) { b = document.createElement('div'); b.id = 'replay-badge'; b.className = 'replay-badge'; $('#stage').appendChild(b); }
  b.innerHTML = `<span class="rb-tag">⟲ ${esc(label)}</span><span class="rb-txt">${esc(text || '')}</span><button type="button" id="rb-exit" class="ghost">Exit replay</button>`;
  b.classList.remove('hidden');
  $('#rb-exit').onclick = () => endReplay();
}
function hideReplayBadge() { $('#replay-badge')?.classList.add('hidden'); }
$('#btn-hi').addEventListener('click', () => {
  const items = highlightItems();
  if (!items.length) { showToast('No highlights yet', true); return; }
  startReplay(items, 'Highlights');
});

// ==========================================================================
// Options
$$('.speed button').forEach((b) => {
  b.classList.toggle('on', Number(b.dataset.speed) === ctl.speed);
  b.addEventListener('click', () => {
    ctl.speed = Number(b.dataset.speed); settings.set('speed', ctl.speed);
    $$('.speed button').forEach((x) => x.classList.toggle('on', x === b));
  });
});
function setCamera(view) {
  ctl.opts.camera = view; settings.set('camera', view);
  if (ctl.renderer) { ctl.renderer.view = view; ctl.renderer.lastScale = null; draw(true); }
  syncCamBtn();
}
function syncCamBtn() { $('#btn-cam').textContent = ctl.opts.camera === 'full' ? 'Follow ball' : 'Full pitch'; }
$('#btn-cam').addEventListener('click', () => setCamera(ctl.opts.camera === 'full' ? 'broadcast' : 'full'));
for (const [id, key] of [['#opt-names', 'names'], ['#opt-passes', 'passes']]) {
  const el = $(id);
  el.checked = ctl.opts[key];
  el.addEventListener('change', () => { ctl.opts[key] = el.checked; settings.set(key, el.checked); applyOpts(); renderPBP(); });
}
$('#opt-sprites').value = ctl.opts.sprites;
$('#opt-sprites').addEventListener('change', (e) => {
  ctl.opts.sprites = e.target.value; settings.set('sprites', ctl.opts.sprites);
  if (ctl.renderer) { ctl.renderer.spriteStyle = ctl.opts.sprites; if (ctl.cur) ctl.renderer.ensureTokens(ctl.cur.ids, ctl.game); }
});
function applyOpts() { $('#stage').classList.toggle('names', ctl.opts.names); }
applyOpts();
document.addEventListener('keydown', (e) => {
  if ($('#game').classList.contains('hidden') || e.target.matches?.('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
  if (e.key === 'c') setCamera(ctl.opts.camera === 'full' ? 'broadcast' : 'full');
  if (e.key === 'f') setTheater(!document.body.classList.contains('theater'));
  if (e.key === 'Escape') { if (ctl.replay) endReplay(); else if (document.body.classList.contains('theater')) setTheater(false); }
});

// ==========================================================================
// Mobile / touch: theater (full screen) and tap-to-pause
const COARSE = window.matchMedia('(pointer: coarse)');
function setTheater(on) {
  if (on === document.body.classList.contains('theater')) return;
  document.body.classList.toggle('theater', on);
  $('#btn-theater').setAttribute('aria-pressed', String(on));
  $('#btn-theater').title = on ? 'Exit full screen (F)' : 'Full screen (F)';
  const root = document.documentElement;
  if (on && !document.fullscreenElement && root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('#btn-theater').addEventListener('click', (e) => { e.stopPropagation(); setTheater(!document.body.classList.contains('theater')); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setTheater(false); });
$('#btn-opts').addEventListener('click', () => {
  const open = $('.controls').classList.toggle('open');
  $('#btn-opts').setAttribute('aria-expanded', String(open));
});
$('#stage').addEventListener('click', (e) => {
  if (!COARSE.matches || e.target.closest('button, a, select, .final, .replay-badge')) return;
  const card = $('#pcard');
  if (card && !card.classList.contains('hidden')) return; // this tap just closes the player card
  if (ctl.finished && !ctl.replay) return;
  $('#btn-play').click();
  showToast(ctl.playing ? '▶' : '❚❚', true);
});

// ==========================================================================
// Overlays
let toastTimer;
function showToast(text, small = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('small', small);
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), small ? 1100 : 2200);
}
let capTimer;
function showCaption(l) {
  const el = $('#caption'), g = ctl.game;
  const team = l.side >= 0 ? g.teams[l.side] : null;
  el.innerHTML = `${team ? `<span class="cap-team" style="background:${g.kits[team.id].main}">${esc(team.abbr)}</span>` : ''}${esc(l.text)}`;
  el.classList.remove('hidden');
  clearTimeout(capTimer);
  capTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  $('#lastplay').innerHTML = `<span class="lp-dd">${clockText(elapsedOf(l))}</span>${team ? `<b>${esc(team.abbr)}</b> ` : ''}${esc(l.text)}`;
}

// Player card: tap or hover a player on the pitch.
function showPlayerCard(id, el, sticky = false) {
  let card = $('#pcard');
  if (!card) {
    card = document.createElement('div'); card.id = 'pcard'; card.className = 'pcard hidden';
    $('#stage').appendChild(card);
    document.addEventListener('click', () => card.classList.add('hidden'));
  }
  if (!id) { if (!card.dataset.sticky) card.classList.add('hidden'); return; }
  const g = ctl.game, p = g.players[id];
  if (!p) return;
  const team = g.teams.find((t) => t.id === p.teamId);
  const s = g.stats.players[id] || {};
  const line = [s.goals && `${s.goals} G`, s.assists && `${s.assists} A`, s.shots && `${s.shots} shots`, s.passes && `${s.cmp}/${s.passes} passes`, s.tackles && `${s.tacklesWon}/${s.tackles} tackles`, s.saves && `${s.saves} saves`].filter(Boolean).join(' · ');
  card.innerHTML = `<div class="pc-head" style="border-color:${g.kits[team.id].main}"><img src="${spriteUrl(p)}" alt="" referrerpolicy="no-referrer">
      <div><b>${esc(p.name)}</b><br><span class="muted">${esc(team.abbr)} · ${POS_NAMES[p.pos]}</span><br>${typeChips(p.types)}</div>
      <div class="pc-ovr">${p.ovr}<small>${p.pos}</small></div></div>
    <div class="bc-stats">${statBars(POKEMON[p.slug], p.pos, p.ratings)}</div>
    <div class="pc-foot">${line || 'No touches yet'}</div>`;
  card.dataset.sticky = sticky ? '1' : '';
  const sr = $('#stage').getBoundingClientRect(), er = el.getBoundingClientRect();
  const x = clampN(er.left - sr.left + 20, 6, sr.width - 236), y = clampN(er.top - sr.top - 40, 6, sr.height - 200);
  card.style.left = `${x}px`; card.style.top = `${y}px`;
  card.classList.remove('hidden');
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// ==========================================================================
// Scorebug
function renderScorebug() {
  const g = ctl.game;
  if (!g) return;
  const score = [0, 0];
  for (const l of g.log.slice(0, ctl.shown)) if (l.type === 'goal') score[l.side]++;
  if (ctl.finished) { score[0] = g.score[0]; score[1] = g.score[1]; }
  const pens = [0, 0];
  let inPens = false;
  for (const l of g.log.slice(0, ctl.shown)) if (l.type === 'pen') { inPens = true; if (l.scored) pens[l.side]++; }
  const side = (i) => {
    const t = g.teams[i];
    const star = POKEMON[parseCard(t.roster.FWD, 'FWD').mon];
    const reds = g.sides[i]?.sentOff?.length || 0;
    return `<div class="sb-team ${i === 0 ? 'away' : 'home'}" style="background:linear-gradient(${i === 0 ? '90deg' : '270deg'}, ${g.kits[t.id].main}55, transparent 70%)">
      <div class="logo" style="background:${g.kits[t.id].main}"><img src="${spriteUrl(star)}" alt="" referrerpolicy="no-referrer"></div>
      <div class="tn"><div class="city">${esc(t.city)}</div><div class="nick"><span class="full">${esc(t.name)}</span><span class="short">${esc(t.abbr)}</span></div><div class="to">${'<i class="red"></i>'.repeat(reds)}</div></div>
      <div class="pts">${score[i]}${inPens ? `<small class="pens">(${pens[i]})</small>` : ''}</div>
      <span class="poss hidden"></span>
    </div>`;
  };
  $('#scorebug').innerHTML = `<div class="sb">${side(0)}<div class="sb-mid"><div class="sb-clock" id="sb-clock">00:00</div><div class="sb-dd" id="sb-half"></div></div>${side(1)}</div>`;
  renderClock(true);
}
let lastClockText = '';
function renderClock(force = false) {
  const g = ctl.game;
  if (!g || !$('#sb-clock')) return;
  const rec = ctl.replay ? ctl.replay.rec : ctl.cur;
  const ft = ctl.replay ? ctl.replay.ft : ctl.ft;
  let t = rec?.frames ? nowElapsed(rec, ft) : 0, half = rec?.half || 1;
  if (ctl.finished && !ctl.replay) t = 2 * HALF_SECS;
  else if (rec?.halfEnd && !ctl.replay && ft >= recDur(rec) - 0.05) t = rec.halfEnd * HALF_SECS;
  if (half === 3) t = 2 * HALF_SECS;
  const label = ctl.finished && !ctl.replay ? 'FULL TIME' : ctl.replay ? 'REPLAY' : half === 3 ? 'PENALTIES' : rec?.halfEnd === 1 && ctl.ft >= recDur(rec) - 0.05 ? 'HALF TIME' : half === 1 ? '1ST HALF' : '2ND HALF';
  const text = `${clockText(t)}|${label}`;
  if (!force && text === lastClockText) return updatePoss(rec, ft);
  lastClockText = text;
  $('#sb-clock').textContent = clockText(t);
  $('#sb-half').textContent = label;
  updatePoss(rec, ft);
}
function updatePoss(rec, ft) {
  if (!rec?.frames) return;
  const f = rec.frames[Math.min(rec.frames.length - 1, Math.floor(ft / 0.1))];
  const own = f?.b[3] ?? -1;
  const side = own < 0 ? -1 : own < rec.ids.length / 2 ? 0 : 1;
  $$('#scorebug .poss').forEach((el, i) => el.classList.toggle('hidden', side !== i || ctl.finished));
}

// ==========================================================================
// Panels
$$('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
function selectTab(tab) {
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  for (const t of ['pbp', 'box', 'players', 'roster']) $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
  settings.set('tab', tab);
}
selectTab(settings.get('tab', 'pbp'));

function renderPanels() {
  const g = ctl.game;
  if (!g) return;
  renderPBP();
  renderBox(g);
  renderPlayers(g);
  renderRosters(g);
}

function renderPBP() {
  const g = ctl.game;
  if (!g) return;
  const items = g.log.slice(0, ctl.shown).filter((l) => ctl.opts.passes || !l.minor);
  const recent = items.slice(-160).reverse();
  let html = '', lastHalf = null;
  for (const l of recent) {
    if (l.half !== lastHalf) { html += `<div class="pbp-q">${['1st half', '2nd half', 'Penalty shootout'][l.half - 1]}</div>`; lastHalf = l.half; }
    const team = l.side >= 0 ? g.teams[l.side] : null;
    const cls = l.type === 'goal' || (l.type === 'pen' && l.scored) ? 'score' : l.type === 'card' || l.type === 'injury' ? 'card' : l.type === 'sub' || l.type === 'coach' ? 'note sub' : l.minor ? 'note' : '';
    const canReplay = ['goal', 'shot', 'woodwork', 'shotEnd', 'card', 'penalty'].includes(l.type) && ctl.history[l.rec];
    html += `<div class="pbp-item ${cls}"><span class="stripe" style="background:${team ? g.kits[team.id].main : 'transparent'}"></span><div>
      <div class="meta">${l.half === 3 ? 'Penalties' : clockText(elapsedOf(l))}${team ? ` · ${team.abbr}` : ''}</div>
      <div class="txt">${esc(l.text)}${canReplay ? ` <button type="button" class="replay-btn" data-i="${g.log.indexOf(l)}" title="Watch it again">▶</button>` : ''}</div></div></div>`;
  }
  $('#tab-pbp').innerHTML = html || '<p class="muted">Kick-off is coming up.</p>';
  $$('#tab-pbp .replay-btn').forEach((b) => b.addEventListener('click', () => {
    const l = g.log[Number(b.dataset.i)];
    startReplay(clipFor(l, l.type === 'goal' ? 9 : 6).map((c) => ({ ...c, text: l.text, m: 0 })), 'Replay');
  }));
}

function renderBox(g) {
  const T = g.stats.teams;
  const poss = T[0].possession + T[1].possession;
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const rows = [
    ['Possession', pct(T[0].possession, poss), pct(T[1].possession, poss)],
    ['Shots', T[0].shots, T[1].shots],
    ['On target', T[0].sot, T[1].sot],
    ['xG', T[0].xg.toFixed(2), T[1].xg.toFixed(2)],
    ['Passes', T[0].passes, T[1].passes],
    ['Pass completion', pct(T[0].cmp, T[0].passes), pct(T[1].cmp, T[1].passes)],
    ['Tackles won', `${T[0].tacklesWon}/${T[0].tackles}`, `${T[1].tacklesWon}/${T[1].tackles}`],
    ['Interceptions', T[0].ints, T[1].ints],
    ['Saves', T[0].saves, T[1].saves],
    ['Corners', T[0].corners, T[1].corners],
    ['Fouls', T[0].fouls, T[1].fouls],
    ['Yellow / red', `${T[0].yellow} / ${T[0].red}`, `${T[1].yellow} / ${T[1].red}`],
  ];
  const head = `<tr><th></th><th>${esc(g.teams[0].abbr)}</th><th>${esc(g.teams[1].abbr)}</th></tr>`;
  $('#tab-box').innerHTML = `<table class="st cmp">${head}${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>
    <p class="muted small">Stats update as each passage of play finishes.</p>`;
}

// Everyone who played, best match rating first.
function playersRated(g) {
  const out = [];
  for (const id in g.players) {
    const r = matchRating(g.players[id], g.stats.players[id]);
    if (r != null) out.push({ id, p: g.players[id], r, s: g.stats.players[id] });
  }
  return out.sort((a, b) => b.r - a.r);
}
function renderPlayers(g) {
  const all = playersRated(g);
  const potm = ctl.finished ? all[0]?.id : null;
  const table = (ti) => {
    const list = all.filter((x) => x.p.teamId === g.teams[ti].id);
    if (!list.length) return '';
    return `<div class="box-team"><span class="chip" style="background:${g.kits[g.teams[ti].id].main}"></span>${esc(g.teams[ti].city)} ${esc(g.teams[ti].name)}</div>
      <table class="st"><tr><th>Player</th><th title="Match rating">Rtg</th><th>G</th><th>A</th><th title="On target / shots">Sh</th><th title="Completed / attempted">Pass</th><th title="Won / attempted">Tkl</th><th>Sv</th></tr>
      ${list.map(({ id, p, r, s }) => `<tr${id === potm ? ' class="potm-row"' : ''}><td class="pl"><img src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">${esc(p.name)} <span class="muted">${p.pos}</span>${id === potm ? ' ⭐' : ''}</td>
        <td><span class="rtg" style="background:${rtgColor(r)}">${r.toFixed(1)}</span></td><td>${s.goals || ''}</td><td>${s.assists || ''}</td><td>${s.shots ? `${s.sot}/${s.shots}` : ''}</td><td>${s.passes ? `${s.cmp}/${s.passes}` : ''}</td><td>${s.tackles ? `${s.tacklesWon}/${s.tackles}` : ''}</td><td>${s.saves || ''}</td></tr>`).join('')}</table>`;
  };
  $('#tab-players').innerHTML = (table(0) + table(1)) || '<p class="muted">No one has touched the ball yet.</p>';
}
const rtgColor = (r) => (r >= 8 ? '#2e7d32' : r >= 7 ? '#558b2f' : r >= 6 ? '#8d7a1a' : r >= 5 ? '#a65b1a' : '#9a2a2a');

// Live depth chart: who's on, energy, the bench, synergies and what the coach is doing.
function renderRosters(g) {
  const team = (ti) => {
    const t = g.teams[ti], side = g.sides[ti];
    if (!side) return '';
    const energyBar = (id) => {
      const e = side.energy?.[id] ?? 100;
      const col = e >= 75 ? 'var(--good)' : e >= 55 ? '#d29922' : 'var(--bad)';
      return `<span class="en" title="${Math.round(e)}% energy${e < 75 ? `, ratings ×${fatigueMult(e).toFixed(2)}` : ''}"><i style="width:${Math.round(e)}%;background:${col}"></i></span> <span class="muted small">${Math.round(e)}%</span>`;
    };
    const status = (id) => (side.sentOff.includes(id) ? '<span class="inj">🟥 Sent off</span>' : side.injured.includes(id) ? '<span class="inj">🚑 Injured</span>' : energyBar(id));
    const row = (id, label) => {
      const p = g.players[id];
      if (!p) return '';
      return `<tr class="${side.sentOff.includes(id) ? 'dim' : ''}"><td class="pl"><img src="${spriteUrl(p)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div><b>${esc(p.name)}</b> <span class="muted">${label}</span><br>${typeChips(p.types)}</div></td><td class="ovr">${p.ovr}</td><td class="best">${status(id)}</td></tr>`;
    };
    const onIds = Object.entries(side.onField);
    const bench = Object.keys(g.players).filter((id) => g.players[id].teamId === t.id && !onIds.some(([, x]) => x === id));
    const c = side.coach?.eff || t.coach;
    const mood = { chasing: 'Chasing the game', protecting: 'Protecting the lead' }[side.coach?.mood] || 'Normal shape';
    const meter = (label, v) => `<span>${label}</span><div class="meter"><span style="width:${Math.round(v * 100)}%"></span></div>`;
    return `<div class="box-team"><span class="chip" style="background:${g.kits[t.id].main}"></span>${esc(t.city)} ${esc(t.name)} <span class="muted small">${formationOf(t.roster).name}</span></div>
      <div class="b-syn">${synergyChips(side.synergy?.counts, side.synergy?.active || {}, { compact: true, onlyActive: true }) || '<span class="muted small">No active synergies</span>'}</div>
      <div class="coach-box"><div class="small"><b>${esc(t.coach.name)}</b> · ${esc(t.coach.style)} · <span class="mood">${mood}</span>${side.subs ? ` · ${side.subs} sub${side.subs > 1 ? 's' : ''}` : ''}</div>
        <div class="meters">${meter('Tempo', c.tempo)}${meter('Press', c.press)}${meter('Direct', c.directness)}${meter('Width', c.width)}${meter('Shooting', c.shootRange)}${meter('Aggression', c.aggression)}</div></div>
      <table class="st"><tr><th>On the pitch</th><th>OVR</th><th>Energy</th></tr>${onIds.map(([slot, id]) => row(id, `${g.players[id]?.pos}${slot === 'FLEX' ? ' (FLEX)' : ''}`)).join('')}
      <tr><th>Bench</th><th></th><th></th></tr>${bench.map((id) => row(id, g.players[id].pos)).join('')}</table>`;
  };
  $('#tab-roster').innerHTML = team(0) + team(1) + '<p class="muted small">Energy drains with running (Stamina = HP). Below 75% ratings fade; coaches rotate tired players at stoppages and rested ones can come back on.</p>';
}

// ==========================================================================
// Boot
wireGuide();
renderTeamGrid();
const params = new URLSearchParams(location.search);
const qHome = findTeam(params.get('home')), qAway = findTeam(params.get('away'));
if (qHome && qAway && qHome !== qAway) {
  sel.home = qHome.id; sel.away = qAway.id; syncSetup();
  startMatch(qHome, qAway, Number(params.get('seed')) || Math.floor(Math.random() * 1e9), { knockout: params.get('ko') === '1', injuries: params.get('inj') !== '0' });
} else showScreen(location.hash === '#cards' ? 'guide' : settings.get('screen', 'setup'));

