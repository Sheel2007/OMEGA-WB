import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsService, STORAGE_KEY } from '../../web/js/services/settings.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    raw: (key) => data.get(key),
  };
}

const ALL_SIZES = ['small', 'medium', 'large'];
// Each widget's default size, and every size it comes in.
function specs(sizes) {
  return Object.fromEntries(Object.entries(sizes).map(([id, size]) => [id, { size, sizes: ALL_SIZES }]));
}
const SIZES = { shopping: 'large', weather: 'medium', notes: 'small', calendar: 'small', games: 'small' };
const options = (storage) => ({
  storage,
  widgets: specs(SIZES),
  defaultWidgets: ['shopping', 'weather'],
});
const saved = (value) => memoryStorage({ [STORAGE_KEY]: JSON.stringify(value) });
// Just the ids, page by page, in reading order.
const ids = (pages) => pages.map((items) => items.map((item) => item.id));
const at = (id, size, col, row) => ({ id, size, col, row });

test('starts from defaults when nothing is saved', () => {
  const settings = createSettingsService(options(memoryStorage()));
  // Laid out in order: Shopping (large) beside the clock, and Weather beside that.
  assert.deepEqual(settings.get(), {
    theme: 'auto',
    pages: [[at('shopping', 'large', 4, 1), at('weather', 'medium', 9, 1)]],
    widgets: ['shopping', 'weather'],
    scenery: true,
    asker: null,
  });
});

test('saves changes and reads them back on the next load', () => {
  const storage = memoryStorage();
  const settings = createSettingsService(options(storage));
  settings.setTheme('blocks');
  settings.setScenery(false);
  settings.addWidget('notes');
  settings.removeWidget('shopping');

  const again = createSettingsService(options(storage));
  assert.equal(again.getTheme(), 'blocks');
  assert.equal(again.getScenery(), false);
  assert.deepEqual(ids(again.getPages()), [['weather', 'notes']]);
  assert.equal(JSON.parse(storage.raw(STORAGE_KEY)).version, 9);
});

test('version 1 settings are upgraded, and Retro becomes Blocks', () => {
  const settings = createSettingsService(options(saved({ version: 1, theme: 'retro', widgets: ['notes', 'shopping', 'weather'] })));
  assert.equal(settings.getTheme(), 'blocks');
  // Keeps the saved order (Notes before Weather), all still beside the clock.
  assert.deepEqual(ids(settings.getPages()), [['notes', 'shopping', 'weather']]);
  assert.equal(settings.getScenery(), true);
});

test('adding a widget that does not fit puts it on a new page, and says where', () => {
  // Page 1 is full once the clock, the shopping list, the weather, the notes and
  // the calendar are on it, so the sixth widget starts page 2.
  const full = ['shopping', 'weather', 'notes', 'calendar'];
  const settings = createSettingsService(options(saved({ version: 1, theme: 'auto', widgets: full })));
  assert.equal(settings.addWidget('games'), 1);
  assert.deepEqual(ids(settings.getPages())[1], ['games']);
  assert.equal(settings.addWidget('games'), null, 'already on the board');
  assert.equal(settings.addWidget('nope'), null, 'unknown widget');
});

test('adding a widget fills the first page with room for it', () => {
  const settings = createSettingsService(options(saved({ version: 2, theme: 'auto', pages: [['shopping', 'weather'], ['games']], scenery: true })));
  assert.equal(settings.addWidget('notes'), 0);
  assert.deepEqual(ids(settings.getPages())[0].sort(), ['notes', 'shopping', 'weather']);
  assert.deepEqual(ids(settings.getPages())[1], ['games']);
});

test('a widget added to the board turns up on a screen that saved its pages earlier', () => {
  // The screen last saved before Calendar existed; version 3 slots it in where the
  // board's own order puts it, without disturbing what the user arranged.
  const withCalendar = {
    storage: saved({ version: 2, theme: 'dark', pages: [['shopping', 'weather', 'notes'], ['games']], scenery: false }),
    widgets: specs({ shopping: 'large', weather: 'medium', notes: 'small', calendar: 'small', games: 'small' }),
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games'],
  };
  const settings = createSettingsService(withCalendar);
  assert.deepEqual(ids(settings.getPages()), [['calendar', 'shopping', 'weather', 'notes'], ['games']]);
  assert.equal(settings.getTheme(), 'dark', 'the screen keeps its theme');
  assert.equal(settings.getScenery(), false, 'and its other choices');
});

