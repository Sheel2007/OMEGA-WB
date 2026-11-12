// Unspeakable: the full-screen ledger. Every entry is blacked out until someone
// taps it, and covers itself again a few seconds later.
import { createKeyboard } from '../../keyboard.js';
import { animateLayout, el, icons, nudge, reconcile, toast } from '../../ui.js';
import { name } from './meta.js';
import { caseLabel, countLabel, numbered, timeAgo } from './format.js';

const TIME_REFRESH_MS = 60 * 1000;
// How long a tapped entry stays readable before it blacks itself out again.
const REVEAL_MS = 8000;

export function mount(root, { services, kiosk }) {
  const { unspeakable } = services;
  let entries = [];
  let firstRender = true;
  let keyboard = null;
  // One timer per entry that's been tapped open.
  const reveals = new Map();

  const meta = el('p', { class: 'ledger-app__meta' });
  const input = el('input', {
    class: 'add-bar__input',
    type: 'text',
    name: 'unspeakable',
    placeholder: 'What happened that we never speak of?',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'send',
    maxlength: '200',
    'aria-label': 'Unspeakable thing to seal',
    inputmode: kiosk ? 'none' : null,
  });
  const submitButton = el('button', { class: 'add-bar__submit', type: 'submit', text: 'Seal', disabled: true });
  const form = el(
    'form',
    { class: 'add-bar', onsubmit: (event) => (event.preventDefault(), seal()) },
    el('span', { class: 'add-bar__plus', html: icons.plus }),
    input,
    submitButton,
  );
  input.addEventListener('input', () => {
    submitButton.disabled = !input.value.trim();
  });

  const grid = el('ul', { class: 'ledger-app__grid', 'aria-label': 'Unspeakable things' });
  const empty = el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-state__art', html: icons.lock }),
    el('p', { class: 'empty-state__title', text: 'Nothing on the record' }),
    el('p', { class: 'empty-state__text', text: 'Either this house behaves, or someone is covering for it.' }),
  );
  const view = el(
    'div',
    { class: 'ledger-app' },
    el('header', { class: 'ledger-app__header' }, el('h1', { class: 'ledger-app__title', text: name }), meta),
    form,
    el('div', { class: 'ledger-app__scroll' }, grid, empty),
  );
  root.append(view);

  if (kiosk) {
    keyboard = createKeyboard({
      input,
      enterLabel: 'Seal',
      onEnter: seal,
      onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
    });
    root.append(keyboard.node);
  }

  async function seal() {
    const text = input.value.trim();
    if (!text) {
      nudge(form);
      return;
    }
    input.value = '';
    input.dispatchEvent(new Event('input'));
    try {
      await unspeakable.addEntry(text);
      keyboard?.hide();
      toast('Sealed. We never speak of it.');
    } catch (err) {
      toast(err.message);
      if (!input.value) {
        input.value = text;
        input.dispatchEvent(new Event('input'));
      }
    }
  }

  function strike(entryId) {
    forget(entryId);
    unspeakable.removeEntry(entryId).then(
      () =>
        toast('Struck from the record', {
          action: 'Undo',
          onAction: () => unspeakable.restoreEntries([entryId]).catch((e) => toast(e.message)),
        }),
      (err) => toast(err.message),
    );
  }

  // Revealing an entry

  function forget(entryId) {
    clearTimeout(reveals.get(entryId));
    reveals.delete(entryId);
  }

  function setVeilLabel(card) {
    const label = card.querySelector('.ledger-card__case').textContent;
    card.firstChild.setAttribute(
      'aria-label',
      card.classList.contains('is-revealed') ? `Hide ${label} again` : `Reveal unspeakable thing ${label}`,
    );
  }

  function cover(card) {
    forget(card.dataset.key);
    card.classList.remove('is-revealed');
    setVeilLabel(card);
  }

  function reveal(card) {
    const entryId = card.dataset.key;
    if (reveals.has(entryId)) {
      cover(card);
      return;
    }
    card.classList.add('is-revealed');
    setVeilLabel(card);
    reveals.set(entryId, setTimeout(() => cover(card), REVEAL_MS));
  }

  function hideAll() {
    for (const entryId of [...reveals.keys()]) {
      const card = grid.querySelector(`[data-key="${entryId}"]`);
      if (card) cover(card);
      else forget(entryId);
    }
  }

  // Cards: a case number, a redaction bar over the text, and a whole-card button
  // that lifts it for a few seconds.

  function createCard() {
    const card = el('li', { class: 'ledger-card' });
    card.append(
      el(
        'button',
        { class: 'ledger-card__veil', type: 'button', onclick: () => reveal(card) },
        el('span', { class: 'ledger-card__case' }),
        el('p', { class: 'ledger-card__text' }, el('span', { class: 'ledger-card__redacted' })),
        el('p', { class: 'ledger-card__time' }),
      ),
      el('button', {
        class: 'ledger-card__strike',
        type: 'button',
        html: icons.close,
        onclick: () => strike(card.dataset.key),
      }),
    );
    return card;
  }

  function updateCard(card, entry) {
    const [veil, strikeButton] = card.children;
    const [caseNumber, text, time] = veil.children;
    const label = caseLabel(entry.number);
    caseNumber.textContent = label;
    if (text.firstChild.textContent !== entry.text) text.firstChild.textContent = entry.text;
    setVeilLabel(card);
    strikeButton.setAttribute('aria-label', `Strike ${label} from the record`);
    time.textContent = timeAgo(entry.created);
  }

  function render(state) {
    entries = numbered(state.entries);
    meta.textContent = countLabel(entries.length);
    const apply = () => {
      reconcile(grid, entries, (e) => e.id, createCard, updateCard);
      grid.hidden = entries.length === 0;
      empty.hidden = entries.length > 0;
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(view, apply);
    }
  }

  const unsubscribe = unspeakable.subscribe(render);
  const clock = setInterval(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const card of grid.children) {
      const entry = byId.get(card.dataset.key);
      if (entry) card.firstChild.children[2].textContent = timeAgo(entry.created);
    }
  }, TIME_REFRESH_MS);
  render({ entries: unspeakable.getEntries() });

  return {
    intent(action) {
      if (action !== 'add') return;
      if (keyboard) keyboard.show();
      else input.focus();
    },
    closeKeyboard() {
      keyboard?.hide();
    },
    unmount() {
      unsubscribe();
      clearInterval(clock);
      hideAll();
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}
