// A touch keyboard for the kiosk. Chromium in kiosk mode on a Pi doesn't
// reliably bring up the system keyboard, so the board brings its own.
import { el, icons, itemGlyph } from './ui.js';

const REPEAT_DELAY_MS = 450;
const REPEAT_EVERY_MS = 70;
const PRESS_FLASH_MS = 150;
const SUGGESTION_COUNT = 3;

// Each row is 23 half-key columns wide; letters span 2.
const LAYOUTS = {
  letters: [
    [...'qwertyuiop', { key: 'backspace', span: 3 }],
    [{ key: 'spacer', span: 1 }, ...'asdfghjkl', { key: 'enter', span: 4 }],
    [{ key: 'shift', span: 3 }, ...'zxcvbnm', "'", '-', '.'],
    [{ key: 'mode', span: 4, label: '123' }, { key: 'space', span: 15 }, { key: 'hide', span: 4 }],
  ],
  symbols: [
    [...'1234567890', { key: 'backspace', span: 3 }],
    [{ key: 'spacer', span: 1 }, '-', '/', ':', '(', ')', '&', '@', '"', ',', { key: 'enter', span: 4 }],
    [{ key: 'spacer', span: 3 }, '%', '+', '=', '#', '*', '!', '?', "'", '.', '$'],
    [{ key: 'mode', span: 4, label: 'ABC' }, { key: 'space', span: 15 }, { key: 'hide', span: 4 }],
  ],
};

const ALT_KEYS = new Set(['backspace', 'shift', 'mode', 'hide']);