test('upgrading keeps a layout the user arranged, and only adds what is missing', () => {
  const settings = createSettingsService({
    storage: saved({ version: 2, theme: 'auto', pages: [['shopping'], ['notes', 'weather', 'games']], scenery: true }),
    widgets: specs({ shopping: 'large', weather: 'medium', notes: 'small', calendar: 'small', games: 'small' }),
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games'],
  });
  assert.deepEqual(ids(settings.getPages()), [['calendar', 'shopping'], ['notes', 'weather', 'games']]);
});

test('a screen already on the current version is left exactly as it was', () => {
  const settings = createSettingsService({
    storage: saved({ version: 3, theme: 'auto', pages: [['shopping']], scenery: true }),
    widgets: specs({ shopping: 'large', weather: 'medium', notes: 'small', calendar: 'small', games: 'small' }),
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games'],
  });
  assert.deepEqual(ids(settings.getPages()), [['shopping']], 'a widget taken off stays off');
});

test('a version 3 screen picks up only the widgets added since, beside where the board puts them', () => {
  // Lights came in version 4. This screen took Notes off; it gets Lights, not Notes back.
  const settings = createSettingsService({
    storage: saved({ version: 3, theme: 'auto', pages: [['calendar', 'shopping', 'weather'], ['games']], scenery: true }),
    widgets: specs({ shopping: 'large', weather: 'medium', notes: 'small', calendar: 'small', games: 'small', lights: 'medium' }),
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games', 'lights'],
    widgetsSince: { lights: 4 },
  });
  assert.deepEqual(ids(settings.getPages()), [['calendar', 'shopping', 'weather'], ['games', 'lights']]);
});

test('a version 4 screen that took Lights off keeps it off', () => {
  const settings = createSettingsService({
    storage: saved({ version: 4, theme: 'auto', pages: [['shopping']], scenery: true }),
    widgets: specs({ shopping: 'large', lights: 'medium' }),
    defaultWidgets: ['shopping', 'lights'],
    widgetsSince: { lights: 4 },
  });
  assert.deepEqual(ids(settings.getPages()), [['shopping']]);
});

test('a version 4 screen picks up the Roommate Cup once, and keeps Lights off if it took it off', () => {
  const sizes = { shopping: 'large', lights: 'medium', games: 'small', 'roommate-games': 'small' };
  const settings = createSettingsService({
    storage: saved({ version: 4, theme: 'auto', pages: [['shopping'], ['games']], scenery: true }),
    widgets: specs(sizes),
    defaultWidgets: ['shopping', 'games', 'lights', 'roommate-games'],
    widgetsSince: { lights: 4, 'roommate-games': 5 },
  });
  assert.deepEqual(ids(settings.getPages()), [['shopping'], ['games', 'roommate-games']]);
  settings.removeWidget('roommate-games');
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 5, theme: 'auto', pages: ids(settings.getPages()), scenery: true }) });
  const reloaded = createSettingsService({
    storage,
    widgets: specs(sizes),
    defaultWidgets: ['shopping', 'games', 'lights', 'roommate-games'],
    widgetsSince: { lights: 4, 'roommate-games': 5 },
  });
  assert.deepEqual(ids(reloaded.getPages()), [['shopping'], ['games']], 'taken off stays off');
});

test('a version 5 screen picks up Grocery once, and remembers who scans on it', () => {
  const sizes = { shopping: 'large', games: 'small', 'roommate-games': 'small', grocery: 'large' };
  const settings = createSettingsService({
    storage: saved({ version: 5, theme: 'auto', pages: [['shopping'], ['games', 'roommate-games']], scenery: true }),
    widgets: specs(sizes),
    defaultWidgets: ['shopping', 'games', 'roommate-games', 'grocery'],
    widgetsSince: { 'roommate-games': 5, grocery: 6 },
  });
  assert.deepEqual(ids(settings.getPages()), [['shopping'], ['games', 'roommate-games', 'grocery']]);
  assert.equal(settings.getAsker(), null);
  settings.setAsker('  Sam  ');
  assert.equal(settings.getAsker(), 'Sam');
  settings.setAsker('x'.repeat(31));
  assert.equal(settings.getAsker(), null);
});

