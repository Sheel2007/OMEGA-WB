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

// The app library rises under the finger: 0 is closed, 1 is open. Dragging up
// (dy < 0) opens it, one for one with the finger over `distance` px.
// Let go past this share of the way (from where it started), or flick, and it goes the rest.
const LIBRARY_COMMIT = 0.25;
// Pulled past open, it gives a little, like the end of a scroll on an iPad.
const LIBRARY_STRETCH = 0.2;
const LIBRARY_STRETCH_LIMIT = 0.08;

export function libraryProgress({ from, dy, distance }) {
  if (!distance) return from;
  const raw = from - dy / distance;
  if (raw <= 1) return Math.max(0, raw);
  return 1 + Math.min(LIBRARY_STRETCH_LIMIT, (raw - 1) * LIBRARY_STRETCH);
}

// Whether it ends up open. vy is the finger's speed in px/ms (up is negative).
export function libraryTarget({ from, progress, vy }) {
  if (Math.abs(vy) >= TURN_SPEED) return vy < 0;
  return from >= 1 ? progress > 1 - LIBRARY_COMMIT : progress > LIBRARY_COMMIT;
}

// The page before the first one (the Sports page) slides in under the finger
// like any other page: 0 is shut, 1 is open, one for one over the screen's
// width. Dragging right (dx > 0) opens it.
export function sideProgress({ from, dx, width }) {
  if (!width) return from;
  return Math.min(1, Math.max(0, from + dx / width));
}

// Whether it ends up open: the same distance or flick that turns a page. vx is
// the finger's speed in px/ms (right is positive).
export function sideTarget({ from, progress, vx }) {
  if (Math.abs(vx) >= TURN_SPEED) return vx > 0;
  return from >= 1 ? progress > 1 - TURN_DISTANCE : progress > TURN_DISTANCE;
}

// A damped spring from 0 to 1, for a CSS `linear()` easing, so a release carries
// on at the finger's speed and settles the way iOS does. `velocity` is in units
// of the whole distance per second at the start; `response` is the spring's
// period in seconds and `damping` its damping ratio (1 never overshoots).
// Returns the duration (ms), the easing, and at(fraction of the duration) → value.
const SPRING_STEP_S = 1 / 240;
const SPRING_MAX_S = 2;
const SPRING_STOPS = 48;

export function spring({ velocity = 0, response = 0.42, damping = 0.86 } = {}) {
  const omega = (2 * Math.PI) / response;
  const stiffness = omega * omega;
  const friction = 2 * damping * omega;
  let x = 0;
  let v = velocity;
  const samples = [0];
  for (let t = 0; t < SPRING_MAX_S; t += SPRING_STEP_S) {
    v += (-stiffness * (x - 1) - friction * v) * SPRING_STEP_S;
    x += v * SPRING_STEP_S;
    samples.push(x);
    if (Math.abs(1 - x) < 5e-4 && Math.abs(v) < 0.05) break;
  }
  samples[samples.length - 1] = 1;
  const last = samples.length - 1;
  const stops = Array.from({ length: SPRING_STOPS + 1 }, (_, i) => samples[Math.round((i / SPRING_STOPS) * last)]);
  const at = (fraction) => {
    const f = Math.min(1, Math.max(0, fraction)) * SPRING_STOPS;
    const i = Math.min(SPRING_STOPS - 1, Math.floor(f));
    return stops[i] + (stops[i + 1] - stops[i]) * (f - i);
  };
  return {
    duration: Math.round(last * SPRING_STEP_S * 1000),
    easing: `linear(${stops.map((stop) => +stop.toFixed(4)).join(', ')})`,
    at,
  };
}
