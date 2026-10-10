import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryProgress, libraryTarget, resist, spring, swipeTarget, velocity } from '../../web/js/swipe.js';

const width = 1000;

test('a long enough drag turns the page', () => {
  assert.equal(swipeTarget({ page: 0, count: 3, dx: -300, vx: 0, width }), 1);
  assert.equal(swipeTarget({ page: 1, count: 3, dx: 300, vx: 0, width }), 0);
  assert.equal(swipeTarget({ page: 1, count: 3, dx: -100, vx: 0, width }), 1, 'too short: stay');
});

test('a quick flick turns the page even when it is short', () => {
  assert.equal(swipeTarget({ page: 0, count: 3, dx: -60, vx: -0.6, width }), 1);
  assert.equal(swipeTarget({ page: 2, count: 3, dx: 40, vx: 0.5, width }), 1);
});

test('a flick against the drag direction cancels it', () => {
  assert.equal(swipeTarget({ page: 1, count: 3, dx: -300, vx: 0.6, width }), 1);
});

test('never goes past the first or last page', () => {
  assert.equal(swipeTarget({ page: 0, count: 3, dx: 500, vx: 1, width }), 0);
  assert.equal(swipeTarget({ page: 2, count: 3, dx: -500, vx: -1, width }), 2);
  assert.equal(swipeTarget({ page: 0, count: 1, dx: -500, vx: -1, width }), 0);
});

test('dragging past the ends meets resistance', () => {
  assert.equal(resist(200, { page: 1, count: 3, width }), 200, 'free in the middle');
  assert.ok(resist(400, { page: 0, count: 3, width }) < 150, 'pulled back at the start');
  assert.ok(resist(-400, { page: 2, count: 3, width }) > -150, 'pulled back at the end');
});

test('velocity uses the most recent movement only', () => {
  const samples = [
    { t: 0, x: 0 },
    { t: 500, x: -10 },
    { t: 560, x: -40 },
    { t: 600, x: -70 },
  ];
  assert.equal(velocity(samples).toFixed(2), '-0.60');
  assert.equal(velocity([{ t: 0, x: 0 }]), 0);
});

test('the app library follows the finger up and down, between closed and open', () => {
  assert.equal(libraryProgress({ from: 0, dy: -500, distance: 1000 }), 0.5, 'half way up');
  assert.equal(libraryProgress({ from: 0, dy: 300, distance: 1000 }), 0, 'dragging down from closed stays closed');
  assert.equal(libraryProgress({ from: 1, dy: 250, distance: 1000 }), 0.75, 'dragging an open one down');
  const stretched = libraryProgress({ from: 1, dy: -200, distance: 1000 });
  assert.ok(stretched > 1 && stretched < 1.05, 'past open it gives a little');
  assert.equal(libraryProgress({ from: 1, dy: -5000, distance: 1000 }), 1.08, 'but only so far');
});

test('the app library opens after a quarter of the way or a flick, and closes the same way', () => {
  assert.equal(libraryTarget({ from: 0, progress: 0.2, vy: 0 }), false, 'a short, slow drag up falls back');
  assert.equal(libraryTarget({ from: 0, progress: 0.3, vy: 0 }), true);
  assert.equal(libraryTarget({ from: 0, progress: 0.05, vy: -0.6 }), true, 'a quick flick up opens it');
  assert.equal(libraryTarget({ from: 0, progress: 0.6, vy: 0.6 }), false, 'flicked back down: never mind');
  assert.equal(libraryTarget({ from: 1, progress: 0.8, vy: 0 }), true, 'pulled down a little stays open');
  assert.equal(libraryTarget({ from: 1, progress: 0.7, vy: 0 }), false);
  assert.equal(libraryTarget({ from: 1, progress: 0.95, vy: 0.6 }), false, 'a quick flick down closes it');
});

test('the spring settles at 1, and a flick carries on at the finger\'s speed', () => {
  const still = spring();
  assert.equal(still.at(0), 0);
  assert.equal(still.at(1), 1);
  assert.ok(still.duration > 200 && still.duration < 2000, `settles in ${still.duration}ms`);
  assert.match(still.easing, /^linear\(0, [\d., -]+, 1\)$/);
  const flicked = spring({ velocity: 6 });
  assert.ok(flicked.at(0.05) > still.at(0.05), 'already moving when it starts');
  const firm = spring({ damping: 1 });
  for (let f = 0; f <= 1; f += 0.02) assert.ok(firm.at(f) <= 1.0005, 'a damping of 1 never overshoots');
  assert.ok(Math.max(...Array.from({ length: 51 }, (_, i) => spring({ damping: 0.6 }).at(i / 50))) > 1, 'a looser one does');
});
