// What the Blocks critters do, worked out ahead of time as a plan: either a dash
// across the screen, or a visit (walk in, linger and blink, walk off). Pure
// functions of time, so the scene only asks "where is it now?" a few times a
// second, and tests can check every moment.

const WALK_SPEED = 110; // px per second
const RUN_SPEED = 300;
const WALK_FRAME_MS = 250; // leg swap
const RUN_FRAME_MS = 125;
const LINGER_MS = [20000, 40000];
const BLINK_MS = 160;
const BLINK_EVERY_MS = [2000, 5000];
const FIRST_VISIT_MS = [20000, 60000];
const VISIT_EVERY_MS = [3 * 60000, 8 * 60000];
const DASH_CHANCE = 0.4;
// Keeps lingering spots away from the very edges.
const EDGE_MARGIN = 0.08;
const SPOT_TRIES = 30;

const between = (random, [lo, hi]) => lo + random() * (hi - lo);

export function nextVisitDelay(random, { first = false } = {}) {
  return Math.round(between(random, first ? FIRST_VISIT_MS : VISIT_EVERY_MS));
}

function walk(from, to, start, speed) {
  const duration = (Math.abs(to - from) / speed) * 1000;
  return { from, to, start, end: start + duration, frameMs: speed === RUN_SPEED ? RUN_FRAME_MS : WALK_FRAME_MS };
}

// A spot to linger that isn't hidden behind anything in `avoid` (e.g. the dock).
function lingerSpot(random, { width, size, avoid }) {
  const lo = width * EDGE_MARGIN;
  const hi = width * (1 - EDGE_MARGIN) - size;
  for (let i = 0; i < SPOT_TRIES; i++) {
    const x = Math.round(lo + random() * (hi - lo));
    if (avoid.every((a) => x + size <= a.left || x >= a.right)) return x;
  }
  return Math.round(lo);
}

// lingerMs overrides how long a visit stays (the dev ?critter=stay mode uses it).
export function planVisit(random, { width, size, avoid = [], kind, lingerMs } = {}) {
  const type = kind ?? (random() < DASH_CHANCE ? 'dash' : 'visit');
  const fromLeft = random() < 0.5;
  const offLeft = -size;
  const offRight = width;
  if (type === 'dash') {
    const leg = walk(fromLeft ? offLeft : offRight, fromLeft ? offRight : offLeft, 0, RUN_SPEED);
    return { kind: 'dash', segments: [leg], duration: leg.end };
  }
  const spot = lingerSpot(random, { width, size, avoid });
  const enter = walk(fromLeft ? offLeft : offRight, spot, 0, WALK_SPEED);
  const linger = lingerMs ?? between(random, LINGER_MS);
  const blinks = [];
  for (let t = enter.end + between(random, BLINK_EVERY_MS); t < enter.end + linger - BLINK_MS; t += between(random, BLINK_EVERY_MS)) {
    blinks.push(Math.round(t));
  }
  const stay = { at: spot, start: enter.end, end: enter.end + linger, facing: fromLeft ? 1 : -1, blinks };
  // Usually carries on the way it was going; sometimes turns back.
  const exitRight = random() < 0.7 ? fromLeft : !fromLeft;
  const leave = walk(spot, exitRight ? offRight : offLeft, stay.end, WALK_SPEED);
  return { kind: 'visit', segments: [enter, stay, leave], duration: leave.end };
}

export function critterAt(plan, ms) {
  if (ms >= plan.duration) return { done: true };
  const segment = plan.segments.find((s) => ms < s.end) ?? plan.segments.at(-1);
  if ('at' in segment) {
    const blinking = segment.blinks.some((t) => ms >= t && ms < t + BLINK_MS);
    return { x: segment.at, frame: blinking ? 'blink' : 'idle', facing: segment.facing, done: false };
  }
  const t = (ms - segment.start) / (segment.end - segment.start);
  const x = Math.round(segment.from + (segment.to - segment.from) * t);
  const frame = Math.floor((ms - segment.start) / segment.frameMs) % 2 === 0 ? 'walk1' : 'walk2';
  return { x, frame, facing: segment.to >= segment.from ? 1 : -1, done: false };
}

// Clouds drift left to right forever, snapped to art pixels (`step`), entering
// from the left as they leave on the right. `runMs` only counts unpaused time.
export function cloudX(runMs, cloud, { width, step }) {
  const span = width + cloud.width;
  const travelled = (cloud.offset + (runMs * cloud.speed) / 1000) % span;
  return Math.floor((travelled - cloud.width) / step) * step;
}
