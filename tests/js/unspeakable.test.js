import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseDate, caseLabel, countLabel, moreLabel, numbered, tallyLabel, timeAgo } from '../../web/js/apps/unspeakable/format.js';
import {
  DEFAULT_LOOK,
  DENY_MS,
  LOOKS,
  WALL_CARDS,
  barWidth,
  denialLine,
  fileNumber,
  lookOf,
  newlySealed,
  stringPoints,
  tapAgain,
  tapeLines,
  tapeText,
  wallSlots,
} from '../../web/js/apps/unspeakable/looks.js';

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

test('a case shows the day it happened, and the tally counts the people turned away', () => {
  assert.match(caseDate(at(2026, 9, 3, 12, 0)), /Oct\s+3/);
  assert.equal(caseDate(null), '');
  assert.equal(caseDate('not a date'), '');
  assert.equal(tallyLabel(17), 'Unauthorized attempts: 17');
  assert.equal(tallyLabel(1), 'Unauthorized attempts: 1');
});

test('the cases that do not fit are counted, in fewer words beside the tally', () => {
  assert.equal(moreLabel(2), '2 more on the record');
  assert.equal(moreLabel(2, true), '+2 more');
});

// Looks

test('there are three looks, and anything else means the default one', () => {
  assert.deepEqual(LOOKS.map((look) => look.id), ['tape', 'dossier', 'wall']);
  assert.ok(LOOKS.every((look) => look.label));
  assert.equal(DEFAULT_LOOK, 'tape');
  assert.equal(lookOf('wall'), 'wall');
  for (const bad of ['neon', undefined, null, 3, 'toString']) assert.equal(lookOf(bad), 'tape');
});

test('the tape says two different things, and what it says changes as cases are added', () => {
  const seen = new Set();
  for (let count = 0; count < 12; count++) {
    const [first, second] = tapeLines(count);
    assert.notEqual(first, second);
    assert.equal(first, first.toUpperCase());
    seen.add(first);
  }
  assert.ok(seen.size >= 3);
  assert.notDeepEqual(tapeLines(1), tapeLines(2));
  assert.equal(tapeText('DO NOT ASK', 3), 'DO NOT ASK · DO NOT ASK · DO NOT ASK');
});

test('each person turned away gets the next line, round and round', () => {
  const lines = Array.from({ length: 5 }, (_, n) => denialLine(n));
  assert.equal(new Set(lines).size, 5);
  assert.equal(denialLine(5), denialLine(0));
  assert.ok(denialLine(-1) && denialLine(undefined));
});

test('the dossier is numbered like a file', () => {
  assert.equal(fileNumber(4), '004');
  assert.equal(fileNumber(0), '000');
  assert.equal(fileNumber(1234), '1234');
});

test('a bar is as long as its entry, within reason', () => {
  assert.ok(barWidth('short') < barWidth('quite a bit longer than that'));
  assert.equal(barWidth('x'.repeat(200)), 100);
  assert.ok(barWidth('') >= 40);
});

test('the evidence wall pins as many cards as its size has room for, all on the board', () => {
  assert.deepEqual(WALL_CARDS, { small: 3, medium: 4, large: 6 });
  for (const [size, most] of Object.entries(WALL_CARDS)) {
    for (let count = 0; count <= 9; count++) {
      const { cards, note } = wallSlots(count, size);
      assert.equal(cards.length, Math.min(count, most));
      for (const pin of [...cards, note]) {
        assert.ok(pin.x >= 14 && pin.x <= 86, `${size} x ${pin.x}`);
        assert.ok(pin.y >= 2 && pin.y <= 84, `${size} y ${pin.y}`);
        assert.ok(Math.abs(pin.rot) <= 8 && pin.rot !== 0, `${size} tilt ${pin.rot}`);
      }
    }
    // No two cards pinned on the same spot.
    const { cards } = wallSlots(most, size);
    assert.equal(new Set(cards.map((pin) => `${pin.x},${pin.y}`)).size, most);
  }
  assert.deepEqual(wallSlots(2, 'mini'), wallSlots(2, 'small'));
});

test('the red string runs pin to pin and ends at the note, and there is none without cards', () => {
  const slots = wallSlots(2, 'small');
  const [a, b] = slots.cards;
  assert.equal(stringPoints(slots), `${a.x},${a.y} ${b.x},${b.y} ${slots.note.x},${slots.note.y}`);
  assert.equal(stringPoints(wallSlots(0, 'small')), '');
});

test('one tap is turned away; a second inside the window gets in', () => {
  const first = tapAgain([], 1000);
  assert.equal(first.opened, false);
  const second = tapAgain(first.taps, 1000 + DENY_MS - 1);
  assert.equal(second.opened, true);
  assert.deepEqual(second.taps, []);
});

test('a second tap after the window is a first tap again', () => {
  const first = tapAgain([], 1000);
  const late = tapAgain(first.taps, 1000 + DENY_MS);
  assert.equal(late.opened, false);
  assert.equal(tapAgain(late.taps, 1000 + DENY_MS + 500).opened, true);
});

test('a new case on top of the pile is the one being sealed', () => {
  const seen = new Set(['a', 'b']);
  assert.equal(newlySealed(seen, [{ id: 'c' }, { id: 'b' }, { id: 'a' }]), 'c');
  assert.equal(newlySealed(seen, [{ id: 'b' }, { id: 'a' }]), null);
  assert.equal(newlySealed(seen, [{ id: 'b' }]), null);
  assert.equal(newlySealed(seen, []), null);
  // The first time the widget draws, everything is new to it and nothing was just sealed.
  assert.equal(newlySealed(null, [{ id: 'a' }]), null);
});
