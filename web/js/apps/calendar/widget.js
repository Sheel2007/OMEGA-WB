// Calendar: the home-screen widget, showing what's coming up.
import { animateLayout, appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { dayBadge, dayKey, formatTime, mergeEvents, msUntilMidnight, nextLabel, upcoming } from './agenda.js';
import * as meta from './meta.js';

// fitRows() hides whichever of these don't fit the widget's height.
const WIDGET_MAX_ITEMS = 12;

export function createWidget({ services, openApp }) {
  const { calendar } = services;
  const summary = el('p', { class: 'widget-head__meta' });
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
    list,
    more,
    empty,
  );

  let total = 0;
  let firstRender = true;
  let midnight = null;
  const fit = () => fitRows(list, more, total, (hidden) => `${hidden} more coming up`);

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
    day.textContent = repeated ? '' : dayBadge(event.day, today);
    title.textContent = event.title;
    time.textContent = event.time ? formatTime(event.time) : '';
  }

  function render({ events: ours, feed }) {
    const today = dayKey(new Date());
    const events = mergeEvents({ events: ours, feed: feed.events });
    const { rows, total: found } = upcoming(events, { from: today, limit: WIDGET_MAX_ITEMS });
    total = found;
    summary.textContent = nextLabel(events, today);
    const apply = () => {
      let previousDay = null;
      reconcile(list, rows, (event) => `${event.id}:${event.day}`, createRow, (row, event) => {
        updateRow(row, event, today, event.day === previousDay);
        previousDay = event.day;
      });
      list.hidden = rows.length === 0;
      empty.hidden = rows.length > 0;
      fit();
    };
    if (firstRender || document.documentElement.classList.contains('is-app-open')) {
      apply();
      firstRender = false;
    } else {
      animateLayout(list, apply);
    }
  }

  // "Today" has to become "Tomorrow" at midnight even if nothing else changes.
  function atMidnight() {
    midnight = setTimeout(() => {
      render(calendar.getSnapshot());
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribe = calendar.subscribe(render);
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
