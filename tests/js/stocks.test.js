import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { colorAt, over } from '../../web/js/apple-wallpaper.js';
import {
  describe,
  direction,
  magnitude,
  noteFor,
  pageCount,
  pageOf,
  percentText,
  sparkline,
  statusLabel,
  statusOf,
  viewOf,
} from '../../web/js/apps/stocks/format.js';
import * as meta from '../../web/js/apps/stocks/meta.js';
import { contrastRatio } from '../../web/js/color.js';
import { createSettingsService, STORAGE_KEY } from '../../web/js/services/settings.js';
import { addWidget, CLOCK_AREA, findWidget, LAYOUTS, nearestSize, normalize, resizable, resizeWidget, SPANS, stripOnly } from '../../web/js/widget-layout.js';

const OPEN = 1795098600;
const CLOSE = 1795122000;
const reading = (change, extra = {}) => ({
  enabled: true,
  name: 'AI Index',
  market: 'open',
  index: { level: 100 + change, change, count: 3, of: 3 },
  series: { start: OPEN, end: CLOSE, step: 300, levels: [100, 100 + change] },
  constituents: [
    { symbol: 'AAA', price: 110, change: 10 },
    { symbol: 'BBB', price: 49, change: -2 },
    { symbol: 'CCC', price: 20, change: 0 },
  ],
  as_of: OPEN + 300,
  error: null,
  ...extra,
});
const nothing = { enabled: true, name: 'AI Index', market: null, index: null, series: null, constituents: [], as_of: null, error: null };

// The pure words and numbers

test('what the strip shows: off, loading, an error, or the index', () => {
  assert.equal(viewOf({ ...nothing, enabled: false }), 'off');
  assert.equal(viewOf(nothing), 'loading');
  assert.equal(viewOf({ ...nothing, error: "Can't reach the market data." }), 'error');
  assert.equal(viewOf(reading(1.2)), 'ready');
  assert.equal(viewOf(reading(1.2, { error: "Can't reach the market data." })), 'ready', 'an old reading still shows');
  assert.equal(viewOf(reading(NaN)), 'loading', 'a number that is not one is not shown');
  assert.equal(viewOf(null), 'off');
  assert.equal(viewOf(undefined), 'off');
});

test('up, down or flat is decided by what the rounded number shows', () => {
  assert.equal(direction(1.24), 'up');
  assert.equal(direction(-0.01), 'down');
  assert.equal(direction(0), 'flat');
  assert.equal(direction(0.004), 'flat', '+0.00% is not "up"');
  assert.equal(direction(-0.004), 'flat');
  assert.equal(direction(0.005), 'up');
  assert.equal(direction(undefined), 'flat');
});

test('the big number is always three digits wide, without its sign', () => {
  assert.equal(magnitude(1.239), '1.24');
  assert.equal(magnitude(-3.32), '3.32');
  assert.equal(magnitude(0), '0.00');
  assert.equal(magnitude(9.994), '9.99');
  assert.equal(magnitude(9.996), '10.0');
  assert.equal(magnitude(-12.44), '12.4');
  assert.equal(magnitude(99.96), '100');
  assert.equal(magnitude(NaN), '');
});

test("a company's move carries its sign, so colour is never the only clue", () => {
  assert.equal(percentText(1.239), '+1.24%');
  assert.equal(percentText(-3.3), '−3.30%');
  assert.equal(percentText(0), '0.00%');
  assert.equal(percentText(-0.001), '0.00%', 'no "−0.00%"');
  assert.equal(percentText(15), '+15.0%');
  assert.equal(percentText(null), '');
});

test('the line under the number says what the number is', () => {
  assert.equal(statusOf(reading(1)), 'open');
  assert.equal(statusLabel(reading(1)), 'Today');
  const ny = { timeZone: 'America/New_York' };
  assert.equal(statusLabel(reading(1, { market: 'closed' }), ny), 'Thu close', 'names the trading day the move is from');
  assert.equal(statusLabel(reading(1, { market: null }), ny), 'Thu close', 'not known to be open is not "today"');
  assert.equal(statusLabel(reading(1, { market: 'closed', series: null })), 'Closed', 'no trading day to name');
  assert.equal(statusLabel(reading(1, { market: 'closed', series: { start: CLOSE, end: OPEN } })), 'Closed');
  assert.equal(statusLabel(reading(1, { error: 'x' })), 'Offline');
  assert.equal(statusLabel(reading(1, { market: 'closed', error: 'x' })), 'Offline');
  assert.equal(statusOf(nothing), null);
  assert.equal(statusLabel(nothing), '');
});

