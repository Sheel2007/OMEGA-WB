// Zen mode's breathing: in for 4 seconds, hold for 2, out for 6, again and again
// for a few minutes, while a big pixel sun grows and shrinks with you. Pure: the
// app asks where a session is at any moment and draws that.

export const BREATH = { inMs: 4000, holdMs: 2000, outMs: 6000 };
export const BREATH_MS = BREATH.inMs + BREATH.holdMs + BREATH.outMs;
// Minutes a session can last.
export const SESSIONS = [1, 3, 5];

// How big the sun is (1 = full size), in whole steps, so it grows like everything
// else in the Blocks world does: a block at a time, not smoothly.
export const SMALLEST = 0.55;
export const LARGEST = 1;
export const STEPS = 18;

const PROMPTS = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' };

export function breathCount(minutes) {
  return Math.max(1, Math.round((minutes * 60000) / BREATH_MS));
}

const ease = (t) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2;

function stepped(scale) {
  const share = (scale - SMALLEST) / (LARGEST - SMALLEST);
  return SMALLEST + (Math.round(share * STEPS) / STEPS) * (LARGEST - SMALLEST);
}

// Where a session of `breaths` breaths is, `ms` after it started.
export function breathAt(ms, breaths) {
  if (ms >= breaths * BREATH_MS) return { done: true, phase: 'done', prompt: 'Nicely done', scale: SMALLEST, breath: breaths };
  const breath = Math.floor(ms / BREATH_MS) + 1;
  const into = ms % BREATH_MS;
  let phase;
  let size;
  let left;
  if (into < BREATH.inMs) {
    phase = 'in';
    size = ease(into / BREATH.inMs);
    left = BREATH.inMs - into;
  } else if (into < BREATH.inMs + BREATH.holdMs) {
    phase = 'hold';
    size = 1;
    left = BREATH.inMs + BREATH.holdMs - into;
  } else {
    phase = 'out';
    size = 1 - ease((into - BREATH.inMs - BREATH.holdMs) / BREATH.outMs);
    left = BREATH_MS - into;
  }
  return {
    done: false,
    phase,
    prompt: PROMPTS[phase],
    scale: stepped(SMALLEST + size * (LARGEST - SMALLEST)),
    breath,
    secondsLeft: Math.ceil(left / 1000),
  };
}
