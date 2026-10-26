// The jukebox console: the only way to reach it is a secret knock on the date
// above the clock. There is no button, no icon, no entry in the app library and
// nothing in the menu — finding it by accident would mean tapping the same line
// five times inside three seconds.
//
// Phones only. The board builds the player instead (jukebox.js), so the sound
// comes out of the monitor and never out of the phone doing the asking.
import { knock } from './knock.js';
import { el, icons } from './ui.js';

const WORDS = {
  idle: 'Nothing playing',
  loading: 'Starting it off…',
  playing: 'Playing on the board',
  blocked: 'The board wouldn’t start the sound',
  error: 'YouTube wouldn’t play that',
};

export function createPhoneJukebox({ jukebox, knockOn }) {
  const lifetime = new AbortController();
  let taps = [];
  let unsubscribe = null;

  const link = field({ type: 'url', name: 'board-link', placeholder: 'Paste a YouTube link', label: 'YouTube link' });
  const play = el('button', { class: 'jukebox__button jukebox__button--go', type: 'submit', text: 'Play' });
  const form = el('form', { class: 'jukebox__row', onsubmit: (event) => (event.preventDefault(), start()) }, link, play);
  const stop = el('button', {
    class: 'jukebox__button jukebox__button--stop',
    type: 'button',
    text: 'Stop',
    onclick: () => run(() => jukebox.stop()),
  });
  const volume = el('input', {
    class: 'jukebox__volume-slider',
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    'aria-label': 'Volume',
    onchange: () => run(() => jukebox.setVolume(Number(volume.value))),
  });
  const console_ = el(
    'div',
    { class: 'jukebox__console' },
    form,
    el('div', { class: 'jukebox__volume' }, el('span', { class: 'jukebox__label', text: 'Volume' }), volume, stop),
  );

  const status = el('p', { class: 'jukebox__status', role: 'status' });
  const sheet = el(
    'div',
    { class: 'jukebox__sheet' },
    el(
      'div',
      { class: 'jukebox__head' },
      el('h2', { class: 'jukebox__title', text: 'Jukebox' }),
      el('button', { class: 'jukebox__close', type: 'button', 'aria-label': 'Close', html: icons.close, onclick: close }),
    ),
    console_,
    status,
  );
  const node = el('div', { class: 'jukebox', role: 'dialog', 'aria-label': 'Jukebox', onclick: (e) => e.target === node && close() }, sheet);
  node.hidden = true;

  function field({ type, name, placeholder, label }) {
    return el('input', {
      class: 'jukebox__field',
      type,
      name,
      placeholder,
      'aria-label': label,
      autocomplete: 'off',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
    });
  }

  function show(text, bad = false) {
    status.textContent = text;
    status.classList.toggle('jukebox__status--bad', bad);
  }

  // Runs a command and puts whatever went wrong on the status line.
  async function run(command) {
    try {
      await command();
      return true;
    } catch (err) {
      show(err.message, true);
      return false;
    }
  }

  async function start() {
    if (!link.value.trim()) return;
    play.disabled = true;
    const ok = await run(() => jukebox.play(link.value));
    play.disabled = false;
    if (ok) link.value = '';
  }

  function render(state) {
    if (document.activeElement !== volume) volume.value = String(state.volume);
    const bad = state.player === 'blocked' || state.player === 'error';
    show(state.detail ?? WORDS[state.player] ?? '', bad);
  }

  function open() {
    node.hidden = false;
    // Only listen while it's up: the board gets the same state anyway.
    unsubscribe = unsubscribe ?? jukebox.subscribe(render);
    link.focus();
  }

  function close() {
    node.hidden = true;
    unsubscribe?.();
    unsubscribe = null;
  }

  // The way in: five taps on the same line, within three seconds.
  knockOn?.addEventListener(
    'pointerup',
    () => {
      const result = knock(taps, Date.now());
      taps = result.taps;
      if (result.opened) open();
    },
    { signal: lifetime.signal },
  );

  return {
    node,
    open,
    destroy() {
      lifetime.abort();
      unsubscribe?.();
      node.remove();
    },
  };
}
