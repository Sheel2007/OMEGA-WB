import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksBands, celestial, dayPhase, solarPosition, skyAt, skyFor, longitudeFromOffset, parseTimeOverride, THEME_MODES } from '../../web/js/sky.js';
import { contrastRatio, mixHex } from '../../web/js/color.js';

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

test('the clock stays readable against the sky at every sun height (WCAG AA large text, 3:1)', () => {
  const text = { light: '#0f1d3f', dark: '#f1f3ff' };
  for (let elevation = -20; elevation <= 90; elevation += 0.25) {
    const sky = skyAt(elevation);
    // The clock covers roughly the top 70% of the way from the sky's top colour to its middle colour.
    for (const t of [0, 0.25, 0.5, 0.72]) {
      const behind = mixHex(sky.top, sky.mid, t);
      const ratio = contrastRatio(text[sky.theme], behind);
      assert.ok(ratio >= 3, `${sky.theme} clock on ${behind} at ${elevation}° is only ${ratio.toFixed(2)}:1`);
    }
  }
});

test('skyFor follows the sun in auto mode and holds still otherwise', () => {
  assert.deepEqual(skyFor('auto', -10), skyAt(-10));
  assert.equal(skyFor('light', -10).theme, 'light');
  assert.equal(skyFor('light', -10).stars, 0);
  assert.equal(skyFor('dark', 60).theme, 'dark');
  assert.ok(skyFor('dark', 60).stars > 0.8);
  assert.equal(skyFor('blocks', -10).theme, 'blocks');
  assert.equal(skyFor('blocks', -10).night, true);
  assert.equal(skyFor('blocks', 30).night, false);
  assert.ok(skyFor('blocks', -15).stars > 0.8);
  assert.equal(skyFor('blocks', 30).stars, 0);
  assert.deepEqual(skyFor('mystery', 20), skyAt(20));
  assert.deepEqual(THEME_MODES, ['auto', 'light', 'dark', 'blocks']);
});

test('contrastRatio and mixHex follow the WCAG maths', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('the Blocks sky keeps its white, outlined clock readable at every sun height (3:1)', () => {
  for (let elevation = -20; elevation <= 90; elevation += 0.25) {
    const bands = blocksBands(skyFor('blocks', elevation));
    assert.equal(bands.length, 5);
    // The clock sits over the top two of the five bands.
    for (const band of bands.slice(0, 2)) {
      const ratio = contrastRatio('#ffffff', band);
      assert.ok(ratio >= 3, `white clock on ${band} at ${elevation}° is only ${ratio.toFixed(2)}:1`);
    }
  }
});

test('celestial puts the sun up by day and the moon up by night', () => {
  const noon = celestial({ elevation: 60, hourAngle: 0, noonElevation: 60 });
  assert.equal(noon.sun.visible, true);
  assert.equal(noon.moon.visible, false);
  assert.ok(Math.abs(noon.sun.x - 0.5) < 0.01, 'midday sun is in the middle');
  assert.ok(noon.sun.y < 0.3, 'and high up');

  const morning = celestial({ elevation: 10, hourAngle: -60, noonElevation: 60 });
  assert.ok(morning.sun.x < 0.5, 'morning sun is on the left (east)');

  const midnight = celestial({ elevation: -40, hourAngle: 180, noonElevation: 60 });
  assert.equal(midnight.sun.visible, false);
  assert.equal(midnight.moon.visible, true);
});

test('dayPhase names the part of the day', () => {
  assert.equal(dayPhase({ elevation: 30, hourAngle: 10 }), 'day');
  assert.equal(dayPhase({ elevation: -12, hourAngle: 170 }), 'night');
  assert.equal(dayPhase({ elevation: 2, hourAngle: -80 }), 'dawn');
  assert.equal(dayPhase({ elevation: 2, hourAngle: 80 }), 'dusk');
});
