// Calendar: the full-screen app for seeing what's coming up and adding to it.
import { createKeyboard } from '../../keyboard.js';
import { fetchQrSvg } from '../../services/board.js';
import { animateLayout, el, icons, MAX_ROWS, nudge, reconcile, toast } from '../../ui.js';
import {
  countLabel,
  dayDate,
  dayKey,
  dayLabel,
  daysBetween,
  formatTime,
  groupByDay,
  mergeEvents,
  msUntilMidnight,
  shiftDay,
} from './agenda.js';
import { id, name } from './meta.js';

// Quick buttons for today and the week after it; anything further out uses the date picker.
const DAY_CHIPS = 7;
// The farthest ahead the date picker allows, matching what the server accepts.
const YEARS_AHEAD = 5;
const chipFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const updatedFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function mount(root, { services, kiosk, info }) {
  const { calendar } = services;
  let firstRender = true;
  let keyboard = null;
  let unmounted = false;
  let midnight = null;
  // What the add form will save: a local day, and a time (or null for all day).
  let when = dayKey(new Date());
  let clock = null;

  const meta = el('p', { class: 'calendar-app__meta' });

  const input = el('input', {
    class: 'add-bar__input',
    type: 'text',
    name: 'event',
    placeholder: 'Add an event',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    maxlength: '80',
    'aria-label': 'Event to add',
    inputmode: kiosk ? 'none' : null,
  });
  const submitButton = el('button', { class: 'add-bar__submit', type: 'submit', text: 'Add', disabled: true });
  const form = el(
    'form',
    { class: 'add-bar', onsubmit: (event) => (event.preventDefault(), addEvent()) },
    el('span', { class: 'add-bar__plus', html: icons.plus }),
    input,
    submitButton,
  );
  input.addEventListener('input', () => {
    submitButton.disabled = !input.value.trim();
  });

  const dayChips = el('div', { class: 'when-row__chips' });
  const datePicker = el('input', {
    class: 'when-row__picker',
    type: 'date',
    'aria-label': 'Another date',
    min: dayKey(new Date()),
    max: shiftDay(dayKey(new Date()), 366 * YEARS_AHEAD),
    value: when,
    onchange: () => {
      if (datePicker.value) {
        when = datePicker.value;
        renderWhen();
      } else {
        datePicker.value = when;
      }
    },
  });
  const allDayChip = el('button', {
    class: 'chip chip--choice',
    type: 'button',
    text: 'All day',
    onclick: () => {
      clock = null;
      renderWhen();
    },
  });
  const timePicker = el('input', {
    class: 'when-row__picker',
    type: 'time',
    'aria-label': 'Time of day',
    onchange: () => {
      clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timePicker.value) ? timePicker.value : null;
      renderWhen();
    },
  });
  const whenRows = el(
    'div',
    { class: 'calendar-app__when' },
    el('div', { class: 'when-row' }, el('span', { class: 'when-row__label', text: 'When' }), dayChips, datePicker),
    el(
      'div',
      { class: 'when-row' },
      el('span', { class: 'when-row__label', text: 'Time' }),
      el('div', { class: 'when-row__chips' }, allDayChip),
      timePicker,
    ),
  );

  const agenda = el('ol', { class: 'agenda', 'aria-label': 'What’s coming up' });
  const overflow = el('p', { class: 'calendar-app__overflow' });
  const empty = el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-state__art', html: icons.calendar }),
    el('p', { class: 'empty-state__title', text: 'Nothing coming up' }),
    el('p', { class: 'empty-state__text', text: 'Add an event above, or subscribe to a Google Calendar.' }),
  );

  const sources = el('ul', { class: 'source-list' });
  const sourcesNote = el('p', { class: 'source-list__note' });
  const calendars = el(
    'section',
    { class: 'panel panel--calendars' },
    el('h2', { class: 'panel__title', text: 'Calendars' }),
    sources,
    sourcesNote,
  );

  const qr = el('div', { class: 'phone-link__qr', role: 'img', 'aria-label': 'QR code for the calendar' });
  const url = el('p', { class: 'phone-link__url' });
  const phone = el(
    'section',
    { class: 'panel panel--phone' },
    el('h2', { class: 'panel__title', text: 'On your phone' }),
    el(
      'div',
      { class: 'phone-link' },
      qr,
      el(
        'div',
        {},
        el('p', { class: 'phone-link__text', text: 'Scan to add events from your phone. Works on the home Wi-Fi.' }),
        url,
      ),
    ),
  );
  phone.hidden = true;

  const view = el(
    'div',
    { class: 'calendar-app' },
    el(
      'div',
      { class: 'calendar-app__main' },
      el('header', { class: 'calendar-app__header' }, el('h1', { class: 'calendar-app__title', text: name }), meta),
      form,
      whenRows,
      el('div', { class: 'calendar-app__scroll' }, agenda, overflow, empty),
    ),
    el('aside', { class: 'calendar-app__side' }, calendars, phone),
  );
  root.append(view);

  info.then(async (details) => {
    if (!details?.url) return;
    const svg = await fetchQrSvg(id);
    if (unmounted) return;
    url.textContent = details.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (svg) qr.innerHTML = svg;
    phone.hidden = false;
  });

  if (kiosk) {
    keyboard = createKeyboard({
      input,
      onEnter: addEvent,
      onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
    });
    root.append(keyboard.node);
  }

  // The add form

  function renderWhen() {
    const today = dayKey(new Date());
    reconcile(
      dayChips,
      Array.from({ length: DAY_CHIPS }, (_, offset) => shiftDay(today, offset)),
      (key) => key,
      (key) =>
        el('button', {
          class: 'chip chip--choice',
          type: 'button',
          onclick: () => {
            when = key;
            renderWhen();
          },
        }),
      (chip, key) => {
        const away = daysBetween(today, key);
        chip.textContent = away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : chipFormat.format(dayDate(key));
        chip.setAttribute('aria-label', `Put it on ${dayLabel(key, today)}`);
      },
    );
    for (const chip of dayChips.children) chip.setAttribute('aria-pressed', String(chip.dataset.key === when));
    if (datePicker.value !== when) datePicker.value = when;
    datePicker.min = today;
    datePicker.max = shiftDay(today, 366 * YEARS_AHEAD);
    allDayChip.setAttribute('aria-pressed', String(clock === null));
    if (timePicker.value !== (clock ?? '')) timePicker.value = clock ?? '';
  }

  async function addEvent() {
    const title = input.value.trim();
    if (!title) {
      nudge(form);
      return;
    }
    input.value = '';
    input.dispatchEvent(new Event('input'));
    try {
      await calendar.addEvent({ title, date: when, time: clock });
      keyboard?.hide();
      toast(`${title} — ${dayLabel(when, dayKey(new Date()))}${clock ? ` at ${formatTime(clock)}` : ''}`);
    } catch (err) {
      toast(err.message);
      if (!input.value) {
        input.value = title;
        input.dispatchEvent(new Event('input'));
      }
    }
  }

  function removeEvent(eventId, title) {
    calendar.removeEvent(eventId).then(
      () =>
        toast(`Removed ${title}`, {
          action: 'Undo',
          onAction: () => calendar.restoreEvents([eventId]).catch((err) => toast(err.message)),
        }),
      (err) => toast(err.message),
    );
  }

  // The agenda

  function createDay() {
    const day = el('li', { class: 'agenda__day' });
    day.append(el('h2', { class: 'agenda__heading' }), el('ul', { class: 'agenda__list' }));
    return day;
  }

  function createEvent() {
    const row = el('li', { class: 'agenda__event' });
    row.append(
      el('span', { class: 'agenda__when' }),
      el('span', { class: 'agenda__title' }),
      el('span', { class: 'agenda__source' }),
      // Only the household's own events can be taken off; the subscribed ones are read-only.
      el('button', {
        class: 'agenda__remove',
        type: 'button',
        html: icons.close,
        onclick: () => removeEvent(row.dataset.eventId, row.dataset.eventTitle),
      }),
    );
    return row;
  }

  function updateEvent(row, event) {
    const [whenCell, title, source, remove] = row.children;
    row.dataset.color = event.color ?? 'ours';
    row.dataset.eventId = event.id;
    row.dataset.eventTitle = event.title;
    whenCell.textContent = event.time ? formatTime(event.time) : 'All day';
    whenCell.classList.toggle('agenda__when--all-day', !event.time);
    title.textContent = event.title;
    const spanLabel = event.days > 1 ? `Day ${(event.dayOffset ?? 0) + 1} of ${event.days}` : null;
    source.textContent = [event.calendar, event.location, spanLabel].filter(Boolean).join(' · ');
    source.hidden = !source.textContent;
    remove.hidden = !event.ours;
    remove.setAttribute('aria-label', `Remove ${event.title}`);
  }

  function renderSources(feed) {
    if (feed.configured === false) {
      sources.hidden = true;
      sourcesNote.textContent =
        'Add your Google Calendar’s secret address in iCal format to config.json to see birthdays and holidays here.';
      return;
    }
    sources.hidden = false;
    reconcile(
      sources,
      feed.calendars,
      (source) => source.name,
      () =>
        el(
          'li',
          { class: 'source-list__item' },
          el('span', { class: 'source-list__dot' }),
          el('span', { class: 'source-list__name' }),
          el('span', { class: 'source-list__status' }),
        ),
      (row, source) => {
        const [dot, label, status] = row.children;
        dot.dataset.color = source.color;
        label.textContent = source.name;
        status.textContent = source.ok ? 'Synced' : source.error || 'Not syncing';
        status.classList.toggle('source-list__status--bad', !source.ok);
      },
    );
    const updated = feed.updated ? updatedFormat.format(new Date(feed.updated)) : null;
    if (feed.error) sourcesNote.textContent = feed.error;
    else if (feed.loading) sourcesNote.textContent = 'Checking the calendars…';
    else if (feed.stale) sourcesNote.textContent = updated ? `Offline — last synced ${updated}` : 'Offline — not synced yet';
    else sourcesNote.textContent = updated ? `Synced ${updated}` : '';
  }

  function render({ events: ours, feed }) {
    const today = dayKey(new Date());
    const events = mergeEvents({ events: ours, feed: feed.events });
    const { days, total, shown } = groupByDay(events, { from: today, limit: MAX_ROWS });
    meta.textContent = countLabel(total);

    const apply = () => {
      reconcile(
        agenda,
        days,
        (day) => day.key,
        createDay,
        (node, day) => {
          const [heading, list] = node.children;
          heading.textContent = dayLabel(day.key, today);
          reconcile(list, day.events, (event) => `${event.id}:${event.dayOffset ?? 0}`, createEvent, updateEvent);
        },
      );
      agenda.hidden = days.length === 0;
      empty.hidden = days.length > 0;
      overflow.hidden = total === shown;
      overflow.textContent = `${total - shown} more not shown`;
      renderSources(feed);
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      // Only the agenda slides: the day buttons above it are keyed by date too,
      // and measuring both together would animate a button from a row's position.
      animateLayout(agenda, apply);
    }
  }

  // "Today" has to become "Tomorrow" at midnight even if nothing else changes.
  function atMidnight() {
    midnight = setTimeout(() => {
      const today = dayKey(new Date());
      if (when < today) when = today;
      renderWhen();
      render(calendar.getSnapshot());
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribe = calendar.subscribe(render);
  renderWhen();
  atMidnight();

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
      unmounted = true;
      unsubscribe();
      clearTimeout(midnight);
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}
