import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOrder } from '../../web/js/widget-layout.js';

const apps = [
  { id: 'notes', widgetSize: 'medium' },
  { id: 'weather', widgetSize: 'wide' },
  { id: 'shopping', widgetSize: 'tall' },
];

test('widgets are laid out biggest first, whatever order they were added in', () => {
  // Re-adding Shopping last used to push it below the board and squash the others.
  assert.deepEqual(layoutOrder(['weather', 'notes', 'shopping'], apps), ['shopping', 'weather', 'notes']);
  assert.deepEqual(layoutOrder(['notes', 'shopping', 'weather'], apps), ['shopping', 'weather', 'notes']);
  assert.deepEqual(layoutOrder(['notes', 'weather'], apps), ['weather', 'notes']);
});

test('widgets of the same size keep the order they were added in', () => {
  const twoWide = [...apps, { id: 'calendar', widgetSize: 'wide' }];
  assert.deepEqual(layoutOrder(['calendar', 'notes', 'weather'], twoWide), ['calendar', 'weather', 'notes']);
  assert.deepEqual(layoutOrder(['weather', 'calendar'], twoWide), ['weather', 'calendar']);
});

test('unknown widgets are left out', () => {
  assert.deepEqual(layoutOrder(['ghost', 'notes'], apps), ['notes']);
  assert.deepEqual(layoutOrder([], apps), []);
});
