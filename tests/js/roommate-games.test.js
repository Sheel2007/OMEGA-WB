import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  announceChoices,
  avatarColor,
  AVATAR_COLORS,
  currentWeek,
  dayWord,
  finisherPlaces,
  fromOrder,
  initials,
  leaderLabel,
  nextNightKey,
  ordinal,
  pointsLabel,
  resultLabel,
  scheduleLabel,
  sendLabel,
  stepGameTime,
  tapFinisher,
  toggleTie,
  toOrder,
  widgetMeta,
} from '../../web/js/apps/roommate-games/format.js';

// Friday 9 October 2026, 6:30 PM local time.
const friday = new Date(2026, 9, 9, 18, 30);
const schedule = { on: true, day: 5, time: '19:00', announce: '10:00', perNight: 1 };
const pick = (fields) => ({ id: 'p', name: 'Uno', kind: 'general', specialist: null, result: null, ...fields });
const week = (id, picks = [pick()], fields = {}) => ({ id, picks, notified: null, ...fields });

test('places and points read naturally', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  assert.equal(pointsLabel(1), '1 pt');
  assert.equal(pointsLabel(0), '0 pts');
  assert.equal(initials('Sam'), 'S');
  assert.equal(initials('  mary jane watson '), 'MJ');
});

test('a roommate keeps the same colour', () => {
  assert.equal(avatarColor('a1b2c3d4e5f6'), avatarColor('a1b2c3d4e5f6'));
  assert.ok(AVATAR_COLORS.includes(avatarColor('anything')));
});

test('game nights are named by how far off they are', () => {
  assert.equal(dayWord('2026-10-09', friday), 'Tonight');
  assert.equal(dayWord('2026-10-10', friday), 'Tomorrow');
  assert.equal(dayWord('2026-10-13', friday), 'Tuesday');
  assert.equal(dayWord('2026-10-16', friday), 'Fri, Oct 16');
  assert.equal(dayWord('2026-10-08', friday), 'Last night');
  assert.equal(scheduleLabel(schedule), 'Fridays at 7:00 PM');
  assert.equal(scheduleLabel({ ...schedule, on: false }), 'Paused');
});

test('the next game night matches the server: today on game day until it is all played', () => {
  assert.equal(nextNightKey(schedule, friday), '2026-10-09');
  assert.equal(nextNightKey(schedule, new Date(2026, 9, 10, 9)), '2026-10-16');
  const played = week('2026-10-09', [pick({ result: [['a'], ['b']] })]);
  assert.equal(nextNightKey(schedule, friday, [played]), '2026-10-16');
  assert.equal(nextNightKey({ ...schedule, day: 0 }, friday), '2026-10-11');
});

test('the app leads with the coming game night, or one still waiting on results', () => {
  assert.equal(currentWeek([], friday), null);
  const tonight = week('2026-10-09');
  assert.equal(currentWeek([tonight], friday), tonight);
  const lastWeek = week('2026-10-02');
  assert.equal(currentWeek([lastWeek], friday), null, 'a week old is history');
  const yesterday = week('2026-10-08');
  assert.equal(currentWeek([yesterday], friday), yesterday, 'still waiting on its result');
  const done = week('2026-10-08', [pick({ result: [['a'], ['b']] })]);
  assert.equal(currentWeek([done], friday), null);
});

test('the widget says what is on tonight, or when the next one is', () => {
  const state = { players: [{ id: 'a', name: 'Sam', points: 0 }], weeks: [], schedule };
  assert.equal(widgetMeta({ ...state, players: [] }, friday), 'Sign up to play');
  assert.equal(widgetMeta(state, friday), 'Tonight · 7:00 PM');
  assert.equal(widgetMeta({ ...state, weeks: [week('2026-10-09', [pick({ name: 'Darts' }), pick({ id: 'q' })])] }, friday), 'Tonight · Darts + 1');
  assert.equal(widgetMeta({ ...state, schedule: { ...schedule, on: false } }, friday), 'Game night paused');
  assert.equal(widgetMeta(state, new Date(2026, 9, 12, 9)), 'Friday · 7:00 PM');
});

