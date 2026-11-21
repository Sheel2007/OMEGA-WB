import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bigNumber,
  countLabel,
  dateLabel,
  daysLeft,
  finished,
  leftLabel,
  nextLabel,
  spoken,
  upcoming,
} from '../../web/js/apps/countdown/format.js';

const TODAY = '2026-11-20';
const finals = { id: 'a', title: 'UMD finals', date: '2026-12-14' };
const winter = { id: 'b', title: 'Winter break', date: '2026-12-22' };
const spring = { id: 'c', title: 'Next semester', date: '2027-01-27' };
const party = { id: 'd', title: 'Friendsgiving', date: '2026-11-15' };
const today = { id: 'e', title: 'Game night', date: TODAY };

test('the days left are counted on the calendar, across months and years', () => {
  assert.equal(daysLeft(finals, TODAY), 24);
  assert.equal(daysLeft(winter, TODAY), 32);
  assert.equal(daysLeft(spring, TODAY), 68);
  assert.equal(daysLeft(today, TODAY), 0);
  assert.equal(daysLeft(party, TODAY), -5);
  // Across the spring clock change, still whole days.
  assert.equal(daysLeft({ date: '2027-03-15' }, '2027-03-13'), 2);
});

test('what is coming is soonest first, today included; what has been is kept apart', () => {
  const all = [spring, party, finals, today, winter];
  assert.deepEqual(upcoming(all, TODAY).map((c) => c.title), ['Game night', 'UMD finals', 'Winter break', 'Next semester']);
  assert.deepEqual(finished(all, TODAY).map((c) => [c.title, c.days]), [['Friendsgiving', -5]]);
  assert.deepEqual(upcoming(null, TODAY), []);
  assert.deepEqual(upcoming([null, { title: 'no day' }], TODAY), []);
});

test('the big number is a count of days, or the word Today on the day', () => {
  assert.deepEqual(bigNumber(24), { number: '24', unit: 'days' });
  assert.deepEqual(bigNumber(1), { number: '1', unit: 'day' });
  assert.deepEqual(bigNumber(0), { number: 'Today', unit: '' });
  assert.deepEqual(bigNumber(-3), { number: '3', unit: 'days' });
});

test('a list row says it in a few words', () => {
  assert.equal(leftLabel(0), 'Today');
  assert.equal(leftLabel(1), 'Tomorrow');
  assert.equal(leftLabel(32), '32 days');
  assert.equal(leftLabel(-1), 'Yesterday');
  assert.equal(leftLabel(-5), '5 days ago');
});

test('the date says its year only once it is far off', () => {
  assert.equal(dateLabel(finals, TODAY), 'Mon, Dec 14');
  assert.equal(dateLabel(spring, TODAY), 'Wed, Jan 27');
  assert.equal(dateLabel({ date: '2028-01-03' }, TODAY), 'Mon, Jan 3, 2028');
});

test('the summary and the phone line name the next one', () => {
  assert.equal(countLabel(0), 'Nothing to count down to');
  assert.equal(countLabel(1), '1 coming up');
  assert.equal(countLabel(3), '3 coming up');
  assert.equal(nextLabel([spring, finals], TODAY), 'UMD finals in 24 days');
  assert.equal(nextLabel([today, finals], TODAY), 'Game night is today');
  assert.equal(nextLabel([{ title: 'Trip', date: '2026-11-21' }], TODAY), 'Trip tomorrow');
  assert.equal(nextLabel([party], TODAY), 'Add a day to wait for');
  assert.equal(spoken(finals, TODAY), 'UMD finals: 24 days, Mon, Dec 14');
});
