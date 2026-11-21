// Countdown: the home-screen widget. The next day the house is waiting for, in
// numbers big enough to read from the sofa, and (medium and large) the ones after it.
import { animateLayout, appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { dayKey, msUntilMidnight } from '../calendar/agenda.js';
import { bigNumber, countLabel, dateLabel, leftLabel, spoken, upcoming } from './format.js';
import * as meta from './meta.js';

// fitRows() hides whichever of these don't fit the widget's height.
const WIDGET_MAX_ROWS = 8;

export function createWidget({ services, openApp }) {
  const { countdown } = services;
  const summary = el('p', { class: 'widget-head__meta' });

  const number = el('span', { class: 'countdown-widget__number' });
  const unit = el('span', { class: 'countdown-widget__unit' });
  const title = el('p', { class: 'countdown-widget__title' });
  const date = el('p', { class: 'countdown-widget__date' });
  const hero = el(
    'div',
    { class: 'countdown-widget__hero' },
    el('p', { class: 'countdown-widget__left' }, number, unit),
    el('div', { class: 'countdown-widget__what' }, title, date),
  );
  const list = el('ul', { class: 'countdown-widget__list', 'aria-label': 'After that' });
  const more = el('p', { class: 'countdown-widget__more' });
  const rest = el('div', { class: 'countdown-widget__rest' }, list, more);
  const empty = el(
    'div',
    { class: 'countdown-widget__empty' },
    el('p', { class: 'countdown-widget__empty-title', text: 'Nothing to count down to' }),
    el('p', { class: 'countdown-widget__empty-text', text: 'Tap + to add a day.' }),
  );
  const body = el('div', { class: 'countdown-widget__body' }, hero, rest);
  const node = el('article', { class: 'countdown-widget', 'aria-label': meta.name });
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
        class: 'widget-head__action',
        type: 'button',
        'aria-label': 'Add a countdown',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'add' }),
      }),
    ),
    body,
    empty,
  );

  let total = 0;
  let firstRender = true;
  let midnight = null;
  const fit = () => fitRows(list, more, total, (hidden) => `${hidden} more after that`);

  function createRow() {
    const row = el('li', { class: 'countdown-widget__item' });
    row.append(el('span', { class: 'countdown-widget__item-title' }), el('span', { class: 'countdown-widget__item-left' }));
    return row;
  }

  function updateRow(row, item, today) {
    const [name, left] = row.children;
    name.textContent = item.title;
    left.textContent = leftLabel(item.days);
    row.setAttribute('aria-label', spoken(item, today));
  }

  function render(state) {
    const today = dayKey(new Date());
    const coming = upcoming(state.countdowns, today);
    const [next, ...after] = coming;
    summary.textContent = countLabel(coming.length);
    body.hidden = !next;
    empty.hidden = Boolean(next);
    node.classList.toggle('countdown-widget--today', next?.days === 0);
    if (!next) return;

    const big = bigNumber(next.days);
    number.textContent = big.number;
    unit.textContent = big.unit;
    title.textContent = next.title;
    date.textContent = dateLabel(next, today);
    hero.setAttribute('aria-label', spoken(next, today));
    hero.setAttribute('role', 'group');

    const rows = after.slice(0, WIDGET_MAX_ROWS);
    total = after.length;
    const apply = () => {
      reconcile(list, rows, (item) => item.id, createRow, (row, item) => updateRow(row, item, today));
      rest.hidden = rows.length === 0;
      fit();
    };
    if (firstRender || document.documentElement.classList.contains('is-app-open')) {
      apply();
      firstRender = false;
    } else {
      animateLayout(list, apply);
    }
  }

  // The days left go down by one at midnight even if nothing else changes.
  function atMidnight() {
    midnight = setTimeout(() => {
      render(countdown.getState());
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribe = countdown.subscribe(render);
  render(countdown.getState());
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(list);
  atMidnight();

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      clearTimeout(midnight);
    },
  };
}
