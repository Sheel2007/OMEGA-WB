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
  widgetIds: ['shopping', 'weather', 'notes'],
  defaultWidgets: ['shopping', 'weather'],
});

test('starts from defaults when nothing is saved', () => {
  const settings = createSettingsService(options(memoryStorage()));
  assert.equal(settings.getTheme(), 'auto');
  assert.deepEqual(settings.getWidgets(), ['shopping', 'weather']);
});

test('saves changes and reads them back on the next load', () => {
  const storage = memoryStorage();
  const settings = createSettingsService(options(storage));
  settings.setTheme('retro');
  settings.addWidget('notes');
  settings.removeWidget('shopping');

  const again = createSettingsService(options(storage));
  assert.equal(again.getTheme(), 'retro');
  assert.deepEqual(again.getWidgets(), ['weather', 'notes']);
  assert.equal(JSON.parse(storage.raw(STORAGE_KEY)).version, 1);
});

test('ignores unknown themes and widgets, and never adds a widget twice', () => {
  const settings = createSettingsService(options(memoryStorage()));
  settings.setTheme('neon');
  settings.addWidget('calendar');
  settings.addWidget('weather');
  assert.equal(settings.getTheme(), 'auto');
  assert.deepEqual(settings.getWidgets(), ['shopping', 'weather']);
});

test('falls back to defaults for corrupt, outdated or tampered data', () => {
  const corrupt = createSettingsService(options(memoryStorage({ [STORAGE_KEY]: '{nope' })));
  assert.deepEqual(corrupt.get(), { theme: 'auto', widgets: ['shopping', 'weather'] });

  const outdated = createSettingsService(options(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 0, theme: 'dark' }) })));
  assert.equal(outdated.getTheme(), 'auto');

  const tampered = createSettingsService(
    options(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, theme: 'dark', widgets: ['notes', 'bogus', 'notes', 7] }) })),
  );
  assert.deepEqual(tampered.get(), { theme: 'dark', widgets: ['notes'] });
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
  settings.get().widgets.push('notes');
  assert.deepEqual(settings.getWidgets(), ['shopping', 'weather']);
});
