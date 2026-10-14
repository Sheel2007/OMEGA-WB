// Words and times for the Lights app and widget: "7:30 AM", "Weekdays", "Off at 11:00 PM".
// Pure functions, so they're tested in node. Days count 0 (Sunday) to 6, as on the server.

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINUTES_PER_DAY = 24 * 60;

const pad = (n) => String(n).padStart(2, '0');

export function parseTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return { hours, minutes };
}

// From minutes after midnight (any number: it wraps round the day) to "HH:MM".
export function toTime(totalMinutes) {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

// The hour and minute steppers each turn on their own, like the wheels of a clock:
// going up from 11 PM gives 12 PM, and AM or PM is only changed by its own buttons.
export function stepHour(time, by) {
  const { hours, minutes } = parseTime(time);
  const pm = hours >= 12;
  const hour12 = (((hours % 12) + by) % 12 + 12) % 12;
  return toTime((hour12 + (pm ? 12 : 0)) * 60 + minutes);
}

export function stepMinute(time, by) {
  const { hours, minutes } = parseTime(time);
  return toTime(hours * 60 + ((((minutes + by) % 60) + 60) % 60));
}

export function setPeriod(time, pm) {
  const { hours, minutes } = parseTime(time);
  return toTime(((hours % 12) + (pm ? 12 : 0)) * 60 + minutes);
}

// "19:05" → { hour: '7', minute: '05', period: 'PM' }: the board's clock is 12-hour.
export function clockParts(time) {
  const { hours, minutes } = parseTime(time);
  return { hour: String(hours % 12 || 12), minute: pad(minutes), period: hours >= 12 ? 'PM' : 'AM' };
}

export function clockLabel(time) {
  const { hour, minute, period } = clockParts(time);
  return `${hour}:${minute} ${period}`;
}

export function repeatLabel(days) {
  const set = new Set(days);
  if (set.size === 0) return 'Once';
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  if (set.size === 1) return `Every ${DAY_NAMES[[...set][0]]}`;
  return [...set].sort((a, b) => a - b).map((d) => SHORT_DAYS[d]).join(', ');
}

// Which lights a schedule switches, in a few words. No ids means every light.
export function lightsLabel(ids, lights) {
  if (!ids.length) return 'All lights';
  const names = ids.map((id) => lights.find((light) => light.id === id)?.name).filter(Boolean);
  if (!names.length) return ids.length === 1 ? '1 light' : `${ids.length} lights`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} more`;
}

// "15 min", "1 hr", "1 hr 30 min".
export function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

// When a Turn off schedule stops watching for lights switched back on: "7:00 AM".
export function watchEnd(schedule) {
  const { hours, minutes } = parseTime(schedule.time);
  return toTime(hours * 60 + minutes + schedule.watchFor * 60);
}

// "Off again after 30 min, until 7:00 AM", or '' when the schedule doesn't watch.
export function againLabel(schedule) {
  if (schedule.on || !schedule.offAgain) return '';
  return `Off again after ${durationLabel(schedule.offAgain)}, until ${clockLabel(watchEnd(schedule))}`;
}

export function scheduleSummary(schedule, lights) {
  const again = againLabel(schedule);
  return `${schedule.on ? 'Turn on' : 'Turn off'} · ${lightsLabel(schedule.lights, lights)} · ${repeatLabel(schedule.days)}${again ? ` · ${again}` : ''}`;
}

// When a schedule next runs, after `now`, or null if it's switched off.
export function nextRun(schedule, now) {
  if (!schedule.enabled) return null;
  const { hours, minutes } = parseTime(schedule.time);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, hours, minutes);
    if (at > now && (!schedule.days.length || schedule.days.includes(at.getDay()))) return at;
  }
  return null;
}

export function nextSchedule(schedules, now) {
  let best = null;
  for (const schedule of schedules) {
    const at = nextRun(schedule, now);
    if (at && (!best || at < best.at)) best = { schedule, at };
  }
  return best;
}

// "Off at 11:00 PM" today, "On tomorrow at 7:00 AM", or "On Sat at 7:00 AM".
export function nextLabel(next, now) {
  if (!next) return '';
  const action = next.schedule.on ? 'On' : 'Off';
  const time = clockLabel(next.schedule.time);
  const days = Math.round(
    (new Date(next.at.getFullYear(), next.at.getMonth(), next.at.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) /
      (MINUTES_PER_DAY * 60 * 1000),
  );
  if (days === 0) return `${action} at ${time}`;
  if (days === 1) return `${action} tomorrow at ${time}`;
  return `${action} ${SHORT_DAYS[next.at.getDay()]} at ${time}`;
}

export function countLabel(lights) {
  if (!lights.length) return 'No lights';
  const on = lights.filter((light) => light.on === true).length;
  if (lights.length === 1) return on ? 'On' : 'Off';
  if (on === 0) return 'All off';
  if (on === lights.length) return 'All on';
  return `${on} of ${lights.length} on`;
}

// The line under the widget's title: what's wrong, if anything, else how many are on.
export function statusLabel(state) {
  if (state.configured === null) return 'Connecting…';
  if (!state.configured) return 'Turned off';
  if (!state.connected) return 'Can’t reach the lights';
  if (state.hub === false) return 'Zigbee2MQTT is off';
  return countLabel(state.lights);
}

// "3:42": how long pairing stays open, counted down from `until` (epoch ms).
export function pairingCountdown(until, now = Date.now()) {
  if (!until) return '';
  const left = Math.max(0, Math.round((until - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// What to do while pairing is open, or how the device that's joining is getting on.
// `kind` is what's being paired: 'light' (a switch) or 'motion' (a motion sensor).
export function pairingMessage(found, kind = 'light') {
  const motion = kind === 'motion';
  switch (found?.state) {
    case 'joining':
      return motion ? 'Found a sensor. Setting it up…' : 'Found a switch. Setting it up…';
    case 'failed':
      return `${found.name} didn’t finish setting up. Hold its button again.`;
    case 'other':
      return `${found.name} joined, but it isn’t ${motion ? 'a motion sensor' : 'an on/off switch'}.`;
    case 'ready':
      return `${found.name} is ready.`;
    default:
      return motion
        ? 'Hold the button on the new sensor (a pin may be needed) for about 5 seconds, until its light blinks. Then let go.'
        : 'Hold the new switch’s button for about 30 seconds, until its light blinks fast. Then let go.';
  }
}

// Battery-powered switches: warn at this charge or below, while there's time to swap batteries.
export const LOW_BATTERY_PERCENT = 30;

export function isBatteryLow(light) {
  return light.battery != null && light.battery <= LOW_BATTERY_PERCENT;
}

// "Porch battery low", "2 batteries low", or ''.
export function lowBatteryLabel(lights) {
  const low = lights.filter(isBatteryLow);
  if (!low.length) return '';
  return low.length === 1 ? `${low[0].name} battery low` : `${low.length} batteries low`;
}

// "just now", "4 min ago", "2 hr ago", "3 days ago", since `at` (epoch ms).
export function agoLabel(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} hr ago`;
  return `${Math.round(minutes / (24 * 60))} days ago`;
}

