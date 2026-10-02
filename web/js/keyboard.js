// A touch keyboard for the kiosk. Chromium in kiosk mode on a Pi doesn't
// reliably bring up the system keyboard, so the board brings its own.
import { el, icons, itemGlyph } from './ui.js';

const REPEAT_DELAY_MS = 450;
const REPEAT_EVERY_MS = 70;

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

export function createKeyboard({ input, onEnter, onPick, getSuggestions, onToggle }) {
  let layout = 'letters';
  let shift = true;
  let open = false;
  let repeatTimer = null;

  const suggestions = el('div', { class: 'keyboard__suggestions' });
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
        const span = def.span || 2;
        const button = el('button', {
          type: 'button',
          tabindex: '-1',
          class: `key key--${def.key}`,
          style: `--span: ${span}`,
          dataset: { key: def.key, char: def.char ?? '' },
        });
        switch (def.key) {
          case 'char':
            button.textContent = shift ? def.char.toUpperCase() : def.char;
            break;
          case 'backspace':
            button.classList.add('key--alt');
            button.innerHTML = icons.backspace;
            button.setAttribute('aria-label', 'Delete');
            break;
          case 'enter':
            button.textContent = 'Add';
            break;
          case 'shift':
            button.classList.add('key--alt');
            button.innerHTML = icons.shift;
            button.setAttribute('aria-label', 'Shift');
            button.setAttribute('aria-pressed', String(shift));
            break;
          case 'mode':
            button.classList.add('key--alt');
            button.textContent = def.label;
            break;
          case 'space':
            button.setAttribute('aria-label', 'Space');
            break;
          case 'hide':
            button.classList.add('key--alt');
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
    const names = getSuggestions(input.value).slice(0, 3);
    suggestions.replaceChildren(
      ...[0, 1, 2].map((i) => {
        const name = names[i];
        const button = el('button', { type: 'button', tabindex: '-1', class: 'suggestion' });
        if (name) {
          button.dataset.pick = name;
          button.append(itemGlyph(name, 'suggestion__glyph'), el('span', { text: name }));
        }
        return button;
      }),
    );
  }

  function changed() {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insert(text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, start, end, 'end');
    changed();
  }

  function backspace() {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    if (start === end && start === 0) return;
    input.setRangeText('', start === end ? start - 1 : start, end, 'end');
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
        if (input.value && !input.value.endsWith(' ')) insert(' ');
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
  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      pick.classList.add('is-down');
      setTimeout(() => pick.classList.remove('is-down'), 150);
      onPick(pick.dataset.pick);
      return;
    }
    const key = event.target.closest('.key');
    if (!key || key.disabled) return;
    key.classList.add('is-down');
    const release = () => {
      key.classList.remove('is-down');
      stopRepeat();
    };
    key.addEventListener('pointerup', release, { once: true });
    key.addEventListener('pointerleave', release, { once: true });
    key.addEventListener('pointercancel', release, { once: true });
    press(key.dataset.key, key.dataset.char);
    if (key.dataset.key === 'backspace') {
      repeatTimer = setTimeout(() => {
        repeatTimer = setInterval(backspace, REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    }
  });

  input.addEventListener('input', () => {
    if (!input.value) setShift(true);
    renderSuggestions();
  });
  input.addEventListener('pointerdown', () => show());
  input.addEventListener('focus', () => show());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });

  function show() {
    if (open) return;
    open = true;
    layout = 'letters';
    shift = !input.value;
    renderKeys();
    renderSuggestions();
    node.classList.add('is-open');
    document.documentElement.style.setProperty('--kb-h', `${node.offsetHeight}px`);
    onToggle?.(true);
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  }

  function hide() {
    if (!open) return;
    open = false;
    stopRepeat();
    node.classList.remove('is-open');
    document.documentElement.style.setProperty('--kb-h', '0px');
    onToggle?.(false);
    input.blur();
  }

  renderKeys();
  renderSuggestions();

  return {
    node,
    show,
    hide,
    refresh: renderSuggestions,
    destroy() {
      hide();
      node.remove();
    },
  };
}
