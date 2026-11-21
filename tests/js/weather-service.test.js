import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService } from '../../web/js/services/weather.js';

// A clock you step by hand: setTimer/clearTimer record what's waiting and for how long.
function fakeTimers() {
  const waiting = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => (waiting.set(next, { fn, ms }), next++),
    clearTimer: (id) => waiting.delete(id),
    pending: () => [...waiting.values()].map((t) => t.ms),
    async fire() {
      const [[id, { fn }]] = waiting;
      waiting.delete(id);
      fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('after a failed load it asks again in a minute, not ten', async () => {
  const timers = fakeTimers();
  const answers = [Promise.reject(new Error('Can’t reach the weather service right now.')), Promise.resolve({ temp: 64 })];
  const weather = createWeatherService({ fetchForecast: () => answers.shift(), ...timers });
  const seen = [];
  weather.subscribe((snapshot) => seen.push(snapshot.error ?? snapshot.forecast?.temp));
  await settle();
  assert.deepEqual(timers.pending(), [60 * 1000]);
  await timers.fire();
  assert.deepEqual(seen.slice(-1), [64], 'the forecast is back on the next try');
  assert.deepEqual(timers.pending(), [10 * 60 * 1000], 'and then the usual ten minutes');
});

test('nothing keeps asking once nobody is subscribed', async () => {
  const timers = fakeTimers();
  const weather = createWeatherService({ fetchForecast: () => Promise.resolve({ temp: 60 }), ...timers });
  const stop = weather.subscribe(() => {});
  await settle();
  stop();
  assert.deepEqual(timers.pending(), []);
  // Subscribing again while an old load is still out never leaves two timers running.
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  const again = createWeatherService({ fetchForecast: () => slow, ...timers });
  const first = again.subscribe(() => {});
  first();
  again.subscribe(() => {});
  release({ temp: 61 });
  await settle();
  await settle();
  assert.equal(timers.pending().length, 1);
});
