import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo } from '../../web/js/apps/notes/format.js';
import { nextNoteColor, NOTE_COLORS } from '../../web/js/services/notes.js';

// Local times, so "yesterday" means the same thing in every timezone the tests run in.
const now = new Date(2026, 9, 1, 18, 0);
const at = (...parts) => new Date(...parts).toISOString();

test('timeAgo says how long a note has been up, in plain words', () => {
  assert.equal(timeAgo(at(2026, 9, 1, 17, 59, 30), now), 'Just now');
  assert.equal(timeAgo(at(2026, 9, 1, 17, 55), now), '5 min ago');
  assert.equal(timeAgo(at(2026, 9, 1, 16, 0), now), '2 hr ago');
  assert.equal(timeAgo(at(2026, 8, 30, 23, 0), now), 'Yesterday');
  assert.match(timeAgo(at(2026, 8, 20, 12, 0), now), /Sep\s+20/);
  assert.equal(timeAgo(null, now), '');
});

test('note colours rotate so neighbouring notes differ, matching the server', () => {
  assert.equal(nextNoteColor([]), 'yellow');
  assert.equal(nextNoteColor([{ color: 'yellow' }]), 'pink');
  assert.equal(nextNoteColor([{ color: 'green' }]), 'yellow');
  assert.equal(nextNoteColor([{ color: 'unknown' }]), 'yellow');
  assert.deepEqual(NOTE_COLORS, ['yellow', 'pink', 'blue', 'green']);
});
