import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALL_PALETTES, fallArt, fallFor, fallOffset, FALLS, fallTile, parseWeather, planGust, TILE, tickDelay } from '../../web/js/scene/fall.js';
import { seededRandom } from '../../web/js/random.js';
import { SEASONS } from '../../web/js/scene/seasons.js';

test('real rain or snow wins; otherwise petals in spring, leaves in autumn, nothing else', () => {
  assert.equal(fallFor({ season: 'spring' }), 'petals');
  assert.equal(fallFor({ season: 'autumn' }), 'leaves');
  assert.equal(fallFor({ season: 'summer' }), null);
  assert.equal(fallFor({ season: 'winter' }), null, 'no snow falls in winter unless it is snowing');
  for (const season of SEASONS) {
    assert.equal(fallFor({ season, precipitation: 'rain' }), 'rain');
    assert.equal(fallFor({ season, precipitation: 'snow' }), 'snow');
    assert.equal(fallFor({ season, precipitation: null }), fallFor({ season }));
  }
});

test('only petals and leaves come in gusts; rain is the fastest', () => {
  assert.deepEqual(Object.keys(FALLS).sort(), ['embers', 'leaves', 'petals', 'rain', 'snow']);
  assert.deepEqual(Object.keys(FALLS).filter((k) => FALLS[k].gusts).sort(), ['leaves', 'petals']);
  for (const fall of Object.values(FALLS)) {
    assert.ok(fall.vy !== 0, 'everything moves up or down');
    assert.ok(fall.tickMs >= 125, 'never faster than 8 times a second');
  }
  assert.equal(Math.min(...Object.values(FALLS).map((f) => f.tickMs)), FALLS.rain.tickMs);
  assert.ok(FALLS.embers.vy < 0, 'embers rise');
});

test('the layer moves in whole art pixels, wraps after a tile, and depends only on the time', () => {
  for (const [kind, fall] of Object.entries(FALLS)) {
    let last = fallOffset(0, fall);
    assert.deepEqual(last, { x: 0, y: 0 });
    for (let ms = 0; ms <= 60000; ms += 37) {
      const { x, y } = fallOffset(ms, fall);
      for (const v of [x, y]) assert.ok(Number.isInteger(v) && v >= 0 && v < TILE, `${kind} at ${ms}ms: ${v}`);
      // One way only (down, or up for embers), a pixel or so at a time, apart from wrapping by a tile.
      const dy = fall.vy > 0 ? (y - last.y + TILE) % TILE : (last.y - y + TILE) % TILE;
      assert.ok(dy <= Math.ceil((Math.abs(fall.vy) * 37) / 1000), `${kind} jumped ${dy}`);
      last = { x, y };
    }
    const lapMs = (TILE / Math.abs(fall.vy)) * 1000;
    assert.equal(fallOffset(lapMs, fall).y, 0, `${kind} comes back round after one tile`);
    assert.deepEqual(fallOffset(12345, fall), fallOffset(12345, fall));
  }
  for (const kind of ['rain', 'snow']) {
    assert.equal(FALLS[kind].vx, 0, `${kind} comes straight down`);
    assert.equal(fallOffset(7777, FALLS[kind]).x, 0);
  }
  assert.ok(FALLS.rain.vy > FALLS.snow.vy * 5, 'rain falls much faster than snow');
});

test('tiles are the right size, use their own colours, and keep every bit inside the tile', () => {
  for (const kind of Object.keys(FALLS)) {
    const rows = fallTile(kind);
    assert.equal(rows.length, TILE);
    let cells = 0;
    rows.forEach((line, y) => {
      assert.equal(line.length, TILE);
      [...line].forEach((ch, x) => {
        if (ch === '.') return;
        cells++;
        assert.ok(FALL_PALETTES[kind][ch], `${kind} has no colour for ${ch}`);
        assert.ok(x < TILE - 1 && y < TILE - 1, `${kind} bit at ${x},${y} touches the edge it wraps to`);
      });
    });
    assert.ok(cells >= 12 && cells <= 150, `${kind} has ${cells} cells: enough to see, not a blizzard`);
    assert.deepEqual(fallTile(kind), rows, 'the same every time');
    assert.match(fallArt(kind), /^url\("data:image\/svg\+xml,/);
  }
});

test('gusts blow for about 20 seconds every one to three minutes', () => {
  const random = seededRandom(5);
  for (let i = 0; i < 100; i++) {
    const first = planGust(random, { first: true });
    assert.ok(first.in >= 8000 && first.in <= 30000);
    const gust = planGust(random);
    assert.ok(gust.in >= 60000 && gust.in <= 180000, `waits ${gust.in}`);
    assert.ok(gust.lasts >= 16000 && gust.lasts <= 24000, `lasts ${gust.lasts}`);
  }
});

test('the ticker wakes as soon as anything needs moving, and no sooner', () => {
  assert.equal(tickDelay({ untilVisit: 90000 }), 1000, 'clouds only: once a second');
  assert.equal(tickDelay({ untilVisit: 300 }), 300, 'a critter about to come out');
  assert.equal(tickDelay({ visit: true }), 125, 'a critter on stage');
  assert.equal(tickDelay({ untilVisit: 90000, fallTickMs: FALLS.snow.tickMs }), 250, 'snow');
  assert.equal(tickDelay({ untilVisit: 90000, fallTickMs: FALLS.rain.tickMs }), 125, 'rain');
  assert.equal(tickDelay({ untilVisit: 90000, untilChange: 40 }), 40, 'a gust about to start or end');
  assert.equal(tickDelay({ untilVisit: -5 }), 0);
});

test('?weather= takes rain, snow or none', () => {
  for (const value of ['rain', 'snow', 'none']) assert.equal(parseWeather(value), value);
  for (const value of [null, '', 'hail', 'RAIN']) assert.equal(parseWeather(value), null);
});
