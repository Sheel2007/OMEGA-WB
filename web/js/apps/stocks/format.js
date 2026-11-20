// Words, numbers and the day's line for the Stocks widget. Pure, so it's tested in node.

export const NAME = 'AI Index';

// What the strip is showing: 'off' (turned off in config.json), 'loading' (nothing
// read yet), 'error' (nothing to show and the market data can't be reached) or
// 'ready' (there's an index, even an old one).
export function viewOf(state) {
  if (!state?.enabled) return 'off';
  if (Number.isFinite(state.index?.change)) return 'ready';
  return state.error ? 'error' : 'loading';
}

// Which way a percent move points once it's rounded to what's shown: +0.004% is flat.
export function direction(change) {
  if (!Number.isFinite(change)) return 'flat';
  const shown = Math.round(change * 100);
  if (shown > 0) return 'up';
  return shown < 0 ? 'down' : 'flat';
}

// A percent move as the digits to show, without its sign: two decimals, or one
// from 10% up, so it's always three digits wide ("3.32", "12.4").
export function magnitude(change) {
  if (!Number.isFinite(change)) return '';
  const size = Math.abs(change);
  if (size >= 99.95) return String(Math.round(size));
  return size >= 9.995 ? size.toFixed(1) : size.toFixed(2);
}

// "+1.24%", "−3.32%" (a real minus sign), "0.00%".
export function percentText(change) {
  if (!Number.isFinite(change)) return '';
  const sign = { up: '+', down: '−', flat: '' }[direction(change)];
  return `${sign}${magnitude(change)}%`;
}

// What the number is: 'offline' (an old reading, the market data can't be reached),
// 'closed' (the last close's move) or 'open' (today so far). null when there's no number.
export function statusOf(state) {
  if (viewOf(state) !== 'ready') return null;
  if (state.error) return 'offline';
  return state.market === 'open' ? 'open' : 'closed';
}

const STATUS_LABELS = { open: 'Today', closed: 'Closed', offline: 'Offline' };

export function statusLabel(state) {
  return STATUS_LABELS[statusOf(state)] ?? '';
}

// The few words the strip shows instead of numbers (a word, and a line under it
// saying why), and `spoken`, the same thing for a screen reader.
export function noteFor(state) {
  switch (viewOf(state)) {
    case 'off':
      return { title: 'Off', hint: 'Set in config.json', spoken: 'turned off' };
    case 'loading':
      return { title: 'Loading', hint: 'Asking the market', spoken: 'loading' };
    case 'error':
      return { title: 'No data', hint: "Can't reach the market data", spoken: "can't reach the market data" };
    default:
      return null;
  }
}

// What a screen reader hears for the whole widget.
export function describe(state) {
  const name = state?.name || NAME;
  const note = noteFor(state);
  if (note) return `${name}: ${note.spoken}`;
  const way = { up: 'up', down: 'down', flat: 'unchanged' }[direction(state.index.change)];
  const move = way === 'unchanged' ? way : `${way} ${magnitude(state.index.change)}%`;
  const when = { open: 'today', closed: 'at the last close; the market is closed', offline: 'when last read; the market data is offline' };
  return `${name}: ${move} ${when[statusOf(state)]}`;
}

// Which companies show at step `page` when `size` fit at once: the list in order,
// `size` at a time, wrapping round. All of them (and no cycling) if they all fit.
export function pageOf(constituents, page, size) {
  const list = Array.isArray(constituents) ? constituents : [];
  const count = Math.max(1, Math.floor(size) || 1);
  if (list.length <= count) return list;
  const start = (((Math.floor(page) || 0) * count) % list.length + list.length) % list.length;
  return Array.from({ length: count }, (_, i) => list[(start + i) % list.length]);
}

// How many steps before the cycle is back where it began (1: nothing to cycle).
export function pageCount(total, size) {
  const count = Math.max(1, Math.floor(size) || 1);
  if (!(total > count)) return 1;
  // Stepping `count` at a time through `total` comes round after total / gcd steps.
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  return total / gcd(total, count);
}

// The least the line's box spans top to bottom, in index points, so a day that
// barely moved is drawn as nearly flat instead of blown up to fill the box.
const MIN_SPAN = 0.5;

// The day's line for an SVG `width` by `height` (the same units as its viewBox):
// { points: "x,y x,y …" for a polyline, baseline: the y of yesterday's close (100),
// last: { x, y } where the line ends }, or null if there's nothing to draw. x runs
// from the opening bell (0) to the closing bell (width), so the line grows through
// the day. Steps with no level (before every company has traded) are skipped.
export function sparkline(series, { width = 100, height = 40, pad = 2, base = 100 } = {}) {
  if (!series || !Array.isArray(series.levels)) return null;
  const { start, end, step, levels } = series;
  if (![start, end, step].every(Number.isFinite) || end <= start || step <= 0) return null;
  const marks = [];
  levels.forEach((level, i) => {
    if (Number.isFinite(level)) marks.push({ at: Math.min(1, Math.max(0, (i * step) / (end - start))), level });
  });
  if (marks.length === 0) return null;
  let low = Math.min(base, ...marks.map((mark) => mark.level));
  let high = Math.max(base, ...marks.map((mark) => mark.level));
  if (high - low < MIN_SPAN) {
    const middle = (high + low) / 2;
    low = middle - MIN_SPAN / 2;
    high = middle + MIN_SPAN / 2;
  }
  const round = (value) => Math.round(value * 100) / 100;
  const x = (at) => round(pad + at * (width - 2 * pad));
  const y = (level) => round(pad + ((high - level) / (high - low)) * (height - 2 * pad));
  const spots = marks.map((mark) => ({ x: x(mark.at), y: y(mark.level) }));
  // One reading is a point, which a polyline can't draw: give it a little length.
  if (spots.length === 1) spots.unshift({ x: Math.max(pad, spots[0].x - 1), y: spots[0].y });
  return {
    points: spots.map((spot) => `${spot.x},${spot.y}`).join(' '),
    baseline: y(base),
    last: spots[spots.length - 1],
  };
}
