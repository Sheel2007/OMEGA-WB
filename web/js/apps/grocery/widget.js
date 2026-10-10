// Grocery: the home-screen widget. What's still to get, who asked for it, what it
// comes to, and the split between Trader Joe's and Lidl.
import { isReady } from '../../services/grocery.js';
import { animateLayout, appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { shownDone, toBuyOf, toggleItem } from '../shopping/settle.js';
import { detailLabel, money, STORE_LABELS, summaryLabel, totals } from './format.js';
import * as meta from './meta.js';
import { lineCost, picture, pictureKey, svg } from './views.js';

const WIDGET_MAX_ITEMS = 12;

export function createWidget({ services, openApp }) {
  const { grocery } = services;
  const summary = el('p', { class: 'widget-head__meta' });
  const stores = el('ul', { class: 'grocery-widget__stores', 'aria-label': 'By store' });
  const list = el('ul', { class: 'grocery-widget__list' });
  const more = el('p', { class: 'grocery-widget__more' });
  const empty = el(
    'div',
    { class: 'grocery-widget__empty' },
    el('span', { class: 'grocery-widget__empty-art', html: svg.scan }),
    el('p', { class: 'grocery-widget__empty-title', text: 'Nothing to get' }),
    el('p', { class: 'grocery-widget__empty-text', text: 'Scan a barcode with your phone, or tap + to search.' }),
  );
  empty.hidden = true;
  const node = el('article', { class: 'grocery-widget', 'aria-label': meta.name });
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
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), summary),
      el('button', {
        class: 'widget-head__action grocery-widget__add',
        type: 'button',
        'aria-label': 'Find something to add',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'search' }),
      }),
    ),
    stores,
    list,
    more,
    empty,
  );

  let toGetCount = 0;
  let currency = 'USD';
  let firstRender = true;

  function setRowDone(row, isDone) {
    row.classList.toggle('grocery-widget__item--done', isDone);
    row.firstChild.setAttribute('aria-pressed', String(isDone));
  }

  function createRow() {
    const row = el('li', { class: 'grocery-widget__item' });
    const ring = el('button', {
      class: 'grocery-widget__ring',
      type: 'button',
      html: icons.check,
      onclick: () => toggleItem(grocery, row.dataset.key, (isDone) => setRowDone(row, isDone)),
    });
    const name = el('span', { class: 'grocery-widget__name' });
    const detail = el('span', { class: 'grocery-widget__detail' });
    const qty = el('span', { class: 'grocery-widget__qty' });
    const price = el('span', { class: 'grocery-widget__price' });
    row.append(ring, el('span', { class: 'grocery-widget__glyph-slot' }), el('span', { class: 'grocery-widget__text' }, name, detail), qty, price);
    return row;
  }

  function updateRow(row, item) {
    setRowDone(row, shownDone(item));
    const [ring, glyphSlot, text, qty, price] = row.children;
    if (row.dataset.picture !== pictureKey(item)) {
      row.dataset.picture = pictureKey(item);
      ring.setAttribute('aria-label', `Mark ${item.name} as bought`);
      glyphSlot.replaceChildren(picture(item, 'grocery-widget__pic'));
      text.firstChild.textContent = item.name;
    }
    text.lastChild.textContent = detailLabel(item);
    text.lastChild.hidden = !text.lastChild.textContent;
    qty.textContent = item.qty > 1 ? `×${item.qty}` : '';
    qty.hidden = item.qty <= 1;
    price.textContent = lineCost(item, currency);
  }

  function renderStores(state) {
    const split = totals(state.items).stores.filter((s) => s.key);
    stores.hidden = split.length === 0;
    reconcile(
      stores,
      split,
      (s) => s.key,
      (s) => el('li', { class: `grocery-widget__store grocery-widget__store--${s.key}` }, el('span', { class: 'grocery-widget__store-name', text: STORE_LABELS[s.key] }), el('span', { class: 'grocery-widget__store-total' })),
      (li, s) => {
        li.lastChild.textContent = s.cents ? money(s.cents, currency) : s.count === 1 ? '1 item' : `${s.count} items`;
      },
    );
  }

  const fit = () => fitRows(list, more, toGetCount, (hidden) => `${hidden} more on the list`);

  function render(state) {
    currency = state.currency;
    const toGet = toBuyOf(state.items);
    toGetCount = toGet.length;
    summary.textContent = isReady(state) ? summaryLabel(state.items, currency) : '';
    const apply = () => {
      renderStores(state);
      reconcile(list, toGet.slice(0, WIDGET_MAX_ITEMS), (i) => i.id, createRow, updateRow);
      list.hidden = toGet.length === 0;
      empty.hidden = !isReady(state) || toGet.length > 0;
      fit();
    };
    if (firstRender || document.documentElement.classList.contains('is-app-open')) {
      apply();
      firstRender = false;
    } else {
      animateLayout(list, apply);
    }
  }

  const unsubscribe = grocery.subscribe(render);
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(list);
  render(grocery.getState());

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
    },
  };
}