test('the leader line handles ties and an empty board', () => {
  const p = (name, points) => ({ name, points });
  assert.equal(leaderLabel([]), '');
  assert.equal(leaderLabel([p('Sam', 0), p('Jo', 0)]), 'No points yet');
  assert.equal(leaderLabel([p('Sam', 14), p('Jo', 9)]), 'Sam leads with 14 pts');
  assert.equal(leaderLabel([p('Sam', 9), p('Jo', 9), p('Al', 2)]), 'Sam and Jo are tied on 9 pts');
  assert.equal(leaderLabel([p('Sam', 1), p('Jo', 1), p('Al', 1)]), '3 are tied on 1 pt');
});

test('a result reads as places, ties shared', () => {
  const names = { a: 'Alex', b: 'Sam', c: 'Jo' };
  assert.equal(resultLabel([['a'], ['b', 'c']], names), '1st Alex · 2nd Sam & Jo');
  assert.equal(resultLabel([['a', 'b'], ['c']], names), '1st Alex & Sam · 3rd Jo');
});

test('tapping roommates in finishing order builds the result', () => {
  let finishers = [];
  for (const id of ['a', 'b', 'c', 'd']) finishers = tapFinisher(finishers, id);
  finishers = toggleTie(finishers, 2);
  assert.deepEqual(toOrder(finishers), [['a'], ['b', 'c'], ['d']]);
  assert.deepEqual(finisherPlaces(finishers), [1, 2, 2, 4]);
  assert.deepEqual(fromOrder(toOrder(finishers)), finishers, 'reopening a result gives the same editor');
  assert.equal(toggleTie(finishers, 0), finishers, 'the first finisher has nobody to tie with');
});

test('taking someone out moves everyone after them up', () => {
  let finishers = fromOrder([['a'], ['b', 'c']]);
  finishers = tapFinisher(finishers, 'a');
  assert.deepEqual(finishers, [{ id: 'b', tied: false }, { id: 'c', tied: true }]);
  assert.deepEqual(toOrder(finishers), [['b', 'c']]);
  assert.deepEqual(fromOrder(null), []);
});

test('game time steps by half hours and the send-out times stay before it', () => {
  assert.equal(stepGameTime('19:00', 1), '19:30');
  assert.equal(stepGameTime('12:00', -1), '12:00');
  assert.equal(stepGameTime('23:30', 1), '23:30');
  assert.deepEqual(announceChoices('19:00'), ['08:00', '10:00', '12:00', '15:00']);
  assert.deepEqual(announceChoices('12:00'), ['08:00', '10:00']);
});

test('the send line says what happened, or what will', () => {
  const state = { channels: { email: true, sms: false }, sending: false, schedule };
  const tonight = week('2026-10-09');
  assert.equal(sendLabel(tonight, state, new Date(2026, 9, 9, 8)), 'Goes out at 10:00 AM');
  assert.equal(sendLabel(tonight, state, friday), 'Going out now');
  assert.equal(sendLabel(tonight, state, new Date(2026, 9, 9, 20)), 'Not sent: game night had already started');
  assert.equal(sendLabel(tonight, { ...state, schedule: { ...schedule, on: false } }, friday), 'Game night is paused, so nothing goes out by itself');
  assert.equal(sendLabel(week('2026-10-16'), state, friday), 'Goes out Fri, Oct 16 at 10:00 AM');
  assert.equal(sendLabel(tonight, { ...state, sending: true }, friday), 'Sending…');
  assert.equal(sendLabel(tonight, { ...state, channels: { email: false, sms: false } }, friday), 'Texts and emails aren’t set up on the Pi');
  const sent = { ...tonight, notified: { at: '2026-10-09T10:00:00', sent: 3, failed: 1, problem: 'A text didn’t send.' } };
  assert.equal(sendLabel(sent, state, friday), 'Sent to 3 roommates at 10:00 AM · 1 missed: A text didn’t send.');
  const failed = { ...tonight, notified: { at: '2026-10-09T10:00:00', sent: 0, failed: 4, problem: 'Couldn’t reach the email server.' } };
  assert.equal(sendLabel(failed, state, friday), 'Didn’t go out at 10:00 AM: Couldn’t reach the email server.');
});
