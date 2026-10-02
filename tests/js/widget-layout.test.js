import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOCK_AREA,
  GRID,
  SPANS,
  dropIndex,
  insertWidget,
  moveWidget,
  packPage,
  paginate,
  removeWidget,
} from '../../web/js/widget-layout.js';

const SIZE_OF = { shopping: 'tall', weather: 'wide', notes: 'medium', calendar: 'medium', games: 'medium' };
const spanOf = (id) => SPANS[SIZE_OF[id] ?? id.split('-')[0]];

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

function checkLayout(input) {
  const { pages, placements } = paginate(input, spanOf);
  const ids = input.flat();
  assert.deepEqual([...pages.flat()].sort(), [...ids].sort(), 'every widget appears exactly once');
  pages.forEach((page, p) => {
    if (p > 0) assert.ok(page.length > 0, 'no empty pages after the first');
    const boxes = page.map((id) => placements.get(id));
    boxes.forEach((box, i) => {
      assert.equal(box.page, p);
      assert.ok(box.col >= 1 && box.row >= 1 && box.col + box.w - 1 <= GRID.cols && box.row + box.h - 1 <= GRID.rows, 'inside the grid');
      if (p === 0) assert.ok(!overlaps(box, CLOCK_AREA), 'clear of the clock');
      boxes.slice(i + 1).forEach((other) => assert.ok(!overlaps(box, other), 'no overlap'));
    });
    const reading = [...boxes].sort((a, b) => a.row - b.row || a.col - b.col).map((b) => page[boxes.indexOf(b)]);
    assert.deepEqual(page, reading, 'pages are stored in reading order');
  });
  assert.deepEqual(paginate(pages, spanOf).pages, pages, 'laying out a layout again changes nothing');
  return pages;
}

test('Shopping, Weather and Notes share the first page in any order (the old bug)', () => {
  for (const order of [
    ['shopping', 'weather', 'notes'],
    ['weather', 'notes', 'shopping'],
    ['notes', 'shopping', 'weather'],
  ]) {
    const { pages, placements } = paginate([order], spanOf);
    assert.equal(pages.length, 1);
    assert.equal(placements.get('shopping').h, 4, 'the tall one still gets the full height');
  }
});

test('the four widgets the board starts with share page 1 beside the clock', () => {
  const pages = checkLayout([['shopping', 'weather', 'notes', 'calendar', 'games']]);
  assert.deepEqual(pages, [['shopping', 'notes', 'weather', 'calendar'], ['games']]);
});

test('a fifth widget spills onto a second page', () => {
  const pages = checkLayout([['shopping', 'weather', 'notes', 'calendar', 'games', 'medium-5']]);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1], ['games', 'medium-5']);
});

test('every sequence of widget sizes up to 7 long lays out cleanly', () => {
  const sizes = Object.keys(SPANS);
  let cases = 0;
  const build = (prefix) => {
    if (prefix.length) {
      checkLayout([prefix.map((size, i) => `${size}-${i}`)]);
      cases++;
    }
    if (prefix.length < 7) sizes.forEach((size) => build([...prefix, size]));
  };
  build([]);
  assert.equal(cases, 3279);
});

test('packPage places the longest prefix that fits and returns the rest', () => {
  // Only one 5 x 4 widget can clear the clock, however much empty area is left over.
  const { placed, overflow } = packPage(['tall-0', 'tall-1', 'medium-2'], spanOf, { reserved: [CLOCK_AREA] });
  assert.deepEqual(placed.map((p) => p.id), ['tall-0']);
  assert.deepEqual(overflow, ['tall-1', 'medium-2']);
});

test('moveWidget, insertWidget and removeWidget edit the page lists', () => {
  const pages = [['shopping', 'weather', 'notes'], ['games']];
  assert.deepEqual(moveWidget(pages, 'games', { page: 0, index: 1 }), [['shopping', 'games', 'weather', 'notes'], []]);
  assert.deepEqual(moveWidget(pages, 'notes', { page: 2, index: 0 }), [['shopping', 'weather'], ['games'], ['notes']]);
  assert.deepEqual(insertWidget([['shopping']], 'notes'), [['shopping', 'notes']]);
  assert.deepEqual(insertWidget(pages, 'x', { page: 1, index: 0 }), [['shopping', 'weather', 'notes'], ['x', 'games']]);
  assert.deepEqual(removeWidget(pages, 'weather'), { pages: [['shopping', 'notes'], ['games']], from: { page: 0, index: 1 } });
  assert.deepEqual(removeWidget(pages, 'nope'), { pages, from: null });
  assert.deepEqual(pages, [['shopping', 'weather', 'notes'], ['games']], 'inputs are not changed');
});

test('dropIndex finds where a dragged widget would land', () => {
  // Two rows: A and B on top, C below.
  const rects = [
    { left: 0, top: 0, right: 100, bottom: 100 },
    { left: 120, top: 0, right: 220, bottom: 100 },
    { left: 0, top: 120, right: 100, bottom: 220 },
  ];
  assert.equal(dropIndex(rects, { x: 10, y: 50 }), 0);
  assert.equal(dropIndex(rects, { x: 90, y: 50 }), 1);
  assert.equal(dropIndex(rects, { x: 200, y: 50 }), 2);
  assert.equal(dropIndex(rects, { x: 300, y: 300 }), 3);
  assert.equal(dropIndex(rects, { x: 50, y: 50 }, { hole: rects[0] }), null, 'inside its own slot: stay put');
  assert.equal(dropIndex(rects, { x: 500, y: 150 }, { axis: 'y' }), 2);
});
