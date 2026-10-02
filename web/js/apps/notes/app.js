// Notes: the full-screen app for posting and taking down notes.
import { createKeyboard } from '../../keyboard.js';
import { animateLayout, el, icons, nudge, reconcile, toast } from '../../ui.js';
import { name } from './meta.js';
import { countLabel, timeAgo } from './format.js';

const TIME_REFRESH_MS = 60 * 1000;

export function mount(root, { services, kiosk }) {
  const { notes } = services;
  let firstRender = true;
  let keyboard = null;

  const meta = el('p', { class: 'notes-app__meta' });
  const input = el('input', {
    class: 'add-bar__input',
    type: 'text',
    name: 'note',
    placeholder: 'Write a note for everyone',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'send',
    maxlength: '200',
    'aria-label': 'Note to post',
    inputmode: kiosk ? 'none' : null,
  });
  const submitButton = el('button', { class: 'add-bar__submit', type: 'submit', text: 'Post', disabled: true });
  const form = el(
    'form',
    { class: 'add-bar', onsubmit: (event) => (event.preventDefault(), postNote()) },
    el('span', { class: 'add-bar__plus', html: icons.plus }),
    input,
    submitButton,
  );
  input.addEventListener('input', () => {
    submitButton.disabled = !input.value.trim();
  });

  const grid = el('ul', { class: 'notes-app__grid', 'aria-label': 'Notes' });
  const empty = el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-state__art', html: icons.note }),
    el('p', { class: 'empty-state__title', text: 'No notes yet' }),
    el('p', { class: 'empty-state__text', text: 'Leave a message for everyone at home.' }),
  );
  const view = el(
    'div',
    { class: 'notes-app' },
    el('header', { class: 'notes-app__header' }, el('h1', { class: 'notes-app__title', text: name }), meta),
    form,
    el('div', { class: 'notes-app__scroll' }, grid, empty),
  );
  root.append(view);

  if (kiosk) {
    keyboard = createKeyboard({
      input,
      enterLabel: 'Post',
      onEnter: postNote,
      onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
    });
    root.append(keyboard.node);
  }

  async function postNote() {
    const text = input.value.trim();
    if (!text) {
      nudge(form);
      return;
    }
    input.value = '';
    input.dispatchEvent(new Event('input'));
    try {
      await notes.addNote(text);
      keyboard?.hide();
    } catch (err) {
      toast(err.message);
      if (!input.value) {
        input.value = text;
        input.dispatchEvent(new Event('input'));
      }
    }
  }

  function removeNote(noteId) {
    notes.removeNote(noteId).then(
      () => toast('Note taken down', { action: 'Undo', onAction: () => notes.restoreNotes([noteId]).catch((e) => toast(e.message)) }),
      (err) => toast(err.message),
    );
  }

  function createCard() {
    const card = el('li', { class: 'note-card' });
    card.append(
      el('p', { class: 'note-card__text' }),
      el('p', { class: 'note-card__time' }),
      el('button', {
        class: 'note-card__remove',
        type: 'button',
        html: icons.close,
        onclick: () => removeNote(card.dataset.key),
      }),
    );
    return card;
  }

  function updateCard(card, note) {
    const [text, time, remove] = card.children;
    card.className = `note-card note-card--${note.color}`;
    if (text.textContent !== note.text) {
      text.textContent = note.text;
      remove.setAttribute('aria-label', `Take down note: ${note.text}`);
    }
    time.textContent = timeAgo(note.created);
  }

  function render(state) {
    meta.textContent = countLabel(state.notes.length);
    const apply = () => {
      reconcile(grid, state.notes, (n) => n.id, createCard, updateCard);
      grid.hidden = state.notes.length === 0;
      empty.hidden = state.notes.length > 0;
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(view, apply);
    }
  }

  const unsubscribe = notes.subscribe(render);
  const clock = setInterval(() => {
    const byId = new Map(notes.getNotes().map((n) => [n.id, n]));
    for (const card of grid.children) {
      const note = byId.get(card.dataset.key);
      if (note) card.children[1].textContent = timeAgo(note.created);
    }
  }, TIME_REFRESH_MS);
  render({ notes: notes.getNotes() });

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
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}
