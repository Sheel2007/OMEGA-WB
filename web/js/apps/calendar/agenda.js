// Words and ordering for the calendar: merging the household's own events with the
// subscribed (Google) ones, grouping them by day, and naming the days. Pure, so it's
// tested in node.
//
// Every date here is a local calendar day as 'YYYY-MM-DD' and every time a local
// 'HH:MM', the way the server sends them: the board and the phones in the house are
// in the same place, so nobody has to think about time zones.

// Keeps the DOM light: the agenda never hands back more rows than this.
export const MAX_AGENDA_EVENTS = 100;
// The longest an all-day event is spread across days (matches the server's limit).
export const MAX_SPAN_DAYS = 30;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const longDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

// Days

export function dayKey(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Midday, so a day never drifts into its neighbour when the clocks change.
export function dayDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function shiftDay(key, days) {
  return dayKey(new Date(dayDate(key).getTime() + days * DAY_MS));
}

export function daysBetween(from, to) {
  return Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / DAY_MS);
}

export function msUntilMidnight(now) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

// Names

export function formatTime(clock) {
  if (!CLOCK.test(clock ?? '')) return '';
  const [hours, minutes] = clock.split(':').map(Number);
  return timeFormat.format(new Date(2026, 0, 1, hours, minutes));
}

// '15:00' plus 90 minutes is '16:30'. It never runs past the end of the day.
export function addMinutes(clock, minutes) {
  if (!CLOCK.test(clock ?? '')) return null;
  const [hours, mins] = clock.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  if (total >= 24 * 60) return '23:59';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// How long a timed event runs, in minutes, or null if it has no end.
export function minutesBetween(start, end) {
  if (!CLOCK.test(start ?? '') || !CLOCK.test(end ?? '')) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

// The full name of a day, for the headings in the app.
export function dayLabel(key, today) {
  const away = daysBetween(today, key);
  if (away === 0) return 'Today';
  if (away === 1) return 'Tomorrow';
  if (away === -1) return 'Yesterday';
  return (away > 1 && away < 7 ? longDayFormat : shortDayFormat).format(dayDate(key));
}

// The short name of a day, for the badge on each row of the widget.
export function dayBadge(key, today) {
  const away = daysBetween(today, key);
  if (away === 0) return 'Today';
  if (away === 1) return 'Tmrw';
  if (away > 1 && away < 7) return weekdayFormat.format(dayDate(key));
  return monthDayFormat.format(dayDate(key));
}

// How far off the next thing is, for the line under the widget's title.
export function nextLabel(events, today) {
  const next = events.find((event) => event.date >= today);
  if (!next) return 'Nothing coming up';
  const todayCount = events.filter((event) => event.date === today).length;
  if (todayCount) return todayCount === 1 ? '1 event today' : `${todayCount} events today`;
  const away = daysBetween(today, next.date);
  if (away === 1) return 'Next: tomorrow';
  if (away < 7) return `Next: ${weekdayFormat.format(dayDate(next.date))}`;
  return `Next: ${monthDayFormat.format(dayDate(next.date))}`;
}

// "3:00 – 4:30 PM", "3:00 PM", "All day" or "All day · 3 days".
export function timeLabel(event) {
  if (!event.time) return event.days > 1 ? `All day · ${event.days} days` : 'All day';
  return event.endTime ? `${formatTime(event.time)} – ${formatTime(event.endTime)}` : formatTime(event.time);
}

// The second line of an event: where it is, what calendar it's on, which day of a run.
export function detailLabel(event) {
  const run = event.days > 1 && event.dayOffset != null ? `Day ${event.dayOffset + 1} of ${event.days}` : null;
  return [event.calendar, event.location, run].filter(Boolean).join(' · ');
}

export function countLabel(count) {
  if (count === 0) return 'Nothing on';
  return count === 1 ? '1 event' : `${count} events`;
}

// Merging

function cleanTitle(title) {
  return typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function span(event) {
  const last = DAY_KEY.test(event.endDate ?? '') ? event.endDate : event.date;
  const counted = Number.isFinite(event.days) ? Math.trunc(event.days) : daysBetween(event.date, last) + 1;
  return Math.min(Math.max(1, counted), MAX_SPAN_DAYS);
}

// Every event the board shows, wherever it came from, looks the same from here on.
function normalise(event, { ours, writable }) {
  if (!DAY_KEY.test(event?.date ?? '') || !cleanTitle(event.title)) return null;
  const days = span(event);
  return {
    id: event.id,
    title: cleanTitle(event.title),
    date: event.date,
    time: CLOCK.test(event.time ?? '') ? event.time : null,
    endTime: CLOCK.test(event.endTime ?? '') ? event.endTime : null,
    endDate: shiftDay(event.date, days - 1),
    days,
    location: text(event.location),
    description: text(event.description),
    calendar: ours ? null : text(event.calendar),
    calendarId: ours ? null : (text(event.calendarId) ?? null),
    color: ours ? null : text(event.color),
    ours,
    // Only events the board can change get a remove button.
    writable: ours || Boolean(writable ?? event.writable),
  };
}

function order(a, b) {
  // All-day events head their day, then timed ones by the clock.
  return (
    a.date.localeCompare(b.date) ||
    Number(Boolean(a.time)) - Number(Boolean(b.time)) ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.title.localeCompare(b.title)
  );
}

// `events` are the ones the board keeps itself and `feed` the ones from connected
// calendars. Ours come first, so when the same thing is on a connected calendar too,
// the copy kept is the one that still knows where it lives.
export function mergeEvents({ events = [], feed = [] } = {}) {
  const ours = Array.isArray(events) ? events.map((event) => normalise(event, { ours: true })) : [];
  const theirs = Array.isArray(feed) ? feed.map((event) => normalise(event, { ours: false })) : [];
  const seen = new Set();
  const merged = [];
  for (const event of [...ours, ...theirs]) {
    if (!event) continue;
    const key = `${event.date}|${event.time ?? ''}|${event.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged.sort(order);
}

// Grouping

// Groups events into the days they fall on, from `from` onwards, spreading a
// multi-day event across each of its days. Returns at most `limit` events in all.
export function groupByDay(events, { from, through = null, limit = MAX_AGENDA_EVENTS } = {}) {
  const byDay = new Map();
  let total = 0;
  for (const event of events) {
    for (let offset = 0; offset < event.days; offset++) {
      const key = offset === 0 ? event.date : shiftDay(event.date, offset);
      if (key < from || (through && key > through)) continue;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(event.days > 1 ? { ...event, dayOffset: offset } : event);
      total++;
    }
  }
  const days = [];
  let shown = 0;
  for (const key of [...byDay.keys()].sort()) {
    if (shown >= limit) break;
    const events_ = byDay.get(key).slice(0, limit - shown);
    shown += events_.length;
    days.push({ key, events: events_ });
  }
  return { days, total, shown };
}

// The flat list the widget shows: the next few events, each tagged with the day it's
// on. Unlike the app's agenda, a multi-day event takes one row rather than one a day,
// so a week away doesn't push everything else off a small widget.
export function upcoming(events, { from, limit = MAX_AGENDA_EVENTS } = {}) {
  const rows = events
    .filter((event) => shiftDay(event.date, event.days - 1) >= from)
    .map((event) => ({ ...event, day: event.date < from ? from : event.date }))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        Number(Boolean(a.time)) - Number(Boolean(b.time)) ||
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.title.localeCompare(b.title),
    );
  return { rows: rows.slice(0, limit), total: rows.length };
}
