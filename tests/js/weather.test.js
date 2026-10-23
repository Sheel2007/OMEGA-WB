import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWeather, localDate, precipitation } from '../../web/js/apps/weather/conditions.js';

test('describeWeather names the common WMO codes', () => {
  assert.deepEqual(describeWeather(0, true), { label: 'Sunny', icon: 'sun' });
  assert.deepEqual(describeWeather(0, false), { label: 'Clear', icon: 'moon' });
  assert.deepEqual(describeWeather(2, true), { label: 'Partly cloudy', icon: 'partly-day' });
  assert.deepEqual(describeWeather(2, false), { label: 'Partly cloudy', icon: 'partly-night' });
  assert.deepEqual(describeWeather(3), { label: 'Cloudy', icon: 'cloud' });
  assert.deepEqual(describeWeather(45), { label: 'Foggy', icon: 'fog' });
  assert.deepEqual(describeWeather(53), { label: 'Drizzle', icon: 'drizzle' });
  assert.deepEqual(describeWeather(65), { label: 'Heavy rain', icon: 'rain' });
  assert.deepEqual(describeWeather(73), { label: 'Snow', icon: 'snow' });
  assert.deepEqual(describeWeather(81), { label: 'Showers', icon: 'rain' });
  assert.deepEqual(describeWeather(95), { label: 'Thunderstorms', icon: 'storm' });
});

test('describeWeather defaults to day and copes with codes it does not know', () => {
  assert.equal(describeWeather(1).icon, 'partly-day');
  assert.deepEqual(describeWeather(1234), { label: 'Cloudy', icon: 'cloud' });
});

test('localDate reads forecast days as local calendar dates, not UTC midnight', () => {
  const date = localDate('2026-10-02');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 2);
  assert.equal(date.getHours(), 12);
});

test('precipitation: rain for drizzle, rain, showers and storms; snow for snow; nothing otherwise', () => {
  const rain = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
  const snow = [71, 73, 75, 77, 85, 86];
  const dry = [0, 1, 2, 3, 45, 48];
  for (const code of rain) assert.equal(precipitation(code), 'rain', `code ${code}`);
  for (const code of snow) assert.equal(precipitation(code), 'snow', `code ${code}`);
  for (const code of dry) assert.equal(precipitation(code), null, `code ${code}`);
  assert.equal(precipitation(1234), null, 'a code it does not know');
  assert.equal(precipitation(undefined), null);
});
