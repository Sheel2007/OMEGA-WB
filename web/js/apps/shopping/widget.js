// Shopping list: the home-screen widget.
import { animateLayout, appIcon, el, fitRows, icons, itemGlyph, reconcile } from '../../ui.js';
import * as meta from './meta.js';
import { countLabel, shownDone, toBuyOf, toggleItem } from './settle.js';

const WIDGET_MAX_ITEMS = 10;

export function createWidget({ services, openApp }) {
  const { shopping } = services;
  const count = el('p', { class: 'widget-head__meta' });
  const list = el('ul', { class: 'shopping-widget__list' });
  const more = el('p', { class: 'shopping-widget__more' });
  const empty = el(
    'div',
    { class: 'shopping-widget__empty' },
    el('p', { class: 'shopping-widget__empty-title', text: 'Nothing to buy' }),
    el('p', { class: 'shopping-widget__empty-text', text: 'Tap + to add something.' }),
  );
  const node = el('article', { class: 'shopping-widget', 'aria-label': meta.name });
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
        'aria-label': 'Add to the shopping list',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'add' }),
      }),
    ),
    list,
    more,
    empty,
  );

  let todoCount = 0;
  let firstRender = true;

  function setRowDone(row, isDone) {
    row.classList.toggle('shopping-widget__item--done', isDone);
    row.firstChild.setAttribute('aria-pressed', String(isDone));
  }

  function createRow() {
    const row = el('li', { class: 'shopping-widget__item' });
    row.append(
      el('button', {
        class: 'shopping-widget__ring',
        type: 'button',
        html: icons.check,
        onclick: () => toggleItem(shopping, row.dataset.key, (isDone) => setRowDone(row, isDone)),
      }),
    );
    return row;
  }

  function updateRow(row, item) {
    setRowDone(row, shownDone(item));
    if (row.dataset.name !== item.name) {
      row.dataset.name = item.name;
      const ring = row.firstChild;
      ring.setAttribute('aria-label', `Mark ${item.name} as bought`);
      row.replaceChildren(ring, itemGlyph(item.name, 'shopping-widget__glyph'), el('span', { class: 'shopping-widget__name', text: item.name }));
    }
  }

  const fit = () => fitRows(list, more, todoCount, (hidden) => `${hidden} more on the list`);

  function render(state) {
    const todo = toBuyOf(state.items);
    todoCount = todo.length;
    count.textContent = countLabel(todo.length);
    const apply = () => {
      reconcile(list, todo.slice(0, WIDGET_MAX_ITEMS), (i) => i.id, createRow, updateRow);
      list.hidden = todo.length === 0;
      empty.hidden = todo.length > 0;
      fit();
    };
    if (firstRender || document.documentElement.classList.contains('is-app-open')) {
      apply();
      firstRender = false;
    } else {
      animateLayout(list, apply);
    }
  }

  const unsubscribe = shopping.subscribe(render);
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(list);
  render(shopping.getState());

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
    },
  };
}