test('a version 7 screen picks up Spotify once, in the first free spot, leaving the rest where they were', () => {
  const sizes = { calendar: 'small', weather: 'medium', notes: 'small', spotify: 'mini' };
  const widgets = Object.fromEntries(Object.entries(sizes).map(([id, size]) => [id, { size, sizes: ['mini', 'small', 'medium', 'large'] }]));
  const board = [[at('weather', 'medium', 9, 1), at('calendar', 'small', 6, 1), at('notes', 'small', 1, 3)]];
  const storage = saved({ version: 7, theme: 'auto', pages: board, applePages: [[at('calendar', 'small', 3, 1), at('weather', 'medium', 1, 2), at('notes', 'small', 4, 1)]], scenery: true });
  const make = () => createSettingsService({ storage, widgets, defaultWidgets: ['calendar', 'weather', 'spotify', 'notes'], widgetsSince: { spotify: 8 } });

  const settings = make();
  const pages = settings.getPages();
  assert.deepEqual(pages[0].find((item) => item.id === 'spotify'), at('spotify', 'mini', 4, 1), 'the column beside the clock');
  assert.deepEqual(pages[0].filter((item) => item.id !== 'spotify'), [at('calendar', 'small', 6, 1), at('weather', 'medium', 9, 1), at('notes', 'small', 1, 3)]);
  settings.setTheme('apple');
  assert.ok(settings.getWidgets().includes('spotify'), 'on the Glass layout too');
  assert.deepEqual(settings.getPages()[0].find((item) => item.id === 'calendar'), at('calendar', 'small', 3, 1), 'which keeps its arrangement');

  settings.setTheme('auto');
  settings.removeWidget('spotify');
  assert.equal(make().getWidgets().includes('spotify'), false, 'taken off stays off');
});

test('a version 8 screen picks up Sports once, leaving everything else where it was', () => {
  const sizes = { calendar: 'small', weather: 'medium', notes: 'small', spotify: 'mini', sports: 'medium' };
  const widgets = Object.fromEntries(Object.entries(sizes).map(([id, size]) => [id, { size, sizes: ['mini', 'small', 'medium', 'large'] }]));
  const board = [[at('spotify', 'mini', 5, 1), at('calendar', 'small', 6, 1), at('weather', 'medium', 9, 1), at('notes', 'small', 1, 3)]];
  const storage = saved({ version: 8, theme: 'auto', pages: board, applePages: null, scenery: true });
  const make = () =>
    createSettingsService({ storage, widgets, defaultWidgets: ['spotify', 'calendar', 'weather', 'notes', 'sports'], widgetsSince: { spotify: 8, sports: 9 } });

  const settings = make();
  const pages = settings.getPages();
  assert.deepEqual(pages[0].find((item) => item.id === 'sports'), at('sports', 'medium', 4, 3), 'the first free spot that fits');
  assert.deepEqual(pages[0].filter((item) => item.id !== 'sports'), board[0]);
  settings.removeWidget('sports');
  assert.equal(make().getWidgets().includes('sports'), false, 'taken off stays off');
});

test('adding to a chosen page puts it there (spilling over only if it must)', () => {
  const settings = createSettingsService(options(saved({ version: 2, theme: 'auto', pages: [['shopping', 'weather'], ['games']], scenery: true })));
  assert.equal(settings.addWidget('notes', { page: 1 }), 1);
  assert.deepEqual(ids(settings.getPages()), [['shopping', 'weather'], ['games', 'notes']]);
});