test('loading, no data and off each say so in a couple of words', () => {
  assert.equal(noteFor(reading(1)), null);
  assert.equal(noteFor(nothing).title, 'Loading');
  assert.equal(noteFor({ ...nothing, error: 'x' }).title, 'No data');
  assert.match(noteFor({ ...nothing, error: 'x' }).hint, /market data/);
  assert.equal(noteFor({ ...nothing, enabled: false }).title, 'Off');
  assert.match(noteFor({ ...nothing, enabled: false }).hint, /config\.json/);
});

test('what a screen reader hears', () => {
  assert.equal(describe(reading(1.239)), 'AI Index: up 1.24% today');
  assert.equal(describe(reading(-3.32, { market: 'closed' })), 'AI Index: down 3.32% at the last close; the market is closed');
  assert.equal(describe(reading(0)), 'AI Index: unchanged today');
  assert.equal(describe(reading(2, { error: 'x' })), 'AI Index: up 2.00% when last read; the market data is offline');
  assert.equal(describe(nothing), 'AI Index: loading');
  assert.equal(describe({ ...nothing, error: 'x' }), "AI Index: can't reach the market data");
  assert.equal(describe({ ...nothing, enabled: false }), 'AI Index: turned off');
  assert.equal(describe(null), 'AI Index: turned off');
});

test('the companies step through a few at a time and come back round', () => {
  const list = ['A', 'B', 'C', 'D', 'E'].map((symbol) => ({ symbol }));
  const shown = (page, size) => pageOf(list, page, size).map((item) => item.symbol).join('');
  assert.equal(shown(0, 2), 'AB');
  assert.equal(shown(1, 2), 'CD');
  assert.equal(shown(2, 2), 'EA', 'the last one is never left on its own');
  assert.equal(shown(3, 2), 'BC');
  assert.equal(shown(5, 2), 'AB', 'back where it began');
  assert.equal(pageCount(5, 2), 5);
  assert.equal(pageCount(10, 2), 5);
  assert.equal(pageCount(10, 3), 10);
  assert.equal(pageCount(10, 4), 5);
  // Everything fits: no cycling.
  assert.equal(shown(3, 5), 'ABCDE');
  assert.equal(shown(0, 9), 'ABCDE');
  assert.equal(pageCount(5, 5), 1);
  assert.equal(pageCount(0, 2), 1);
  assert.deepEqual(pageOf(null, 0, 2), []);
  assert.equal(shown(0, 0), 'A', 'never fewer than one');
});

test('every company gets its turn, the same number of times', () => {
  for (const [total, size] of [[10, 2], [10, 3], [7, 2], [9, 4], [3, 2]]) {
    const list = Array.from({ length: total }, (_, i) => ({ symbol: String(i) }));
    const seen = new Map();
    for (let page = 0; page < pageCount(total, size); page++) {
      for (const item of pageOf(list, page, size)) seen.set(item.symbol, (seen.get(item.symbol) ?? 0) + 1);
    }
    assert.equal(seen.size, total, `${total} at ${size} a time shows them all`);
    assert.equal(new Set(seen.values()).size, 1, `${total} at ${size} a time shows each as often`);
    assert.deepEqual(pageOf(list, pageCount(total, size), size), pageOf(list, 0, size));
  }
});

// The day's line

const numbers = (points) => points.split(' ').map((pair) => pair.split(',').map(Number));

test("the day's line runs from the opening bell and grows through the day", () => {
  const drawn = sparkline({ start: 0, end: 1200, step: 300, levels: [100, 101, 102] }, { width: 100, height: 40, pad: 0 });
  assert.deepEqual(numbers(drawn.points), [[0, 40], [25, 20], [50, 0]]);
  assert.equal(drawn.baseline, 40, "yesterday's close is the bottom on a day that only went up");
  assert.deepEqual(drawn.last, { x: 50, y: 0 });
});

