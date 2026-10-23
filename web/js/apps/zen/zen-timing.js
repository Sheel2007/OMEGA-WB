// Zen mode's timings, in one place.

// The controls rest (fade away) after this long without a touch.
export const CONTROLS_REST_MS = 6000;
// "Tap anywhere" shows the first time they rest, for this long.
export const HINT_MS = 3500;
// A mood moves the sun over this long, a step at a time (each step repaints the sky).
export const SKY_CHANGE_MS = 12000;
export const SKY_STEP_MS = 500;
// The breathing sun's ticker: 8 steps a second, like a visiting critter.
export const BREATH_TICK_MS = 125;
// The small clock on the controls.
export const CLOCK_TICK_MS = 10000;
// A shooting star now and then while it's night (real or a mood).
export const SHOOTING_STAR_MS = [40000, 120000];
// The first one after the starry night mood comes in, once the sky has darkened.
export const FIRST_STAR_AFTER_MS = SKY_CHANGE_MS + 1500;

export function nextShootingStar(random) {
  const [lo, hi] = SHOOTING_STAR_MS;
  return Math.round(lo + random() * (hi - lo));
}

// How many repaints a sky change takes.
export function skySteps(durationMs, stepMs = SKY_STEP_MS) {
  return Math.max(1, Math.round(durationMs / stepMs));
}
