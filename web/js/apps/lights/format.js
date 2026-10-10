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

// What to do while pairing is open, or how the switch that's joining is getting on.
export function pairingMessage(found) {
  switch (found?.state) {
    case 'joining':
      return 'Found a switch. Setting it up…';
    case 'failed':
      return `${found.name} didn’t finish setting up. Hold its button again.`;
    case 'other':
      return `${found.name} joined, but it isn’t an on/off switch.`;
    case 'ready':
      return `${found.name} is ready.`;
    default:
      return 'Hold the new switch’s button for about 30 seconds, until its light blinks fast. Then let go.';
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

// "Battery 22% — replace soon · reported 2 hr ago", or '' for a switch without one.
export function batteryLabel(light, now = Date.now()) {
  if (light.battery == null) return '';
  const level = `Battery ${light.battery}%${isBatteryLow(light) ? ' — replace soon' : ''}`;
  if (!light.batteryAt) return level;
  const minutes = Math.max(0, Math.floor((now - light.batteryAt) / 60000));
  let ago;
  if (minutes < 1) ago = 'just now';
  else if (minutes < 60) ago = `${minutes} min ago`;
  else if (minutes < 48 * 60) ago = `${Math.round(minutes / 60)} hr ago`;
  else ago = `${Math.round(minutes / (24 * 60))} days ago`;
  return `${level} · reported ${ago}`;
}

// What a light's tile says under its name.
export function lightStateLabel(light) {
  if (!light.reachable) return 'No response';
  if (light.on === null) return 'Checking…';
  // On, but a Turn off schedule will switch it off again then.
  if (light.on && light.offAt) return `Until ${clockLabel(light.offAt)}`;
  return light.on ? 'On' : 'Off';
}
