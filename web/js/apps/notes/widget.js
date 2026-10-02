// Notes: the home-screen widget, showing the newest notes.
import { appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { countLabel } from './format.js';
import * as meta from './meta.js';

// Newest first; fitRows() hides whichever of these don't fit.
const NOTES_IN_WIDGET = 4;

export function createWidget({ services, openApp }) {
  const { notes } = services;
  const count = el('p', { class: 'widget-head__meta' });
  const list = el('ul', { class: 'notes-widget__list' });
  const more = el('p', { class: 'notes-widget__more' });
  const empty = el(
    'div',
    { class: 'notes-widget__empty' },
    el('p', { class: 'notes-widget__empty-title', text: 'No notes yet' }),
    el('p', { class: 'notes-widget__empty-text', text: 'Tap + to leave one.' }),
  );
  const node = el('article', { class: 'notes-widget', 'aria-label': meta.name });
  node.append(
    el('a', {
      class: 'widget__link',
      href: `#/app/${meta.id}`,
      'aria-label': `Open ${meta.name}`,
      onclick: (event) => {
        event.preventDefault();
        openApp(meta.id, { origin: node });
      },
    }),
    el(
      'header',
      { class: 'widget-head' },
      appIcon(meta, 'widget-head__icon'),
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), count),
      el('button', {
        class: 'widget-head__action',
        type: 'button',
        'aria-label': 'Write a note',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'add' }),
      }),
    ),
    list,
    more,
    empty,
  );

  let total = 0;
  const fit = () => fitRows(list, more, total, (hidden) => `${hidden} more in Notes`);

  function render(state) {
    const all = state.notes;
    total = all.length;
    count.textContent = countLabel(all.length);
    reconcile(
      list,
      all.slice(0, NOTES_IN_WIDGET),
      (n) => n.id,
      () => el('li', { class: 'note-card note-card--mini' }, el('p', { class: 'note-card__text' })),
      (card, note) => {
        card.className = `note-card note-card--mini note-card--${note.color}`;
        card.firstChild.textContent = note.text;
      },
    );
    list.hidden = all.length === 0;
    empty.hidden = all.length > 0;
    fit();
  }

  const unsubscribe = notes.subscribe(render);
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(list);
  render({ notes: notes.getNotes() });

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
    },
  };
}
