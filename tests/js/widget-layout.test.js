import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../../web/js/random.js';
import {
  CLOCK_AREA,
  GRID,
  LAYOUTS,
  SIZES,
  SPANS,
  addWidget,
  arrange,
  cellFromPoint,
  findWidget,
  firstSpot,
  fromOrder,
  layoutFor,
  nearestSize,
  normalize,
  packPage,
  paginate,
  placeWidget,
  removeWidget,
  resizeWidget,
  widgetOrder,
} from '../../web/js/widget-layout.js';

const SIZE_OF = { shopping: 'large', weather: 'medium', notes: 'small', calendar: 'small', games: 'small' };
const spanOf = (id) => SPANS[SIZE_OF[id] ?? id.split('-')[0]];
const board = LAYOUTS.board;
const apple = LAYOUTS.apple;
const ALL = { size: 'small', sizes: SIZES };
const specOf = (id) => (typeof id === 'string' && !id.startsWith('bogus') ? ALL : null);

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

// Ordered packing (new screens, and upgrades from saved lists)

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
    assert.equal(placements.get('shopping').h, 4, 'the large one still gets the full height');
  }
});

test('the four widgets the board starts with share page 1 beside the clock', () => {
  const { pages, placements } = paginate([['calendar', 'shopping', 'weather', 'notes', 'games']], spanOf);
  checkLayout([['calendar', 'shopping', 'weather', 'notes', 'games']]);
  assert.deepEqual(pages, [['calendar', 'shopping', 'weather', 'notes'], ['games']]);
  assert.deepEqual(placements.get('calendar'), { page: 0, col: 5, row: 1, w: 3, h: 2 });
  assert.deepEqual(placements.get('shopping'), { page: 0, col: 8, row: 1, w: 5, h: 4 });
  assert.deepEqual(placements.get('weather'), { page: 0, col: 1, row: 3, w: 4, h: 2 });
  assert.deepEqual(placements.get('notes'), { page: 0, col: 5, row: 3, w: 3, h: 2 });
});

test('a fifth widget spills onto a second page', () => {
  const pages = checkLayout([['calendar', 'shopping', 'weather', 'notes', 'games', 'small-5']]);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[1], ['games', 'small-5']);
});

test('every sequence of widget sizes up to 7 long lays out cleanly', () => {
  let cases = 0;
  const build = (prefix) => {
    if (prefix.length) {
      checkLayout([prefix.map((size, i) => `${size}-${i}`)]);
      cases++;
    }
    if (prefix.length < 7) SIZES.forEach((size) => build([...prefix, size]));
  };
  build([]);
  // 4 + 4² + … + 4⁷ (mini, small, medium, large).
  assert.equal(cases, 21844);
});

test('packPage places the longest prefix that fits and returns the rest', () => {
  // Only one 5 x 4 widget can clear the clock, however much empty area is left over.
  const { placed, overflow } = packPage(['large-0', 'large-1', 'small-2'], spanOf, { reserved: [CLOCK_AREA] });
  assert.deepEqual(placed.map((p) => p.id), ['large-0']);
  assert.deepEqual(overflow, ['large-1', 'small-2']);
});

test('every theme but Apple uses the board layout', () => {
  for (const theme of ['auto', 'light', 'dark', 'blocks']) assert.equal(layoutFor(theme), board);
  assert.equal(layoutFor('apple'), apple);
  assert.deepEqual(arrange([['calendar', 'shopping', 'weather', 'notes', 'games']], (id) => SIZE_OF[id]).pages, [
    ['calendar', 'shopping', 'weather', 'notes'],
    ['games'],
  ]);
});

test('the Apple layout uses iOS widget units: small 1 × 1, medium 2 × 1, large 2 × 2', () => {
  assert.deepEqual(apple.grid, { cols: 4, rows: 2 });
  assert.deepEqual(apple.spans, { mini: { w: 1, h: 1 }, small: { w: 1, h: 1 }, medium: { w: 2, h: 1 }, large: { w: 2, h: 2 } }, 'mini is a small square');
  assert.deepEqual(apple.clock, { col: 1, row: 1, w: 2, h: 1 }, 'the clock takes one medium slot');

  // The board's own seven widgets fit on two pages.
  const sizes = { calendar: 'small', weather: 'medium', notes: 'small', games: 'small', lights: 'medium', cup: 'small', grocery: 'large' };
  const pages = fromOrder([Object.keys(sizes)], (id) => sizes[id], apple);
  assert.deepEqual(pages.map((items) => items.map((item) => item.id)), [
    ['calendar', 'notes', 'weather', 'games'],
    ['lights', 'grocery', 'cup'],
  ]);
  assert.deepEqual(findWidget(pages, 'weather'), { page: 0, id: 'weather', size: 'medium', col: 1, row: 2 });
  assert.deepEqual(findWidget(pages, 'grocery'), { page: 1, id: 'grocery', size: 'large', col: 3, row: 1 });
});

