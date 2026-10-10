// Words and small rules for the Roommate Cup: "1st", "14 pts", "Tonight · 7:00 PM",
// which game night to show, and the finishing-order editor. Pure, so it's tested in node.
import { clockLabel, DAY_NAMES, parseTime, toTime } from '../lights/format.js';

export const KIND_LABELS = { general: 'General', specialized: 'Specialized' };
// One per roommate, from the calendar colours (each at least 3:1 against a card).
export const AVATAR_COLORS = ['blue', 'purple', 'teal', 'pink', 'orange', 'green'];
// The times game night can start, and when the games can go out that day.
export const ANNOUNCE_TIMES = ['08:00', '10:00', '12:00', '15:00'];
const TIME_STEP = 30;
const EARLIEST_GAME = '12:00';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

export function pointsLabel(points) {
  return points === 1 ? '1 pt' : `${points} pts`;
}

export function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toUpperCase();
}

// The same colour for a roommate on every screen and every visit.
export function avatarColor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// Game nights are known by their date, "2026-10-16".

export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const daysBetween = (fromKey, toKey) => Math.round((parseDay(toKey) - parseDay(fromKey)) / DAY_MS);

export function nightLabel(key) {
  const day = parseDay(key);
  return `${SHORT_DAYS[day.getDay()]}, ${MONTHS[day.getMonth()]} ${day.getDate()}`;
}

// "Tonight", "Tomorrow", "Friday" (this week), or "Fri, Oct 23".
export function dayWord(key, now) {
  const ahead = daysBetween(dayKey(now), key);
  if (ahead === 0) return 'Tonight';
  if (ahead === 1) return 'Tomorrow';
  if (ahead > 1 && ahead < 7) return DAY_NAMES[parseDay(key).getDay()];
  if (ahead === -1) return 'Last night';
  return nightLabel(key);
}

export function whenLabel(key, time, now) {
  return `${dayWord(key, now)} · ${clockLabel(time)}`;
}

export const isComplete = (week) => week.picks.length > 0 && week.picks.every((pick) => pick.result);

// The game night the app leads with: one still to come, or one this past week
// that's still waiting on results. Null when there's nothing to show.
export function currentWeek(weeks, now) {
  const today = dayKey(now);
  const latest = weeks.at(-1);
  if (!latest) return null;
  const age = daysBetween(latest.id, today);
  if (age <= 0) return latest;
  if (age < 7 && !isComplete(latest)) return latest;
  return null;
}

// The date of the next game night, matching the server: today on game day, unless
// every game that night already has a result.
export function nextNightKey(schedule, now, weeks = []) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const night = new Date(today);
  night.setDate(today.getDate() + ((schedule.day - today.getDay() + 7) % 7));
  const week = weeks.find((w) => w.id === dayKey(night));
  if (week && isComplete(week)) night.setDate(night.getDate() + 7);
  return dayKey(night);
}

export function scheduleLabel(schedule) {
  if (!schedule.on) return 'Paused';
  return `${DAY_NAMES[schedule.day]}s at ${clockLabel(schedule.time)}`;
}

// Game time steps in half hours, from noon to 11:30 PM.
export function stepGameTime(time, by) {
  const earliest = parseTime(EARLIEST_GAME);
  const minutes = parseTime(time);
  const total = minutes.hours * 60 + minutes.minutes + by * TIME_STEP;
  const lowest = earliest.hours * 60 + earliest.minutes;
  return toTime(Math.min(23 * 60 + 30, Math.max(lowest, total)));
}

// The send-out times that are still before game night starts.
export function announceChoices(time) {
  return ANNOUNCE_TIMES.filter((choice) => choice < time);
}

// What the widget says under its name.
export function widgetMeta(state, now) {
  if (state.players.length === 0) return 'Sign up to play';
  const week = currentWeek(state.weeks, now);
  if (week && dayKey(now) === week.id && week.picks.length) {
    const [first, ...rest] = week.picks;
    return `Tonight · ${first.name}${rest.length ? ` + ${rest.length}` : ''}`;
  }
  if (!state.schedule.on) return 'Game night paused';
  const key = nextNightKey(state.schedule, now, state.weeks);
  return `${dayWord(key, now)} · ${clockLabel(state.schedule.time)}`;
}

