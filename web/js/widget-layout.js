// Where widgets go on the home pages. Pure functions, so they're tested in node.
//
// Each page is a 12 × 4 grid; page 1 also has the clock in its top-left 7 × 2.
// Widgets keep the order the user chose: a page takes the longest run of the
// list that fits (found with a small search), and the rest moves to the next page.

export const GRID = { cols: 12, rows: 4 };
export const SPANS = { tall: { w: 5, h: 4 }, wide: { w: 4, h: 2 }, medium: { w: 3, h: 2 } };
export const CLOCK_AREA = { col: 1, row: 1, w: 7, h: 2 };

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

function paginateOnce(pages, spanOf, firstPageReserved) {
  const out = [];
  const placements = new Map();
  let carry = [];
  for (let i = 0; i < pages.length || carry.length; i++) {
    const ids = [...carry, ...(pages[i] ?? [])];
    if (ids.length === 0 && out.length > 0) continue;
    const page = out.length;
    const { placed, overflow } = packPage(ids, spanOf, { reserved: page === 0 ? firstPageReserved : [] });
    out.push(placed.map((box) => box.id));
    placed.forEach(({ id, ...box }) => placements.set(id, { page, ...box }));
    carry = overflow;
  }
  if (out.length === 0) out.push([]);
  return { pages: out, placements };
}

// Normalises page lists: fills each page in order, spills what doesn't fit, drops
// empty pages after the first, and stores every page in reading order.
export function paginate(pages, spanOf, { firstPageReserved = [CLOCK_AREA] } = {}) {
  let result = paginateOnce(pages, spanOf, firstPageReserved);
  for (let pass = 1; pass < MAX_PASSES; pass++) {
    const again = paginateOnce(result.pages, spanOf, firstPageReserved);
    if (JSON.stringify(again.pages) === JSON.stringify(result.pages)) break;
    result = again;
  }
  return result;
}

export function removeWidget(pages, id) {
  const page = pages.findIndex((ids) => ids.includes(id));
  if (page === -1) return { pages, from: null };
  const index = pages[page].indexOf(id);
  return { pages: pages.map((ids) => ids.filter((x) => x !== id)), from: { page, index } };
}

// `page` may be pages.length, which starts a new page.
export function insertWidget(pages, id, { page = pages.length - 1, index } = {}) {
  const next = pages.map((ids) => [...ids]);
  while (next.length <= page) next.push([]);
  const target = next[page];
  target.splice(index ?? target.length, 0, id);
  return next;
}

export function moveWidget(pages, id, target) {
  return insertWidget(removeWidget(pages, id).pages, id, target);
}

// How many of the (reading-order) rects come before the pointer. Inside `hole`
// (the dragged widget's own slot) returns null: stay where you are.
export function dropIndex(rects, point, { axis = 'x', hole = null } = {}) {
  const inside = (r) => point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  if (hole && inside(hole)) return null;
  const before =
    axis === 'y'
      ? (r) => (r.top + r.bottom) / 2 < point.y
      : (r) => r.bottom <= point.y || (r.top <= point.y && (r.left + r.right) / 2 < point.x);
  return rects.filter(before).length;
}