// "Battery 22% — replace soon · reported 2 hr ago", or '' for a switch without one.
export function batteryLabel(light, now = Date.now()) {
  if (light.battery == null) return '';
  const level = `Battery ${light.battery}%${isBatteryLow(light) ? ' — replace soon' : ''}`;
  if (!light.batteryAt) return level;
  return `${level} · reported ${agoLabel(light.batteryAt, now)}`;
}

// What a light's tile says under its name.
export function lightStateLabel(light) {
  if (!light.reachable) return 'No response';
  if (light.on === null) return 'Checking…';
  // On, but a Turn off schedule will switch it off again then.
  if (light.on && light.offAt) return `Until ${clockLabel(light.offAt)}`;
  return light.on ? 'On' : 'Off';
}

// "When it gets dark": the lights come on once a day, between noon and `until`.

// Earliest to latest. Matches DARK_LEVELS in board/lights.py.
export const DARK_LEVELS = ['early', 'sunset', 'late'];
export const DARK_UNTIL = ['21:00', '22:00', '23:00', '00:00'];
// The lux each level means to a light sensor, for its hint.
export const DARK_LUX = { early: 100, sunset: 30, late: 10 };

const SUN_LEVELS = { early: 'Before sunset', sunset: 'At sunset', late: 'After sunset' };
const SENSOR_LEVELS = { early: 'A little dim', sunset: 'Dim', late: 'Dark' };

export function darkLevelLabel(level, bySensor = false) {
  return (bySensor ? SENSOR_LEVELS : SUN_LEVELS)[level] ?? '';
}

// "11:00 PM", or "Midnight" for the end of the day.
export function untilLabel(until) {
  return until === '00:00' ? 'Midnight' : clockLabel(until);
}

// Whether "HH:MM" comes before the stop time (midnight being the end of the day).
export function beforeUntil(time, until) {
  return until === '00:00' || time < until;
}