// Placements

// Every widget once, inside the grid, clear of the clock and each other, in reading order.
function checkPlacements(pages, layout) {
  const ids = widgetOrder(pages);
  assert.equal(new Set(ids).size, ids.length, 'no widget twice');
  pages.forEach((items, p) => {
    if (p > 0) assert.ok(items.length > 0, 'no empty pages after the first');
    const boxes = items.map((item) => ({ col: item.col, row: item.row, ...layout.spans[item.size] }));
    boxes.forEach((box, i) => {
      assert.ok(box.col >= 1 && box.row >= 1 && box.col + box.w - 1 <= layout.grid.cols && box.row + box.h - 1 <= layout.grid.rows, 'inside the grid');
      if (p === 0) assert.ok(!overlaps(box, layout.clock), 'clear of the clock');
      boxes.slice(i + 1).forEach((other) => assert.ok(!overlaps(box, other), 'no overlap'));
    });
    const sorted = [...items].sort((a, b) => a.row - b.row || a.col - b.col);
    assert.deepEqual(items, sorted, 'reading order');
  });
  assert.deepEqual(normalize(pages, layout, specOf), pages, 'a valid layout is left as it is');
}

const at = (id, size, col, row) => ({ id, size, col, row });

test('fromOrder gives an ordered list places of its own', () => {
  const pages = fromOrder([['calendar', 'shopping', 'weather', 'notes', 'games']], (id) => SIZE_OF[id]);
  assert.deepEqual(pages, [
    [at('calendar', 'small', 5, 1), at('shopping', 'large', 8, 1), at('weather', 'medium', 1, 3), at('notes', 'small', 5, 3)],
    [at('games', 'small', 1, 1)],
  ]);
  checkPlacements(pages, board);
});

test('normalize keeps good places and fixes bad ones', () => {
  const pages = normalize(
    [
      [
        at('a', 'small', 5, 1),
        at('b', 'small', 6, 1), // on top of a: nearest free spot
        at('c', 'medium', 1, 1), // over the clock
        at('a', 'small', 9, 3), // a twice
        at('bogus', 'small', 9, 3), // unknown
        at('d', 'huge', 10, 3), // a size it doesn't come in
        { id: 'e', size: 'small' }, // no place
        'nonsense',
      ],
      [],
      [at('f', 'large', 11, 3)], // off the grid
    ],
    board,
    specOf,
  );
  checkPlacements(pages, board);
  assert.deepEqual(findWidget(pages, 'a'), { page: 0, id: 'a', size: 'small', col: 5, row: 1 });
  assert.deepEqual(findWidget(pages, 'd'), { page: 0, id: 'd', size: 'small', col: 10, row: 3 });
  assert.equal(findWidget(pages, 'b').page, 0);
  assert.equal(findWidget(pages, 'c').page, 0);
  assert.equal(findWidget(pages, 'f').page, 1, 'the empty page in between is dropped');
  assert.equal(findWidget(pages, 'bogus'), null);
  assert.equal(normalize('nope', board, specOf), null);
  assert.deepEqual(normalize([], board, specOf), [[]]);
});

test('placeWidget drops a widget where it is let go', () => {
  const pages = [[at('a', 'small', 5, 1), at('b', 'small', 8, 1)]];
  const moved = placeWidget(pages, { id: 'a', size: 'small' }, { page: 0, col: 10, row: 3 }, board);
  assert.deepEqual(moved, [[at('b', 'small', 8, 1), at('a', 'small', 10, 3)]], 'anywhere, leaving a gap behind');
  checkPlacements(moved, board);
});

