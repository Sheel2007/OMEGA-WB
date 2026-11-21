// Countdown: the home-screen widget. The next three days the house is waiting for,
// side by side in numbers big enough to read from the sofa, so you can see how they
// line up (finals, then the break, then the next semester). The header says how many
// there are in all; the app has every one of them.
import { animateLayout, appIcon, el, icons, reconcile } from '../../ui.js';
import { dayKey, msUntilMidnight } from '../calendar/agenda.js';
import { bigNumber, countLabel, dateLabel, spoken, upcoming } from './format.js';
import * as meta from './meta.js';

// How many the widget shows at once, at every size.
const SHOWN = 3;

export function createWidget({ services, openApp }) {
  const { countdown } = services;
  const summary = el('p', { class: 'widget-head__meta' });
  const list = el('ul', { class: 'countdown-widget__list', 'aria-label': 'Coming up' });
  const empty = el(
    'div',
    { class: 'countdown-widget__empty' },
    el('p', { class: 'countdown-widget__empty-title', text: 'Nothing to count down to' }),
    el('p', { class: 'countdown-widget__empty-text', text: 'Tap + to add a day.' }),
  );
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
    list,
    empty,
  );

  let firstRender = true;
  let midnight = null;

  // A row: the days left, big, with the word under it; then the name and the day.
  function createRow() {
    const row = el('li', { class: 'countdown-widget__item' });
    row.append(
      el(
        'p',
        { class: 'countdown-widget__left', 'aria-hidden': 'true' },
        el('span', { class: 'countdown-widget__number' }),
        el('span', { class: 'countdown-widget__unit' }),
      ),
      el(
        'div',
        { class: 'countdown-widget__what', 'aria-hidden': 'true' },
        el('p', { class: 'countdown-widget__title' }),
        el('p', { class: 'countdown-widget__date' }),
      ),
    );
    return row;
  }

  function updateRow(row, item, today) {
    const [left, what] = row.children;
    const big = bigNumber(item.days);
    left.firstChild.textContent = big.number;
    left.lastChild.textContent = big.unit;
    what.firstChild.textContent = item.title;
    what.lastChild.textContent = dateLabel(item, today);
    row.classList.toggle('countdown-widget__item--today', item.days === 0);
    row.setAttribute('aria-label', spoken(item, today));
  }

  function render(state) {
    const today = dayKey(new Date());
    const coming = upcoming(state.countdowns, today);
    const rows = coming.slice(0, SHOWN);
    summary.textContent = countLabel(coming.length);
    const apply = () => {
      reconcile(list, rows, (item) => item.id, createRow, (row, item) => updateRow(row, item, today));
      list.hidden = rows.length === 0;
      empty.hidden = rows.length > 0;
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
  atMidnight();

  return {
    node,
    destroy() {
      unsubscribe();
      clearTimeout(midnight);
    },
  };
}