// The sun's time for a level today ("At sunset · 6:24 PM"), or why it won't come today.
export function sunLevelLabel(level, dark) {
  const at = dark.sunTimes?.[level];
  if (!dark.sunTimes) return darkLevelLabel(level);
  if (!at || !beforeUntil(at, dark.until)) return `${darkLevelLabel(level)} · not before ${untilLabel(dark.until)} today`;
  return `${darkLevelLabel(level)} · ${clockLabel(at)}`;
}

// "Came on at 6:24 PM" when it switched the lights on today, else ''.
export function darkRanLabel(dark, now = new Date()) {
  if (!dark.ranAt) return '';
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return dark.ranAt.slice(0, 10) === today ? `Came on at ${clockLabel(dark.ranAt.slice(11, 16))} today` : '';
}

// The row in the app: what it does, which lights, how it tells, and until when.
export function darkSummary(dark, lights, sensors, now = new Date()) {
  if (!dark.using) return 'Needs the board’s location or a light sensor';
  const ran = darkRanLabel(dark, now);
  const sensor = dark.using === 'sensor' && sensors.find((s) => s.id === dark.sensor);
  const when = sensor ? `${darkLevelLabel(dark.level, true)}, by ${sensor.name}` : sunLevelLabel(dark.level, dark);
  return [ran || 'Turn on', lightsLabel(dark.lights, lights), when, `Until ${untilLabel(dark.until)}`].join(' · ');
}

// Motion sensors

// How long without motion before the screen goes off, in minutes.
export const SCREEN_OFF_AFTER = [10, 15, 30, 60];
// Matches TEST_SECONDS in board/screen.py.
export const SCREEN_TEST_SECONDS = 5;

// What a motion sensor's tile says: "Motion now", "Motion 4 min ago", or that it hasn't reported.
export function motionStateLabel(sensor, now = Date.now()) {
  if (sensor.occupied) return 'Motion now';
  if (sensor.lastMotion) return `Motion ${agoLabel(sensor.lastMotion, now)}`;
  return sensor.occupied === false ? 'No motion yet' : 'Waiting for a report';
}

// What it does, in a line.
export function motionSummary(rule) {
  if (!rule.enabled) return 'Doesn’t switch the screen off';
  return `Screen off after ${durationLabel(rule.offAfter)} without motion`;
}

// Whether the board can switch its screen off here, and if not, what to do about it.
export function screenStatusLabel(screen) {
  if (!screen) return 'Switching the screen off is turned off in config.json.';
  if (screen.testing) return 'Testing: the screen goes off for a few seconds…';
  if (screen.problem) return screen.problem;
  if (screen.error) return screen.error;
  return `Ready: the board switches the screen off with ${screen.method}.`;
}

// The sensor's own settings, by Zigbee2MQTT's name for them.
const SETTING_LABELS = {
  motion_timeout: 'Says it’s clear after',
  occupancy_timeout: 'Says it’s clear after',
  detection_interval: 'Time between detections',
  occupancy_sensitivity: 'Sensitivity',
  motion_sensitivity: 'Sensitivity',
  sensitivity: 'Sensitivity',
};

export function settingLabel(setting) {
  return SETTING_LABELS[setting.property] ?? setting.property.replace(/_/g, ' ');
}

const SECOND_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MAX_CHOICES = 6;

// The choices offered for a setting: a few round numbers in its range (and whatever it's
// set to now), or its own words.
export function settingChoices(setting) {
  if (setting.type === 'enum') return [...setting.values];
  let steps = SECOND_STEPS.filter((v) => v >= setting.min && v <= setting.max);
  if (steps.length > MAX_CHOICES) {
    const every = (steps.length - 1) / (MAX_CHOICES - 1);
    steps = Array.from({ length: MAX_CHOICES }, (_, i) => steps[Math.round(i * every)]);
  }
  if (!steps.length) steps = [setting.min, setting.max];
  if (Number.isInteger(setting.value) && setting.value >= setting.min && setting.value <= setting.max) steps.push(setting.value);
  return [...new Set(steps)].sort((a, b) => a - b);
}

// "30 sec", "1 min 30 sec", "2 min"; "40 cm" for other units; "Medium" for words.
export function settingValueLabel(setting, value) {
  if (setting.type === 'enum') return String(value).charAt(0).toUpperCase() + String(value).slice(1).replace(/_/g, ' ');
  if (setting.unit && !['s', 'sec', 'seconds'].includes(setting.unit)) return `${value} ${setting.unit}`;
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (!minutes) return `${seconds} sec`;
  return seconds ? `${minutes} min ${seconds} sec` : durationLabel(minutes);
}
