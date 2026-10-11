// Words, times and choices for the Sports widget, app and match page. Pure, so
// it's tested in node.
//
// A match is the server's shape (board/sports.py): { id, league, competition,
// table, kickoff (ms), status: { state: pre|in|post, name, detail, clock,
// completed }, home, away (each { id, name, short, abbr, crest, color, score,
// shootout, winner }), note, venue, follows: [follow ids], detail }.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// ESPN doesn't say when a match ended; two hours after kickoff is near enough.
const MATCH_LENGTH_MS = 2 * HOUR;
// A followed team's result stays the main thing on the widget this long after.
const RESULT_SHOWN_MS = 3 * HOUR;

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const LONG_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const at = (now) => (typeof now === 'number' ? now : now.getTime());

export const isLive = (match) => match.status.state === 'in';
export const isDone = (match) => match.status.state === 'post';
export const isUpcoming = (match) => match.status.state === 'pre';
export const isHalfTime = (match) => match.status.name === 'STATUS_HALFTIME';
const isFinal = (match) => isDone(match) && match.status.completed;

// The follows that are teams (not whole competitions), by follow id.
function teamFollows(follows) {
  return new Set(follows.filter((follow) => follow.kind === 'team').map((follow) => follow.id));
}

// The ESPN team ids of the teams the board follows, for picking them out of tables.
export function followedTeamIds(follows) {
  return new Set(follows.filter((follow) => follow.kind === 'team' && follow.team).map((follow) => follow.team));
}

function isTeamMatch(match, teams) {
  return match.follows.some((id) => teams.has(id));
}

// The match the Sports page shows big, and why: a followed team playing now, then any
// followed match playing now, then a team's result from the last few hours, then
// the next team match, the next of anything, and last of all the latest result.
export function pickFeatured(matches, follows, now) {
  const t = at(now);
  const teams = teamFollows(follows);
  const ours = matches.filter((m) => isTeamMatch(m, teams));
  const others = matches.filter((m) => !isTeamMatch(m, teams));
  const next = (list) => list.find((m) => isUpcoming(m) && m.kickoff >= t - MATCH_LENGTH_MS);
  const recent = ours.filter((m) => isFinal(m) && m.kickoff <= t && t - m.kickoff <= MATCH_LENGTH_MS + RESULT_SHOWN_MS).at(-1);
  const choices = [
    ['live', ours.find(isLive)],
    ['live', others.find(isLive)],
    ['result', recent],
    ['next', next(ours)],
    ['next', next(others)],
    ['result', ours.filter(isDone).at(-1)],
  ];
  const found = choices.find(([, match]) => match);
  return found ? { why: found[0], match: found[1] } : null;
}

// Under the featured match: anything else on now, then the followed teams' next matches.
export function comingList(matches, follows, now, skipId) {
  const t = at(now);
  const teams = teamFollows(follows);
  const others = matches.filter((m) => m.id !== skipId);
  return [...others.filter(isLive), ...others.filter((m) => isTeamMatch(m, teams) && isUpcoming(m) && m.kickoff >= t - MATCH_LENGTH_MS)];
}

// The followed teams' results, newest first.
export function resultsList(matches, follows, skipId) {
  const teams = teamFollows(follows);
  return matches.filter((m) => m.id !== skipId && isTeamMatch(m, teams) && isDone(m)).reverse();
}

// After the final whistle, the result stays on the home screen this long before
// a later match that day takes over with its countdown.
const RESULT_HELD_MS = 30 * MINUTE;

// The match for the game-day strip under the clock: a followed team playing now,
// then one that's just finished, then the next one today, then today's last result
// for a few hours after. Null when no followed team plays today.
export function gameDayMatch(matches, follows, now) {
  const t = at(now);
  const teams = teamFollows(follows);
  const today = dayKey(t);
  const ours = matches.filter((m) => isTeamMatch(m, teams));
  const ended = (m) => t - (m.kickoff + MATCH_LENGTH_MS);
  const finished = ours.filter((m) => isFinal(m) && m.kickoff <= t && ended(m) <= RESULT_SHOWN_MS);
  return (
    ours.find(isLive) ??
    finished.filter((m) => ended(m) <= RESULT_HELD_MS).at(-1) ??
    ours.find((m) => isUpcoming(m) && dayKey(m.kickoff) === today && m.kickoff >= t - MATCH_LENGTH_MS) ??
    finished.at(-1) ??
    null
  );
}

