import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio } from '../../web/js/color.js';
import { ANIMALS, CRITTERS, CRITTERS_FOR_PHASE, FRAMES, frameGrid, MONSTERS, SIZE, spriteSheetSvg } from '../../web/js/scene/critters.js';
import { cloudX, critterAt, nextVisitDelay, pickCritter, planVisit } from '../../web/js/scene/director.js';
import { seededRandom } from '../../web/js/random.js';
import { blocksBands, skyFor } from '../../web/js/sky.js';
import { landColours } from '../../web/js/scene/scenery-art.js';
import { SEASONS } from '../../web/js/scene/seasons.js';

test('every critter is drawn exactly 16 wide, patches included', () => {
  for (const def of Object.values(CRITTERS)) {
    assert.equal(def.base.length, SIZE, `${def.name} rows`);
    for (const line of def.base) assert.equal(line.length, SIZE, `${def.name}: "${line}"`);
    for (const frame of FRAMES.slice(1)) {
      for (const [row, line] of Object.entries(def[frame] ?? {})) {
        assert.ok(Number(row) >= 0 && Number(row) < SIZE, `${def.name} ${frame} row ${row}`);
        assert.equal(line.length, SIZE, `${def.name} ${frame} row ${row}: "${line}"`);
      }
    }
  }
});

test('every critter frame is a 16 × 16 grid using only its own colours', () => {
  for (const def of Object.values(CRITTERS)) {
    for (const frame of FRAMES) {
      const grid = frameGrid(def, frame);
      assert.equal(grid.length, SIZE, `${def.name} ${frame} rows`);
      for (const line of grid) {
        assert.equal(line.length, SIZE, `${def.name} ${frame} width`);
        for (const ch of line) assert.ok(ch === '.' || def.palette[ch], `${def.name} uses unknown colour "${ch}"`);
      }
    }
    assert.notDeepEqual(frameGrid(def, 'walk1'), frameGrid(def, 'walk2'), `${def.name} walk frames differ`);
  }
});

test('sprite sheets are small, crisp SVGs with a mirrored row', () => {
  for (const def of Object.values(CRITTERS)) {
    const svg = decodeURIComponent(spriteSheetSvg(def).split(',')[1]);
    assert.match(svg, /viewBox='0 0 64 32'/);
    assert.match(svg, /crispEdges/);
    assert.ok(svg.length < 20000, `${def.name} sheet is ${svg.length} bytes`);
  }
});

test('animals by day, monsters at night', () => {
  assert.deepEqual(Object.keys(CRITTERS_FOR_PHASE).sort(), ['dawn', 'day', 'dusk', 'night']);
  for (const [phase, pool] of Object.entries(CRITTERS_FOR_PHASE)) {
    assert.ok(pool.length >= 2, `${phase} has a choice`);
    for (const name of pool) assert.ok(CRITTERS[name], name);
  }
  assert.deepEqual(CRITTERS_FOR_PHASE.night, MONSTERS);
  for (const phase of ['dawn', 'day', 'dusk']) assert.deepEqual(CRITTERS_FOR_PHASE[phase], ANIMALS);
  assert.deepEqual([...ANIMALS, ...MONSTERS].sort(), Object.keys(CRITTERS).sort(), 'every critter comes out at some point');
});

test('the same critter never visits twice running, and everyone gets a turn', () => {
  const random = seededRandom(11);
  for (const pool of [ANIMALS, MONSTERS]) {
    let last = null;
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const name = pickCritter(random, pool, last);
      assert.ok(pool.includes(name));
      assert.notEqual(name, last);
      seen.add(name);
      last = name;
    }
    assert.deepEqual([...seen].sort(), [...pool].sort());
  }
  assert.equal(pickCritter(random, ['solo'], 'solo'), 'solo', 'a list of one still works');
});

// What's behind a critter as it walks along the top of the floor: the lowest sky
// band, or a hill or tree in any season, drawn darker once it's dark.
function backdrops(fromElevation, toElevation) {
  const colours = new Set();
  for (let elevation = fromElevation; elevation <= toElevation; elevation += 0.5) {
    const sky = skyFor('blocks', elevation);
    colours.add(blocksBands(sky)[4]);
    for (const season of SEASONS) for (const land of landColours(season, { night: sky.night })) colours.add(land);
  }
  return [...colours];
}

// Some colour that covers at least 15% of the critter has to stand out (3:1) from
// whatever is behind it: the dark outline by day, the light body once it's dark.
function standsOut(def, backdrop) {
  const counts = new Map();
  let total = 0;
  for (const ch of frameGrid(def, 'idle').join('')) {
    if (ch === '.') continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
    total++;
  }
  return [...counts].some(([ch, n]) => n / total >= 0.15 && contrastRatio(def.palette[ch], backdrop) >= 3);
}

