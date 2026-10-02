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

const options = (storage) => ({
  storage,
  widgetSizes: { shopping: 'tall', weather: 'wide', notes: 'medium', calendar: 'medium', games: 'medium' },
  defaultWidgets: ['shopping', 'weather'],
});
const saved = (value) => memoryStorage({ [STORAGE_KEY]: JSON.stringify(value) });

test('starts from defaults when nothing is saved', () => {
  const settings = createSettingsService(options(memoryStorage()));
  assert.deepEqual(settings.get(), { theme: 'auto', pages: [['shopping', 'weather']], widgets: ['shopping', 'weather'], scenery: true });
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
  assert.deepEqual(again.getPages(), [['notes', 'weather']]);
  assert.equal(JSON.parse(storage.raw(STORAGE_KEY)).version, 3);
});

test('version 1 settings are upgraded, and Retro becomes Blocks', () => {
  const settings = createSettingsService(options(saved({ version: 1, theme: 'retro', widgets: ['notes', 'shopping', 'weather'] })));
  assert.equal(settings.getTheme(), 'blocks');
  // Keeps the saved order (Notes before Weather), all still beside the clock.
  assert.deepEqual(settings.getPages(), [['notes', 'shopping', 'weather']]);
  assert.equal(settings.getScenery(), true);
});

test('adding a widget that does not fit puts it on a new page, and says where', () => {
  // Page 1 is full once the clock, the shopping list, the weather, the notes and
  // the calendar are on it, so the sixth widget starts page 2.
  const full = ['shopping', 'weather', 'notes', 'calendar'];
  const settings = createSettingsService(options(saved({ version: 1, theme: 'auto', widgets: full })));
  assert.equal(settings.addWidget('games'), 1);
  assert.deepEqual(settings.getPages()[1], ['games']);
  assert.equal(settings.addWidget('games'), null, 'already on the board');
  assert.equal(settings.addWidget('nope'), null, 'unknown widget');
});

test('adding a widget fills the first page with room for it', () => {
  const settings = createSettingsService(options(saved({ version: 2, theme: 'auto', pages: [['shopping', 'weather'], ['games']], scenery: true })));
  assert.equal(settings.addWidget('notes'), 0);
  assert.deepEqual(settings.getPages()[0].sort(), ['notes', 'shopping', 'weather']);
  assert.deepEqual(settings.getPages()[1], ['games']);
});

test('a widget added to the board turns up on a screen that saved its pages earlier', () => {
  // The screen last saved before Calendar existed; version 3 slots it in where the
  // board's own order puts it, without disturbing what the user arranged.
  const withCalendar = {
    storage: saved({ version: 2, theme: 'dark', pages: [['shopping', 'weather', 'notes'], ['games']], scenery: false }),
    widgetSizes: { shopping: 'tall', weather: 'wide', notes: 'medium', calendar: 'medium', games: 'medium' },
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games'],
  };
  const settings = createSettingsService(withCalendar);
  assert.deepEqual(settings.getPages(), [['calendar', 'shopping', 'weather', 'notes'], ['games']]);
  assert.equal(settings.getTheme(), 'dark', 'the screen keeps its theme');
  assert.equal(settings.getScenery(), false, 'and its other choices');
});

test('upgrading keeps a layout the user arranged, and only adds what is missing', () => {
  const settings = createSettingsService({
    storage: saved({ version: 2, theme: 'auto', pages: [['shopping'], ['notes', 'weather', 'games']], scenery: true }),
    widgetSizes: { shopping: 'tall', weather: 'wide', notes: 'medium', calendar: 'medium', games: 'medium' },
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games'],
  });
  assert.deepEqual(settings.getPages(), [['calendar', 'shopping'], ['notes', 'weather', 'games']]);
});

test('a screen already on the current version is left exactly as it was', () => {
  const settings = createSettingsService({
    storage: saved({ version: 3, theme: 'auto', pages: [['shopping']], scenery: true }),
    widgetSizes: { shopping: 'tall', weather: 'wide', notes: 'medium', calendar: 'medium', games: 'medium' },
    defaultWidgets: ['calendar', 'shopping', 'weather', 'notes', 'games'],
  });
  assert.deepEqual(settings.getPages(), [['shopping']], 'a widget taken off stays off');
});

test('adding to a chosen page puts it there (spilling over only if it must)', () => {
  const settings = createSettingsService(options(saved({ version: 2, theme: 'auto', pages: [['shopping', 'weather'], ['games']], scenery: true })));
  assert.equal(settings.addWidget('notes', { page: 1 }), 1);
  assert.deepEqual(settings.getPages(), [['shopping', 'weather'], ['games', 'notes']]);
});

test('moving a widget to another page, and removing then restoring it', () => {
  const settings = createSettingsService(options(saved({ version: 2, theme: 'auto', pages: [['shopping', 'weather', 'notes'], ['games']], scenery: true })));
  settings.moveWidget('notes', { page: 1, index: 0 });
  assert.deepEqual(settings.getPages(), [['shopping', 'weather'], ['notes', 'games']]);

  const from = settings.removeWidget('weather');
  assert.deepEqual(from, { page: 0, index: 1 });
  assert.deepEqual(settings.getPages(), [['shopping'], ['notes', 'games']]);
  settings.restoreWidget('weather', from);
  assert.deepEqual(settings.getPages(), [['shopping', 'weather'], ['notes', 'games']]);
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
  assert.deepEqual(corrupt.getPages(), [['shopping', 'weather']]);

  const future = createSettingsService(options(saved({ version: 9, theme: 'dark' })));
  assert.equal(future.getTheme(), 'auto');

  const tampered = createSettingsService(
    options(saved({ version: 3, theme: 'dark', pages: [['notes', 'bogus', 'notes'], ['notes', 7, 'games'], 'x'], scenery: 'yes' })),
  );
  assert.deepEqual(tampered.get(), { theme: 'dark', pages: [['notes'], ['games']], widgets: ['notes', 'games'], scenery: true });
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
  assert.deepEqual(settings.getPages(), [['shopping', 'weather']]);
});
