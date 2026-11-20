// Words, times and choices for the Sports widget, app and match page. Pure, so
// it's tested in node.
//
// A match is the server's shape (board/sports.py): { id, sport: soccer|basketball,
// league, competition, table, kickoff (ms), status: { state: pre|in|post, name,
// detail, clock, completed }, home, away (each { id, name, short, abbr, crest,
// color, score, shootout, winner, and in basketball rank }), note, venue,
// follows: [follow ids], detail }. A basketball game is a match too: its clock
// reads "2:12 2nd", it tips off instead of kicking off, and it ends "Final".

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
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });

const at = (now) => (typeof now === 'number' ? now : now.getTime());

export const isLive = (match) => match.status.state === 'in';
export const isDone = (match) => match.status.state === 'post';
export const isUpcoming = (match) => match.status.state === 'pre';
export const isHalfTime = (match) => match.status.name === 'STATUS_HALFTIME';
const isFinal = (match) => isDone(match) && match.status.completed;
export const isBasketball = (match) => match?.sport === 'basketball';
// What the start is called, and what it is to start.
const startWord = (match) => (isBasketball(match) ? 'Tip-off' : 'Kickoff');
// Under a countdown that ticks: "to kickoff", then "kicking off" once it's due.
export const startCaption = (match, due) => (isBasketball(match) ? (due ? 'tipping off' : 'to tip-off') : due ? 'kicking off' : 'to kickoff');
// How a finished match is announced.
export const finishedWord = (match) => (isBasketball(match) ? 'Final' : 'Full time');
// A team in the top 25 goes by its place: "#6 Virginia".
export const teamTitle = (team) => (team.rank ? `#${team.rank} ${team.name}` : team.name);

// The follows that are teams (not whole competitions), by follow id.
function teamFollows(follows) {
  return new Set(follows.filter((follow) => follow.kind === 'team').map((follow) => follow.id));
}

