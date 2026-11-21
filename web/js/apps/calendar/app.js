// Calendar: the full-screen app — what's coming up, and the form for adding to it.
// The days the house is counting down to (services.countdown, their own list on the
// Pi) live here too: the form's Count down to this switch adds one, the Countdowns
// panel lists them, and every event's hourglass counts down to it.
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
import {
  bigNumber,
  dateLabel,
  finished,
  leftLabel,
  markCountdowns,
  MAX_COUNTDOWN_TITLE,
  spoken,
  upcoming as upcomingCountdowns,
} from './countdowns.js';
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
// The longest event title the server takes (board/calendar.py MAX_TITLE_LENGTH).
const MAX_EVENT_TITLE = 80;
const chipFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const updatedFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function mount(root, { services, kiosk }) {
  const { calendar, countdown } = services;
  let firstRender = true;
  // While on, the form adds a countdown (a name and a day) instead of an event.
  let counting = false;
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

  const countdownSwitch = el(
    'button',
    {
      class: 'when-row__switch',
      type: 'button',
      role: 'switch',
      'aria-checked': 'false',
      onclick: () => setCounting(!counting),
    },
    el('span', { class: 'when-row__switch-text', text: 'Count down to this' }),
    el('span', { class: 'when-row__switch-track', 'aria-hidden': 'true' }),
  );
  // No label of its own: the switch says what it does.
  const countdownRow = row('', countdownSwitch);

  const whenRow = row('When', dayChips, datePicker);
  const formRows = el('div', { class: 'calendar-app__when' }, whenRow, countdownRow, timeRow, detailRow, calendarRow);

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

  const countdownList = el('ul', { class: 'countdown-list', 'aria-label': 'Counting down' });
  const countdownHint = el('p', {
    class: 'countdown-list__hint',
    text: 'Switch on Count down to this when you add something.',
  });
  const doneList = el('ul', { class: 'countdown-list countdown-list--done', 'aria-label': 'Been and gone' });
  const done = el(
    'details',
    { class: 'countdown-list__done' },
    el('summary', { class: 'countdown-list__summary', text: 'Been and gone' }),
    doneList,
  );
  const countdownPanel = el(
    'section',
    { class: 'panel panel--countdowns' },
    el('h2', { class: 'panel__title', text: 'Countdowns' }),
    countdownList,
    countdownHint,
    done,
  );

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

  // The quickest way to add something from a phone is Google Calendar itself: it has
  // the whole editor, and the board picks the event up on its next sync.
  const qr = el('div', { class: 'phone-link__qr', role: 'img', 'aria-label': 'QR code for Google Calendar' });
  const phoneNote = el('p', { class: 'phone-link__note' });
  const phone = el(
    'section',
    { class: 'panel panel--phone' },
    el('h2', { class: 'panel__title', text: 'Add on your phone' }),
    el(
      'div',
      { class: 'phone-link' },
      qr,
      el(
        'div',
        {},
        el('p', {
          class: 'phone-link__text',
          text: 'Scan to add an event in Google Calendar. The board picks it up on its next sync.',
        }),
        el('p', { class: 'phone-link__url', text: 'calendar.google.com' }),
      ),
    ),
    phoneNote,
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
    el('aside', { class: 'calendar-app__side' }, countdownPanel, calendars, phone),
  );
  root.append(view);

  fetchQrSvg({ target: 'google-calendar' }).then((svg) => {
    if (unmounted || !svg) return;
    qr.innerHTML = svg;
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
    // A countdown is a name and a day: no time, details or calendar to pick.
    timeRow.hidden = counting;
    detailRow.hidden = counting;
    calendarRow.hidden = counting || targets.length < 2;
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

  function setCounting(on) {
    counting = on;
    countdownSwitch.setAttribute('aria-checked', String(on));
    title.maxLength = on ? MAX_COUNTDOWN_TITLE : MAX_EVENT_TITLE;
    title.placeholder = on ? 'What are we counting down to?' : 'Add an event';
    title.setAttribute('aria-label', on ? 'Countdown to add' : 'Event to add');
    renderForm();
  }

  async function addEvent() {
    const text = title.value.trim();
    if (!text) {
      nudge(form);
      title.focus();
      return;
    }
    if (counting) {
      const day = draft.date;
      clearForm();
      try {
        await countDownTo(text, day);
        keyboard?.hide();
        setCounting(false);
      } catch {
        if (!title.value) {
          title.value = text;
          title.dispatchEvent(new Event('input'));
        }
      }
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

  // Countdowns

  // Adds one and says so, with an Undo. Rejects (after saying why) if it couldn't.
  async function countDownTo(text, day) {
    try {
      const result = await countdown.addCountdown(text, day);
      const added = result?.countdown?.id;
      toast(
        `Counting down to ${text}`,
        added
          ? { action: 'Undo', onAction: () => countdown.removeCountdown(added).catch((err) => toast(err.message)) }
          : undefined,
      );
    } catch (err) {
      toast(err.message);
      throw err;
    }
  }

  function removeCountdown(countdownId, label) {
    countdown.removeCountdown(countdownId).then(
      () =>
        toast(`${label} removed`, {
          action: 'Undo',
          onAction: () => countdown.restoreCountdowns([countdownId]).catch((err) => toast(err.message)),
        }),
      (err) => toast(err.message),
    );
  }

  // The hourglass on an event: count down to it, or stop.
  function toggleCountdown(node) {
    const counted = node.dataset.countdownId;
    if (counted) {
      removeCountdown(counted, node.dataset.eventTitle);
      return;
    }
    const text = node.dataset.eventTitle.slice(0, MAX_COUNTDOWN_TITLE).trim();
    countDownTo(text, node.dataset.eventDay).catch(() => {});
  }

  function createCountdown() {
    const node = el('li', { class: 'countdown-list__item' });
    node.append(
      el('span', { class: 'countdown-list__number', 'aria-hidden': 'true' }),
      el(
        'div',
        { class: 'countdown-list__what', 'aria-hidden': 'true' },
        el('p', { class: 'countdown-list__title' }),
        el('p', { class: 'countdown-list__date' }),
      ),
      el('button', {
        class: 'countdown-list__remove',
        type: 'button',
        html: icons.close,
        onclick: () => removeCountdown(node.dataset.key, node.dataset.title),
      }),
    );
    return node;
  }

  function updateCountdown(node, item, today) {
    const [number, what, remove] = node.children;
    const [itemTitle, date] = what.children;
    node.dataset.title = item.title;
    node.setAttribute('aria-label', spoken(item, today));
    node.classList.toggle('countdown-list__item--today', item.days === 0);
    number.textContent = bigNumber(item.days).number;
    itemTitle.textContent = item.title;
    // The big number already says how many days; words only where it can't
    // ("Tomorrow", "6 days ago").
    date.textContent = item.days > 1 ? dateLabel(item, today) : `${leftLabel(item.days)} · ${dateLabel(item, today)}`;
    remove.setAttribute('aria-label', `Remove ${item.title}`);
  }

  function renderCountdowns(countdowns, today) {
    const coming = upcomingCountdowns(countdowns, today);
    const gone = finished(countdowns, today);
    reconcile(countdownList, coming, (item) => item.id, createCountdown, (node, item) => updateCountdown(node, item, today));
    reconcile(doneList, gone, (item) => item.id, createCountdown, (node, item) => updateCountdown(node, item, today));
    countdownList.hidden = coming.length === 0;
    countdownHint.hidden = coming.length + gone.length > 0;
    done.hidden = gone.length === 0;
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
      () => {
        const row = el('li', { class: 'source-list__item' });
        // The whole row is the switch: tapping it shows or hides that calendar here.
        row.append(
          el(
            'button',
            {
              class: 'source-list__toggle',
              type: 'button',
              onclick: () => {
                const wanted = row.dataset.shown !== 'true';
                calendar.showCalendar(row.dataset.calendarId, wanted).catch((err) => toast(err.message));
              },
            },
            el('span', { class: 'source-list__dot' }),
            el('span', { class: 'source-list__name' }),
            el('span', { class: 'source-list__status' }),
          ),
        );
        return row;
      },
      (node, entry) => {
        const button = node.firstChild;
        const [dot, label, status] = button.children;
        node.dataset.calendarId = entry.id ?? '';
        node.dataset.shown = String(entry.shown !== false);
        dot.dataset.color = entry.color;
        label.textContent = entry.name;
        const target = entry.kind === 'google' && entry.id === account.target;
        if (entry.shown === false) status.textContent = 'Hidden';
        else status.textContent = entry.ok ? (target ? 'New events here' : 'Synced') : entry.error || 'Not syncing';
        status.classList.toggle('source-list__status--bad', entry.shown !== false && !entry.ok);
        button.setAttribute('aria-pressed', String(entry.shown !== false));
        button.setAttribute('aria-label', `${entry.shown === false ? 'Show' : 'Hide'} ${entry.name} on this board`);
        button.disabled = !entry.id;
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
    // Scanning the code only brings an event back here if the board reads that calendar.
    // A connected account reads them all; a subscription only reads the one it names.
    const subscribed = sources.calendars.some((entry) => entry.kind === 'ical');
    phoneNote.hidden = account.linked;
    if (subscribed) {
      phoneNote.textContent = 'The board shows the calendars listed above, so add the event to one of those.';
    } else {
      phoneNote.textContent = account.configured
        ? 'Connect the account above, or events you add there won’t reach the board.'
        : 'Nothing is connected yet, so events added there won’t reach the board. The README has the steps.';
    }
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
      // Count down to it (or stop): every event has one.
      el('button', {
        class: 'agenda__count',
        type: 'button',
        html: icons.hourglass,
        onclick: () => toggleCountdown(node),
      }),
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

  function updateEvent(node, event, today) {
    const [when, body, count, remove] = node.children;
    const [eventTitle, detail, note] = body.children;
    node.dataset.color = event.color ?? 'ours';
    node.dataset.eventId = event.id;
    node.dataset.eventTitle = event.title;
    node.dataset.eventDay = event.date;
    node.dataset.countdownId = event.countdown?.id ?? '';
    node.classList.toggle('agenda__event--countdown', Boolean(event.countdown));
    when.textContent = event.countdown ? leftLabel(event.countdown.left) : timeLabel(event);
    when.classList.toggle('agenda__when--all-day', !event.time && !event.countdown);
    // Something that started before today can't be counted down to.
    count.hidden = !event.countdown && event.date < today;
    count.setAttribute('aria-pressed', String(Boolean(event.countdown)));
    count.setAttribute('aria-label', event.countdown ? `Stop counting down to ${event.title}` : `Count down to ${event.title}`);
    eventTitle.textContent = event.title;
    detail.textContent = detailLabel(event);
    detail.hidden = !detail.textContent;
    note.textContent = event.description ?? '';
    note.hidden = !event.description;
    remove.hidden = !event.writable;
    remove.setAttribute('aria-label', `Remove ${event.title}`);
  }

  function render() {
    const { events: ours, sources } = calendar.getSnapshot();
    const { countdowns } = countdown.getState();
    const today = dayKey(new Date());
    const events = markCountdowns(mergeEvents({ events: ours, feed: sources.events }), countdowns, today);
    const { days, total, shown } = groupByDay(events, { from: today, limit: MAX_ROWS });
    // Countdowns with no event of their own are rows here, but they aren't events.
    meta.textContent = countLabel(total - events.filter((event) => event.id.startsWith('countdown:')).length);

    const apply = () => {
      reconcile(
        agenda,
        days,
        (day) => day.key,
        createDay,
        (node, day) => {
          const [heading, list] = node.children;
          heading.textContent = dayLabel(day.key, today);
          reconcile(list, day.events, (event) => `${event.id}:${event.dayOffset ?? 0}`, createEvent, (row, event) =>
            updateEvent(row, event, today),
          );
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
    renderCountdowns(countdowns, today);
    renderSources(sources);
    renderForm();
  }

  // "Today" has to become "Tomorrow" at midnight even if nothing else changes.
  function atMidnight() {
    midnight = setTimeout(() => {
      const today = dayKey(new Date());
      if (draft.date < today) draft = { ...draft, date: today, endDate: maxDay(today, draft.endDate) };
      render();
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribe = calendar.subscribe(render);
  const unsubscribeCountdown = countdown.subscribe(render);
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
      unsubscribeCountdown();
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
