import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../../web/js/random.js';
import { FALLS } from '../../web/js/scene/fall.js';
import { celestial, dayPhase, sunBetween } from '../../web/js/sky.js';
import { BREATH, BREATH_MS, breathAt, breathCount, LARGEST, SESSIONS, SMALLEST, STEPS } from '../../web/js/apps/zen/breathe.js';
import { MOODS, moodById, STARRY_NIGHT, SUNSET } from '../../web/js/apps/zen/moods.js';
import { fillNoise, nextCrackle, SOUNDS, VOLUMES } from '../../web/js/apps/zen/sounds-plan.js';
import {
  CONTROLS_REST_MS,
  nextShootingStar,
  SHOOTING_STAR_MS,
  SKY_CHANGE_MS,
  SKY_STEP_MS,
  skySteps,
} from '../../web/js/apps/zen/zen-timing.js';
import * as zen from '../../web/js/apps/zen/meta.js';

test('Zen is an immersive app with no widget', () => {
  assert.equal(zen.id, 'zen');
  assert.equal(zen.immersive, true);
  assert.equal(zen.widgetSize, undefined);
  assert.match(zen.iconGlyph, /^<svg/);
});

test('every mood moves the sun somewhere real, or leaves it, and drops something that can fall', () => {
  assert.deepEqual(MOODS.map((m) => m.id), ['now', 'rain', 'snow', 'sunset', 'night']);
  for (const mood of MOODS) {
    assert.ok(mood.fall === undefined || mood.fall === null || FALLS[mood.fall], `${mood.id} falls ${mood.fall}`);
    assert.ok(mood.sound === null || SOUNDS[mood.sound], `${mood.id} sounds like ${mood.sound}`);
    assert.ok(mood.label.length > 0);
  }
  assert.equal(moodById('now').fall, undefined, 'Now leaves it to the real weather');
  assert.equal(moodById('nope').id, 'now');
  assert.equal(dayPhase(SUNSET), 'dusk', 'the sunset is a dusk, with the day visitors');
  const sunset = celestial({ ...SUNSET, noonElevation: 60 });
  assert.ok(sunset.sun.visible && sunset.sun.x > 0.6, 'the sun shows, low in the west (right)');
  assert.equal(dayPhase(STARRY_NIGHT), 'night', 'a starry night brings the night visitors');
  assert.ok(celestial({ ...STARRY_NIGHT, noonElevation: 60 }).moon.visible, 'the moon is out');
});

test('the sun moves between moods along a sun-like arc, forward in time, ending exactly there', () => {
  const noon = { elevation: 50, hourAngle: -5, noonElevation: 60 };
  const night = { ...STARRY_NIGHT, noonElevation: 60 };
  let lastAngle = noon.hourAngle;
  for (let i = 0; i <= 24; i++) {
    const sun = sunBetween(noon, night, i / 24);
    assert.ok(sun.elevation >= -90 && sun.elevation <= 90, `${sun.elevation}`);
    const moved = (((sun.hourAngle - lastAngle) % 360) + 360) % 360;
    assert.ok(moved < 90, 'only ever forward, a step at a time');
    lastAngle = sun.hourAngle;
  }
  assert.deepEqual(sunBetween(noon, night, 1), night);
  assert.deepEqual(sunBetween(noon, night, 0).elevation, noon.elevation);
  // Forward from evening to morning goes through the night; the short way back doesn't.
  const evening = { elevation: 3, hourAngle: 75, noonElevation: 60 };
  const morning = { elevation: 20, hourAngle: -60, noonElevation: 60 };
  assert.ok(sunBetween(evening, morning, 0.5).elevation < 0, 'forward: the sun sets first');
  assert.ok(sunBetween(evening, morning, 0.5, { direction: 'shortest' }).elevation > 0, 'shortest: straight back over noon');
});

test('a sky change is a handful of steps, not a smooth animation', () => {
  assert.equal(skySteps(SKY_CHANGE_MS), SKY_CHANGE_MS / SKY_STEP_MS);
  assert.ok(SKY_STEP_MS >= 250, 'no more than a few sky repaints a second');
  assert.equal(skySteps(0), 1);
});

