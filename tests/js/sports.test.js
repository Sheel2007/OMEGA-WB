import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  byDay,
  countdown,
  dayLabel,
  describe,
  followedTeamIds,
  inkOn,
  kickoffLabel,
  liveTeamMatch,
  matchesFor,
  pickFeatured,
  scorers,
  shortDay,
  shortStatus,
  splitFixtures,
  statLeader,
  statShare,
  statusText,
  subtitle,
  tableFor,
  tableWindow,
  widgetList,
} from '../../web/js/apps/sports/format.js';

// Local times, so the day labels read the same in any time zone the tests run in.
const local = (month, day, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
const NOW = new Date(local(10, 13, 12));

const FOLLOWS = [
  { id: 'arsenal', name: 'Arsenal', kind: 'team', team: '359', table: 'eng.1' },
  { id: 'tottenham', name: 'Tottenham', kind: 'team', team: '367', table: 'eng.1' },
  { id: 'ucl', name: 'Champions League', kind: 'competition', team: null, table: 'uefa.champions' },
];

const STATUS = {
  pre: { state: 'pre', name: 'STATUS_SCHEDULED', detail: 'Scheduled', clock: null, completed: false },
  live: { state: 'in', name: 'STATUS_SECOND_HALF', detail: '2nd Half', clock: "63'", completed: false },
  ht: { state: 'in', name: 'STATUS_HALFTIME', detail: 'HT', clock: "45'", completed: false },
  ft: { state: 'post', name: 'STATUS_FULL_TIME', detail: 'FT', clock: null, completed: true },
  pens: { state: 'post', name: 'STATUS_FINAL_PEN', detail: 'FT-Pens', clock: null, completed: true },
  ppd: { state: 'post', name: 'STATUS_POSTPONED', detail: 'Postponed', clock: null, completed: false },
};

function side(id, name, score = null, extra = {}) {
  return { id, name, short: name, abbr: name.slice(0, 3).toUpperCase(), crest: `soccer:${id}`, color: null, score, shootout: null, winner: false, ...extra };
}

function match(id, kickoff, { status = 'pre', follows = ['arsenal'], home = side('359', 'Arsenal'), away = side('166', 'Lille'), table = 'uefa.champions' } = {}) {
  return { id, league: 'uefa.champions', competition: 'Champions League', table, kickoff, status: STATUS[status], home, away, note: null, venue: 'Emirates Stadium', follows, detail: 0 };
}

const scored = (h, a, extra = {}) => ({ home: side('359', 'Arsenal', h, extra.home), away: side('166', 'Lille', a, extra.away) });

test('the widget shows a followed team playing now before anything else', () => {
  const matches = [
    match('ucl-live', local(10, 13, 11), { status: 'live', follows: ['ucl'], ...scored(0, 0) }),
    match('ours-live', local(10, 13, 11, 30), { status: 'live', ...scored(1, 0) }),
    match('next', local(10, 14, 20)),
  ];
  assert.deepEqual(pickFeatured(matches, FOLLOWS, NOW), { why: 'live', match: matches[1] });
  // No team match on: any followed match playing.
  assert.equal(pickFeatured([matches[0], matches[2]], FOLLOWS, NOW).match.id, 'ucl-live');
});

test("then a team's result from the last few hours, then its next match", () => {
  const result = match('result', local(10, 13, 9), { status: 'ft', ...scored(2, 1) });
  const next = match('next', local(10, 18, 15));
  assert.equal(pickFeatured([result, next], FOLLOWS, NOW).why, 'result');
  // Long enough after: the next match takes over.
  const later = new Date(local(10, 13, 17));
  assert.deepEqual(pickFeatured([result, next], FOLLOWS, later), { why: 'next', match: next });
  // Nothing coming up at all: the latest result.
  assert.deepEqual(pickFeatured([result], FOLLOWS, later), { why: 'result', match: result });
  assert.equal(pickFeatured([], FOLLOWS, NOW), null);
});

test('under it: the rest of what is on, what is next for the teams, then their results', () => {
  const matches = [
    match('old', local(10, 1, 15), { status: 'ft', ...scored(1, 1) }),
    match('older', local(9, 20, 15), { status: 'ft', ...scored(0, 2) }),
    match('ucl-live', local(10, 13, 11), { status: 'live', follows: ['ucl'] }),
    match('featured', local(10, 13, 11, 30), { status: 'live' }),
    match('ucl-later', local(10, 14, 20), { follows: ['ucl'] }),
    match('next', local(10, 18, 15)),
  ];
  matches.sort((a, b) => a.kickoff - b.kickoff);
  assert.deepEqual(widgetList(matches, FOLLOWS, NOW, 'featured').map((m) => m.id), ['ucl-live', 'next', 'old', 'older']);
});

test('the app opens on a followed team playing now', () => {
  const live = match('ours', local(10, 13, 11), { status: 'live' });
  assert.equal(liveTeamMatch([match('ucl', local(10, 13, 11), { status: 'live', follows: ['ucl'] }), live], FOLLOWS), live);
  assert.equal(liveTeamMatch([match('ucl', local(10, 13, 11), { status: 'live', follows: ['ucl'] })], FOLLOWS), null);
});

test('days and kickoff times read like a person would say them', () => {
  assert.equal(dayLabel(local(10, 13, 20), NOW), 'Today');
  assert.equal(dayLabel(local(10, 14, 1), NOW), 'Tomorrow');
  assert.equal(dayLabel(local(10, 12, 23), NOW), 'Yesterday');
  assert.equal(dayLabel(local(10, 17), NOW), 'Sat');
  assert.equal(dayLabel(local(10, 17), NOW, { long: true }), 'Saturday');
  assert.equal(dayLabel(local(10, 24), NOW), 'Sat, Oct 24');
  assert.equal(kickoffLabel(match('x', local(10, 13, 15)), NOW), 'Today 3:00 PM');
});

test('a countdown on the day, and nothing further out', () => {
  assert.equal(countdown(match('x', local(10, 13, 12, 40)), NOW), 'Kickoff in 40 min');
  assert.equal(countdown(match('x', local(10, 13, 14, 15)), NOW), 'Kickoff in 2h 15m');
  assert.equal(countdown(match('x', local(10, 13, 13)), NOW), 'Kickoff in 1h');
  assert.equal(countdown(match('x', local(10, 13, 11, 55)), NOW), 'Kickoff soon', 'late to start');
  assert.equal(countdown(match('x', local(10, 15, 12)), NOW), null);
  assert.equal(countdown(match('x', local(10, 13, 10), { status: 'live' }), NOW), null);
});

test('status, short and long', () => {
  const at = (status, extra) => match('x', local(10, 13, 15), { status, ...extra });
  assert.equal(statusText(at('live'), NOW), "63'");
  assert.equal(statusText(at('ht'), NOW), 'Half-time');
  assert.equal(statusText(at('ft'), NOW), 'Full time');
  assert.equal(statusText(at('pens'), NOW), 'After penalties');
  assert.equal(statusText(at('pre'), NOW), 'Today 3:00 PM');
  assert.equal(shortStatus(at('live')), "63'");
  assert.equal(shortStatus(at('ht')), 'HT');
  assert.equal(shortStatus(at('ft')), 'FT');
  assert.equal(shortStatus(at('pens')), 'Pens');
  assert.equal(shortStatus(at('ppd')), 'PPD');
  assert.equal(shortStatus(at('pre')), '3:00 PM');
});

test('what a screen reader hears, and the app library line', () => {
  const live = match('x', local(10, 13, 11), { status: 'live', ...scored(1, 0) });
  assert.equal(describe(live, NOW), "Live, 63': Arsenal 1, Lille 0");
  const pens = match('x', local(10, 13, 9), { status: 'pens', home: side('359', 'Arsenal', 1, { shootout: 4 }), away: side('166', 'Lille', 1, { shootout: 3 }) });
  assert.equal(describe(pens, NOW), 'After penalties: Arsenal 1, Lille 1, 4 – 3 on penalties');
  assert.equal(describe(match('x', local(10, 13, 15)), NOW), 'Arsenal versus Lille, Today 3:00 PM, Champions League');
  assert.equal(subtitle({ follows: FOLLOWS, matches: [live] }, NOW), "Arsenal 1–0 Lille · 63'");
  assert.equal(subtitle({ follows: FOLLOWS, matches: [match('x', local(10, 14, 20))] }, NOW), 'Arsenal v Lille · Tomorrow 8:00 PM');
  assert.equal(subtitle({ follows: FOLLOWS, matches: [] }, NOW), 'No matches coming up');
});

test('fixtures and results split around now, grouped by day', () => {
  const matches = [
    match('a', local(10, 10, 15), { status: 'ft' }),
    match('b', local(10, 12, 20), { status: 'ft' }),
    match('c', local(10, 13, 11), { status: 'live' }),
    match('d', local(10, 13, 20)),
    match('e', local(10, 14, 20), { follows: ['tottenham'] }),
  ];
  const { coming, results } = splitFixtures(matches, NOW);
  assert.deepEqual(coming.map((day) => day.matches.map((m) => m.id)), [['c', 'd'], ['e']]);
  assert.deepEqual(results.map((day) => day.matches.map((m) => m.id)), [['b'], ['a']], 'newest first');
  assert.deepEqual(matchesFor(matches, 'tottenham').map((m) => m.id), ['e']);
  assert.equal(matchesFor(matches, 'all'), matches);
  assert.equal(byDay([]).length, 0);
});

test("a table window keeps the followed teams and fills in round them", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, team: { id: String(i + 1) } }));
  // Arsenal 2nd, Spurs 14th, 8 rows: as many round each of them.
  assert.deepEqual(tableWindow(rows, new Set(['2', '14']), 8), [0, 1, 2, 3, 11, 12, 13, 14]);
  assert.deepEqual(tableWindow(rows, new Set(['20']), 3), [17, 18, 19]);
  assert.deepEqual(tableWindow(rows, new Set(['nobody']), 3), [0, 1, 2], 'else the top');
  assert.deepEqual(tableWindow(rows.slice(0, 2), new Set(['1']), 5), [0, 1], 'never more rows than there are');
});