// `input` is the field being typed into; an app with several (title, location, notes)
// passes them all as `inputs` and the keyboard follows whichever has the caret.
export function createKeyboard({ input, inputs = [input], enterLabel = 'Add', onEnter, onPick, getSuggestions, onToggle }) {
  const fields = inputs.filter(Boolean);
  const lifetime = new AbortController();
  let active = fields[0];
  let layout = 'letters';
  let shift = true;
  let open = false;
  let repeatTimer = null;
  let releaseCurrent = null;

  const suggestions = el('div', { class: 'keyboard__suggestions' });
  suggestions.hidden = !getSuggestions;
  const rows = el('div', { class: 'keyboard__rows' });
  const node = el(
    'div',
    { class: 'keyboard', role: 'group', 'aria-label': 'On-screen keyboard' },
    el('div', { class: 'keyboard__inner' }, suggestions, rows),
  );

  function renderKeys() {
    rows.replaceChildren(
      ...LAYOUTS[layout].flat().map((spec) => {
        const def = typeof spec === 'string' ? { key: 'char', char: spec } : spec;
        const button = el('button', {
          type: 'button',
          tabindex: '-1',
          class: `keyboard__key keyboard__key--${def.key}${ALT_KEYS.has(def.key) ? ' keyboard__key--alt' : ''}`,
          style: `--span: ${def.span || 2}`,
          dataset: { key: def.key, char: def.char ?? '' },
        });
        switch (def.key) {
          case 'char':
            button.textContent = shift ? def.char.toUpperCase() : def.char;
            break;
          case 'backspace':
            button.innerHTML = icons.backspace;
            button.setAttribute('aria-label', 'Delete');
            break;
          case 'enter':
            button.textContent = enterLabel;
            break;
          case 'shift':
            button.innerHTML = icons.shift;
            button.setAttribute('aria-label', 'Shift');
            button.setAttribute('aria-pressed', String(shift));
            break;
          case 'mode':
            button.textContent = def.label;
            break;
          case 'space':
            button.setAttribute('aria-label', 'Space');
            break;
          case 'hide':
            button.innerHTML = icons.hideKeyboard;
            button.setAttribute('aria-label', 'Hide keyboard');
            break;
          case 'spacer':
            button.disabled = true;
            break;
        }
        return button;
      }),
    );
  }

  function renderSuggestions() {
    if (!getSuggestions) return;
    const names = getSuggestions(active.value).slice(0, SUGGESTION_COUNT);
    suggestions.replaceChildren(
      ...Array.from({ length: SUGGESTION_COUNT }, (_, i) => {
        const name = names[i];
        const button = el('button', { type: 'button', tabindex: '-1', class: 'keyboard__suggestion' });
        if (name) {
          button.dataset.pick = name;
          button.append(itemGlyph(name, 'keyboard__glyph'), el('span', { class: 'keyboard__suggestion-text', text: name }));
        }
        return button;
      }),
    );
  }

  function changed() {
    active.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insert(text) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    active.setRangeText(text, start, end, 'end');
    changed();
  }

  function backspace() {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    if (start === end && start === 0) return;
    active.setRangeText('', start === end ? start - 1 : start, end, 'end');
    changed();
  }

  function setShift(next) {
    if (shift === next) return;
    shift = next;
    renderKeys();
  }

  function press(key, char) {
    switch (key) {
      case 'char':
        insert(shift ? char.toUpperCase() : char);
        if (layout === 'letters') setShift(false);
        break;
      case 'space':
        if (active.value && !active.value.endsWith(' ')) insert(' ');
        break;
      case 'backspace':
        backspace();
        break;
      case 'enter':
        onEnter();
        break;
      case 'shift':
        setShift(!shift);
        break;
      case 'mode':
        layout = layout === 'letters' ? 'symbols' : 'letters';
        renderKeys();
        break;
      case 'hide':
        hide();
        break;
    }
  }

  function stopRepeat() {
    clearTimeout(repeatTimer);
    clearInterval(repeatTimer);
    repeatTimer = null;
  }

  // pointerdown + preventDefault keeps the caret in the text field.
  node.addEventListener(
    'pointerdown',
    (event) => {
      event.preventDefault();
      const pick = event.target.closest('[data-pick]');
      if (pick) {
        pick.classList.add('keyboard__suggestion--down');
        setTimeout(() => pick.classList.remove('keyboard__suggestion--down'), PRESS_FLASH_MS);
        onPick?.(pick.dataset.pick);
        return;
      }
      const key = event.target.closest('.keyboard__key');
      if (!key || key.disabled) return;
      releaseCurrent?.();
      key.classList.add('keyboard__key--down');
      // One set of release listeners per press, all removed together.
      const pressListeners = new AbortController();
      releaseCurrent = () => {
        key.classList.remove('keyboard__key--down');
        stopRepeat();
        pressListeners.abort();
        releaseCurrent = null;
      };
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
        key.addEventListener(type, () => releaseCurrent?.(), { signal: pressListeners.signal });
      }
      press(key.dataset.key, key.dataset.char);
      if (key.dataset.key === 'backspace') {
        repeatTimer = setTimeout(() => {
          repeatTimer = setInterval(backspace, REPEAT_EVERY_MS);
        }, REPEAT_DELAY_MS);
      }
    },
    { signal: lifetime.signal },
  );

  const listen = { signal: lifetime.signal };
  for (const field of fields) {
    field.addEventListener(
      'input',
      () => {
        if (field !== active) return;
        if (!field.value) setShift(true);
        renderSuggestions();
      },
      listen,
    );
    const focus = () => {
      active = field;
      show();
    };
    field.addEventListener('pointerdown', focus, listen);
    field.addEventListener('focus', focus, listen);
    field.addEventListener('keydown', (event) => event.key === 'Escape' && hide(), listen);
  }

  function show() {
    if (open) {
      // Moving between fields keeps the keyboard up; only the shift state follows.
      setShift(!active.value);
      renderSuggestions();
      if (document.activeElement !== active) active.focus({ preventScroll: true });
      return;
    }
    open = true;
    layout = 'letters';
    shift = !active.value;
    renderKeys();
    renderSuggestions();
    node.classList.add('keyboard--open');
    document.documentElement.style.setProperty('--kb-h', `${node.offsetHeight}px`);
    onToggle?.(true);
    if (document.activeElement !== active) active.focus({ preventScroll: true });
  }

  function hide() {
    if (!open) return;
    open = false;
    releaseCurrent?.();
    node.classList.remove('keyboard--open');
    document.documentElement.style.setProperty('--kb-h', '0px');
    onToggle?.(false);
    active.blur();
  }

  renderKeys();
  renderSuggestions();

  return {
    node,
    show,
    hide,
    // Which field the keys type into, when an app wants to put the caret somewhere.
    focusField(field) {
      if (!fields.includes(field)) return;
      active = field;
      show();
    },
    refresh: renderSuggestions,
    destroy() {
      hide();
      lifetime.abort();
      node.remove();
    },
  };
}