test('placeWidget pushes aside what it lands on, to the nearest free space', () => {
  const pages = [[at('a', 'small', 5, 1), at('b', 'small', 8, 1)]];
  const moved = placeWidget(pages, { id: 'a', size: 'small' }, { page: 0, col: 8, row: 1 }, board);
  checkPlacements(moved, board);
  assert.deepEqual(findWidget(moved, 'a'), { page: 0, id: 'a', size: 'small', col: 8, row: 1 });
  const b = findWidget(moved, 'b');
  assert.equal(b.page, 0);
  assert.ok(Math.hypot(b.col - 8, b.row - 1) <= 3, `b moved only a little (to ${b.col},${b.row})`);
});

test('placeWidget keeps a widget on the grid and off the clock', () => {
  const pages = [[at('a', 'large', 8, 1)]];
  const edge = placeWidget(pages, { id: 'a', size: 'large' }, { page: 0, col: 12, row: 4 }, board);
  assert.deepEqual(findWidget(edge, 'a'), { page: 0, id: 'a', size: 'large', col: 8, row: 1 }, 'pulled back inside');
  const clock = placeWidget(pages, { id: 'a', size: 'large' }, { page: 0, col: 1, row: 1 }, board);
  const a = findWidget(clock, 'a');
  assert.ok(!overlaps({ col: a.col, row: a.row, ...SPANS.large }, CLOCK_AREA), 'never over the clock');
  checkPlacements(clock, board);
});

test('placeWidget moves what no longer fits on to the next page, and can start a new one', () => {
  // Apple page 1: clock, then a and b fill the top right and c and d the bottom row.
  const pages = [[at('a', 'small', 3, 1), at('b', 'small', 4, 1), at('c', 'medium', 1, 2), at('d', 'medium', 3, 2)]];
  const big = placeWidget(pages, { id: 'e', size: 'large' }, { page: 0, col: 3, row: 1 }, apple);
  checkPlacements(big, apple);
  assert.deepEqual(findWidget(big, 'e'), { page: 0, id: 'e', size: 'large', col: 3, row: 1 });
  assert.deepEqual(widgetOrder([big[1]]).sort(), ['a', 'b', 'd'], 'the three it covered go to page 2');
  const fresh = placeWidget(pages, { id: 'a', size: 'small' }, { page: 1, col: 2, row: 2 }, apple);
  assert.deepEqual(fresh[1], [at('a', 'small', 2, 2)]);
});

test('resizeWidget grows a widget in place and makes room for it', () => {
  const pages = [[at('a', 'small', 5, 1), at('b', 'small', 8, 1), at('c', 'small', 5, 3)]];
  const grown = resizeWidget(pages, 'a', 'large', board);
  checkPlacements(grown, board);
  assert.deepEqual(findWidget(grown, 'a'), { page: 0, id: 'a', size: 'large', col: 5, row: 1 });
  const atEdge = resizeWidget([[at('a', 'small', 10, 3)]], 'a', 'large', board);
  assert.deepEqual(findWidget(atEdge, 'a'), { page: 0, id: 'a', size: 'large', col: 8, row: 1 }, 'moved in from the edge');
  assert.equal(resizeWidget(pages, 'nope', 'large', board), pages);
});

test('addWidget takes the first free spot, on a given page or the first with room', () => {
  const pages = [[at('a', 'small', 5, 1)]];
  assert.deepEqual(addWidget(pages, { id: 'b', size: 'small' }, board), { pages: [[at('a', 'small', 5, 1), at('b', 'small', 8, 1)]], page: 0 });
  assert.equal(addWidget(pages, { id: 'b', size: 'small' }, board, { page: 1 }).page, 1);
  const full = [[at('a', 'large', 3, 1)]];
  assert.equal(addWidget(full, { id: 'b', size: 'large' }, apple).page, 1, 'a full page sends it on');
});

test('removeWidget says where the widget was, so placeWidget can put it back', () => {
  const pages = [[at('a', 'small', 5, 1), at('b', 'medium', 9, 3)]];
  const { pages: without, from } = removeWidget(pages, 'b');
  assert.deepEqual(from, { page: 0, id: 'b', size: 'medium', col: 9, row: 3 });
  assert.deepEqual(placeWidget(without, { id: 'b', size: from.size }, from, board), pages);
  assert.deepEqual(removeWidget(pages, 'nope'), { pages, from: null });
});

