// Calendar: the home-screen widget, showing what's coming up. The days the house is
// counting down to (services.countdown) sit above the agenda in big numbers: the
// next one at small, one and the two after it in a line at medium, three across at
// large. A countdown shown up there never shows again as a row.
import { animateLayout, appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { dayKey, daysBadge, formatTime, mergeEvents, msUntilMidnight, nextLabel } from './agenda.js';
import { bigNumber, dateLabel, spoken, widgetRows } from './countdowns.js';
import * as meta from './meta.js';

// fitRows() hides whichever of these don't fit the widget's height.
const WIDGET_MAX_ITEMS = 8;
// The countdowns shown above the agenda: just the next at small; at medium the next
// big and two more in a line; three across at large.
const heroCountFor = (size) => (size === 'small' ? 1 : 3);

export function createWidget({ services, openApp }) {
  const { calendar, countdown } = services;
  const summary = el('p', { class: 'widget-head__meta' });
  const heroes = el('ul', { class: 'calendar-widget__heroes', 'aria-label': 'Counting down' });
  const then = el('p', { class: 'calendar-widget__then' });
  const countdowns = el('div', { class: 'calendar-widget__countdowns' }, heroes, then);
  const list = el('ul', { class: 'calendar-widget__list' });
  const more = el('p', { class: 'calendar-widget__more' });
  const empty = el(
    'div',
    { class: 'calendar-widget__empty' },
    el('p', { class: 'calendar-widget__empty-title', text: 'Nothing on' }),
    el('p', { class: 'calendar-widget__empty-text', text: 'Tap + to add something.' }),
  );
  const node = el('article', { class: 'calendar-widget', 'aria-label': meta.name });
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
        'aria-label': 'Add an event',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'add' }),
      }),
    ),
    countdowns,
    list,
    more,
    empty,
  );

  let total = 0;
  let firstRender = true;
  let midnight = null;
  let renderedSize = null;
  const fit = () => fitRows(list, more, total, (hidden) => `${hidden} more coming up`);

  function createHero() {
    const hero = el('li', { class: 'calendar-widget__hero' });
    hero.append(
      el('span', { class: 'calendar-widget__hero-number', 'aria-hidden': 'true' }),
      el(
        'span',
        { class: 'calendar-widget__hero-unit', 'aria-hidden': 'true' },
        el('span', {}),
        el('span', { class: 'calendar-widget__hero-to', text: ' to' }),
      ),
      el('span', { class: 'calendar-widget__hero-title', 'aria-hidden': 'true' }),
      el('span', { class: 'calendar-widget__hero-date', 'aria-hidden': 'true' }),
    );
    return hero;
  }

  function updateHero(hero, item, today) {
    const [number, unit, title, date] = hero.children;
    const big = bigNumber(item.days);
    number.textContent = big.number;
    unit.firstChild.textContent = big.unit;
    unit.hidden = !big.unit;
    title.textContent = item.title;
    date.textContent = dateLabel(item, today);
    hero.classList.toggle('calendar-widget__hero--today', item.days === 0);
    hero.setAttribute('aria-label', spoken(item, today));
  }

  function createRow() {
    const row = el('li', { class: 'calendar-widget__item' });
    row.append(
      el('span', { class: 'calendar-widget__day' }),
      el('span', { class: 'calendar-widget__title' }),
      el('span', { class: 'calendar-widget__time' }),
    );
    return row;
  }

  // `repeated` blanks the day badge on the second and later events of the same day,
  // so a busy day reads as one block instead of the same word three times.
  function updateRow(row, event, today, repeated) {
    const [day, title, time] = row.children;
    row.dataset.color = event.color ?? 'ours';
    row.classList.toggle('calendar-widget__item--countdown', Boolean(event.countdown));
    // Every row says how many days away it is; a countdown's row is coloured too.
    day.textContent = repeated ? '' : daysBadge(event.day, today);
    title.textContent = event.title;
    time.textContent = event.time ? formatTime(event.time) : '';
  }

  // The medium widget's line under its one big number: "Winter break 31 · Next semester 67".
  function updateThen(items) {
    then.replaceChildren();
    // Each name keeps its number with it; CSS puts the "·" between them, and the
    // space between items is where a long line wraps.
    items.forEach((item, index) => {
      if (index) then.append(' ');
      then.append(el('span', { class: 'calendar-widget__then-item' }, `${item.title} `, el('b', { text: bigNumber(item.days).number })));
    });
    then.hidden = items.length === 0;
  }

  function render() {
    const { events: ours, sources } = calendar.getSnapshot();
    const today = dayKey(new Date());
    const size = node.dataset.size ?? 'small';
    renderedSize = size;
    const events = mergeEvents({ events: ours, feed: sources.events });
    const shown = widgetRows({
      events,
      countdowns: countdown.getState().countdowns,
      today,
      heroCount: heroCountFor(size),
      limit: WIDGET_MAX_ITEMS,
    });
    total = shown.total;
    summary.textContent = nextLabel(events, today);
    const apply = () => {
      reconcile(heroes, shown.heroes, (item) => item.id, createHero, (hero, item) => updateHero(hero, item, today));
      updateThen(shown.heroes.slice(1));
      countdowns.hidden = shown.heroes.length === 0;
      let previousDay = null;
      reconcile(list, shown.rows, (event) => `${event.id}:${event.day}`, createRow, (row, event) => {
        updateRow(row, event, today, event.day === previousDay);
        previousDay = event.day;
      });
      list.hidden = shown.rows.length === 0;
      empty.hidden = shown.rows.length > 0 || shown.heroes.length > 0;
      fit();
    };
    if (firstRender || document.documentElement.classList.contains('is-app-open')) {
      apply();
      firstRender = false;
    } else {
      animateLayout(list, apply);
    }
  }

  // "Today" has to become "Tomorrow", and every countdown has to go down by one, at
  // midnight even if nothing else changes.
  function atMidnight() {
    midnight = setTimeout(() => {
      render();
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribeCalendar = calendar.subscribe(render);
  const unsubscribeCountdown = countdown.subscribe(render);
  // A new size can mean a different number of countdowns up top; otherwise only the
  // rows that fit change.
  const resizes = new ResizeObserver(() => {
    if ((node.dataset.size ?? 'small') !== renderedSize) render();
    else fit();
  });
  resizes.observe(list);
  resizes.observe(node);
  atMidnight();

  return {
    node,
    destroy() {
      unsubscribeCalendar();
      unsubscribeCountdown();
      resizes.disconnect();
      clearTimeout(midnight);
    },
  };
}