test('every critter stands out from the sky and hills whenever it can be out', () => {
  const when = { animals: [-6, 90], monsters: [-20, -6] };
  for (const [names, [from, to]] of [[ANIMALS, when.animals], [MONSTERS, when.monsters]]) {
    for (const name of names) {
      for (const backdrop of backdrops(from, to)) {
        assert.ok(standsOut(CRITTERS[name], backdrop), `${name} is lost against ${backdrop}`);
      }
    }
  }
});

const stage = { width: 1920, size: 96, avoid: [{ left: 800, right: 1120 }] };

function sample(plan, step = 50) {
  const states = [];
  for (let ms = 0; ms <= plan.duration + step; ms += step) states.push({ ms, ...critterAt(plan, ms) });
  return states;
}

test('a dash runs all the way across and finishes off stage', () => {
  const plan = planVisit(seededRandom(1), { ...stage, kind: 'dash' });
  const states = sample(plan);
  const live = states.filter((s) => !s.done);
  assert.ok(live[0].x <= -stage.size || live[0].x >= stage.width, 'starts off stage');
  assert.ok(live.some((s) => s.x > 0 && s.x < stage.width), 'crosses the screen');
  assert.ok(live.every((s) => s.frame === 'walk1' || s.frame === 'walk2'), 'legs keep moving');
  assert.ok(plan.duration > 4000 && plan.duration < 15000, `takes ${plan.duration}ms`);
  assert.equal(states.at(-1).done, true);
});

test('a visit walks in, lingers (blinking) away from the dock, then leaves', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const plan = planVisit(seededRandom(seed), { ...stage, kind: 'visit' });
    const states = sample(plan);
    const idle = states.filter((s) => !s.done && (s.frame === 'idle' || s.frame === 'blink'));
    const lingerMs = idle.length * 50;
    assert.ok(lingerMs >= 19000 && lingerMs <= 41000, `seed ${seed} lingers ${lingerMs}ms`);
    const spot = idle[0].x;
    assert.ok(spot + stage.size <= stage.avoid[0].left || spot >= stage.avoid[0].right, `seed ${seed} stops at ${spot}, behind the dock`);
    assert.ok(spot >= 0 && spot + stage.size <= stage.width, 'stops on screen');
    assert.ok(idle.some((s) => s.frame === 'blink'), `seed ${seed} blinks`);
    assert.equal(states.at(-1).done, true);
    const last = states.filter((s) => !s.done).at(-1);
    assert.ok(last.x <= -stage.size + 10 || last.x >= stage.width - 10, 'walks off stage');
  }
});

test('a visitor who has been called runs in and stops on the near side, within a few seconds', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const plan = planVisit(seededRandom(seed), { ...stage, avoid: [], kind: 'visit', lingerMs: 60000, hurry: true });
    const [enter, stay] = plan.segments;
    assert.ok(enter.end <= 4000, `seed ${seed} takes ${Math.round(enter.end)}ms to arrive`);
    const fromLeft = enter.from < 0;
    if (fromLeft) assert.ok(stay.at + stage.size <= stage.width * 0.4 + 1, `seed ${seed} stops at ${stay.at}`);
    else assert.ok(stay.at >= stage.width * 0.6 - 1, `seed ${seed} stops at ${stay.at}`);
    assert.ok(stay.end - stay.start >= 59000, 'and stays as long as asked');
  }
});

test('plans are repeatable for the same random numbers', () => {
  assert.deepEqual(planVisit(seededRandom(7), stage), planVisit(seededRandom(7), stage));
});

test('visits are spaced out: the first soon, then every few minutes', () => {
  const random = seededRandom(3);
  for (let i = 0; i < 50; i++) {
    const first = nextVisitDelay(random, { first: true });
    assert.ok(first >= 20000 && first <= 60000);
    const later = nextVisitDelay(random);
    assert.ok(later >= 3 * 60000 && later <= 8 * 60000);
  }
});

test('clouds drift right in whole art pixels and wrap around', () => {
  const cloud = { offset: 100, speed: 6, width: 288 };
  const step = 6;
  const a = cloudX(0, cloud, { width: 1920, step });
  const b = cloudX(10000, cloud, { width: 1920, step });
  assert.ok(Number.isInteger(a / step), "snapped to art pixels");
  assert.equal(b - a, 60);
  const lap = ((1920 + cloud.width) / cloud.speed) * 1000;
  assert.equal(cloudX(lap, cloud, { width: 1920, step }), a, 'comes back round');
  const wrapAt = ((1920 + cloud.width - cloud.offset) / cloud.speed) * 1000;
  assert.ok(cloudX(wrapAt - 200, cloud, { width: 1920, step }) >= 1920 - step, 'leaves on the right…');
  assert.equal(cloudX(wrapAt + 200, cloud, { width: 1920, step }), -cloud.width, '…then re-enters from the left');
});