test('a mini widget fills the one column the clock, a small and a medium leave on page 1', () => {
  assert.deepEqual(SPANS.mini, { w: 1, h: 2 });
  const sizes = { calendar: 'small', weather: 'medium', spotify: 'mini', notes: 'small', games: 'small', lights: 'medium' };
  const pages = fromOrder([Object.keys(sizes)], (id) => sizes[id], board);
  assert.equal(pages.length, 1, 'all six on page 1');
  assert.deepEqual(pages[0].find((item) => item.id === 'spotify'), { id: 'spotify', size: 'mini', col: 12, row: 1 });
  // Dropped next to the clock on a board with that column free, it stays there.
  const moved = placeWidget(pages, { id: 'spotify', size: 'mini' }, { page: 0, col: 5, row: 1 }, board);
  assert.deepEqual(moved[0].find((item) => item.id === 'spotify'), { id: 'spotify', size: 'mini', col: 5, row: 1 });
  // Nothing else fits the column it left.
  assert.equal(firstSpot(pages[0].filter((item) => item.id !== 'spotify'), 0, 'small', board), null);
});

test('cellFromPoint snaps a corner to the nearest cell', () => {
  // 12 columns of 100px with 20px gaps, 4 rows of 200px with 20px gaps.
  const grid = { left: 50, top: 100, width: 1420, height: 860, colGap: 20, rowGap: 20, cols: 12, rows: 4 };
  assert.deepEqual(cellFromPoint({ x: 50, y: 100 }, grid), { col: 1, row: 1 });
  assert.deepEqual(cellFromPoint({ x: 50 + 120 * 4 + 50, y: 100 + 220 + 120 }, grid), { col: 5, row: 3 });
  assert.deepEqual(cellFromPoint({ x: -500, y: 5000 }, grid), { col: 1, row: 4 }, 'clamped to the grid');
});

test('nearestSize picks the size closest to the span dragged out', () => {
  assert.equal(nearestSize(SIZES, SPANS, { w: 3, h: 2 }, 'large'), 'small');
  assert.equal(nearestSize(SIZES, SPANS, { w: 4, h: 2 }, 'small'), 'medium');
  assert.equal(nearestSize(SIZES, SPANS, { w: 6, h: 4 }, 'small'), 'large');
  assert.equal(nearestSize(['small', 'large'], SPANS, { w: 4, h: 2 }, 'small'), 'small', 'only sizes it comes in');
  assert.equal(nearestSize(SIZES, apple.spans, { w: 2, h: 2 }, 'small'), 'large');
  assert.equal(nearestSize(SIZES, SPANS, { w: 1, h: 2 }, 'small'), 'mini');
  assert.equal(nearestSize(SIZES, SPANS, { w: 2, h: 2 }, 'mini'), 'mini', 'halfway keeps the size it is');
  assert.equal(nearestSize(SIZES, apple.spans, { w: 1, h: 1 }, 'small'), 'small', 'the same square on Glass stays small');
});

test('any run of drags, resizes, adds and removes keeps every layout valid', () => {
  for (const layout of [board, apple]) {
    const random = seededRandom(layout === board ? 7 : 11);
    const pick = (list) => list[Math.floor(random() * list.length)];
    let pages = [[]];
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let step = 0; step < 2000; step++) {
      const on = widgetOrder(pages);
      const off = ids.filter((id) => !on.includes(id));
      const roll = random();
      if (off.length && (roll < 0.2 || on.length === 0)) {
        pages = addWidget(pages, { id: pick(off), size: pick(SIZES) }, layout).pages;
      } else if (roll < 0.3) {
        pages = normalize(removeWidget(pages, pick(on)).pages, layout, specOf);
      } else if (roll < 0.5) {
        pages = resizeWidget(pages, pick(on), pick(SIZES), layout);
      } else {
        const id = pick(on);
        const target = {
          page: Math.floor(random() * (pages.length + 1)),
          col: 1 + Math.floor(random() * layout.grid.cols),
          row: 1 + Math.floor(random() * layout.grid.rows),
        };
        pages = placeWidget(pages, { id, size: findWidget(pages, id).size }, target, layout);
      }
      checkPlacements(pages, layout);
      assert.deepEqual(widgetOrder(pages).sort(), [...new Set([...widgetOrder(pages)])].sort());
    }
  }
});
