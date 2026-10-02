import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarPosition, skyAt, longitudeFromOffset, parseTimeOverride } from '../../web/js/sky.js';

test('sun is high at midsummer noon and below the horizon at midnight', () => {
  const noon = solarPosition(new Date('2026-06-21T12:02:00Z'), 40, 0);
  assert.ok(Math.abs(noon.elevation - 73.4) < 1, `noon elevation ${noon.elevation}`);
  assert.ok(Math.abs(noon.hourAngle) < 3, `noon hour angle ${noon.hourAngle}`);

  const midnight = solarPosition(new Date('2026-06-21T00:00:00Z'), 40, 0);
  assert.ok(midnight.elevation < -20, `midnight elevation ${midnight.elevation}`);
});

test('the morning sun is east of noon (negative hour angle)', () => {
  const morning = solarPosition(new Date('2026-03-20T08:00:00Z'), 51.5, 0);
  assert.ok(morning.hourAngle < -50 && morning.hourAngle > -70);
  assert.ok(morning.elevation > 5 && morning.elevation < 25);
});

test('skyAt switches to the dark theme once the sun sets', () => {
  assert.equal(skyAt(30).theme, 'light');
  assert.equal(skyAt(6).theme, 'light');
  assert.equal(skyAt(-1).theme, 'dark');
  assert.equal(skyAt(-30).theme, 'dark');
});

test('stars only come out when it is properly dark', () => {
  assert.equal(skyAt(10).stars, 0);
  assert.ok(skyAt(-15).stars > 0.8);
});

test('skyAt blends between keyframes', () => {
  assert.equal(skyAt(30).top, '#7db1ea');
  assert.equal(skyAt(90).top, '#78aee9');
  assert.equal(skyAt(60).top, '#7bb0ea'); // halfway, rounded per channel
});

test('longitude is estimated from the standard timezone offset', () => {
  assert.equal(longitudeFromOffset(300), -75); // US Eastern
  assert.equal(longitudeFromOffset(-60), 15); // Central Europe
});

test('parseTimeOverride understands HH:MM for previewing other times of day', () => {
  const base = new Date(2026, 9, 1, 9, 0);
  const at = parseTimeOverride('19:45', base);
  assert.equal(at.getHours(), 19);
  assert.equal(at.getMinutes(), 45);
  assert.equal(parseTimeOverride('nope', base), null);
  assert.equal(parseTimeOverride(null, base), null);
});