// "Sam leads", "Sam and Alex are tied", "3 are tied for first".
export function leaderLabel(players) {
  if (players.length === 0) return '';
  const best = players[0].points;
  if (best === 0) return 'No points yet';
  const leaders = players.filter((p) => p.points === best);
  if (leaders.length === 1) return `${leaders[0].name} leads with ${pointsLabel(best)}`;
  if (leaders.length === 2) return `${leaders[0].name} and ${leaders[1].name} are tied on ${pointsLabel(best)}`;
  return `${leaders.length} are tied on ${pointsLabel(best)}`;
}

// "1st Alex · 2nd Sam & Jo", for a game that's been played.
export function resultLabel(order, names) {
  let ahead = 0;
  return order
    .map((group) => {
      const text = `${ordinal(ahead + 1)} ${group.map((id) => names[id] ?? 'Someone').join(' & ')}`;
      ahead += group.length;
      return text;
    })
    .join(' · ');
}

// One line of a roommate's breakdown: "1st of 4" and "+3", "+1 bonus".
export function placeLabel(entry) {
  return `${ordinal(entry.place)} of ${entry.of}`;
}

export function gainLabel(entry) {
  return `+${entry.points + entry.bonus}`;
}

export function sendLabel(week, state, now) {
  const { channels, sending, schedule } = state;
  if (sending) return 'Sending…';
  const sent = week?.notified;
  if (sent) {
    const at = new Date(sent.at);
    const when = dayKey(at) === dayKey(now) ? clockLabel(`${pad(at.getHours())}:${pad(at.getMinutes())}`) : nightLabel(dayKey(at));
    if (!sent.sent) return `Didn’t go out at ${when}: ${sent.problem ?? 'nobody could be reached'}`;
    const people = sent.sent === 1 ? '1 roommate' : `${sent.sent} roommates`;
    const missed = sent.failed ? ` · ${sent.failed} missed${sent.problem ? `: ${sent.problem}` : ''}` : '';
    return `Sent to ${people} at ${when}${missed}`;
  }
  if (!channels.email && !channels.sms) return 'Texts and emails aren’t set up on the Pi';
  if (!week) return '';
  if (!schedule.on) return 'Game night is paused, so nothing goes out by itself';
  const today = dayKey(now);
  if (week.id > today) return `Goes out ${nightLabel(week.id)} at ${clockLabel(schedule.announce)}`;
  const minute = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  // The board sends on its next check, about a minute after the games are due.
  if (minute < schedule.announce) return `Goes out at ${clockLabel(schedule.announce)}`;
  if (minute < schedule.time) return 'Going out now';
  return 'Not sent: game night had already started';
}

export function channelsLabel(channels) {
  if (channels.email && channels.sms) return 'By text and email';
  if (channels.email) return 'By email';
  if (channels.sms) return 'By text';
  return 'Not set up: add email or texts to config.json on the Pi';
}

export function catalogLabel(games) {
  const general = games.filter((g) => g.kind === 'general').length;
  const specialized = games.length - general;
  if (games.length === 0) return 'No games yet';
  return `${general} General · ${specialized} Specialized`;
}

// The finishing-order editor works on a flat list of finishers, each either in a
// place of their own or tied with the one above, and turns that into places.

export function toOrder(finishers) {
  const order = [];
  for (const { id, tied } of finishers) {
    if (tied && order.length) order.at(-1).push(id);
    else order.push([id]);
  }
  return order;
}

export function fromOrder(order) {
  return (order ?? []).flatMap((group) => group.map((id, index) => ({ id, tied: index > 0 })));
}

// Tap someone not yet placed to put them next; tap someone placed to take them out.
export function tapFinisher(finishers, id) {
  if (finishers.some((f) => f.id === id)) {
    const rest = finishers.filter((f) => f.id !== id);
    return rest.map((f, index) => (index === 0 ? { ...f, tied: false } : f));
  }
  return [...finishers, { id, tied: false }];
}

export function toggleTie(finishers, index) {
  if (index <= 0 || index >= finishers.length) return finishers;
  return finishers.map((f, i) => (i === index ? { ...f, tied: !f.tied } : f));
}

// Each finisher's place, with ties sharing it (1, 2, 2, 4).
export function finisherPlaces(finishers) {
  const places = [];
  finishers.forEach((f, index) => places.push(f.tied && index > 0 ? places[index - 1] : index + 1));
  return places;
}