test('moving a widget puts it where it was dropped; removing then restoring puts it back', () => {
  const settings = createSettingsService(
    options(saved({ version: 7, theme: 'auto', pages: [[at('notes', 'small', 5, 1), at('weather', 'medium', 9, 1)], [at('games', 'small', 1, 1)]], scenery: true })),
  );
  settings.moveWidget('notes', { page: 0, col: 9, row: 3 });
  assert.deepEqual(settings.getPages()[0], [at('weather', 'medium', 9, 1), at('notes', 'small', 9, 3)], 'anywhere on the page, gaps and all');
  settings.moveWidget('games', { page: 0, col: 9, row: 1 });
  assert.deepEqual(settings.getPages().length, 1, 'the page it left was empty, so it goes');
  assert.deepEqual(settings.getPages()[0].find((item) => item.id === 'games'), at('games', 'small', 9, 1));
  assert.ok(!settings.getPages()[0].some((item) => item.id === 'weather' && item.col === 9 && item.row === 1), 'Weather moved aside');

  const from = settings.removeWidget('notes');
  assert.deepEqual(from, { page: 0, id: 'notes', size: 'small', col: 9, row: 3 });
  assert.deepEqual(settings.getWidgets().includes('notes'), false);
  settings.restoreWidget('notes', from);
  assert.deepEqual(settings.getPages()[0].find((item) => item.id === 'notes'), at('notes', 'small', 9, 3));
});

test('resizing a widget changes its size where it is, and only to sizes it comes in', () => {
  const settings = createSettingsService({
    storage: saved({ version: 7, theme: 'auto', pages: [[at('notes', 'small', 5, 1), at('games', 'small', 8, 1)]], scenery: true }),
    widgets: { notes: { size: 'small', sizes: ALL_SIZES }, games: { size: 'small', sizes: ['small', 'medium'] } },
    defaultWidgets: [],
  });
  settings.resizeWidget('notes', 'large');
  const notes = settings.getPages()[0].find((item) => item.id === 'notes');
  assert.deepEqual(notes, at('notes', 'large', 5, 1));
  assert.ok(settings.getPages()[0].some((item) => item.id === 'games' && item.col >= 10), 'Games moved out of its way (Notes now spans columns 5 to 9)');
  settings.resizeWidget('games', 'large');
  assert.equal(settings.getPages().flat().find((item) => item.id === 'games').size, 'small', 'Games has no large size');
  // A saved size it doesn't come in falls back to its default.
  const odd = createSettingsService({
    storage: saved({ version: 7, theme: 'auto', pages: [[at('games', 'large', 5, 1)]], scenery: true }),
    widgets: { games: { size: 'small', sizes: ['small', 'medium'] } },
    defaultWidgets: [],
  });
  assert.deepEqual(odd.getPages(), [[at('games', 'small', 5, 1)]]);
});

test('ignores unknown themes and widgets, and never adds a widget twice', () => {
  const settings = createSettingsService(options(memoryStorage()));
  settings.setTheme('neon');
  settings.addWidget('weather');
  assert.equal(settings.getTheme(), 'auto');
  assert.deepEqual(settings.getWidgets(), ['shopping', 'weather']);
});

test('falls back to safe values for corrupt, unknown or tampered data', () => {
  const corrupt = createSettingsService(options(memoryStorage({ [STORAGE_KEY]: '{nope' })));
  assert.deepEqual(ids(corrupt.getPages()), [['shopping', 'weather']]);

  const future = createSettingsService(options(saved({ version: 10, theme: 'dark' })));
  assert.equal(future.getTheme(), 'auto');

  const tampered = createSettingsService(
    options(saved({ version: 3, theme: 'dark', pages: [['notes', 'bogus', 'notes'], ['notes', 7, 'games'], 'x'], scenery: 'yes' })),
  );
  assert.deepEqual(tampered.get(), {
    theme: 'dark',
    pages: [[at('notes', 'small', 4, 1)], [at('games', 'small', 1, 1)]],
    widgets: ['notes', 'games'],
    scenery: true,
    asker: null,
  });
});

test('keeps working in memory when storage is unavailable', () => {
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  const settings = createSettingsService(options(broken));
  settings.setTheme('dark');
  assert.equal(settings.getTheme(), 'dark');
});

test('tells subscribers about changes until they unsubscribe', () => {
  const settings = createSettingsService(options(memoryStorage()));
  const seen = [];
  const unsubscribe = settings.subscribe((value) => seen.push(value.theme));
  settings.setTheme('light');
  settings.setTheme('light');
  unsubscribe();
  settings.setTheme('dark');
  assert.deepEqual(seen, ['light']);
});