// A followed team's next match (by follow id): the one it's playing now, else the
// one it's just finished (for half an hour, like the game-day strip), else the next
// one to come. Null when none is known.
export function nextMatchFor(matches, followId, now) {
  const t = at(now);
  const ours = matches.filter((m) => m.follows.includes(followId));
  const ended = (m) => t - (m.kickoff + MATCH_LENGTH_MS);
  return (
    ours.find(isLive) ??
    ours.filter((m) => isFinal(m) && m.kickoff <= t && ended(m) <= RESULT_HELD_MS).at(-1) ??
    ours.find((m) => isUpcoming(m) && m.kickoff >= t - MATCH_LENGTH_MS) ??
    null
  );
}

// Each team's next match, soonest first; a match two of them play shows once.
export function nextMatches(matches, followIds, now) {
  const found = new Map();
  for (const id of followIds) {
    const match = nextMatchFor(matches, id, now);
    if (match) found.set(match.id, match);
  }
  return [...found.values()].sort((a, b) => a.kickoff - b.kickoff);
}

// What a match is called on its notification: its derby's name when it has one.
const DERBIES = { '359:367': 'North London Derby' };
export function meetingName(match) {
  const key = [match.home.id, match.away.id].sort().join(':');
  return DERBIES[key] ?? `${match.home.short} v ${match.away.short}`;
}

// How long until it, the way a notification says when: "in 55 days",
// "Tomorrow", "in 3h 20m", "Now", "Full time".
export function untilLabel(match, now) {
  if (isLive(match)) return 'Now';
  if (isDone(match)) return 'Full time';
  const days = daysBetween(at(now), match.kickoff);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return 'Tomorrow';
  const left = match.kickoff - at(now);
  if (left <= 0) return 'Now';
  const hours = Math.floor(left / HOUR);
  const minutes = Math.ceil((left % HOUR) / MINUTE);
  if (hours === 0) return `in ${minutes} min`;
  return minutes === 60 ? `in ${hours + 1}h` : minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
}

// A countdown to kickoff that ticks: "4:05:09", "14:05", then "0:00".
export function countdownClock(match, now) {
  const left = Math.max(0, Math.ceil((match.kickoff - at(now)) / 1000));
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = String(left % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

// The followed team match on right now, if there is one: the Sports app opens on it.
export function liveTeamMatch(matches, follows) {
  const teams = teamFollows(follows);
  return matches.find((m) => isLive(m) && isTeamMatch(m, teams)) ?? null;
}

// Filtering by a follow ("all" is everything).
export function matchesFor(matches, followId) {
  return followId === 'all' ? matches : matches.filter((m) => m.follows.includes(followId));
}

// Times

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromMs, toMs) {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / DAY);
}

export const timeLabel = (ms) => TIME.format(ms);

// "Today", "Tomorrow", "Yesterday", "Sat" for the rest of the coming week, else "Sat, Oct 24".
export function dayLabel(ms, now, { long = false } = {}) {
  const days = daysBetween(at(now), ms);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return (long ? LONG_WEEKDAY : WEEKDAY).format(ms);
  return DATE.format(ms);
}

// The fewest words for a day, above a time in a list: "Today", "Tomorrow", "Sat"
// (within a week either way), else "Oct 24".
export function shortDay(ms, now) {
  const days = daysBetween(at(now), ms);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (Math.abs(days) < 7) return WEEKDAY.format(ms);
  return SHORT_DATE.format(ms);
}

