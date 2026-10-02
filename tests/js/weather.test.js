import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWeather, localDate } from '../../web/js/apps/weather/conditions.js';

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
