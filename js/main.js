// UI controller: screens and navigation.
import { renderGuide, wireGuide } from './guide.js';
import { $, $$ } from './ui.js';
import { settings } from './storage.js';

const SCREENS = ['setup', 'guide'];
function showScreen(name) {
  if (!SCREENS.includes(name)) name = 'setup';
  for (const id of SCREENS) $(`#${id}`).classList.toggle('hidden', id !== name);
  $$('.modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === name));
  if (name === 'guide') renderGuide();
  settings.set('screen', name);
  window.scrollTo(0, 0);
}
$$('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.mode)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.goto)));

wireGuide();
showScreen(location.hash === '#cards' ? 'guide' : settings.get('screen', 'guide'));
