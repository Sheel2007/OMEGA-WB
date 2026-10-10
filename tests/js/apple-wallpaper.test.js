import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backdropCss, BLOBS, colorAt, over, saturate, wallpaperCss } from '../../web/js/apple-wallpaper.js';
import { contrastRatio } from '../../web/js/color.js';

// The Apple theme's text and accents (tokens.css).
const ACCENTS = {
  calendar: '#ff9a90',
  weather: '#64d2ff',
  notes: '#ffd60a',
  games: '#c7a6ff',
  lights: '#ffb340',
  'roommate-games': '#5ee0c4',
  grocery: '#ff8cba',
};

function everywhere(fn) {
  for (let x = 0; x <= 100; x += 2) for (let y = 0; y <= 100; y += 2) fn(x, y);
}

test('saturate() follows the CSS filter matrix', () => {
  assert.equal(saturate('#808080'), '#808080', 'greys stay grey');
  assert.equal(saturate('#6a3fd0', 1), '#6a3fd0');
  // Channels move away from the colour's grey: the lowest (green) drops, the highest (blue) rises.
  assert.equal(saturate('#6a3fd0'), '#7d2fff');
});

test('the wallpaper and the glass copy are the same blobs, the copy saturated', () => {
  assert.equal(wallpaperCss().split('radial-gradient').length - 1, BLOBS.length);
  assert.equal(backdropCss().split('radial-gradient').length - 1, BLOBS.length);
  assert.notEqual(wallpaperCss(), backdropCss());
});

test('text on the glass passes WCAG AA wherever a card sits', () => {
  everywhere((x, y) => {
    const glass = colorAt(x, y, { glass: true });
    // Empty states: 55% white.
    const quiet = contrastRatio(over('#ffffff', 0.55, glass), glass);
    assert.ok(quiet >= 4.5, `55% white at ${x},${y} is ${quiet.toFixed(2)}:1`);
    for (const [id, accent] of Object.entries(ACCENTS)) {
      const ratio = contrastRatio(accent, glass);
      assert.ok(ratio >= 4.5, `${id} label at ${x},${y} is ${ratio.toFixed(2)}:1`);
      // The + inside its 18% tint (a graphic: 3:1).
      const plus = contrastRatio(accent, over(accent, 0.18, glass));
      assert.ok(plus >= 3, `${id} + at ${x},${y} is ${plus.toFixed(2)}:1`);
    }
  });
});

test('the clock and its 70% white date read on the wallpaper itself', () => {
  everywhere((x, y) => {
    const wall = colorAt(x, y);
    assert.ok(contrastRatio('#ffffff', wall) >= 7);
    assert.ok(contrastRatio(over('#ffffff', 0.7, wall), wall) >= 4.5);
  });
});