// "Today 3:00 PM", "Sat 3:00 PM", "Sat, Oct 24 3:00 PM".
export function kickoffLabel(match, now) {
  return `${dayLabel(match.kickoff, now)} ${timeLabel(match.kickoff)}`;
}

// "Kickoff in 2h 15m" on the day, "Kickoff soon" once it's late to start.
export function countdown(match, now) {
  if (!isUpcoming(match)) return null;
  const left = match.kickoff - at(now);
  if (left <= 0) return 'Kickoff soon';
  if (left >= DAY) return null;
  const hours = Math.floor(left / HOUR);
  const minutes = Math.ceil((left % HOUR) / MINUTE);
  if (hours === 0) return `Kickoff in ${minutes} min`;
  if (minutes === 0 || minutes === 60) return `Kickoff in ${minutes ? hours + 1 : hours}h`;
  return `Kickoff in ${hours}h ${minutes}m`;
}

// Status

const FINISHED = {
  FT: 'Full time',
  AET: 'After extra time',
  'FT-Pens': 'After penalties',
  Pens: 'After penalties',
};

// In a few words: "63'", "Half-time", "Full time", "Postponed", or when it kicks off.
export function statusText(match, now) {
  if (isLive(match)) return isHalfTime(match) ? 'Half-time' : match.status.clock || match.status.detail || 'Live';
  if (isDone(match)) return FINISHED[match.status.detail] ?? (match.status.detail || 'Full time');
  return kickoffLabel(match, now);
}

// The shortest form, for a row in a list: "63'", "HT", "FT", "Pens", "PPD", "3:00 PM".
export function shortStatus(match) {
  if (isLive(match)) return isHalfTime(match) ? 'HT' : match.status.clock || 'Live';
  if (isDone(match)) {
    if (!match.status.completed) return /postpone/i.test(match.status.detail) ? 'PPD' : match.status.detail || 'Off';
    return match.status.detail === 'FT-Pens' ? 'Pens' : match.status.detail || 'FT';
  }
  return timeLabel(match.kickoff);
}

export function hasScore(match) {
  return match.home.score != null && match.away.score != null;
}

export function scoreText(match) {
  return hasScore(match) ? `${match.home.score} – ${match.away.score}` : 'vs';
}

export function shootoutText(match) {
  const { home, away } = match;
  return home.shootout != null && away.shootout != null ? `${home.shootout} – ${away.shootout} on penalties` : null;
}

// What a screen reader hears for a match.
export function describe(match, now) {
  const { home, away } = match;
  if (isUpcoming(match)) return `${home.name} versus ${away.name}, ${kickoffLabel(match, now)}, ${match.competition}`;
  const score = hasScore(match) ? `${home.name} ${home.score}, ${away.name} ${away.score}` : `${home.name} versus ${away.name}`;
  const pens = shootoutText(match);
  if (isLive(match)) return `Live, ${isHalfTime(match) ? 'half-time' : match.status.clock || 'in play'}: ${score}`;
  return `${statusText(match, now)}: ${score}${pens ? `, ${pens}` : ''}`;
}

// One line for the app library and the phone's home screen.
export function subtitle(state, now) {
  const featured = pickFeatured(state.matches, state.follows, now);
  if (!featured) return state.follows.length ? 'No matches coming up' : 'Not following anyone';
  const { match } = featured;
  const teams = `${match.home.short} ${hasScore(match) ? `${match.home.score}–${match.away.score} ` : 'v '}${match.away.short}`;
  if (isLive(match)) return `${teams} · ${shortStatus(match)}`;
  if (isDone(match)) return `${teams} · ${shortStatus(match)}`;
  return `${teams} · ${kickoffLabel(match, now)}`;
}

// Lists

// Matches grouped by the day they're on (this screen's time zone), in order.
export function byDay(matches) {
  const days = [];
  for (const match of matches) {
    const key = dayKey(match.kickoff);
    if (days.at(-1)?.key !== key) days.push({ key, kickoff: match.kickoff, matches: [] });
    days.at(-1).matches.push(match);
  }
  return days;
}

