import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emojiFor, suggest, buyAgain, nameKey } from '../../web/js/groceries.js';

test('emojiFor matches plain, plural and accented names', () => {
  assert.equal(emojiFor('Eggs'), '🥚');
  assert.equal(emojiFor('Bananas'), '🍌');
  assert.equal(emojiFor('Strawberries'), '🍓');
  assert.equal(emojiFor('Tomatoes'), '🍅');
  assert.equal(emojiFor('Peaches'), '🍑');
  assert.equal(emojiFor('2 avocados'), '🥑');
  assert.equal(emojiFor('Jalapeños'), '🌶️');
});

test('emojiFor prefers multi-word names, then the last matching word', () => {
  assert.equal(emojiFor('Peanut butter'), '🥜');
  assert.equal(emojiFor('Ice cream'), '🍨');
  assert.equal(emojiFor('Cream cheese'), '🧀');
  assert.equal(emojiFor('Black pepper'), '🧂');
  assert.equal(emojiFor('Bell pepper'), '🫑');
  assert.equal(emojiFor('Oat milk'), '🥛');
  assert.equal(emojiFor('Garlic bread'), '🍞');
  assert.equal(emojiFor('Paper towels'), '🧻');
  assert.equal(emojiFor('Hot dog buns'), '🌭');
});

test('emojiFor does not match words hidden inside other words', () => {
  assert.equal(emojiFor('Pineapple'), '🍍');
  assert.equal(emojiFor('Eggplant'), '🍆');
  assert.equal(emojiFor('Mystery item'), null);
  assert.equal(emojiFor(''), null);
});

test('nameKey ignores case and extra spaces', () => {
  assert.equal(nameKey('  Oat   MILK '), 'oat milk');
});

test('suggest puts things you have bought before first', () => {
  const recent = [{ name: 'Mint chocolate', count: 3 }];
  const result = suggest('mi', { recent, exclude: new Set() });
  assert.equal(result[0], 'Mint chocolate');
  assert.ok(result.includes('Milk'));
});

test('suggest matches the start of any word and skips items already on the list', () => {
  const result = suggest('mil', { recent: [], exclude: new Set(['milk']) });
  assert.ok(result.includes('Oat milk'));
  assert.ok(!result.includes('Milk'));
});

test('suggest returns nothing for an empty prefix and respects the limit', () => {
  assert.deepEqual(suggest('  ', { recent: [], exclude: new Set() }), []);
  assert.ok(suggest('s', { recent: [], exclude: new Set(), limit: 3 }).length <= 3);
});

test('buyAgain ranks by how often something was added and fills with staples', () => {
  const recent = [
    { name: 'Coffee', count: 1, last: '2026-09-30T10:00:00Z' },
    { name: 'Oat milk', count: 5, last: '2026-09-01T10:00:00Z' },
    { name: 'Eggs', count: 2, last: '2026-09-20T10:00:00Z' },
  ];
  const result = buyAgain(recent, new Set(['eggs']), 6);
  assert.deepEqual(result.slice(0, 2), ['Oat milk', 'Coffee']);
  assert.equal(result.length, 6);
  assert.ok(!result.includes('Eggs'));
});