test('get() hands out copies, so callers cannot change settings behind its back', () => {
  const settings = createSettingsService(options(memoryStorage()));
  const copy = settings.get();
  copy.widgets.push('notes');
  copy.pages[0].push('notes');
  assert.deepEqual(ids(settings.getPages()), [['shopping', 'weather']]);
});

test('the Apple theme keeps its own arrangement, and switching back leaves the board as it was', () => {
  const storage = saved({ version: 6, theme: 'auto', pages: [['shopping', 'weather', 'notes'], ['games']], scenery: true });
  const settings = createSettingsService(options(storage));
  const board = ids(settings.getPages());
  assert.equal(settings.getLayout().id, 'board');

  settings.setTheme('apple');
  assert.equal(settings.getLayout().id, 'apple');
  // On the board, Shopping (large) and Weather (medium) share the top beside the
  // clock. On Glass, Shopping fills the right half beside the clock and Weather
  // the medium slot under the clock, so Notes starts page 2.
  assert.deepEqual(board, [['shopping', 'weather', 'notes'], ['games']]);
  assert.deepEqual(ids(settings.getPages()), [['shopping', 'weather'], ['notes', 'games']]);
  settings.moveWidget('games', { page: 0, index: 0 });
  const apple = ids(settings.getPages());

  settings.setTheme('dark');
  assert.deepEqual(ids(settings.getPages()), board, 'the board layout is untouched');
  settings.setTheme('apple');
  assert.deepEqual(ids(settings.getPages()), apple, 'and Apple remembers its own');

  const again = createSettingsService(options(storage));
  assert.deepEqual(ids(again.getPages()), apple, 'both are saved');
});

test('adding and removing a widget changes every layout; moving or resizing only the one on screen', () => {
  const storage = saved({
    version: 7,
    theme: 'apple',
    pages: [[at('shopping', 'large', 5, 1), at('weather', 'medium', 1, 3)]],
    applePages: [[at('weather', 'medium', 3, 1)], [at('shopping', 'large', 1, 1)]],
    scenery: true,
  });
  const settings = createSettingsService(options(storage));
  assert.deepEqual(ids(settings.getPages()), [['weather'], ['shopping']]);
  settings.addWidget('notes');
  settings.removeWidget('weather');
  settings.moveWidget('shopping', { page: 1, col: 3, row: 1 });
  settings.resizeWidget('notes', 'medium');
  settings.setTheme('light');
  assert.deepEqual(settings.getWidgets().sort(), ['notes', 'shopping']);
  const onBoard = settings.getPages().flat();
  assert.deepEqual(onBoard.find((item) => item.id === 'shopping'), at('shopping', 'large', 5, 1), 'not moved on the board');
  assert.equal(onBoard.find((item) => item.id === 'notes').size, 'small', 'nor resized');

  // Saved Apple pages that disagree with the board about which widgets are on are rebuilt.
  const stale = createSettingsService(
    options(saved({ version: 7, theme: 'apple', pages: [[at('shopping', 'large', 5, 1), at('weather', 'medium', 1, 3)]], applePages: [[at('notes', 'small', 3, 1)]], scenery: true })),
  );
  assert.deepEqual(stale.getWidgets().sort(), ['shopping', 'weather']);
});

test('a version 6 screen keeps its order, laid out once with each widget at its default size', () => {
  const settings = createSettingsService(options(saved({ version: 6, theme: 'auto', pages: [['weather', 'notes'], ['games']], applePages: [['notes']], scenery: true })));
  assert.deepEqual(settings.getPages(), [[at('weather', 'medium', 4, 1), at('notes', 'small', 8, 1)], [at('games', 'small', 1, 1)]]);
  settings.setTheme('apple');
  assert.deepEqual(ids(settings.getPages()), [['weather', 'notes'], ['games']], 'an old Apple arrangement is worked out again');
});

test('a screen saved when it had a dock setting loads without it', () => {
  const settings = createSettingsService(options(saved({ version: 7, theme: 'auto', pages: [], dock: false, scenery: true })));
  assert.equal('dock' in settings.get(), false);
  assert.equal(settings.getTheme(), 'auto');
});
