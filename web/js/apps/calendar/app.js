// Calendar: the full-screen app — what's coming up, and the form for adding to it.
import { createKeyboard } from '../../keyboard.js';
import { fetchQrSvg } from '../../services/board.js';
import { BOARD_CALENDAR } from '../../services/calendar.js';
import { animateLayout, el, icons, MAX_ROWS, nudge, reconcile, toast } from '../../ui.js';
import {
  addMinutes,
  countLabel,
  dayDate,
  dayKey,
  dayLabel,
  daysBetween,
  detailLabel,
  formatTime,
  groupByDay,
  mergeEvents,
  minutesBetween,
  msUntilMidnight,
  shiftDay,
  timeLabel,
} from './agenda.js';
import { id, name } from './meta.js';

// Quick buttons for today and the week after it; anything further out uses the date picker.
const DAY_CHIPS = 7;
// How long a timed event runs, in minutes, as one tap.
const LENGTHS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hr' },
  { minutes: 120, label: '2 hr' },
  { minutes: 240, label: '4 hr' },
];
// How many days an all-day event covers, as one tap.
const SPANS = [1, 2, 3, 7];
// The farthest ahead the date pickers allow, matching what the server accepts.
const YEARS_AHEAD = 5;
const chipFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const updatedFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function mount(root, { services, kiosk, info }) {
  const { calendar } = services;
  let firstRender = true;
  let keyboard = null;
  let unmounted = false;
  let midnight = null;
  // What the form will save. `time` null means all day; `endDate` is the last day.
  let draft = { date: dayKey(new Date()), time: null, endTime: null, endDate: dayKey(new Date()), calendar: null };

  const meta = el('p', { class: 'calendar-app__meta' });

  // The form

  const title = field({ name: 'event', placeholder: 'Add an event', label: 'Event to add', max: 80, kiosk });
  const submitButton = el('button', { class: 'add-bar__submit', type: 'submit', text: 'Add', disabled: true });
  const form = el(
    'form',
    { class: 'add-bar', onsubmit: (event) => (event.preventDefault(), addEvent()) },
    el('span', { class: 'add-bar__plus', html: icons.plus }),
    title,
    submitButton,
  );
  title.addEventListener('input', () => {
    submitButton.disabled = !title.value.trim();
  });

  const dayChips = el('div', { class: 'when-row__chips' });
  const datePicker = picker('date', 'Another date', () => {
    if (!datePicker.value) return (datePicker.value = draft.date);
    set({ date: datePicker.value, endDate: maxDay(datePicker.value, draft.endDate) });
  });

  const allDayChip = choice('All day', () => set({ time: null, endTime: null }));
  const startPicker = picker('time', 'Start time', () => {
    const time = clockOf(startPicker) ?? null;
    const length = minutesBetween(draft.time, draft.endTime);
    set({ time, endTime: time && length ? addMinutes(time, length) : null, endDate: draft.date });
  });
  const lengthChips = el('div', { class: 'when-row__chips' });
  const endPicker = picker('time', 'End time', () => set({ endTime: clockOf(endPicker) ?? null }));
  const spanChips = el('div', { class: 'when-row__chips' });
  const lastDayPicker = picker('date', 'Last day', () =>
    set({ endDate: maxDay(draft.date, lastDayPicker.value || draft.date) }),
  );
  // One row either way: all day (and how many days), or a start time (and how long).
  const timeRow = row('Time', allDayChip, startPicker, lengthChips, endPicker, spanChips, lastDayPicker);

  const where = field({ name: 'where', placeholder: 'Add a place (optional)', label: 'Where', max: 120, kiosk });
  const notes = field({ name: 'notes', placeholder: 'Add a note (optional)', label: 'Notes', max: 500, kiosk });
  const detailRow = row('Details', where, notes);

  const calendarChips = el('div', { class: 'when-row__chips' });
  const calendarRow = row('Goes on', calendarChips);

  const whenRow = row('When', dayChips, datePicker);
  const formRows = el('div', { class: 'calendar-app__when' }, whenRow, timeRow, detailRow, calendarRow);

  // The agenda

  const agenda = el('ol', { class: 'agenda', 'aria-label': 'What’s coming up' });
  const overflow = el('p', { class: 'calendar-app__overflow' });
  const empty = el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-state__art', html: icons.calendar }),
    el('p', { class: 'empty-state__title', text: 'Nothing coming up' }),
    el('p', { class: 'empty-state__text', text: 'Add an event above, or connect a Google account.' }),
  );

  // The side

  const sourceList = el('ul', { class: 'source-list' });
  const sourceNote = el('p', { class: 'source-list__note' });
  const syncButton = el('button', { class: 'panel__action', type: 'button', text: 'Sync now', onclick: syncNow });
  const linkButton = el('button', { class: 'panel__action panel__action--strong', type: 'button', onclick: toggleLink });
  const calendars = el(
    'section',
    { class: 'panel panel--calendars' },
    el('h2', { class: 'panel__title', text: 'Calendars' }),
    sourceList,
    sourceNote,
    el('div', { class: 'panel__buttons' }, linkButton, syncButton),
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
      formRows,
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
      inputs: [title, where, notes],
      onEnter: addEvent,
      onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
    });
    root.append(keyboard.node);
  }

  // Keeping the form in step with itself

  function set(changes) {
    draft = { ...draft, ...changes };
    if (draft.time && draft.endTime && minutesBetween(draft.time, draft.endTime) <= 0) draft.endTime = null;
    if (!draft.time && draft.endDate < draft.date) draft.endDate = draft.date;
    renderForm();
  }

  function renderForm() {
    const today = dayKey(new Date());
    chips(dayChips, Array.from({ length: DAY_CHIPS }, (_, offset) => shiftDay(today, offset)), {
      label: (key) => {
        const away = daysBetween(today, key);
        return away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : chipFormat.format(dayDate(key));
      },
      title: (key) => `Put it on ${dayLabel(key, today)}`,
      pressed: (key) => key === draft.date,
      pick: (key) => set({ date: key, endDate: maxDay(key, shiftDay(key, daysBetween(draft.date, draft.endDate))) }),
    });
    sync(datePicker, draft.date);
    datePicker.min = today;
    datePicker.max = shiftDay(today, 366 * YEARS_AHEAD);

    allDayChip.setAttribute('aria-pressed', String(draft.time === null));
    sync(startPicker, draft.time ?? '');
    sync(endPicker, draft.endTime ?? '');
    const length = minutesBetween(draft.time, draft.endTime);
    chips(lengthChips, LENGTHS, {
      key: (option) => String(option.minutes),
      label: (option) => option.label,
      title: (option) => `Make it ${option.label} long`,
      pressed: (option) => option.minutes === length,
      pick: (option) => set({ endTime: addMinutes(draft.time ?? '09:00', option.minutes), time: draft.time ?? '09:00' }),
    });
    const timed = draft.time !== null;
    lengthChips.hidden = !timed;
    endPicker.hidden = !timed;

    // All-day events can run over several days; timed ones belong to one.
    const days = daysBetween(draft.date, draft.endDate) + 1;
    spanChips.hidden = timed;
    // The last day only needs spelling out once an event runs past one day.
    lastDayPicker.hidden = timed || days < 2;
    chips(spanChips, SPANS, {
      key: (count) => String(count),
      label: (count) => (count === 1 ? '1 day' : `${count} days`),
      title: (count) => (count === 1 ? 'Just the one day' : `Run it over ${count} days`),
      pressed: (count) => count === days,
      pick: (count) => set({ endDate: shiftDay(draft.date, count - 1) }),
    });
    sync(lastDayPicker, draft.endDate);
    lastDayPicker.min = draft.date;
    lastDayPicker.max = shiftDay(draft.date, 29);

    const targets = writableTargets();
    const usual = targets.find((target) => target.id === calendar.getAccount().target) ?? targets[0];
    calendarRow.hidden = targets.length < 2;
    chips(calendarChips, targets, {
      key: (target) => target.id,
      label: (target) => target.name,
      title: (target) => `Put new events on ${target.name}`,
      pressed: (target) => target.id === (draft.calendar ?? usual?.id),
      pick: (target) => set({ calendar: target.id }),
    });
  }

  // Everywhere a new event could go: each writable Google calendar, plus the board itself.
  function writableTargets() {
    const writable = calendar.getWritable().map((entry) => ({ id: entry.id, name: entry.name }));
    return writable.length ? [...writable, { id: BOARD_CALENDAR, name: 'This board' }] : [];
  }

  async function addEvent() {
    const text = title.value.trim();
    if (!text) {
      nudge(form);
      title.focus();
      return;
    }
    const fields = {
      title: text,
      date: draft.date,
      time: draft.time,
      endTime: draft.endTime,
      endDate: draft.time ? draft.date : draft.endDate,
      location: where.value,
      description: notes.value,
    };
    clearForm();
    try {
      const result = await calendar.addEvent(fields, { calendar: draft.calendar ?? undefined });
      keyboard?.hide();
      const place = result?.where === 'google' ? ` on ${result.event?.calendar ?? 'Google Calendar'}` : '';
      toast(`${text} — ${dayLabel(fields.date, dayKey(new Date()))}${fields.time ? ` at ${formatTime(fields.time)}` : ''}${place}`);
    } catch (err) {
      toast(err.message);
      if (!title.value) {
        title.value = text;
        where.value = fields.location ?? '';
        notes.value = fields.description ?? '';
        title.dispatchEvent(new Event('input'));
      }
    }
  }

  function clearForm() {
    for (const input of [title, where, notes]) input.value = '';
    title.dispatchEvent(new Event('input'));
  }

  function removeEvent(eventId, label) {
    calendar.removeEvent(eventId).then(
      () =>
        toast(`Removed ${label}`, {
          action: 'Undo',
          onAction: () => calendar.restoreEvents([eventId]).catch((err) => toast(err.message)),
        }),
      (err) => toast(err.message),
    );
  }

  // Google

  async function toggleLink() {
    linkButton.disabled = true;
    try {
      if (calendar.getAccount().linked) {
        await calendar.unlinkGoogle();
        toast('Google Calendar disconnected. Events already on the board stay put.');
      } else {
        const started = await calendar.linkGoogle();
        // Google sends the browser back to this server once the account says yes.
        location.href = started.url;
      }
    } catch (err) {
      toast(err.message);
    } finally {
      linkButton.disabled = false;
    }
  }

  function syncNow() {
    syncButton.disabled = true;
    calendar
      .syncNow()
      .catch((err) => toast(err.message))
      .finally(() => {
        syncButton.disabled = false;
      });
  }

  function renderSources(sources) {
    const { account, calendars: entries } = sources;
    sourceList.hidden = entries.length === 0;
    reconcile(
      sourceList,
      entries,
      (entry) => `${entry.kind}:${entry.id ?? entry.name}`,
      () =>
        el(
          'li',
          { class: 'source-list__item' },
          el('span', { class: 'source-list__dot' }),
          el('span', { class: 'source-list__name' }),
          el('span', { class: 'source-list__status' }),
        ),
      (node, entry) => {
        const [dot, label, status] = node.children;
        dot.dataset.color = entry.color;
        label.textContent = entry.name;
        const target = entry.kind === 'google' && entry.id === account.target;
        status.textContent = entry.ok ? (target ? 'New events here' : 'Synced') : entry.error || 'Not syncing';
        status.classList.toggle('source-list__status--bad', !entry.ok);
      },
    );

    const updated = sources.updated ? updatedFormat.format(new Date(sources.updated)) : null;
    if (!sources.configured) {
      sourceNote.textContent =
        'Connect a Google account to see birthdays and holidays here and to add events to it. ' +
        'Add an OAuth client to config.json first — the README has the steps.';
    } else if (sources.stale) {
      sourceNote.textContent = updated ? `Offline — last synced ${updated}` : 'Offline — not synced yet';
    } else {
      sourceNote.textContent = updated ? `Synced ${updated}` : 'Syncing…';
    }

    linkButton.hidden = !account.configured;
    linkButton.textContent = account.linked ? 'Disconnect Google' : 'Connect Google Calendar';
    syncButton.hidden = !sources.configured;
  }

  // The agenda

  function createDay() {
    const day = el('li', { class: 'agenda__day' });
    day.append(el('h2', { class: 'agenda__heading' }), el('ul', { class: 'agenda__list' }));
    return day;
  }

  function createEvent() {
    const node = el('li', { class: 'agenda__event' });
    node.append(
      el('span', { class: 'agenda__when' }),
      el(
        'div',
        { class: 'agenda__body' },
        el('p', { class: 'agenda__title' }),
        el('p', { class: 'agenda__detail' }),
        el('p', { class: 'agenda__notes' }),
      ),
      // Only events on a calendar the board can change get a remove button.
      el('button', {
        class: 'agenda__remove',
        type: 'button',
        html: icons.close,
        onclick: () => removeEvent(node.dataset.eventId, node.dataset.eventTitle),
      }),
    );
    return node;
  }

  function updateEvent(node, event) {
    const [when, body, remove] = node.children;
    const [eventTitle, detail, note] = body.children;
    node.dataset.color = event.color ?? 'ours';
    node.dataset.eventId = event.id;
    node.dataset.eventTitle = event.title;
    when.textContent = timeLabel(event);
    when.classList.toggle('agenda__when--all-day', !event.time);
    eventTitle.textContent = event.title;
    detail.textContent = detailLabel(event);
    detail.hidden = !detail.textContent;
    note.textContent = event.description ?? '';
    note.hidden = !event.description;
    remove.hidden = !event.writable;
    remove.setAttribute('aria-label', `Remove ${event.title}`);
  }

  function render({ events: ours, sources }) {
    const today = dayKey(new Date());
    const events = mergeEvents({ events: ours, feed: sources.events });
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
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      // Only the agenda slides: the day buttons above it are keyed by date too,
      // and measuring both together would animate a button from a row's position.
      animateLayout(agenda, apply);
    }
    renderSources(sources);
    renderForm();
  }

  // "Today" has to become "Tomorrow" at midnight even if nothing else changes.
  function atMidnight() {
    midnight = setTimeout(() => {
      const today = dayKey(new Date());
      if (draft.date < today) draft = { ...draft, date: today, endDate: maxDay(today, draft.endDate) };
      render(calendar.getSnapshot());
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribe = calendar.subscribe(render);
  atMidnight();

  return {
    intent(action) {
      if (action !== 'add') return;
      if (keyboard) keyboard.focusField(title);
      else title.focus();
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

// Little builders, so the form above reads as the form it is

function field({ name, placeholder, label, max, kiosk }) {
  return el('input', {
    class: name === 'event' ? 'add-bar__input' : 'when-row__text',
    type: 'text',
    name,
    placeholder,
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    maxlength: String(max),
    'aria-label': label,
    // The board brings its own keyboard; the system one would cover half the screen.
    inputmode: kiosk ? 'none' : null,
  });
}

function picker(type, label, onchange) {
  return el('input', { class: 'when-row__picker', type, 'aria-label': label, onchange });
}

function choice(label, onclick) {
  return el('button', { class: 'chip chip--choice', type: 'button', text: label, onclick });
}

function row(label, ...children) {
  return el('div', { class: 'when-row' }, el('span', { class: 'when-row__label', text: label }), ...children);
}

// What each chip stands for now, so a chip reused for a different option still works.
const chipOption = new WeakMap();

// Keyed buttons that show which one is picked, rebuilt without losing the pressed node.
function chips(parent, options, { key = (option) => String(option), label, title, pressed, pick }) {
  reconcile(
    parent,
    options,
    key,
    () => {
      const node = el('button', { class: 'chip chip--choice', type: 'button' });
      node.addEventListener('click', () => pick(chipOption.get(node)));
      return node;
    },
    (node, option) => {
      chipOption.set(node, option);
      node.textContent = label(option);
      node.setAttribute('aria-label', title(option));
      node.setAttribute('aria-pressed', String(Boolean(pressed(option))));
    },
  );
}

function sync(input, value) {
  if (input.value !== value) input.value = value;
}

function clockOf(input) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.value) ? input.value : null;
}

function maxDay(a, b) {
  return a > b ? a : b;
}
