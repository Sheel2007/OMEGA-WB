import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLS } from '../../web/js/scene/fall.js';
import { LAYERS, PLACES, placeArt, placeById, placeVars } from '../../web/js/scene/places.js';
import { SEASONS } from '../../web/js/scene/seasons.js';

test('every place has a unique id, a name, and a sky we can draw', () => {
  const ids = PLACES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(PLACES.length >= 15, 'all the kinds of place');
  for (const place of PLACES) {
    assert.ok(place.label.length > 0);
    assert.ok(['open', 'cave', 'underworld', 'void'].includes(place.sky), `${place.id} sky`);
    assert.ok(place.fall === undefined || place.fall === null || FALLS[place.fall], `${place.id} falls ${place.fall}`);
    if (place.sky !== 'open') assert.ok(place.backdrop, `${place.id} has something instead of a sky`);
  }
  assert.equal(PLACES[0].id, 'meadow', 'the meadow comes first: it is where Zen starts');
  assert.equal(placeById('nowhere').id, 'meadow');
});

test('no place is named after a game world (our own underworld and floating isles)', () => {
  for (const place of PLACES) assert.doesNotMatch(place.label, /nether|\bend\b|ender|minecraft/i, place.label);
});

test('every layer of every place is the right size and has a colour for every pixel', () => {
  for (const place of PLACES) {
    for (const season of place.seasonal ? SEASONS : ['summer']) {
      const art = placeArt(place.id, { season });
      assert.ok(art.floor && art.trees && art.flora, `${place.id} has ground, trees and plants`);
      for (const [name, piece] of Object.entries(art)) {
        if (!piece) continue;
        const [w, h] = LAYERS[name];
        assert.equal(piece.rows.length, h, `${place.id} ${name} rows`);
        for (const line of piece.rows) {
          assert.equal(line.length, w, `${place.id} ${name} width`);
          for (const ch of line) assert.ok(ch === '.' || piece.palette[ch], `${place.id} ${season} ${name} has no colour for "${ch}"`);
        }
        assert.ok(piece.rows.join('').replace(/\./g, '').length > 0, `${place.id} ${name} draws something`);
      }
      assert.ok(!art.floor.rows.join('').includes('.'), `${place.id}'s ground is solid`);
    }
  }
});

test('a place always looks the same, and the meadow follows the season', () => {
  assert.deepEqual(placeArt('forest'), placeArt('forest'));
  const leaves = (season) => placeArt('meadow', { season }).trees.palette.l;
  assert.equal(new Set(SEASONS.map(leaves)).size, 4, 'different leaves every season');
});

test('the custom properties come out for every place, by day and by night', () => {
  for (const place of PLACES) {
    const day = placeVars(place.id);
    const night = placeVars(place.id, { night: true });
    for (const [name, value] of Object.entries(day)) {
      if (name === '--zen-sky') continue;
      assert.ok(value === 'none' || /^url\("data:image\/svg\+xml,[^"]+"\)$/.test(value), `${place.id} ${name}`);
      assert.ok(value.length < 60000, `${place.id} ${name} is ${value.length} characters`);
    }
    if (place.sky === 'open') {
      assert.notEqual(day['--zen-trees'], night['--zen-trees'], `${place.id} darkens at night`);
      assert.equal(day['--zen-sky'], 'transparent');
    } else {
      assert.equal(day['--zen-trees'], night['--zen-trees'], `${place.id} has no night underground`);
      assert.match(day['--zen-sky'], /^#[0-9a-f]{6}$/);
    }
  }
});
