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

export function scheduleSummary(schedule, lights) {
  return `${schedule.on ? 'Turn on' : 'Turn off'} · ${lightsLabel(schedule.lights, lights)} · ${repeatLabel(schedule.days)}`;
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
  if (!state.configured) return 'Not set up';
  if (!state.connected) return 'Can’t reach the lights';
  if (state.hub === false) return 'Zigbee2MQTT is off';
  return countLabel(state.lights);
}

// What a light's tile says under its name.
export function lightStateLabel(light) {
  if (!light.reachable) return 'No response';
  if (light.on === null) return 'Checking…';
  return light.on ? 'On' : 'Off';
}