test('breathing goes in for 4, holds for 2, out for 6, and ends when the time is up', () => {
  assert.equal(BREATH_MS, 12000);
  assert.deepEqual(SESSIONS, [1, 3, 5]);
  assert.equal(breathCount(1), 5);
  assert.equal(breathCount(5), 25);
  assert.equal(breathAt(0, 5).phase, 'in');
  assert.equal(breathAt(BREATH.inMs + 10, 5).phase, 'hold');
  assert.equal(breathAt(BREATH.inMs + BREATH.holdMs + 10, 5).phase, 'out');
  assert.equal(breathAt(BREATH_MS + 10, 5).breath, 2);
  assert.equal(breathAt(5 * BREATH_MS, 5).done, true);
  // Grows while breathing in, biggest while holding, shrinks while breathing out, in whole steps.
  let last = 0;
  for (let ms = 0; ms < BREATH.inMs; ms += 125) {
    const { scale } = breathAt(ms, 1);
    assert.ok(scale >= last, 'grows');
    last = scale;
  }
  assert.equal(breathAt(BREATH.inMs + 500, 1).scale, LARGEST);
  for (let ms = BREATH.inMs + BREATH.holdMs; ms < BREATH_MS; ms += 125) {
    const { scale } = breathAt(ms, 1);
    assert.ok(scale <= last, 'shrinks');
    assert.ok(scale >= SMALLEST && scale <= LARGEST);
    const step = ((scale - SMALLEST) / (LARGEST - SMALLEST)) * STEPS;
    assert.ok(Math.abs(step - Math.round(step)) < 1e-9, 'whole steps');
    last = scale;
  }
  assert.equal(breathAt(1000, 1).prompt, 'Breathe in');
});

test('the controls rest after a few seconds; shooting stars come now and then', () => {
  assert.ok(CONTROLS_REST_MS >= 4000 && CONTROLS_REST_MS <= 10000);
  const random = seededRandom(4);
  for (let i = 0; i < 100; i++) {
    const ms = nextShootingStar(random);
    assert.ok(ms >= SHOOTING_STAR_MS[0] && ms <= SHOOTING_STAR_MS[1]);
  }
});

test('every sound recipe is made of real, gentle numbers', () => {
  const finite = (v) => Number.isFinite(v) && v > 0;
  for (const [name, sound] of Object.entries(SOUNDS)) {
    assert.ok(['white', 'pink', 'brown'].includes(sound.noise), name);
    assert.ok(sound.filters.length > 0);
    for (const f of sound.filters) {
      assert.ok(['lowpass', 'highpass', 'bandpass'].includes(f.type));
      assert.ok(finite(f.frequency) && f.frequency < 20000 && finite(f.Q));
    }
    assert.ok(finite(sound.level) && sound.level <= 1);
    if (sound.drift) {
      assert.ok(sound.filters[sound.drift.filter], `${name} drifts a filter it has`);
      assert.ok(finite(sound.drift.rateHz) && sound.drift.rateHz < 1, 'slow');
      assert.ok(sound.drift.depthHz < sound.filters[sound.drift.filter].frequency, 'never sweeps below zero');
    }
  }
  assert.ok(VOLUMES.quiet < VOLUMES.normal && VOLUMES.normal <= 0.5, 'background, not a speaker test');
  const random = seededRandom(9);
  for (let i = 0; i < 100; i++) {
    const c = nextCrackle(random, SOUNDS.campfire.crackles);
    assert.ok(c.inMs >= 120 && c.inMs <= 1100 && c.level > 0 && c.level <= 0.3 && c.lengthMs > 0);
  }
});

test('noise stays between -1 and 1 and centred, whatever its colour', () => {
  for (const kind of ['white', 'pink', 'brown']) {
    const samples = fillNoise(kind, new Float32Array(48000), seededRandom(2));
    let sum = 0;
    for (const v of samples) {
      assert.ok(v >= -1 && v <= 1 && Number.isFinite(v));
      sum += v;
    }
    assert.ok(Math.abs(sum / samples.length) < 0.1, `${kind} is centred`);
    assert.ok(samples.some((v) => Math.abs(v) > 0.05), `${kind} isn't silent`);
  }
});