test('the table beside a match is its own, else the first followed team’s', () => {
  const tables = { 'eng.1': { id: 'eng.1' }, 'uefa.champions': { id: 'uefa.champions' } };
  const state = { tables, follows: FOLLOWS };
  assert.equal(tableFor(state, match('x', 0)).id, 'uefa.champions');
  assert.equal(tableFor(state, match('x', 0, { table: null })).id, 'eng.1');
  assert.equal(tableFor(state, null).id, 'eng.1');
  assert.equal(tableFor({ tables: {}, follows: FOLLOWS }, null), null);
  assert.deepEqual([...followedTeamIds(FOLLOWS)], ['359', '367']);
});

test('who scored, one line each, own goals for the other side', () => {
  const events = [
    { type: 'goal', side: 'home', player: 'Bukayo Saka', minute: "12'" },
    { type: 'yellow', side: 'away', player: 'Someone', minute: "30'" },
    { type: 'penalty', side: 'home', player: 'Bukayo Saka', minute: "70'" },
    { type: 'goal', side: 'home', player: 'Bukayo Saka', minute: "80'" },
    { type: 'own-goal', side: 'away', player: 'Jaka Bijol', minute: "88'" },
  ];
  assert.deepEqual(scorers(events, 'home'), ["Saka 12', 80'", "Saka 70' (pen)", "Bijol 88' (OG)"]);
  assert.deepEqual(scorers(events, 'away'), []);
});

test('stat bars, leaders, and shirt numbers that read on the shirt', () => {
  assert.equal(statShare({ home: 3, away: 1 }), 0.75);
  assert.equal(statShare({ home: 0, away: 0 }), 0.5);
  assert.equal(statLeader({ key: 'totalShots', home: 13, away: 11 }), 'home');
  assert.equal(statLeader({ key: 'foulsCommitted', home: 12, away: 20 }), 'home', 'fewer fouls is better');
  assert.equal(statLeader({ key: 'saves', home: 4, away: 4 }), null);
  assert.equal(inkOn('ffffff'), '#111111');
  assert.equal(inkOn('132257'), '#ffffff');
  assert.equal(inkOn('e20520'), '#ffffff');
  assert.equal(inkOn('f4c534'), '#111111');
  assert.equal(inkOn(null), '#ffffff');
});

test('a list row says the day in as few words as it can', () => {
  assert.equal(shortDay(local(10, 13, 20), NOW), 'Today');
  assert.equal(shortDay(local(10, 16, 19), NOW), 'Fri');
  assert.equal(shortDay(local(10, 10, 11), NOW), 'Sat', 'last weekend too');
  assert.equal(shortDay(local(10, 24, 15), NOW), 'Oct 24');
});
