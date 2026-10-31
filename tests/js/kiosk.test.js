import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';

const SECOND = 1000;

const listeners = new Map();
let stopKiosk = null;

beforeEach(() => {
  listeners.clear();
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = { documentElement: { classList: { add() {}, remove() {} } } };
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
});

afterEach(() => {
  stopKiosk?.();
  stopKiosk = null;
  mock.timers.reset();
  delete globalThis.document;
  delete globalThis.addEventListener;
});

const touch = () => listeners.get('pointerdown')();

// One second at a time: a single big tick would start a timer set by another timer
// from the end of the tick, not from when that timer fired.
function pass(seconds) {
  for (let i = 0; i < seconds; i++) mock.timers.tick(SECOND);
}

async function start(idleMs) {
  const { initKiosk } = await import('../../web/js/kiosk.js');
  const idle = { count: 0 };
  stopKiosk = initKiosk({ idleMs, onIdle: () => (idle.count += 1) }).stop;
  return idle;
}

test('goes idle once, after the wait, and not before', async () => {
  const idle = await start(() => 90 * SECOND);
  pass(89);
  assert.equal(idle.count, 0);
  pass(1);
  assert.equal(idle.count, 1);
  pass(600);
  assert.equal(idle.count, 1);
});

test('a touch starts the wait again', async () => {
  const idle = await start(() => 120 * SECOND);
  pass(119);
  touch();
  pass(119);
  assert.equal(idle.count, 0);
  pass(1);
  assert.equal(idle.count, 1);
});

test('a page that opened after the last touch still gets its whole wait, from that touch', async () => {
  let sports = false;
  const idle = await start(() => (sports ? 120 : 90) * SECOND);
  touch();
  // The swipe's last move came before the page counted as open.
  sports = true;
  pass(119);
  assert.equal(idle.count, 0);
  pass(1);
  assert.equal(idle.count, 1);
});

test('a page shut before the wait is over goes idle at the end of the wait it started', async () => {
  let sports = true;
  const idle = await start(() => (sports ? 120 : 90) * SECOND);
  sports = false;
  pass(119);
  assert.equal(idle.count, 0);
  pass(1);
  assert.equal(idle.count, 1);
});

test('stopping cancels the wait', async () => {
  const idle = await start(() => 90 * SECOND);
  stopKiosk();
  stopKiosk = null;
  pass(600);
  assert.equal(idle.count, 0);
});
