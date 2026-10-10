// Every widget can be resized in edit mode, so every app has to say which sizes
// its widget comes in (see "Widget sizes" in CLAUDE.md). This reads each app's
// meta.js directly (the widgets themselves need a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { SIZES } from '../../web/js/widget-layout.js';

const APPS_DIR = new URL('../../web/js/apps/', import.meta.url);
const apps = readdirSync(APPS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/widget.js`, APPS_DIR)))
  .map((entry) => entry.name);

test('every app with a widget is checked', () => {
  assert.ok(apps.length >= 7, `found ${apps.join(', ')}`);
});

for (const app of apps) {
  test(`${app}: its widget says which sizes it comes in, and starts at one of them`, async () => {
    const meta = await import(new URL(`${app}/meta.js`, APPS_DIR));
    assert.ok(SIZES.includes(meta.widgetSize), `widgetSize "${meta.widgetSize}" is one of ${SIZES.join(', ')}`);
    assert.ok(Array.isArray(meta.widgetSizes) && meta.widgetSizes.length > 0, 'widgetSizes is a list');
    assert.ok(meta.widgetSizes.every((size) => SIZES.includes(size)), `widgetSizes only uses ${SIZES.join(', ')}`);
    assert.equal(new Set(meta.widgetSizes).size, meta.widgetSizes.length, 'no size twice');
    assert.ok(meta.widgetSizes.includes(meta.widgetSize), 'it starts at a size it comes in');
    assert.deepEqual(meta.widgetSizes, SIZES.filter((size) => meta.widgetSizes.includes(size)), 'listed small to large');
  });
}
