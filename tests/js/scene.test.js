import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRITTER_FOR_PHASE, CRITTERS, FRAMES, frameGrid, SIZE, spriteSheetSvg } from '../../web/js/scene/critters.js';
import { cloudX, critterAt, nextVisitDelay, planVisit } from '../../web/js/scene/director.js';
import { seededRandom } from '../../web/js/random.js';

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

test('a critter for every part of the day', () => {
  assert.deepEqual(Object.keys(CRITTER_FOR_PHASE).sort(), ['dawn', 'day', 'dusk', 'night']);
  for (const name of Object.values(CRITTER_FOR_PHASE)) assert.ok(CRITTERS[name], name);
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
