import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resist, swipeTarget, velocity } from '../../web/js/swipe.js';

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
