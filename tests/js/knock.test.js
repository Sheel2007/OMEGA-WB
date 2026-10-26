import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOCK_TAPS, KNOCK_WITHIN_MS, knock, recentTaps } from '../../web/js/knock.js';

// Taps `count` times, `gap` apart, and says which tap (if any) opened it.
function tapping(count, gap, options) {
  let taps = [];
  let at = 1000;
  for (let i = 1; i <= count; i++) {
    const result = knock(taps, at, options);
    taps = result.taps;
    if (result.opened) return i;
    at += gap;
  }
  return null;
}

test('five quick taps on the same spot open it, and nothing less does', () => {
  assert.equal(tapping(KNOCK_TAPS, 200), KNOCK_TAPS);
  assert.equal(tapping(KNOCK_TAPS - 1, 200), null, 'four taps is not the knock');
});

test('taps spread out over too long never add up', () => {
  // A second apart: by the fifth, the first has aged out of the window.
  assert.equal(tapping(KNOCK_TAPS, KNOCK_WITHIN_MS / 2), null);
  assert.equal(tapping(20, KNOCK_WITHIN_MS + 1), null, 'idly tapping all day is not the knock');
});

test('a run that is interrupted still opens once five land close together', () => {
  let taps = [];
  // Two taps, a long pause, then five quick ones.
  for (const at of [0, 400]) taps = knock(taps, at).taps;
  let opened = null;
  let at = 60_000;
  for (let i = 1; i <= KNOCK_TAPS; i++) {
    const result = knock(taps, at);
    taps = result.taps;
    if (result.opened) opened = i;
    at += 150;
  }
  assert.equal(opened, KNOCK_TAPS);
});

test('opening it clears the count, so the next knock starts from nothing', () => {
  let taps = [];
  let at = 0;
  for (let i = 0; i < KNOCK_TAPS; i++) {
    taps = knock(taps, (at += 100)).taps;
  }
  assert.deepEqual(taps, [], 'the run is spent');
  assert.equal(knock(taps, (at += 100)).opened, false, 'one more tap must not open it again');
});

test('the window keeps only the taps still worth counting', () => {
  const now = 10_000;
  const times = [now - 9000, now - 5000, now - 100, now - 50];
  assert.deepEqual(recentTaps(times, now, 3000), [now - 100, now - 50]);
  assert.deepEqual(recentTaps([], now, 3000), []);
});

test('the knock can be made longer or shorter', () => {
  assert.equal(tapping(3, 100, { taps: 3 }), 3);
  assert.equal(tapping(7, 100, { taps: 7 }), 7);
  assert.equal(tapping(5, 100, { taps: 7 }), null);
});
