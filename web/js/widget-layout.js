// Where widgets go on the home pages. Pure functions, so they're tested in node.
//
// Every widget has a place of its own: a page, a column and a row on that page's
// grid, and a size. Edit mode drags a widget to the cell under the finger and
// pushes whatever it lands on to the nearest free space (placeWidget), and resizes
// one in place the same way (resizeWidget). A layout is a list of pages, each a
// list of placements { id, size, col, row } in reading order.
//
// Each page is a 12 × 4 grid; page 1 also has the clock in its top-left 4 × 2.
// The Apple theme lays pages out in iOS widget units instead (LAYOUTS.apple): a
// 4 × 2 grid of near-square cells, with the clock in one medium slot.
//
// Widgets come in four sizes (SIZES); each app says which it supports in meta.js.
// Mini is one column by two rows: the strip a 12-column page has left over beside
// the clock and three- and four-column widgets, which nothing else fits in.

export const SIZES = ['mini', 'small', 'medium', 'large'];
export const GRID = { cols: 12, rows: 4 };
export const SPANS = { mini: { w: 1, h: 2 }, small: { w: 3, h: 2 }, medium: { w: 4, h: 2 }, large: { w: 5, h: 4 } };
// The clock only needs room for the time and the date under it; the rest of the
// top row is left for widgets, so the five the board ships with share page 1.
export const CLOCK_AREA = { col: 1, row: 1, w: 4, h: 2 };

export const LAYOUTS = {
  board: { id: 'board', grid: GRID, spans: SPANS, clock: CLOCK_AREA },
  apple: {
    id: 'apple',
    grid: { cols: 4, rows: 2 },
    // iOS has nothing narrower than its small widget, so mini is a small square here.
    spans: { mini: { w: 1, h: 1 }, small: { w: 1, h: 1 }, medium: { w: 2, h: 1 }, large: { w: 2, h: 2 } },
    clock: { col: 1, row: 1, w: 2, h: 1 },
  },
};

// Which layout a theme setting uses. Every theme but Apple shares the board's.
export function layoutFor(theme) {
  return theme === 'apple' ? LAYOUTS.apple : LAYOUTS.board;
}

// Laying out a list in order (new screens, and screens saved before widgets had
// places of their own): a page takes the longest run of the list that fits (found
// with a small search), and the rest moves to the next page.

// paginate() with a layout's grid, spans and clock. sizeOf(id) gives the widget's size.
export function arrange(pages, sizeOf, layout = LAYOUTS.board) {
  return paginate(pages, (id) => layout.spans[sizeOf(id)], { grid: layout.grid, firstPageReserved: [layout.clock] });
}

// Exact for every list of up to 8 widgets (checked against an unlimited search) and
// under 1ms on a laptop; the cap stops a pathological input from hanging the board.
const MAX_STEPS = 100000;
// Re-packing a page that's already in reading order almost always gives the same
// layout; a couple of passes settle the rare case where it doesn't.
const MAX_PASSES = 3;

function emptyGrid(grid, reserved) {
  const cells = Array.from({ length: grid.rows }, () => new Array(grid.cols).fill(false));
  for (const area of reserved) fill(cells, area, true);
  return cells;
}

function fill(cells, { col, row, w, h }, value) {
  for (let r = row - 1; r < row - 1 + h; r++) for (let c = col - 1; c < col - 1 + w; c++) cells[r][c] = value;
}

function isFree(cells, { col, row, w, h }) {
  for (let r = row - 1; r < row - 1 + h; r++) for (let c = col - 1; c < col - 1 + w; c++) if (cells[r][c]) return false;
  return true;
}

function freeCells(cells) {
  return cells.reduce((sum, row) => sum + row.filter((taken) => !taken).length, 0);
}

// Depth-first: widgets in list order, each tried at every free spot in reading order.
function search(ids, spanOf, cells, grid, budget) {
  const placed = [];
  const place = (i) => {
    if (i === ids.length) return true;
    const { w, h } = spanOf(ids[i]);
    for (let row = 1; row + h - 1 <= grid.rows; row++) {
      for (let col = 1; col + w - 1 <= grid.cols; col++) {
        if (--budget.steps < 0) return false;
        const box = { col, row, w, h };
        if (!isFree(cells, box)) continue;
        fill(cells, box, true);
        placed.push({ id: ids[i], ...box });
        if (place(i + 1)) return true;
        placed.pop();
        fill(cells, box, false);
      }
    }
    return false;
  };
  return place(0) ? placed : null;
}