test("yesterday's close is always in the picture", () => {
  const down = sparkline({ start: 0, end: 600, step: 300, levels: [99, 98, 96] }, { width: 100, height: 40, pad: 0 });
  assert.equal(down.baseline, 0);
  assert.deepEqual(numbers(down.points).map(([, y]) => y), [10, 20, 40]);
  const both = sparkline({ start: 0, end: 600, step: 300, levels: [102, 98] }, { width: 100, height: 40, pad: 0 });
  assert.equal(both.baseline, 20);
});

test('the line stays inside its padding', () => {
  const levels = Array.from({ length: 79 }, (_, i) => 100 + Math.sin(i / 5) * 3);
  const drawn = sparkline({ start: OPEN, end: CLOSE, step: 300, levels }, { width: 100, height: 50, pad: 4 });
  const points = numbers(drawn.points);
  assert.equal(points.length, 79);
  for (const [x, y] of points) {
    assert.ok(x >= 4 && x <= 96, `x ${x}`);
    assert.ok(y >= 4 && y <= 46, `y ${y}`);
  }
  assert.equal(points[0][0], 4);
  assert.equal(points[78][0], 96, 'the closing bell is the right-hand edge');
});

test('a day that barely moved is drawn nearly flat, not blown up', () => {
  const drawn = sparkline({ start: 0, end: 600, step: 300, levels: [100, 100.02, 100.01] }, { width: 100, height: 40, pad: 0 });
  const ys = numbers(drawn.points).map(([, y]) => y);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 4, `spread ${ys}`);
  assert.ok(Math.abs(drawn.baseline - 20) < 4);
});

test('steps before every company had traded are skipped', () => {
  const drawn = sparkline({ start: 0, end: 1200, step: 300, levels: [null, 101, 102] }, { width: 100, height: 40, pad: 0 });
  assert.deepEqual(numbers(drawn.points).map(([x]) => x), [25, 50]);
});

test('one reading is still a mark on the chart', () => {
  const drawn = sparkline({ start: 0, end: 1200, step: 300, levels: [101] }, { width: 100, height: 40, pad: 2 });
  const points = numbers(drawn.points);
  assert.equal(points.length, 2);
  assert.equal(points[0][1], points[1][1]);
  assert.ok(points[0][0] >= 2);
});

test('nothing to draw is no line, whatever arrives', () => {
  for (const series of [
    null,
    undefined,
    {},
    { levels: [] },
    { start: 0, end: 600, step: 300, levels: [] },
    { start: 0, end: 600, step: 300, levels: [null, null] },
    { start: 0, end: 600, step: 300, levels: 'x' },
    { start: 600, end: 600, step: 300, levels: [100] },
    { start: 0, end: 600, step: 0, levels: [100] },
    { start: 0, end: 600, step: '300', levels: [100] },
  ]) {
    assert.equal(sparkline(series), null, JSON.stringify(series));
  }
  const odd = sparkline({ start: 0, end: 600, step: 300, levels: [100, 'x', NaN, 101] });
  assert.equal(numbers(odd.points).length, 2);
  assert.ok(numbers(odd.points).flat().every(Number.isFinite));
});

// Colours: green and red are text on the card, so they need 4.5:1 in every theme.

const tokens = readFileSync(new URL('../../web/css/tokens.css', import.meta.url), 'utf8');

function themeBlock(selector) {
  const start = tokens.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `tokens.css has ${selector}`);
  return tokens.slice(start, tokens.indexOf('\n}', start));
}

