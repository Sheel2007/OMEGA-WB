// Countdown: what the widget and the app say about the days left. Pure, so node can
// test it. Days are counted on this screen's own calendar ("YYYY-MM-DD" keys), so
// a countdown turns over at local midnight, the same moment as the clock.
import { dayDate, daysBetween, upcoming as upcomingEvents } from './agenda.js';

const shortDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const shortDayYear = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
// Further off than this, the date says its year too.
const YEAR_AFTER_DAYS = 300;

export function daysLeft(countdown, today) {
  return daysBetween(today, countdown.date);
}

// Still to come (today included), soonest first; two on one day keep their order.
export function upcoming(countdowns, today) {
  return withDays(countdowns, today)
    .filter((item) => item.days >= 0)
    .sort((a, b) => a.days - b.days);
}

// Already been, most recent first: the app keeps them until someone clears them.
export function finished(countdowns, today) {
  return withDays(countdowns, today)
    .filter((item) => item.days < 0)
    .sort((a, b) => b.days - a.days);
}

function withDays(countdowns, today) {
  const list = Array.isArray(countdowns) ? countdowns : [];
  return list.filter((c) => c && typeof c.date === 'string').map((c) => ({ ...c, days: daysLeft(c, today) }));
}

// The big number and the word under it: { number: '24', unit: 'days' }, and on the
// day itself { number: 'Today', unit: '' }.
export function bigNumber(days) {
  if (days === 0) return { number: 'Today', unit: '' };
  const count = Math.abs(days);
  return { number: String(count), unit: count === 1 ? 'day' : 'days' };
}

// The same thing in a few words for a list row: "Today", "Tomorrow", "24 days".
export function leftLabel(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return days === -1 ? 'Yesterday' : `${-days} days ago`;
  return `${days} days`;
}

// "Mon, Dec 14", with the year once it's far off ("Wed, Jan 27, 2027").
export function dateLabel(countdown, today) {
  const far = Math.abs(daysLeft(countdown, today)) > YEAR_AFTER_DAYS;
  return (far ? shortDayYear : shortDay).format(dayDate(countdown.date));
}

// The line under the app's name, and the widget's summary.
export function countLabel(count) {
  if (count === 0) return 'Nothing to count down to';
  return count === 1 ? '1 coming up' : `${count} coming up`;
}

// What the app's icon says on a phone: "UMD finals in 24 days".
export function nextLabel(countdowns, today) {
  const [next] = upcoming(countdowns, today);
  if (!next) return 'Add a day to wait for';
  if (next.days === 0) return `${next.title} is today`;
  if (next.days === 1) return `${next.title} tomorrow`;
  return `${next.title} in ${next.days} days`;
}

// For a screen reader: "UMD finals: 24 days, Mon, Dec 14".
export function spoken(countdown, today) {
  return `${countdown.title}: ${leftLabel(daysLeft(countdown, today))}, ${dateLabel(countdown, today)}`;
}

// Countdowns among the calendar's events, for the Calendar widget and app.

// The server keeps a countdown's name to this many characters (board/countdown.py).
export const MAX_COUNTDOWN_TITLE = 40;

const fold = (title) => (typeof title === 'string' ? title.trim().replace(/\s+/g, ' ').toLowerCase() : '');

// An event's name as a countdown's: tidied and cut to the server's length, counted
// in characters (code points), so the cut never splits an emoji in half. Half an
// emoji is a string the server can't write to disk.
export function countdownTitle(title) {
  const clean = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
  return Array.from(clean).slice(0, MAX_COUNTDOWN_TITLE).join('').trim();
}

// An event and a countdown are the same thing when they're on the same day under the
// same name. The event's name is cut the way countdownTitle() cuts it, so a long
// event counted down to from the app still matches the countdown made from it.
export function sameThing(event, countdown) {
  return event.date === countdown.date && fold(countdownTitle(event.title)) === fold(countdown.title);
}

// The countdown an agenda row stands for. A counted-down event that runs for days is
// one on its first day only; the days after it are ordinary rows.
export function countdownOn(event) {
  return event.dayOffset ? null : (event.countdown ?? null);
}

// All-day first, then by the clock, then by name: the agenda's own order.
function byDay(a, b) {
  return (
    a.date.localeCompare(b.date) ||
    Number(Boolean(a.time)) - Number(Boolean(b.time)) ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.title.localeCompare(b.title)
  );
}

// The events with the countdowns still to come worked in: an event that is a
// countdown is marked `countdown: { id, left }`, and a countdown with no event of its
// own becomes an all-day row of its own. Countdowns that have been are left out.
export function markCountdowns(events, countdowns, today) {
  const coming = upcoming(countdowns, today);
  const matched = new Set();
  const marked = (Array.isArray(events) ? events : []).map((event) => {
    const twin = coming.find((countdown) => !matched.has(countdown.id) && sameThing(event, countdown));
    if (!twin) return event;
    matched.add(twin.id);
    return { ...event, countdown: { id: twin.id, left: twin.days } };
  });
  for (const countdown of coming) {
    if (matched.has(countdown.id)) continue;
    marked.push({
      id: `countdown:${countdown.id}`,
      title: countdown.title,
      date: countdown.date,
      time: null,
      endTime: null,
      endDate: countdown.date,
      days: 1,
      color: null,
      ours: false,
      writable: false,
      countdown: { id: countdown.id, left: countdown.days },
    });
  }
  return marked.sort(byDay);
}

// What the Calendar widget shows: the first `heroCount` countdowns big, and the
// agenda under them with the rest worked in. A hero never shows again as a row, and
// neither does the event it stands for.
export function widgetRows({ events, countdowns, today, heroCount, limit }) {
  const coming = upcoming(countdowns, today);
  const heroes = coming.slice(0, heroCount);
  const rest = coming.slice(heroCount);
  const list = (Array.isArray(events) ? events : []).filter((event) => !heroes.some((hero) => sameThing(event, hero)));
  const { rows, total } = upcomingEvents(markCountdowns(list, rest, today), { from: today, limit });
  return { heroes, rows, total };
}