export function packPage(ids, spanOf, { reserved = [], grid = GRID } = {}) {
  const free = freeCells(emptyGrid(grid, reserved));
  for (let k = ids.length; k > 0; k--) {
    const prefix = ids.slice(0, k);
    const area = prefix.reduce((sum, id) => sum + spanOf(id).w * spanOf(id).h, 0);
    if (area > free) continue;
    const placed = search(prefix, spanOf, emptyGrid(grid, reserved), grid, { steps: MAX_STEPS });
    if (placed) {
      placed.sort((a, b) => a.row - b.row || a.col - b.col);
      return { placed, overflow: ids.slice(k) };
    }
  }
  return { placed: [], overflow: [...ids] };
}

function paginateOnce(pages, spanOf, firstPageReserved, grid) {
  const out = [];
  const placements = new Map();
  let carry = [];
  for (let i = 0; i < pages.length || carry.length; i++) {
    const ids = [...carry, ...(pages[i] ?? [])];
    if (ids.length === 0 && out.length > 0) continue;
    const page = out.length;
    const { placed, overflow } = packPage(ids, spanOf, { reserved: page === 0 ? firstPageReserved : [], grid });
    out.push(placed.map((box) => box.id));
    placed.forEach(({ id, ...box }) => placements.set(id, { page, ...box }));
    carry = overflow;
  }
  if (out.length === 0) out.push([]);
  return { pages: out, placements };
}

// Normalises page lists: fills each page in order, spills what doesn't fit, drops
// empty pages after the first, and stores every page in reading order.
export function paginate(pages, spanOf, { firstPageReserved = [CLOCK_AREA], grid = GRID } = {}) {
  let result = paginateOnce(pages, spanOf, firstPageReserved, grid);
  for (let pass = 1; pass < MAX_PASSES; pass++) {
    const again = paginateOnce(result.pages, spanOf, firstPageReserved, grid);
    if (JSON.stringify(again.pages) === JSON.stringify(result.pages)) break;
    result = again;
  }
  return result;
}

// Placements

const byReading = (a, b) => a.row - b.row || a.col - b.col;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

function boxOf(item, layout) {
  return { col: item.col, row: item.row, ...layout.spans[item.size] };
}

// Is `box` inside the grid, clear of the clock on page 1, and clear of `items`?
function isOpen(box, items, page, layout) {
  const { grid, clock } = layout;
  if (box.col < 1 || box.row < 1 || box.col + box.w - 1 > grid.cols || box.row + box.h - 1 > grid.rows) return false;
  if (page === 0 && overlaps(box, clock)) return false;
  return items.every((other) => !overlaps(box, boxOf(other, layout)));
}

function openSpots(items, page, size, layout) {
  const { w, h } = layout.spans[size];
  const spots = [];
  for (let row = 1; row + h - 1 <= layout.grid.rows; row++) {
    for (let col = 1; col + w - 1 <= layout.grid.cols; col++) {
      if (isOpen({ col, row, w, h }, items, page, layout)) spots.push({ col, row });
    }
  }
  return spots;
}

// The first free spot in reading order, or null if the page has no room.
export function firstSpot(items, page, size, layout) {
  return openSpots(items, page, size, layout)[0] ?? null;
}

