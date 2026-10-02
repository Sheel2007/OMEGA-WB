// Words for the notes app and widget: "5 min ago", "3 notes".

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

export function countLabel(count) {
  if (count === 0) return 'No notes';
  return count === 1 ? '1 note' : `${count} notes`;
}
