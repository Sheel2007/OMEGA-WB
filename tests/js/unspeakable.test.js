import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseLabel, countLabel, numbered, timeAgo } from '../../web/js/apps/unspeakable/format.js';

// Local times, so "yesterday" means the same thing in every timezone the tests run in.
const now = new Date(2026, 9, 1, 18, 0);
const at = (...parts) => new Date(...parts).toISOString();

test('timeAgo says how long something has been on the record, in plain words', () => {
  assert.equal(timeAgo(at(2026, 9, 1, 17, 59, 30), now), 'Just now');
  assert.equal(timeAgo(at(2026, 9, 1, 17, 55), now), '5 min ago');
  assert.equal(timeAgo(at(2026, 9, 1, 16, 0), now), '2 hr ago');
  assert.equal(timeAgo(at(2026, 8, 30, 23, 0), now), 'Yesterday');
  assert.match(timeAgo(at(2026, 8, 20, 12, 0), now), /Sep\s+20/);
  assert.equal(timeAgo(null, now), '');
});

test('the count says how much the house is sitting on, and an empty ledger is suspicious', () => {
  assert.equal(countLabel(0), 'Nothing on the record. Suspicious.');
  assert.equal(countLabel(1), '1 thing we don’t talk about');
  assert.equal(countLabel(4), '4 things we don’t talk about');
});

test('case numbers count up from the oldest incident, newest first in the list', () => {
  const entries = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  assert.deepEqual(numbered(entries).map((e) => [e.id, e.number]), [['c', 3], ['b', 2], ['a', 1]]);
  assert.deepEqual(numbered([]), []);
  assert.equal(caseLabel(3), '#3');
});

test('numbering leaves the stored entries alone', () => {
  const entries = [{ id: 'a', text: 'the turkey incident' }];
  const out = numbered(entries);
  assert.equal(entries[0].number, undefined);
  assert.equal(out[0].text, 'the turkey incident');
});
