// Swipe maths for the home pages. Pure, so it's tested in node.

// Turn the page after dragging this share of its width, or flicking at this speed (px/ms).
const TURN_DISTANCE = 0.18;
const TURN_SPEED = 0.35;
// Past the first or last page the track follows the finger at this rate, up to this share of the width.
const EDGE_RESISTANCE = 0.3;
const EDGE_LIMIT = 0.12;
// Speed is measured over the last part of the gesture, so a pause before letting go counts.
const VELOCITY_WINDOW_MS = 100;

export function swipeTarget({ page, count, dx, vx, width }) {
  let target = page;
  const flick = Math.abs(vx) >= TURN_SPEED;
  const far = Math.abs(dx) >= width * TURN_DISTANCE;
  if (flick) target = vx < 0 ? page + 1 : page - 1;
  else if (far) target = dx < 0 ? page + 1 : page - 1;
  // A flick back the other way at the end of a long drag means "never mind".
  if (flick && far && Math.sign(vx) !== Math.sign(dx)) target = page;
  return Math.min(count - 1, Math.max(0, target));
}

export function resist(dx, { page, count, width }) {
  const pastStart = page === 0 && dx > 0;
  const pastEnd = page === count - 1 && dx < 0;
  if (!pastStart && !pastEnd) return dx;
  const limit = width * EDGE_LIMIT;
  return Math.sign(dx) * Math.min(limit, Math.abs(dx) * EDGE_RESISTANCE);
}

// samples: [{ t, x }] oldest first.
export function velocity(samples) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? samples[samples.length - 2];
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

// The app library slides up from the bottom of the home screen under the finger:
// 0 is closed, 1 is open. Dragging up (dy < 0) opens it.
// Let go past this share of the way (from where it started), or flick, and it goes the rest.
const LIBRARY_COMMIT = 0.25;

export function libraryProgress({ from, dy, height }) {
  if (!height) return from;
  return Math.min(1, Math.max(0, from - dy / height));
}

// Whether it ends up open. vy is the finger's speed in px/ms (up is negative).
export function libraryTarget({ from, progress, vy }) {
  if (Math.abs(vy) >= TURN_SPEED) return vy < 0;
  return from >= 1 ? progress > 1 - LIBRARY_COMMIT : progress > LIBRARY_COMMIT;
}
