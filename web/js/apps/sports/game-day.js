// Sports: the game-day strip under the clock on page 1. On a day a followed team
// plays, it shows the two teams with a countdown to kickoff that ticks down to the
// second, then the score and the minute all through the match, then the result
// for a while after. Matches on at the same time share the card, a row each, and a
// later match's countdown takes over when the last one ends. Any other day it
// isn't there. Tap a match for its page.
//
// The score comes over the live stream. The strip's own timer ticks once a second
// only while it's counting down; otherwise once a minute, to notice the day's
// matches coming or going.
import { el } from '../../ui.js';
import {
  countdownClock,
  describe,
  gameDayMatches,
  hasScore,
  isDone,
  isHalfTime,
  isLive,
  isUpcoming,
  shortStatus,
  statusText,
  timeLabel,
} from './format.js';
import { id as appId } from './meta.js';
import { crest, liveBadge, setCrest } from './views.js';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * 1000;
// As many rows as fit under the clock without reaching the widgets below it.
const MAX_ROWS = 3;

function createRow(openApp) {
  const label = el('span', { class: 'game-day__label' });
  const live = liveBadge();
  const homeCrest = crest(null, 'game-day__crest');
  const awayCrest = crest(null, 'game-day__crest');
  const homeName = el('span', { class: 'game-day__name' });
  const awayName = el('span', { class: 'game-day__name' });
  const middle = el('span', { class: 'game-day__middle' });
  const caption = el('span', { class: 'game-day__caption' });
  let match = null;
  const node = el(
    'button',
    { class: 'game-day__match', type: 'button', onclick: () => openApp(appId, { origin: node, intent: `match-${match.id}` }) },
    el('span', { class: 'game-day__top' }, live, label),
    el(
      'span',
      { class: 'game-day__teams' },
      el('span', { class: 'game-day__team game-day__team--home' }, homeName, homeCrest),
      el('span', { class: 'game-day__score' }, middle, caption),
      el('span', { class: 'game-day__team game-day__team--away' }, awayCrest, awayName),
    ),
  );

  function paint(next, now, shared) {
    match = next;
    const counting = isUpcoming(match);
    node.classList.toggle('game-day__match--counting', counting);
    live.hidden = !isLive(match);
    live.lastChild.textContent = isLive(match) ? (isHalfTime(match) ? 'HT' : match.status.clock || 'Live') : '';
    if (shared) label.textContent = isDone(match) ? shortStatus(match) : '';
    else label.textContent = counting ? `${match.competition} · ${timeLabel(match.kickoff)}` : match.competition;
    setCrest(homeCrest, match.home);
    setCrest(awayCrest, match.away);
    homeName.textContent = match.home.abbr;
    awayName.textContent = match.away.abbr;
    if (counting) {
      middle.textContent = countdownClock(match, now);
      caption.textContent = match.kickoff > now.getTime() ? 'to kickoff' : 'kicking off';
    } else {
      middle.textContent = hasScore(match) ? `${match.home.score} – ${match.away.score}` : 'vs';
      caption.textContent = isLive(match) ? '' : shortStatus(match) === 'FT' ? 'Full time' : statusText(match, now);
    }
    caption.hidden = !caption.textContent;
    node.setAttribute('aria-label', `Game day. ${describe(match, now)}. Open the match.`);
  }

  return { node, paint };
}

export function createGameDay({ services, openApp }) {
  const { sports } = services;
  const rows = Array.from({ length: MAX_ROWS }, () => createRow(openApp));
  const node = el('div', { class: 'game-day' }, ...rows.map((row) => row.node));
  node.hidden = true;

  let state = sports.getState();
  let matches = [];
  let timer = null;

  function paint() {
    const now = new Date();
    matches = gameDayMatches(state.matches, state.follows, now).slice(0, MAX_ROWS);
    node.hidden = !matches.length;
    if (!matches.length) return;
    const shared = matches.length > 1;
    node.classList.toggle('game-day--shared', shared);
    rows.forEach((row, index) => {
      row.node.hidden = index >= matches.length;
      if (matches[index]) row.paint(matches[index], now, shared);
    });
  }

  // Once a second while counting down (lined up with the clock's seconds), else once a minute.
  function tick() {
    clearTimeout(timer);
    paint();
    timer = setTimeout(tick, matches.some(isUpcoming) ? SECOND_MS - (Date.now() % SECOND_MS) : MINUTE_MS);
  }

  const unsubscribe = sports.subscribe((next) => {
    state = next;
    tick();
  });

  return {
    node,
    destroy() {
      unsubscribe();
      clearTimeout(timer);
      timer = null;
    },
  };
}
