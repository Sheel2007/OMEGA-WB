// Unspeakable: the home-screen widget. The newest entries, each under its own
// censor bar, so the board says how much it's holding without saying what.
import { appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { caseLabel, numbered, shortCountLabel } from './format.js';
import * as meta from './meta.js';

// Newest first; fitRows() hides whichever of these don't fit.
const ENTRIES_IN_WIDGET = 4;

export function createWidget({ services, openApp }) {
  const { unspeakable } = services;
  const count = el('p', { class: 'widget-head__meta' });
  const list = el('ul', { class: 'ledger-widget__list' });
  const more = el('p', { class: 'ledger-widget__more' });
  const empty = el(
    'div',
    { class: 'ledger-widget__empty' },
    el('p', { class: 'ledger-widget__empty-title', text: 'Nothing on the record' }),
    el('p', { class: 'ledger-widget__empty-text', text: 'Suspicious. Tap + to fix that.' }),
  );
  const node = el('article', { class: 'ledger-widget', 'aria-label': meta.name });
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
        'aria-label': 'Seal an unspeakable thing',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'add' }),
      }),
    ),
    list,
    more,
    empty,
  );

  let total = 0;
  const fit = () => fitRows(list, more, total, (hidden) => `${hidden} more on the record`);

  function render(state) {
    const all = numbered(state.entries);
    total = all.length;
    count.textContent = shortCountLabel(all.length);
    reconcile(
      list,
      all.slice(0, ENTRIES_IN_WIDGET),
      (e) => e.id,
      () =>
        el(
          'li',
          { class: 'ledger-card ledger-card--mini' },
          el('span', { class: 'ledger-card__case' }),
          el('span', { class: 'ledger-card__bar' }),
        ),
      (card, entry) => {
        const [caseNumber, bar] = card.children;
        caseNumber.textContent = caseLabel(entry.number);
        // Never the text itself: nothing on the board gives an entry away.
        card.setAttribute('aria-label', `${caseLabel(entry.number)}, sealed`);
        // A bar as long as the entry, within reason, so the board looks like a file.
        bar.style.width = `${Math.min(100, 40 + entry.text.length * 1.6)}%`;
      },
    );
    list.hidden = all.length === 0;
    empty.hidden = all.length > 0;
    fit();
  }

  const unsubscribe = unspeakable.subscribe(render);
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(list);
  render({ entries: unspeakable.getEntries() });

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
    },
  };
}
