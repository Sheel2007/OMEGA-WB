// Countdown: what the widget and the app say about the days left. Pure, so node can
// test it. Days are counted on this screen's own calendar ("YYYY-MM-DD" keys), so
// a countdown turns over at local midnight, the same moment as the clock.
import { dayDate, daysBetween } from '../calendar/agenda.js';

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