// The free spot closest to `near` (ties go to reading order), or null.
export function nearestSpot(items, page, size, layout, near) {
  let best = null;
  let bestDistance = Infinity;
  for (const spot of openSpots(items, page, size, layout)) {
    const distance = Math.hypot(spot.col - near.col, spot.row - near.row);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

// Sorts every page into reading order and drops empty pages after the first.
function tidy(pages) {
  const kept = pages.filter((items, p) => p === 0 || items.length > 0).map((items) => [...items].sort(byReading));
  return kept.length ? kept : [[]];
}

// Puts `item` on the first page from `from` on with room for it (a new page if none).
function settle(pages, from, item, layout) {
  for (let page = from; ; page++) {
    if (page === pages.length) pages.push([]);
    const spot = firstSpot(pages[page], page, item.size, layout);
    if (spot) {
      pages[page].push({ ...item, ...spot });
      return page;
    }
  }
}

// Page lists of ids (laid out in order) as placements.
export function fromOrder(idPages, sizeOf, layout = LAYOUTS.board) {
  const { pages, placements } = arrange(idPages, sizeOf, layout);
  return pages.map((ids) => ids.map((id) => ({ id, size: sizeOf(id), col: placements.get(id).col, row: placements.get(id).row })));
}

// Every widget's id, page by page in reading order (the order a phone lists them in).
export function widgetOrder(pages) {
  return pages.flatMap((items) => items.map((item) => item.id));
}

export function findWidget(pages, id) {
  for (const [page, items] of pages.entries()) {
    const item = items.find((other) => other.id === id);
    if (item) return { page, ...item };
  }
  return null;
}

// Checks saved pages: drops unknown, repeated or malformed widgets, gives any
// widget a size it supports, and moves a widget that's off the grid, over the
// clock or on top of another to the nearest free space (or a later page).
// specOf(id) is { size, sizes } for a known widget and null otherwise.
export function normalize(raw, layout, specOf) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const pages = [];
  const homeless = [];
  raw.filter(Array.isArray).forEach((items, page) => {
    pages.push([]);
    const valid = items
      .filter((item) => item && typeof item.id === 'string' && specOf(item.id) && !seen.has(item.id) && seen.add(item.id))
      .map((item) => {
        const spec = specOf(item.id);
        const size = spec.sizes.includes(item.size) ? item.size : spec.size;
        const placed = Number.isInteger(item.col) && Number.isInteger(item.row);
        return { id: item.id, size, col: placed ? item.col : Infinity, row: placed ? item.row : Infinity };
      })
      .sort(byReading);
    for (const item of valid) {
      if (Number.isFinite(item.col) && isOpen(boxOf(item, layout), pages[page], page, layout)) pages[page].push(item);
      else homeless.push({ item, page });
    }
  });
  if (pages.length === 0) pages.push([]);
  for (const { item, page } of homeless) {
    const near = Number.isFinite(item.col) ? item : { col: 1, row: 1 };
    const spot = nearestSpot(pages[page], page, item.size, layout, near);
    if (spot) pages[page].push({ ...item, ...spot });
    else settle(pages, page + 1, { id: item.id, size: item.size }, layout);
  }
  return tidy(pages);
}

// Puts `item` ({ id, size }) at `target` ({ page, col, row }; page may be
// pages.length for a new page), as close to that cell as the grid and the clock
// allow. Widgets it lands on move to the nearest free space on that page, or to
// the next page with room.
export function placeWidget(pages, item, target, layout) {
  const { grid, spans } = layout;
  const span = spans[item.size];
  const next = pages.map((items) => items.filter((other) => other.id !== item.id));
  while (next.length <= target.page) next.push([]);
  const page = target.page;
  const wanted = { col: clamp(target.col, 1, grid.cols - span.w + 1), row: clamp(target.row, 1, grid.rows - span.h + 1) };
  // Only the clock can stop it here; anything else in the way is pushed aside.
  const spot = nearestSpot([], page, item.size, layout, wanted);
  if (!spot) {
    settle(next, page + 1, { id: item.id, size: item.size }, layout);
    return tidy(next);
  }
  const placed = { id: item.id, size: item.size, ...spot };
  const box = boxOf(placed, layout);
  const pushed = next[page].filter((other) => overlaps(box, boxOf(other, layout))).sort(byReading);
  next[page] = [...next[page].filter((other) => !pushed.includes(other)), placed];
  for (const other of pushed) {
    const free = nearestSpot(next[page], page, other.size, layout, other);
    if (free) next[page].push({ ...other, ...free });
    else settle(next, page + 1, { id: other.id, size: other.size }, layout);
  }
  return tidy(next);
}

// Changes a widget's size where it stands (moving it in from the edge if it no
// longer fits there), pushing aside whatever it now covers.
export function resizeWidget(pages, id, size, layout) {
  const found = findWidget(pages, id);
  if (!found) return pages;
  return placeWidget(pages, { id, size }, { page: found.page, col: found.col, row: found.row }, layout);
}

// Adds a widget in the first free spot: on `page` if given, otherwise on the first
// page with room (or a new page). Returns the pages and the page it went on.
export function addWidget(pages, item, layout, { page } = {}) {
  const next = pages.map((items) => [...items]);
  const at = settle(next, page ?? 0, { id: item.id, size: item.size }, layout);
  const tidied = tidy(next);
  return { pages: tidied, page: findWidget(tidied, item.id)?.page ?? at };
}

// Takes a widget off. `from` (its page, place and size) puts it back with placeWidget.
export function removeWidget(pages, id) {
  const from = findWidget(pages, id);
  if (!from) return { pages, from: null };
  return { pages: pages.map((items) => items.filter((item) => item.id !== id)), from };
}

// The cell a widget whose top-left corner is at `point` would snap to. `grid` is
// the page's box on screen ({ left, top, width, height }) with its gaps, columns
// and rows.
export function cellFromPoint(point, { left, top, width, height, colGap = 0, rowGap = 0, cols, rows }) {
  const pitchX = (width + colGap) / cols;
  const pitchY = (height + rowGap) / rows;
  return {
    col: clamp(Math.round((point.x - left) / pitchX) + 1, 1, cols),
    row: clamp(Math.round((point.y - top) / pitchY) + 1, 1, rows),
  };
}

// Of `sizes`, the one whose span is closest to `want` ({ w, h } in cells). Ties
// keep `current`, then go to the smaller size.
export function nearestSize(sizes, spans, want, current) {
  const cost = (size) => Math.abs(spans[size].w - want.w) + Math.abs(spans[size].h - want.h);
  return [...sizes].sort((a, b) => cost(a) - cost(b) || (b === current) - (a === current) || SIZES.indexOf(a) - SIZES.indexOf(b))[0];
}
