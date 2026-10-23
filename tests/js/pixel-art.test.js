import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUri, dilate8, hconcat, mirror, pad, pathData, pixelSvg, shift } from '../../web/js/pixel-art.js';
import { CRITTERS, FRAMES, frameGrid, SIZE, sheetGrid, spriteSheetSvg } from '../../web/js/scene/critters.js';

// Draws an SVG from pixelSvg() back into a grid of colours, to check nothing was lost.
function redraw(svg) {
  const [, width, height] = svg.match(/viewBox='0 0 (\d+) (\d+)'/).map(Number);
  const grid = Array.from({ length: height }, () => Array(width).fill(null));
  for (const [, fill, d] of svg.matchAll(/<path fill='([^']+)' d='([^']*)'\/>/g)) {
    for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(w); i++) {
        assert.equal(grid[y][Number(x) + i], null, 'no cell is drawn twice');
        grid[y][Number(x) + i] = fill;
      }
    }
  }
  return grid;
}

const colours = (rows, palette) => rows.map((line) => [...line].map((ch) => (ch === '.' ? null : palette[ch])));

test('pixelSvg draws every cell once, in its own colour', () => {
  const rows = ['.ab', 'aa.', '..b'];
  const palette = { a: '#111111', b: '#eeeeee' };
  const svg = pixelSvg(rows, palette);
  assert.match(svg, /viewBox='0 0 3 3'/);
  assert.match(svg, /shape-rendering='crispEdges'/);
  assert.deepEqual(redraw(svg), colours(rows, palette));
});

test('every critter sheet redraws exactly: each frame, facing both ways', () => {
  for (const def of Object.values(CRITTERS)) {
    const sheet = sheetGrid(def);
    assert.equal(sheet.length, SIZE * 2);
    assert.ok(sheet.every((line) => line.length === SIZE * FRAMES.length));
    const drawn = redraw(decodeURIComponent(spriteSheetSvg(def).split(',')[1]));
    assert.deepEqual(drawn, colours(sheet, def.palette), def.name);
    FRAMES.forEach((frame, f) => {
      const grid = frameGrid(def, frame);
      const cut = (rowFrom) => sheet.slice(rowFrom, rowFrom + SIZE).map((line) => line.slice(f * SIZE, (f + 1) * SIZE));
      assert.deepEqual(cut(0), grid, `${def.name} ${frame} faces right`);
      assert.deepEqual(cut(SIZE), mirror(grid), `${def.name} ${frame} mirrored`);
    });
  }
});

test('an unknown colour is an error, not a hole', () => {
  assert.throws(() => pixelSvg(['ax'], { a: '#000000' }), /"x"/);
});

test('pathData merges runs and can be moved', () => {
  assert.equal(pathData(['##.#'], '#'), 'M0 0h2v1h-2zM3 0h1v1h-1z');
  assert.equal(pathData(['#'], '#', { x: 2, y: 5 }), 'M2 5h1v1h-1z');
});

test('pad, dilate8, shift and hconcat', () => {
  const dot = pad(['#'], { top: 1, right: 1, bottom: 1, left: 1 });
  assert.deepEqual(dot, ['...', '.#.', '...']);
  assert.deepEqual(dilate8(dot), ['###', '###', '###']);
  assert.deepEqual(shift(dot, 1, 1), ['...', '...', '..#']);
  assert.deepEqual(shift(dot, -1, 0), ['...', '#..', '...']);
  assert.deepEqual(hconcat([['a', 'b'], ['cc']], 1), ['a.cc', 'b...']);
  assert.ok(dataUri("<svg x='1'/>").startsWith('data:image/svg+xml,'));
});