// The fixtures from now on (anything live or still to play) and the results so
// far (newest first), each grouped by day.
export function splitFixtures(matches, now) {
  const t = at(now);
  const coming = matches.filter((m) => isLive(m) || (isUpcoming(m) && m.kickoff >= t - MATCH_LENGTH_MS));
  const shown = new Set(coming.map((m) => m.id));
  const results = matches.filter((m) => !shown.has(m.id) && (isDone(m) || m.kickoff < t)).reverse();
  return { coming: byDay(coming), results: byDay(results) };
}

// Tables

// The table to show beside a match (its own, or its team's league for a cup tie),
// else the first followed team's.
export function tableFor(state, match) {
  const { tables, follows } = state;
  if (match?.table && tables[match.table]) return tables[match.table];
  const id = follows.map((follow) => follow.table).find((table) => table && tables[table]);
  return id ? tables[id] : null;
}

// Which rows (by index, in order) to show when only `size` fit: the followed
// teams, then the rows nearest them, else the top of the table.
export function tableWindow(rows, wanted, size) {
  const count = Math.max(0, Math.min(size, rows.length));
  const marked = rows.flatMap((row, i) => (row.team?.id && wanted.has(row.team.id) ? [i] : []));
  if (!marked.length) return [...Array(count).keys()];
  const picked = new Set(marked.slice(0, count));
  for (let distance = 1; picked.size < count; distance++) {
    for (const i of marked) {
      for (const j of [i - distance, i + distance]) {
        if (picked.size < count && j >= 0 && j < rows.length) picked.add(j);
      }
    }
  }
  return [...picked].sort((a, b) => a - b);
}

// "+5", "0", "-3".
export function signed(value) {
  if (value == null) return '–';
  return value > 0 ? `+${value}` : String(value);
}

// The match page

// The goals each side scored, one line per scorer: "Calafiori 62'", "Saka 12', 70' (pen)".
export function scorers(events, side) {
  const lines = new Map();
  for (const event of events) {
    if (!['goal', 'penalty', 'own-goal'].includes(event.type)) continue;
    // An own goal counts for the other side.
    const forSide = event.type === 'own-goal' ? (event.side === 'home' ? 'away' : 'home') : event.side;
    if (forSide !== side || !event.player) continue;
    const name = surname(event.player);
    const mark = event.type === 'penalty' ? ' (pen)' : event.type === 'own-goal' ? ' (OG)' : '';
    const key = `${name}${mark}`;
    if (!lines.has(key)) lines.set(key, { name, mark, minutes: [] });
    lines.get(key).minutes.push(event.minute);
  }
  return [...lines.values()].map(({ name, mark, minutes }) => `${name} ${minutes.join(', ')}${mark}`);
}

// "Bruno Guimarães" -> "Guimarães"; a single name stays whole.
export function surname(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
}

// How much of a stat's bar is the home side's (0 to 1).
export function statShare(stat) {
  const total = stat.home + stat.away;
  return total > 0 ? stat.home / total : 0.5;
}

export function statValue(stat, side) {
  return `${stat[side]}${stat.unit ?? ''}`;
}

// Which side leads a stat (fouls and cards are better low), or null for a tie.
const LOWER_IS_BETTER = new Set(['foulsCommitted', 'offsides', 'yellowCards', 'redCards']);
export function statLeader(stat) {
  if (stat.home === stat.away) return null;
  const homeAhead = stat.home > stat.away;
  return LOWER_IS_BETTER.has(stat.key) ? (homeAhead ? 'away' : 'home') : homeAhead ? 'home' : 'away';
}

// Black or white, whichever reads better on a team colour ("e20520"), for the
// shirt numbers on the pitch.
export function inkOn(hex) {
  if (!/^[0-9a-f]{6}$/i.test(hex ?? '')) return '#ffffff';
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const light = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // White's contrast against it, and black's; the better of the two.
  return 1.05 / (light + 0.05) >= (light + 0.05) / 0.05 ? '#ffffff' : '#111111';
}
