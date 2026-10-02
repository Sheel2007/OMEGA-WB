import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countLabel,
  dayBadge,
  dayKey,
  dayLabel,
  daysBetween,
  formatTime,
  groupByDay,
  mergeEvents,
  msUntilMidnight,
  nextLabel,
  shiftDay,
  upcoming,
} from '../../web/js/apps/calendar/agenda.js';

const TODAY = '2026-10-02';

const ours = (date, title, time = null) => ({ id: `${title}-${date}`, title, date, time });
const theirs = (date, title, extra = {}) => ({
  id: `feed0:${title}@${date}`,
  title,
  date,
  time: null,
  endTime: null,
  days: 1,
  location: null,
  calendar: 'Birthdays',
  color: 'pink',
  ...extra,
});

test('dayKey and shiftDay work on local calendar days, across month and year ends', () => {
  assert.equal(dayKey(new Date(2026, 9, 2, 23, 30)), '2026-10-02');
  assert.equal(shiftDay('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-10-02', '2026-10-09'), 7);
  assert.equal(daysBetween('2026-10-09', '2026-10-02'), -7);
});

test('shiftDay stays on the right day through a daylight-saving change', () => {
  // US clocks go back on 1 November 2026; a naive +24h would land back on the 31st.
  assert.equal(shiftDay('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDay('2026-11-01', 1), '2026-11-02');
  assert.equal(daysBetween('2026-10-25', '2026-11-08'), 14);
});

test('formatTime turns a 24-hour clock into the local way of writing it', () => {
  assert.match(formatTime('15:00'), /3[:.]00/);
  assert.match(formatTime('09:05'), /9[:.]05/);
  assert.equal(formatTime(null), '');
  assert.equal(formatTime('25:00'), '');
  assert.equal(formatTime('nope'), '');
});

test('dayLabel names nearby days in words and far ones by date', () => {
  assert.equal(dayLabel(TODAY, TODAY), 'Today');
  assert.equal(dayLabel('2026-10-03', TODAY), 'Tomorrow');
  assert.equal(dayLabel('2026-10-01', TODAY), 'Yesterday');
  assert.match(dayLabel('2026-10-06', TODAY), /Tuesday/);
  assert.match(dayLabel('2026-12-25', TODAY), /Dec\s*25/);
});

test('dayBadge is short enough for a widget row', () => {
  assert.equal(dayBadge(TODAY, TODAY), 'Today');
  assert.equal(dayBadge('2026-10-03', TODAY), 'Tmrw');
  assert.match(dayBadge('2026-10-06', TODAY), /^Tue/);
  assert.match(dayBadge('2026-12-25', TODAY), /Dec\s*25/);
});

test('nextLabel counts today first, then says how far off the next thing is', () => {
  assert.equal(nextLabel([], TODAY), 'Nothing coming up');
  assert.equal(nextLabel([ours(TODAY, 'Bins')], TODAY), '1 event today');
  assert.equal(nextLabel([ours(TODAY, 'Bins'), ours(TODAY, 'Film')], TODAY), '2 events today');
  assert.equal(nextLabel([ours('2026-10-03', 'Dentist')], TODAY), 'Next: tomorrow');
  assert.match(nextLabel([ours('2026-10-06', 'Dentist')], TODAY), /^Next: Tue/);
  assert.match(nextLabel([ours('2026-12-25', 'Holiday')], TODAY), /^Next: Dec\s*25/);
});

test('countLabel reads naturally', () => {
  assert.equal(countLabel(0), 'Nothing on');
  assert.equal(countLabel(1), '1 event');
  assert.equal(countLabel(4), '4 events');
});

test('mergeEvents puts all-day events first, then times, and drops rubbish', () => {
  const merged = mergeEvents({
    events: [ours('2026-10-05', 'Film night', '19:30'), ours('2026-10-05', 'Bin day')],
    feed: [theirs('2026-10-03', 'Sam’s birthday'), theirs('2026-10-05', 'Lunch', { time: '12:00' })],
  });
  assert.deepEqual(
    merged.map((event) => [event.date, event.time, event.title]),
    [
      ['2026-10-03', null, 'Sam’s birthday'],
      ['2026-10-05', null, 'Bin day'],
      ['2026-10-05', '12:00', 'Lunch'],
      ['2026-10-05', '19:30', 'Film night'],
    ],
  );
});

test('mergeEvents tidies titles, marks where each event came from, and ignores broken ones', () => {
  const merged = mergeEvents({
    events: [ours('2026-10-05', '  Bin    day '), ours('next week', 'No date'), ours('2026-10-06', '   ')],
    feed: [theirs('2026-10-07', 'Holiday', { days: 3, time: '90:00' })],
  });
  assert.deepEqual(merged.map((event) => event.title), ['Bin day', 'Holiday']);
  assert.equal(merged[0].ours, true);
  assert.equal(merged[0].days, 1);
  assert.equal(merged[1].ours, false);
  assert.equal(merged[1].calendar, 'Birthdays');
  assert.equal(merged[1].days, 3);
  assert.equal(merged[1].time, null);
});

test('mergeEvents keeps the household copy when a subscribed calendar has the same event', () => {
  const merged = mergeEvents({
    events: [ours('2026-10-05', 'Bin day')],
    feed: [theirs('2026-10-05', 'bin day')],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ours, true);
});

test('mergeEvents caps a silly span rather than filling the agenda with it', () => {
  const merged = mergeEvents({ feed: [theirs('2026-10-05', 'Sabbatical', { days: 400 })] });
  assert.equal(merged[0].days, 30);
});

test('groupByDay groups from today onwards and ignores what has passed', () => {
  const events = mergeEvents({
    events: [ours('2026-09-30', 'Last week'), ours(TODAY, 'Bins'), ours('2026-10-05', 'Film', '19:30')],
  });
  const { days, total, shown } = groupByDay(events, { from: TODAY });
  assert.deepEqual(days.map((day) => [day.key, day.events.map((e) => e.title)]), [
    [TODAY, ['Bins']],
    ['2026-10-05', ['Film']],
  ]);
  assert.equal(total, 2);
  assert.equal(shown, 2);
});

test('groupByDay spreads a multi-day event over each of its days', () => {
  const events = mergeEvents({ feed: [theirs('2026-10-03', 'Away', { days: 3 })] });
  const { days } = groupByDay(events, { from: TODAY });
  assert.deepEqual(days.map((day) => day.key), ['2026-10-03', '2026-10-04', '2026-10-05']);
  assert.deepEqual(days.map((day) => day.events[0].dayOffset), [0, 1, 2]);
});

test('groupByDay clips a multi-day event that started before today', () => {
  const events = mergeEvents({ feed: [theirs('2026-09-30', 'Away', { days: 5 })] });
  const { days } = groupByDay(events, { from: TODAY });
  assert.deepEqual(days.map((day) => day.key), [TODAY, '2026-10-03', '2026-10-04']);
  assert.equal(days[0].events[0].dayOffset, 2);
});

test('groupByDay honours a last day and never returns more rows than the limit', () => {
  const events = mergeEvents({
    events: Array.from({ length: 12 }, (_, i) => ours(shiftDay(TODAY, i), `Event ${i}`)),
  });
  assert.equal(groupByDay(events, { from: TODAY, through: shiftDay(TODAY, 2) }).days.length, 3);
  const limited = groupByDay(events, { from: TODAY, limit: 5 });
  assert.equal(limited.shown, 5);
  assert.equal(limited.total, 12);
  assert.equal(limited.days.length, 5);
});

test('upcoming flattens the agenda into widget rows, each tagged with its day', () => {
  const events = mergeEvents({
    events: [ours(TODAY, 'Bins'), ours(TODAY, 'Film', '19:30'), ours('2026-10-09', 'Dentist', '15:00')],
  });
  const { rows, total } = upcoming(events, { from: TODAY, limit: 2 });
  assert.deepEqual(rows.map((row) => [row.day, row.title]), [[TODAY, 'Bins'], [TODAY, 'Film']]);
  assert.equal(total, 3);
});

test('upcoming gives a multi-day event one row, and shows an ongoing one as today', () => {
  const events = mergeEvents({
    feed: [theirs('2026-10-09', 'Trip', { days: 3 }), theirs('2026-09-30', 'Away', { days: 5 })],
  });
  const { rows, total } = upcoming(events, { from: TODAY });
  assert.deepEqual(rows.map((row) => [row.day, row.title]), [[TODAY, 'Away'], ['2026-10-09', 'Trip']]);
  assert.equal(total, 2);
});

test('upcoming leaves out anything that has finished', () => {
  const events = mergeEvents({ feed: [theirs('2026-09-28', 'Over', { days: 2 })] });
  assert.deepEqual(upcoming(events, { from: TODAY }).rows, []);
});

test('msUntilMidnight counts to the start of the next local day', () => {
  assert.equal(msUntilMidnight(new Date(2026, 9, 2, 23, 59, 59, 0)), 1000);
  assert.equal(msUntilMidnight(new Date(2026, 9, 2, 0, 0, 0, 0)), 24 * 60 * 60 * 1000);
});