function token(block, name) {
  const found = block.match(new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-f]{6});`));
  assert.ok(found, `${name} is a six-digit hex colour`);
  return found[1];
}

test('up and down pass WCAG AA on the card in light, dark and Blocks', () => {
  const cards = {
    // Light and dark cards are a little see-through: checked over the sky colours
    // that help least (the darkest night behind a white card, daylight behind a dark one).
    ':root[data-theme="light"]': ['#ffffff', over('#ffffff', 0.9, '#000000')],
    ':root[data-theme="dark"]': ['#141a38', over('#141a38', 0.92, '#ffffff')],
    ':root[data-theme="blocks"]': ['#ece6d6'],
    ':root[data-theme="blocks"][data-night="true"]': ['#2b2e38'],
  };
  for (const [selector, surfaces] of Object.entries(cards)) {
    const block = themeBlock(selector);
    for (const name of ['--stock-up', '--stock-down']) {
      for (const surface of surfaces) {
        const ratio = contrastRatio(token(block, name), surface);
        assert.ok(ratio >= 4.5, `${name} in ${selector} on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('up, down and the name pass WCAG AA on the glass wherever the card sits', () => {
  const block = themeBlock(':root[data-theme="apple"]');
  const colours = ['--stock-up', '--stock-down', '--accent-stocks'].map((name) => [name, token(block, name)]);
  for (let x = 0; x <= 100; x += 2) {
    for (let y = 0; y <= 100; y += 2) {
      const glass = colorAt(x, y, { glass: true });
      for (const [name, colour] of colours) {
        const ratio = contrastRatio(colour, glass);
        assert.ok(ratio >= 4.5, `${name} at ${x},${y} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test('every theme has the colours the widget uses', () => {
  assert.match(tokens, /--icon-stocks:/);
  const css = readFileSync(new URL('../../web/css/apps/stocks.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'stocks.css only uses tokens, never a colour of its own');
  assert.doesNotMatch(css, /animation|@keyframes|backdrop-filter/, 'nothing loops and nothing blurs');
  assert.doesNotMatch(css, /font-family/, 'Blocks numbers keep the block digits');
});

// A widget that comes in one size

const APPS_DIR = new URL('../../web/js/apps/', import.meta.url);
const index = readFileSync(new URL('index.js', APPS_DIR), 'utf8');
const listed = (name) => JSON.parse(index.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\])`))[1].replaceAll("'", '"'));
const DEFAULT_WIDGETS = listed('DEFAULT_WIDGETS');

// Every real widget's sizes, read the way widget-sizes.test.js does.
async function realWidgets() {
  const widgets = {};
  for (const entry of readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(new URL(`${entry.name}/widget.js`, APPS_DIR))) continue;
    const app = await import(new URL(`${entry.name}/meta.js`, APPS_DIR));
    widgets[app.id] = { size: app.widgetSize, sizes: app.widgetSizes };
  }
  return widgets;
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const saved = (value) => memoryStorage({ [STORAGE_KEY]: JSON.stringify(value) });
const boxOf = (item, layout = LAYOUTS.board) => ({ col: item.col, row: item.row, ...layout.spans[item.size] });

test('Stocks only comes in the mini strip, and has no app behind it', () => {
  assert.equal(meta.id, 'stocks');
  assert.equal(meta.widgetSize, 'mini');
  assert.deepEqual(meta.widgetSizes, ['mini']);
  assert.deepEqual(SPANS.mini, { w: 1, h: 2 }, 'one column, the height of the clock');
  assert.ok(!existsSync(new URL('stocks/app.js', APPS_DIR)), 'display only');
  assert.match(meta.iconGlyph, /^<svg /);
});

test('a widget with one size has no corner to stretch', () => {
  assert.equal(resizable(meta.widgetSizes), false);
  assert.equal(resizable(['mini']), false);
  assert.equal(resizable(['small', 'small']), false);
  assert.equal(resizable([]), false);
  assert.equal(resizable(undefined), false);
  assert.equal(resizable(['mini', 'small']), true);
  assert.equal(resizable(['small', 'medium', 'large']), true);
  // And if something asked anyway, the only size it could snap to is the one it is.
  for (const want of [{ w: 1, h: 2 }, { w: 5, h: 4 }, { w: 3, h: 2 }]) {
    assert.equal(nearestSize(['mini'], SPANS, want, 'mini'), 'mini');
    assert.equal(nearestSize(['mini'], LAYOUTS.apple.spans, want, 'mini'), 'mini');
  }
});

test("edit mode leaves the resize corner off widgets that can't be resized", () => {
  const editor = readFileSync(new URL('../../web/js/home-editor.js', import.meta.url), 'utf8');
  const tools = editor.slice(editor.indexOf('function toolsFor('), editor.indexOf('function labelTools('));
  const gate = tools.indexOf('if (!resizable(appOf(id)?.widgetSizes)) return [remove];');
  assert.ok(gate > 0, 'toolsFor() returns only the remove button for a one-size widget');
  assert.ok(gate < tools.indexOf("class: 'widget__resize'"), 'before the corner is built');
});

test('a new screen starts with Stocks in the strip between the clock and Spotify', async () => {
  const widgets = await realWidgets();
  assert.deepEqual(DEFAULT_WIDGETS.slice(0, 2), ['stocks', 'spotify']);
  const settings = createSettingsService({ storage: memoryStorage(), widgets, defaultWidgets: DEFAULT_WIDGETS });
  const [first] = settings.getPages();
  const stocks = first.find((item) => item.id === 'stocks');
  const spotify = first.find((item) => item.id === 'spotify');
  assert.deepEqual(stocks, { id: 'stocks', size: 'mini', col: CLOCK_AREA.col + CLOCK_AREA.w, row: 1 }, 'right beside the clock');
  assert.deepEqual(spotify, { id: 'spotify', size: 'mini', col: stocks.col + 1, row: 1 });
  // The top row is exactly full: clock, the two strips, Calendar and Weather.
  const top = first.filter((item) => item.row === 1);
  assert.equal(CLOCK_AREA.w + top.reduce((sum, item) => sum + boxOf(item).w, 0), LAYOUTS.board.grid.cols);
  assert.deepEqual(first.map((item) => item.id), ['stocks', 'spotify', 'calendar', 'weather', 'unspeakable', 'games', 'lights']);
});

test('a board that already has its layout picks Stocks up once, in the first free strip, and keeps the rest exactly', async () => {
  const widgets = await realWidgets();
  const widgetsSince = Object.fromEntries(
    [...index.match(/export const WIDGETS_SINCE = \{([^}]*)\}/)[1].matchAll(/'?([\w-]+)'?:\s*(\d+)/g)].map(([, id, version]) => [id, Number(version)]),
  );
  assert.equal(widgetsSince.stocks, 11, 'screens saved before version 11 gain it');
  // Spotify moved along a column: the strip beside the clock is free.
  const beside = [
    [
      { id: 'spotify', size: 'mini', col: 5, row: 1 },
      { id: 'calendar', size: 'small', col: 6, row: 1 },
      { id: 'weather', size: 'medium', col: 9, row: 1 },
      { id: 'games', size: 'small', col: 1, row: 3 },
    ],
  ];
  // The top row is full (the board as it first came): the first free strip is lower down.
  const full = [
    [
      { id: 'spotify', size: 'mini', col: 4, row: 1 },
      { id: 'calendar', size: 'medium', col: 5, row: 1 },
      { id: 'weather', size: 'medium', col: 9, row: 1 },
      { id: 'unspeakable', size: 'small', col: 1, row: 3 },
      { id: 'games', size: 'small', col: 4, row: 3 },
      { id: 'lights', size: 'medium', col: 7, row: 3 },
    ],
  ];
  for (const version of [7, 8, 9, 10]) {
    for (const [pages, place] of [[beside, { col: 4, row: 1 }], [full, { col: 11, row: 3 }]]) {
      const storage = saved({ version, theme: 'dark', pages });
      const make = () => createSettingsService({ storage, widgets, defaultWidgets: DEFAULT_WIDGETS, widgetsSince });
      const settings = make();
      const got = settings.getPages();
      assert.deepEqual(findWidget(got, 'stocks'), { page: 0, id: 'stocks', size: 'mini', ...place }, `version ${version} gains Stocks`);
      for (const item of pages[0]) assert.deepEqual(findWidget(got, item.id), { page: 0, ...item }, `version ${version} keeps ${item.id}`);
      settings.removeWidget('stocks');
      assert.ok(!findWidget(make().getPages(), 'stocks'), 'taken off stays off');
    }
  }
});

test('adding it from the menu puts it in the first free strip, and nothing else moves', async () => {
  const widgets = await realWidgets();
  // Two widgets beside the clock leave one column over: the one right beside the clock here.
  const pages = [
    [
      { id: 'calendar', size: 'medium', col: 5, row: 1 },
      { id: 'weather', size: 'medium', col: 9, row: 1 },
      { id: 'unspeakable', size: 'small', col: 1, row: 3 },
      { id: 'games', size: 'small', col: 4, row: 3 },
      { id: 'lights', size: 'small', col: 7, row: 3 },
      { id: 'spotify', size: 'small', col: 10, row: 3 },
    ],
  ];
  const settings = createSettingsService({ storage: saved({ version: 10, theme: 'dark', pages }), widgets, defaultWidgets: DEFAULT_WIDGETS });
  assert.equal(settings.addWidget('stocks'), 0, 'on page 1');
  const got = settings.getPages();
  assert.deepEqual(findWidget(got, 'stocks'), { page: 0, id: 'stocks', size: 'mini', col: 4, row: 1 });
  for (const item of pages[0]) assert.deepEqual(findWidget(got, item.id), { page: 0, ...item });
  assert.equal(got.length, 1);
});

test('it fits the leftover column wherever that is, where no other size could go', () => {
  const layout = LAYOUTS.board;
  // The clock, then two medium widgets: column 12 is all that's left of the top rows.
  const pages = [
    [
      { id: 'a', size: 'medium', col: 4, row: 1 },
      { id: 'b', size: 'medium', col: 8, row: 1 },
      { id: 'c', size: 'medium', col: 1, row: 3 },
      { id: 'd', size: 'medium', col: 5, row: 3 },
      { id: 'e', size: 'medium', col: 9, row: 3 },
    ],
  ];
  const added = addWidget(pages, { id: 'stocks', size: 'mini' }, layout);
  assert.deepEqual(findWidget(added.pages, 'stocks'), { page: 0, id: 'stocks', size: 'mini', col: 12, row: 1 });
  for (const size of ['small', 'medium', 'large']) {
    assert.equal(addWidget(pages, { id: 'x', size }, layout).page, 1, `${size} has to go to page 2`);
  }
});

test('it cannot be resized, whatever asks', async () => {
  const widgets = await realWidgets();
  const settings = createSettingsService({ storage: memoryStorage(), widgets, defaultWidgets: DEFAULT_WIDGETS });
  const before = JSON.stringify(settings.getPages());
  let told = 0;
  settings.subscribe(() => told++);
  for (const size of ['small', 'medium', 'large', 'mini', 'huge', undefined]) settings.resizeWidget('stocks', size);
  assert.equal(JSON.stringify(settings.getPages()), before);
  assert.equal(told, 0, 'nothing changed, so nobody is told');
  // Resizing to the size it already is, in the pure layout, moves nothing either.
  const pages = settings.getPages();
  assert.deepEqual(resizeWidget(pages, 'stocks', 'mini', LAYOUTS.board), pages);
});

test('a saved layout that says it is another size is put back to mini', async () => {
  const widgets = await realWidgets();
  const specOf = (id) => widgets[id] ?? null;
  for (const size of ['small', 'medium', 'large', 'giant', undefined, 7]) {
    const pages = normalize([[{ id: 'stocks', size, col: 4, row: 1 }, { id: 'calendar', size: 'small', col: 5, row: 1 }]], LAYOUTS.board, specOf);
    assert.deepEqual(findWidget(pages, 'stocks'), { page: 0, id: 'stocks', size: 'mini', col: 4, row: 1 }, `saved as ${size}`);
    assert.deepEqual(findWidget(pages, 'calendar'), { page: 0, id: 'calendar', size: 'small', col: 5, row: 1 }, 'and nothing is pushed aside');
  }
  const settings = createSettingsService({
    storage: saved({ version: 10, theme: 'dark', pages: [[{ id: 'stocks', size: 'large', col: 4, row: 1 }]] }),
    widgets,
    defaultWidgets: DEFAULT_WIDGETS,
  });
  assert.deepEqual(settings.getPages(), [[{ id: 'stocks', size: 'mini', col: 4, row: 1 }]]);
});

test('on Glass it stands beside the clock and takes no cell of the grid', async () => {
  const widgets = await realWidgets();
  const settings = createSettingsService({ storage: memoryStorage(), widgets, defaultWidgets: DEFAULT_WIDGETS });
  const board = JSON.stringify(settings.getPages());
  assert.deepEqual(settings.getDocked(), [], 'the board has a column for it');
  settings.setTheme('apple');
  // Glass has no one-column strip: the widget is docked in the clock's slot.
  assert.equal(stripOnly(meta.widgetSizes), true);
  assert.deepEqual(LAYOUTS.apple.strip, { col: 2, row: 1 }, "the last cell of the clock's slot");
  assert.deepEqual(settings.getDocked(), ['stocks']);
  assert.equal(findWidget(settings.getPages(), 'stocks'), null, "it isn't on the grid");
  assert.ok(settings.getWidgets().includes('stocks'), 'but it is on');
  assert.deepEqual(settings.get().docked, ['stocks']);
  // So the top row is as full as it was without it: the clock, then two squares.
  const top = settings.getPages()[0].filter((item) => item.row === 1);
  assert.deepEqual(top.map((item) => [item.id, item.col]), [['spotify', 3], ['calendar', 4]]);
  // Nothing moves or stretches it.
  const before = JSON.stringify(settings.get());
  settings.resizeWidget('stocks', 'large');
  settings.moveWidget('stocks', { page: 1, col: 1, row: 1 });
  assert.equal(settings.addWidget('stocks'), null, "it's already on");
  assert.equal(JSON.stringify(settings.get()), before);

  // Taking it off takes it off the board too, and Undo puts it back where it was there.
  const glassPages = JSON.stringify(settings.getPages());
  const from = settings.removeWidget('stocks');
  assert.equal(from.docked, true);
  assert.deepEqual(settings.getDocked(), []);
  assert.equal(settings.getWidgets().includes('stocks'), false);
  assert.equal(JSON.stringify(settings.getPages()), glassPages, 'the rest of Glass is as it was');
  settings.setTheme('dark');
  assert.equal(findWidget(settings.getPages(), 'stocks'), null);
  settings.setTheme('apple');
  settings.restoreWidget('stocks', from);
  assert.deepEqual(settings.getDocked(), ['stocks']);
  settings.setTheme('dark');
  assert.equal(JSON.stringify(settings.getPages()), board, "the board's layout is as it was");

  // Added from the menu while on Glass: beside the clock (page 1), and in a strip on the board.
  settings.removeWidget('stocks');
  settings.setTheme('apple');
  assert.equal(settings.addWidget('stocks'), 0);
  assert.deepEqual(settings.getDocked(), ['stocks']);
  assert.equal(JSON.stringify(settings.getPages()), glassPages);
  settings.setTheme('dark');
  assert.deepEqual(findWidget(settings.getPages(), 'stocks'), { page: 0, id: 'stocks', size: 'mini', col: 4, row: 1 });
});

test('a Glass board that already has its arrangement keeps it: Stocks docks without taking a square', async () => {
  const widgets = await realWidgets();
  const widgetsSince = { spotify: 8, stocks: 11 };
  // A full first page on both layouts, as a board in use has.
  const pages = [
    [
      { id: 'spotify', size: 'mini', col: 4, row: 1 },
      { id: 'calendar', size: 'medium', col: 5, row: 1 },
      { id: 'weather', size: 'medium', col: 9, row: 1 },
      { id: 'unspeakable', size: 'small', col: 1, row: 3 },
      { id: 'grocery', size: 'small', col: 4, row: 3 },
      { id: 'lights', size: 'medium', col: 7, row: 3 },
    ],
  ];
  const applePages = [
    [
      { id: 'spotify', size: 'small', col: 3, row: 1 },
      { id: 'calendar', size: 'small', col: 4, row: 1 },
      { id: 'weather', size: 'medium', col: 1, row: 2 },
      { id: 'unspeakable', size: 'small', col: 3, row: 2 },
      { id: 'grocery', size: 'small', col: 4, row: 2 },
    ],
    [{ id: 'lights', size: 'small', col: 1, row: 1 }],
  ];
  const settings = createSettingsService({
    storage: saved({ version: 10, theme: 'apple', pages, applePages }),
    widgets,
    defaultWidgets: DEFAULT_WIDGETS,
    widgetsSince,
  });
  assert.deepEqual(settings.getPages(), applePages, 'every square where it was');
  assert.deepEqual(settings.getDocked(), ['stocks']);

  // A screen that saved Stocks as a square on Glass (the first version did) loses the square, not the widget.
  const squared = [[...applePages[0]], [...applePages[1], { id: 'stocks', size: 'mini', col: 2, row: 1 }]];
  const withStocks = [[...pages[0], { id: 'stocks', size: 'mini', col: 11, row: 3 }]];
  const again = createSettingsService({
    storage: saved({ version: 11, theme: 'apple', pages: withStocks, applePages: squared }),
    widgets,
    defaultWidgets: DEFAULT_WIDGETS,
    widgetsSince,
  });
  assert.deepEqual(again.getPages(), applePages);
  assert.deepEqual(again.getDocked(), ['stocks']);
});