// The ESPN team ids of the teams the board follows, for picking them out of tables.
// ESPN's numbers repeat from sport to sport, so a table asks for its own sport's.
export function followedTeamIds(follows, sport = null) {
  const teams = follows.filter((follow) => follow.kind === 'team' && follow.team && (!sport || (follow.sport ?? 'soccer') === sport));
  return new Set(teams.map((follow) => follow.team));
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
// A later match kicking off within this long doesn't wait for that: its countdown
// takes over at the final whistle.
const NEXT_SOON_MS = HOUR;

// The matches for the game-day strip under the clock, in kickoff order: followed
// teams playing now (with any that kicked off alongside them and have finished),
// then what's just finished, then the next kickoff today, then today's last
// results for a few hours after. Matches kicking off together come as one. Empty
// when no followed team plays today.
export function gameDayMatches(matches, follows, now) {
  const t = at(now);
  const teams = teamFollows(follows);
  const today = dayKey(t);
  const ours = matches.filter((m) => isTeamMatch(m, teams));
  const ended = (m) => t - (m.kickoff + MATCH_LENGTH_MS);
  const finished = ours.filter((m) => isFinal(m) && m.kickoff <= t && ended(m) <= RESULT_SHOWN_MS);
  const waiting = ours.filter((m) => isUpcoming(m) && dayKey(m.kickoff) === today && m.kickoff >= t - MATCH_LENGTH_MS);
  // Past its kickoff but not live yet: ESPN just hasn't said so.
  const playing = ours.filter((m) => isLive(m) || (waiting.includes(m) && m.kickoff <= t));
  if (playing.length) {
    return ours.filter((m) => playing.includes(m) || (finished.includes(m) && playing.some((p) => p.kickoff === m.kickoff)));
  }
  const kickingOffWith = (list, match) => list.filter((m) => m.kickoff === match?.kickoff);
  const next = waiting[0];
  const fresh = finished.filter((m) => ended(m) <= RESULT_HELD_MS);
  if (fresh.length && !(next && next.kickoff - t <= NEXT_SOON_MS)) return kickingOffWith(fresh, fresh.at(-1));
  return next ? kickingOffWith(waiting, next) : kickingOffWith(finished, finished.at(-1));
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

// "Kickoff in 2h 15m" on the day, "Kickoff soon" once it's late to start
// ("Tip-off" for basketball).
export function countdown(match, now) {
  if (!isUpcoming(match)) return null;
  const start = startWord(match);
  const left = match.kickoff - at(now);
  if (left <= 0) return `${start} soon`;
  if (left >= DAY) return null;
  const hours = Math.floor(left / HOUR);
  const minutes = Math.ceil((left % HOUR) / MINUTE);
  if (hours === 0) return `${start} in ${minutes} min`;
  if (minutes === 0 || minutes === 60) return `${start} in ${minutes ? hours + 1 : hours}h`;
  return `${start} in ${hours}h ${minutes}m`;
}

// Status

const FINISHED = {
  FT: 'Full time',
  AET: 'After extra time',
  'FT-Pens': 'After penalties',
  Pens: 'After penalties',
};

// In a few words: "63'", "Half-time", "Full time", "Postponed", or when it kicks
// off. Basketball: "2:12 2nd", "Half-time", "Final", "Final/OT".
export function statusText(match, now) {
  if (isLive(match)) return isHalfTime(match) ? 'Half-time' : match.status.clock || match.status.detail || 'Live';
  if (isDone(match)) return FINISHED[match.status.detail] ?? (match.status.detail || finishedWord(match));
  return kickoffLabel(match, now);
}

// The shortest form, for a row in a list: "63'", "HT", "FT", "Pens", "PPD", "3:00 PM".
// Basketball: "2:12 2nd", "HT", "Final", "F/OT".
export function shortStatus(match) {
  if (isLive(match)) return isHalfTime(match) ? 'HT' : match.status.clock || 'Live';
  if (isDone(match)) {
    if (!match.status.completed) return /postpone/i.test(match.status.detail) ? 'PPD' : match.status.detail || 'Off';
    if (isBasketball(match)) return (match.status.detail || 'Final').replace(/^Final\//, 'F/');
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

// A table comes in three kinds: a league's (played, won, drawn, lost, goal
// difference, points), college soccer's from the Big Ten's own page (no goal
// difference, an overall record instead), and a basketball conference's (the
// conference record, then the overall record and the streak).

// The app's columns, as [label, kind], and a row's cells under the ones after the team.
export function tableColumns(table) {
  if (table.kind === 'basketball') return [['#', 'rank'], ['Team', 'team'], ['Conf', 'points'], ['Overall', 'num'], ['Streak', 'num wide']];
  if (table.kind === 'college') return [['#', 'rank'], ['Team', 'team'], ['GP', 'num'], ['W', 'num'], ['L', 'num'], ['T', 'num'], ['Pts', 'points'], ['Overall', 'num wide']];
  return [['#', 'rank'], ['Team', 'team'], ['P', 'num'], ['W', 'num wide'], ['D', 'num wide'], ['L', 'num wide'], ['GD', 'num'], ['Pts', 'points']];
}

export function tableCells(table, row) {
  if (table.kind === 'basketball') return [`${row.won}-${row.lost}`, row.overall, row.streak];
  if (table.kind === 'college') return [row.played, row.won, row.lost, row.drawn, row.points, row.overall ?? ''];
  return [row.played, row.won, row.drawn, row.lost, signed(row.diff), row.points];
}

// The Sports page's short table has room for three numbers after the team: a
// quiet one, another quiet one, and the one that counts.
export function shortTableCells(table, row) {
  if (table.kind === 'basketball') return ['', row.overall ?? '', `${row.won}-${row.lost}`];
  return [row.played ?? '', row.diff != null ? signed(row.diff) : `${row.won}-${row.lost}-${row.drawn}`, row.points ?? ''];
}

// What a screen reader hears for a row of it.
export function tableRowLabel(table, row) {
  if (table.kind !== 'basketball') return `${row.rank}. ${row.team.name}, ${row.points} points`;
  return `${row.rank}. ${row.team.name}, ${row.won}-${row.lost} in the conference${row.overall ? `, ${row.overall} overall` : ''}`;
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

// "58%", "13"; a shooting stat has what was made too: "24-57 (42%)".
export function statValue(stat, side) {
  const value = `${stat[side]}${stat.unit ?? ''}`;
  const made = stat[`${side}Text`];
  return made ? `${made} (${value})` : value;
}

// Which side leads a stat (fouls, cards and turnovers are better low), or null for a tie.
const LOWER_IS_BETTER = new Set([
  'foulsCommitted',
  'offsides',
  'yellowCards',
  'redCards',
  'bigChancesMissed',
  'fouls',
  'totalTurnovers',
  'avgTotalTurnovers',
  'avgPointsAgainst',
]);
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

// A basketball game's page: the score by period and the box score.

// What each period is called: "1st", "2nd", then "OT", "2OT". The men play two
// halves and the women four quarters (`regulation`).
export function periodLabels(count, regulation = 2) {
  const ordinals = ['1st', '2nd', '3rd', '4th'];
  return Array.from({ length: count }, (_, i) => {
    if (i < regulation) return ordinals[i] ?? `${i + 1}`;
    const extra = i - regulation + 1;
    return extra === 1 ? 'OT' : `${extra}OT`;
  });
}

// The box score's columns: [the player's field, the heading, what it stands for].
// `extra` ones are left out where there's no room (a phone).
export const BOX_COLUMNS = [
  { key: 'min', label: 'MIN', name: 'Minutes', extra: true },
  { key: 'pts', label: 'PTS', name: 'Points' },
  { key: 'reb', label: 'REB', name: 'Rebounds' },
  { key: 'ast', label: 'AST', name: 'Assists' },
  { key: 'fg', label: 'FG', name: 'Field goals' },
  { key: 'tp', label: '3PT', name: 'Three-pointers', extra: true },
  { key: 'ft', label: 'FT', name: 'Free throws', extra: true },
];

export const boxValue = (line, key) => line?.[key] ?? '–';

// A team's box score as the starters and the bench.
export function boxGroups(box) {
  const players = box?.players ?? [];
  return { starters: players.filter((p) => p.starter), bench: players.filter((p) => !p.starter) };
}

// Who has scored most, for under the team's name: "P. Payne 20".
export function topScorers(box, count = 3) {
  return [...(box?.players ?? [])]
    .filter((player) => player.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, count)
    .map((player) => `${player.name} ${player.pts}`);
}

// What a screen reader hears for a player's line.
export function boxLineLabel(player) {
  const parts = [`${player.number ? `${player.number} ` : ''}${player.full}`];
  if (player.pts != null) parts.push(player.pts === 1 ? '1 point' : `${player.pts} points`);
  if (player.reb != null) parts.push(player.reb === 1 ? '1 rebound' : `${player.reb} rebounds`);
  if (player.ast != null) parts.push(player.ast === 1 ? '1 assist' : `${player.ast} assists`);
  if (player.min != null) parts.push(player.min === 1 ? '1 minute' : `${player.min} minutes`);
  return parts.join(', ');
}

// FotMob's extras on the match page (board/fotmob.py): ratings, the referee, form.

// How a rating is coloured, the way FotMob does: 9 and up, 7 and up, 6 and up, below 6.
export function ratingBand(rating) {
  if (typeof rating !== 'number') return null;
  return rating >= 9 ? 'top' : rating >= 7 ? 'good' : rating >= 6 ? 'ok' : 'poor';
}

export const ratingText = (rating) => rating.toFixed(1);

// A referee's number a match: "20.3", "4.15".
export const perMatchText = (value) => value.toFixed(value >= 10 ? 1 : 2);

// "Below the league average of 21.2".
export function versusAverage(stat) {
  if (stat.average == null) return '';
  const diff = stat.perMatch - stat.average;
  const word = Math.abs(diff) < 0.05 ? 'Level with' : diff > 0 ? 'Above' : 'Below';
  return `${word} the league average of ${perMatchText(stat.average)}`;
}

// One of a team's last results: "Won 2–1 at home to Chelsea".
export function formText(game) {
  const word = { W: 'Won', D: 'Drew', L: 'Lost' }[game.result];
  return `${word} ${game.for}–${game.against} ${game.home ? 'at home to' : 'away at'} ${game.opponent}`;
}

// Why a player is missing: "Injured · Doubtful".
const OUT_REASONS = { injury: 'Injured', suspension: 'Suspended', suspended: 'Suspended', international: 'Away with their country' };
export function outText(player) {
  const reason = player.reason ? (OUT_REASONS[player.reason.toLowerCase()] ?? `${player.reason[0].toUpperCase()}${player.reason.slice(1)}`) : 'Out';
  return [reason, player.back].filter(Boolean).join(' · ');
}

export const monthYear = (ms) => MONTH_YEAR.format(ms);

export function minutesText(minutes) {
  if (minutes == null) return '';
  return minutes === 1 ? '1 minute played' : `${minutes} minutes played`;
}
