import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio } from '../../web/js/color.js';
import { FLORA_SIZE, landColours, nightColour, sceneryArt, sceneryVars } from '../../web/js/scene/scenery-art.js';
import { parseSeason, SEASONS, seasonAt } from '../../web/js/scene/seasons.js';

// Local dates, so the test means the same in every timezone.
const day = (month, date) => new Date(2027, month - 1, date, 12);

test('seasons change on the first of March, June, September and December', () => {
  const north = 40;
  assert.equal(seasonAt(day(2, 28), north), 'winter');
  assert.equal(seasonAt(day(3, 1), north), 'spring');
  assert.equal(seasonAt(day(5, 31), north), 'spring');
  assert.equal(seasonAt(day(6, 1), north), 'summer');
  assert.equal(seasonAt(day(8, 31), north), 'summer');
  assert.equal(seasonAt(day(9, 1), north), 'autumn');
  assert.equal(seasonAt(day(11, 30), north), 'autumn');
  assert.equal(seasonAt(day(12, 1), north), 'winter');
  assert.equal(seasonAt(day(12, 31), north), 'winter');
  assert.equal(seasonAt(day(1, 1), north), 'winter');
  assert.equal(seasonAt(new Date(2028, 1, 29, 23, 59), north), 'winter', 'leap day');
  assert.equal(seasonAt(new Date(2028, 2, 1, 0, 0), north), 'spring', 'just after midnight');
});

test('south of the equator the seasons are the other way round', () => {
  assert.equal(seasonAt(day(1, 15), -35), 'summer');
  assert.equal(seasonAt(day(4, 15), -35), 'autumn');
  assert.equal(seasonAt(day(7, 15), -35), 'winter');
  assert.equal(seasonAt(day(10, 15), -35), 'spring');
  assert.equal(seasonAt(day(7, 15), 0), 'summer', 'the equator counts as north');
  assert.equal(seasonAt(day(7, 15)), 'summer', 'no latitude counts as north');
});

test('?season= takes only real seasons', () => {
  for (const season of SEASONS) assert.equal(parseSeason(season), season);
  for (const bad of [null, '', 'fall', 'WINTER', 'monsoon']) assert.equal(parseSeason(bad), null);
});

const SIZES = { floor: [16, 16], hill: [32, 9], tree: [10, 10], flora: [FLORA_SIZE.width, FLORA_SIZE.height] };

test('every season draws every piece at its size, in its own colours', () => {
  for (const season of SEASONS) {
    const art = sceneryArt(season);
    for (const [piece, [width, height]] of Object.entries(SIZES)) {
      if (piece === 'flora' && art.flora === null) continue;
      const { rows, palette } = art[piece];
      assert.equal(rows.length, height, `${season} ${piece} rows`);
      for (const line of rows) {
        assert.equal(line.length, width, `${season} ${piece}: "${line}"`);
        for (const ch of line) assert.ok(ch === '.' || palette[ch], `${season} ${piece} has no colour for "${ch}"`);
      }
      for (const colour of Object.values(palette)) assert.match(colour, /^#[0-9a-f]{6}$/);
    }
  }
  assert.equal(sceneryArt('winter').flora, null, 'nothing grows in winter');
  assert.deepEqual(sceneryArt('monsoon'), sceneryArt('summer'), 'anything else is dressed for summer');
});

test('the custom properties come out for every season, by day and by night, and stay small', () => {
  for (const season of SEASONS) {
    for (const night of [false, true]) {
      const vars = sceneryVars(season, { night });
      assert.deepEqual(Object.keys(vars).sort(), ['--art-floor', '--art-flora', '--art-hill', '--art-tree']);
      for (const [name, value] of Object.entries(vars)) {
        if (value === 'none') {
          assert.equal(`${season} ${name}`, 'winter --art-flora');
          continue;
        }
        assert.match(value, /^url\("data:image\/svg\+xml,[^"]+"\)$/, `${season} ${name}`);
        assert.ok(value.length < 6000, `${season} ${name} is ${value.length} characters`);
      }
    }
  }
});

test('night darkens the land', () => {
  const day = sceneryVars('summer');
  const night = sceneryVars('summer', { night: true });
  assert.notEqual(day['--art-hill'], night['--art-hill']);
  for (const colour of landColours('summer')) {
    assert.ok(contrastRatio(nightColour(colour), '#000000') < contrastRatio(colour, '#000000'), `${colour} gets darker`);
  }
});

test('winter is white on top, and the dirt below stays dirt', () => {
  const { rows, palette } = sceneryArt('winter').floor;
  for (const ch of rows[0]) assert.ok(contrastRatio(palette[ch], '#000000') > 12, `snow ${palette[ch]} is light`);
  assert.deepEqual(rows, sceneryArt('summer').floor.rows, 'same blocks, new colours');
});
