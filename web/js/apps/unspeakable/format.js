// Words for the ledger: "5 min ago", "4 things we don't talk about", "#3".

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function timeAgo(iso, now = new Date()) {
  if (!iso) return '';
  const then = new Date(iso);
  const elapsed = now - then;
  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(then)) / (24 * HOUR));
  if (days === 0) return `${Math.floor(elapsed / HOUR)} hr ago`;
  if (days === 1) return 'Yesterday';
  return dateFormat.format(then);
}

// An empty ledger in a house this size is a little suspicious, so say so.
export function countLabel(count) {
  if (count === 0) return 'Nothing on the record. Suspicious.';
  return count === 1 ? '1 thing we don’t talk about' : `${count} things we don’t talk about`;
}

// The widget's head has room for a few words, not the whole joke.
export function shortCountLabel(count) {
  if (count === 0) return 'Nothing sealed';
  return count === 1 ? '1 sealed' : `${count} sealed`;
}

// Case numbers: the list arrives newest first, so the oldest incident is #1.
export function numbered(entries) {
  return entries.map((entry, index) => ({ ...entry, number: entries.length - index }));
}

export function caseLabel(number) {
  return `#${number}`;
}
