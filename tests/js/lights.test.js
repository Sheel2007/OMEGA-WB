import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  againLabel,
  batteryLabel,
  isBatteryLow,
  lowBatteryLabel,
  clockLabel,
  durationLabel,
  clockParts,
  countLabel,
  lightsLabel,
  lightStateLabel,
  nextLabel,
  pairingCountdown,
  pairingMessage,
  nextRun,
  nextSchedule,
  repeatLabel,
  scheduleSummary,
  setPeriod,
  statusLabel,
  stepHour,
  stepMinute,
  toTime,
  watchEnd,
} from '../../web/js/apps/lights/format.js';

const LIGHTS = [
  { id: '0x01', name: 'Bedroom light', on: true, reachable: true, swapped: false },
  { id: '0x02', name: 'Kitchen light', on: false, reachable: true, swapped: false },
  { id: '0x03', name: 'Hall light', on: null, reachable: true, swapped: false },
];
const schedule = (fields) => ({ id: 's', time: '07:00', on: true, lights: [], days: [], enabled: true, ...fields });
// Friday 9 October 2026, 6:30 PM local time.
const friday = new Date(2026, 9, 9, 18, 30);

test('times read the way the board clock shows them', () => {
  assert.deepEqual(clockParts('19:05'), { hour: '7', minute: '05', period: 'PM' });
  assert.equal(clockLabel('00:00'), '12:00 AM');
  assert.equal(clockLabel('12:30'), '12:30 PM');
  assert.equal(toTime(-30), '23:30');
  assert.equal(toTime(24 * 60 + 5), '00:05');
});

test('the hour and minute wheels turn on their own, and AM/PM only by its buttons', () => {
  assert.equal(stepHour('23:15', 1), '12:15', '11 PM up an hour is 12 PM, not the next morning');
  assert.equal(stepHour('00:15', -1), '11:15', '12 AM down an hour is 11 AM');
  assert.equal(stepHour('09:00', 1), '10:00');
  assert.equal(stepMinute('09:55', 5), '09:00', 'minutes wrap without moving the hour');
  assert.equal(stepMinute('09:00', -5), '09:55');
  assert.equal(setPeriod('09:30', true), '21:30');
  assert.equal(setPeriod('21:30', false), '09:30');
  assert.equal(setPeriod('12:00', false), '00:00');
});

test('repeat labels use plain words for the common patterns', () => {
  assert.equal(repeatLabel([]), 'Once');
  assert.equal(repeatLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(repeatLabel([5, 1, 2, 3, 4]), 'Weekdays');
  assert.equal(repeatLabel([6, 0]), 'Weekends');
  assert.equal(repeatLabel([3]), 'Every Wednesday');
  assert.equal(repeatLabel([5, 1, 3]), 'Mon, Wed, Fri');
});

test('a schedule names its lights briefly', () => {
  assert.equal(lightsLabel([], LIGHTS), 'All lights');
  assert.equal(lightsLabel(['0x02'], LIGHTS), 'Kitchen light');
  assert.equal(lightsLabel(['0x01', '0x02'], LIGHTS), 'Bedroom light and Kitchen light');
  assert.equal(lightsLabel(['0x01', '0x02', '0x03'], LIGHTS), 'Bedroom light and 2 more');
  assert.equal(lightsLabel(['0x99', '0x98'], LIGHTS), '2 lights', 'lights the board no longer has');
  assert.equal(scheduleSummary(schedule({ on: false, days: [6, 0] }), LIGHTS), 'Turn off · All lights · Weekends');
});

test('the next run skips days the schedule does not repeat on', () => {
  assert.deepEqual(nextRun(schedule({ time: '19:00' }), friday), new Date(2026, 9, 9, 19, 0), 'later today');
  assert.deepEqual(nextRun(schedule({ time: '18:30' }), friday), new Date(2026, 9, 10, 18, 30), 'not the minute it is now');
  assert.deepEqual(nextRun(schedule({ time: '07:00', days: [1, 2, 3, 4, 5] }), friday), new Date(2026, 9, 12, 7, 0), 'Monday');
  assert.equal(nextRun(schedule({ enabled: false }), friday), null);

  const next = nextSchedule([schedule({ id: 'a', time: '07:00', days: [1] }), schedule({ id: 'b', time: '23:00', on: false })], friday);
  assert.equal(next.schedule.id, 'b');
  assert.equal(nextLabel(next, friday), 'Off at 11:00 PM');
  assert.equal(nextLabel(nextSchedule([schedule({ time: '07:00' })], friday), friday), 'On tomorrow at 7:00 AM');
  assert.equal(nextLabel(nextSchedule([schedule({ time: '07:00', days: [1] })], friday), friday), 'On Mon at 7:00 AM');
  assert.equal(nextLabel(nextSchedule([], friday), friday), '');
});

test('counts and status say what matters at a glance', () => {
  assert.equal(countLabel([]), 'No lights');
  assert.equal(countLabel([LIGHTS[0]]), 'On');
  assert.equal(countLabel([LIGHTS[1]]), 'Off');
  assert.equal(countLabel(LIGHTS), '1 of 3 on');
  assert.equal(countLabel(LIGHTS.map((l) => ({ ...l, on: true }))), 'All on');
  assert.equal(countLabel(LIGHTS.map((l) => ({ ...l, on: false }))), 'All off');

  const healthy = { configured: true, connected: true, hub: true, lights: LIGHTS };
  assert.equal(statusLabel(healthy), '1 of 3 on');
  assert.equal(statusLabel({ ...healthy, configured: null }), 'Connecting…');
  assert.equal(statusLabel({ ...healthy, configured: false }), 'Turned off');
  assert.equal(statusLabel({ ...healthy, connected: false }), 'Can’t reach the lights');
  assert.equal(statusLabel({ ...healthy, hub: false }), 'Zigbee2MQTT is off');

  assert.equal(lightStateLabel(LIGHTS[0]), 'On');
  assert.equal(lightStateLabel(LIGHTS[2]), 'Checking…');
  assert.equal(lightStateLabel({ ...LIGHTS[0], reachable: false }), 'No response');
});

test('pairing counts down in minutes and seconds, and says how the new switch is doing', () => {
  assert.equal(pairingCountdown(1_000_000 + 222_400, 1_000_000), '3:42');
  assert.equal(pairingCountdown(1_000_000 + 9_000, 1_000_000), '0:09');
  assert.equal(pairingCountdown(1_000_000 - 5_000, 1_000_000), '0:00', 'never negative');
  assert.equal(pairingCountdown(null), '');

  assert.match(pairingMessage(null), /Hold the new switch’s button/);
  assert.equal(pairingMessage({ state: 'joining', name: 'Light 0009' }), 'Found a switch. Setting it up…');
  assert.equal(pairingMessage({ state: 'ready', name: 'Light 0009' }), 'Light 0009 is ready.');
  assert.match(pairingMessage({ state: 'failed', name: 'Light 0009' }), /didn’t finish setting up/);
  assert.match(pairingMessage({ state: 'other', name: 'Hall sensor' }), /isn’t an on\/off switch/);
});

test('a Turn off schedule that turns lights off again says so', () => {
  assert.equal(durationLabel(15), '15 min');
  assert.equal(durationLabel(60), '1 hr');
  assert.equal(durationLabel(90), '1 hr 30 min');

  const night = schedule({ time: '23:00', on: false, days: [0, 1, 2, 3, 4, 5, 6], offAgain: 30, watchFor: 8 });
  assert.equal(watchEnd(night), '07:00', 'past midnight wraps to the morning');
  assert.equal(againLabel(night), 'Off again after 30 min, until 7:00 AM');
  assert.equal(scheduleSummary(night, LIGHTS), 'Turn off · All lights · Every day · Off again after 30 min, until 7:00 AM');
  assert.equal(againLabel({ ...night, offAgain: 0 }), '');
  assert.equal(againLabel({ ...night, on: true }), '', 'only Turn off schedules watch');

  assert.equal(lightStateLabel({ ...LIGHTS[0], offAt: '23:45' }), 'Until 11:45 PM', 'on, and when it goes off again');
  assert.equal(lightStateLabel({ ...LIGHTS[1], offAt: null }), 'Off');
});

test('switches at 30% battery or less are flagged, with plain words', () => {
  const porch = { ...LIGHTS[0], name: 'Porch', battery: 22, batteryAt: 1_000_000 };
  const hall = { ...LIGHTS[1], name: 'Hall', battery: 30 };
  const kitchen = { ...LIGHTS[2], name: 'Kitchen', battery: 31 };
  const mains = { ...LIGHTS[0], battery: null };
  assert.deepEqual([porch, hall, kitchen, mains].map(isBatteryLow), [true, true, false, false]);

  assert.equal(lowBatteryLabel([kitchen, mains]), '');
  assert.equal(lowBatteryLabel([porch, kitchen]), 'Porch battery low');
  assert.equal(lowBatteryLabel([porch, hall, kitchen]), '2 batteries low');

  assert.equal(batteryLabel(mains), '', 'nothing for a switch without a battery');
  assert.equal(batteryLabel(kitchen), 'Battery 31%');
  assert.equal(batteryLabel(porch, 1_000_000 + 30_000), 'Battery 22% — replace soon · reported just now');
  assert.equal(batteryLabel(porch, 1_000_000 + 2 * 3600_000), 'Battery 22% — replace soon · reported 2 hr ago');
  assert.equal(batteryLabel(porch, 1_000_000 + 3 * 86400_000), 'Battery 22% — replace soon · reported 3 days ago');
});
