// Sports: one match's page, laid out like a match centre. The score across the
// top with who scored, then three tabs: the line-ups on a pitch (each side in its
// formation, with goals, assists, cards and substitutions marked on the players,
// and the bench underneath), the team stats side by side, and the timeline.
//
// The page comes from the Pi (/api/sports/match), which keeps it fresh while the
// match is on. The live stream says when there's a newer one (the match's
// `detail` count, its score or its status moves), and only then is it fetched.
import { el, icons } from '../../ui.js';
import {
  countdown,
  describe,
  hasScore,
  inkOn,
  isHalfTime,
  isLive,
  isUpcoming,
  kickoffLabel,
  scorers,
  shootoutText,
  statLeader,
  statShare,
  statusText,
  statValue,
} from './format.js';
import { crest, liveBadge, setCrest } from './views.js';

// A burst of updates (a goal, then its page) shouldn't fetch the page twice in a row.
const MIN_REFETCH_MS = 4000;
const TABS = [
  { id: 'lineups', label: 'Line-ups' },
  { id: 'stats', label: 'Stats' },
  { id: 'timeline', label: 'Timeline' },
];

const svg = {
  ball:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#fff" stroke="#111" stroke-width="1.6"/><path d="M12 7.6l4.2 3-1.6 4.9H9.4l-1.6-4.9z" fill="#111"/><path d="M12 7.6V2.5M16.2 10.6l4.6-1.5M14.6 15.5l2.9 4M9.4 15.5l-2.9 4M7.8 10.6L3.2 9.1" stroke="#111" stroke-width="1.4"/></svg>',
  boot:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff"/><path d="M5 15.5l1.2-6.8h4l.6 2.2c2.6.4 5.4 1.3 7.6 2.6.9.5 1 1.6.4 2.2H5z" fill="#111"/><path d="M5.6 17.8h13" stroke="#111" stroke-width="1.6" stroke-linecap="round"/></svg>',
  off:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#e5483a"/><path d="M16.5 12H8M11.5 8L7.5 12l4 4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  on:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1f9d55"/><path d="M7.5 12H16M12.5 8l4 4-4 4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function card(color) {
  return el('span', { class: `sports-booking sports-booking--${color}`, 'aria-hidden': 'true' });
}

export function createMatchPage({ sports, matchId, onBack }) {
  let detail = null;
  let summary = null;
  let tab = 'lineups';
  let shownKey;
  let loading = false;
  let wanted = false;
  let lastFetch = 0;
  let retryTimer = null;
  let destroyed = false;

  // Header: back, the competition and how the match stands

  const comp = el('p', { class: 'sports-page__comp' });
  const back = el('button', { class: 'sports-page__back', type: 'button', onclick: onBack, html: `${icons.chevronLeft}<span>All matches</span>` });

  const homeCrest = crest(null, 'sports-score__crest');
  const awayCrest = crest(null, 'sports-score__crest');
  const homeName = el('h2', { class: 'sports-score__name' });
  const awayName = el('h2', { class: 'sports-score__name' });
  const homeGoals = el('ul', { class: 'sports-score__scorers', 'aria-label': 'Goals' });
  const awayGoals = el('ul', { class: 'sports-score__scorers', 'aria-label': 'Goals' });
  const scoreNumbers = el('p', { class: 'sports-score__numbers' });
  const scoreStatus = el('p', { class: 'sports-score__status' });
  const scoreLive = liveBadge();
  const scoreExtra = el('p', { class: 'sports-score__extra' });
  const info = el('p', { class: 'sports-score__info' });
  const scoreboard = el(
    'section',
    { class: 'sports-score', 'aria-live': 'polite' },
    el('div', { class: 'sports-score__team sports-score__team--home' }, homeCrest, homeName, homeGoals),
    el('div', { class: 'sports-score__middle' }, scoreLive, scoreNumbers, scoreStatus, scoreExtra, info),
    el('div', { class: 'sports-score__team sports-score__team--away' }, awayCrest, awayName, awayGoals),
  );

  // Tabs

  const tabButtons = new Map(
    TABS.map(({ id, label }) => [
      id,
      el('button', {
        class: 'sports-tabs__tab',
        type: 'button',
        text: label,
        'aria-pressed': 'false',
        onclick: () => {
          tab = id;
          paint();
        },
      }),
    ]),
  );
  const tabs = el('div', { class: 'sports-tabs', role: 'group', 'aria-label': 'Show' }, ...tabButtons.values());
  const content = el('div', { class: 'sports-page__content' });

  const node = el(
    'div',
    { class: 'sports-page' },
    el('header', { class: 'sports-page__bar' }, back, comp, tabs),
    scoreboard,
    content,
  );

  // Fetching

  async function load() {
    wanted = false;
    if (loading) {
      wanted = true;
      return;
    }
    const wait = lastFetch + MIN_REFETCH_MS - Date.now();
    if (wait > 0) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(load, wait);
      return;
    }
    loading = true;
    lastFetch = Date.now();
    try {
      const found = await sports.match(matchId);
      if (destroyed) return;
      detail = found;
      paint();
    } catch (err) {
      if (destroyed) return;
      if (!detail) {
        content.replaceChildren(message('Couldn’t load this match', `${err.message} It’ll try again when there’s news.`));
      }
    } finally {
      loading = false;
      if (wanted && !destroyed) load();
    }
  }

  // Painting

  function current() {
    // The live stream's score and status are the newest; the page has the rest.
    if (!detail) return summary;
    if (!summary) return detail;
    return {
      ...detail,
      status: summary.status,
      home: { ...detail.home, score: summary.home.score, shootout: summary.home.shootout, winner: summary.home.winner },
      away: { ...detail.away, score: summary.away.score, shootout: summary.away.shootout, winner: summary.away.winner },
    };
  }

  function paint() {
    const match = current();
    if (!match) return;
    const now = new Date();
    comp.textContent = match.competition;
    setCrest(homeCrest, match.home);
    setCrest(awayCrest, match.away);
    homeName.textContent = match.home.name;
    awayName.textContent = match.away.name;
    const events = detail?.events ?? [];
    fillScorers(homeGoals, scorers(events, 'home'));
    fillScorers(awayGoals, scorers(events, 'away'));
    const live = isLive(match);
    scoreLive.hidden = !live;
    scoreLive.lastChild.textContent = live ? (isHalfTime(match) ? 'Half-time' : match.status.clock || 'Live') : '';
    scoreNumbers.textContent = hasScore(match) ? `${match.home.score} – ${match.away.score}` : kickoffLabel(match, now);
    scoreNumbers.classList.toggle('sports-score__numbers--time', !hasScore(match));
    scoreStatus.textContent = live ? '' : hasScore(match) ? statusText(match, now) : countdown(match, now) ?? '';
    scoreStatus.hidden = !scoreStatus.textContent;
    scoreExtra.textContent = shootoutText(match) ?? match.note ?? '';
    scoreExtra.hidden = !scoreExtra.textContent;
    scoreboard.setAttribute('aria-label', describe(match, now));
    const facts = [match.venue, detail?.referee && `Referee ${detail.referee}`, detail?.attendance && `${detail.attendance.toLocaleString('en-US')} watching`];
    info.textContent = facts.filter(Boolean).join(' · ');
    info.hidden = !info.textContent;

    if (!detail) {
      content.replaceChildren(message('Loading the match…', ''));
      return;
    }
    const hasLineups = detail.home.lines.length > 0 || detail.away.lines.length > 0;
    const available = { lineups: true, stats: detail.stats.length > 0, timeline: true };
    if (!available[tab]) tab = 'lineups';
    for (const [id, button] of tabButtons) {
      button.hidden = !available[id];
      button.setAttribute('aria-pressed', String(id === tab));
    }
    if (tab === 'lineups') content.replaceChildren(hasLineups ? lineups(match) : noLineups(match, now));
    else if (tab === 'stats') content.replaceChildren(stats(match));
    else content.replaceChildren(timeline(match));
  }

  function fillScorers(list, lines) {
    list.replaceChildren(...lines.map((line) => el('li', { class: 'sports-score__scorer', text: line })));
    list.hidden = lines.length === 0;
  }

  // Line-ups

  function lineups(match) {
    return el(
      'div',
      { class: 'sports-lineups' },
      el(
        'div',
        { class: 'sports-lineups__head' },
        teamHead(match.home, 'home'),
        teamHead(match.away, 'away'),
      ),
      el(
        'div',
        { class: 'sports-pitch' },
        el('span', { class: 'sports-pitch__markings', 'aria-hidden': 'true' }),
        half(match.home, 'home'),
        half(match.away, 'away'),
      ),
      el(
        'div',
        { class: 'sports-bench' },
        bench(match.home, 'home'),
        bench(match.away, 'away'),
      ),
    );
  }

  function teamHead(team, side) {
    return el(
      'div',
      { class: `sports-lineups__team sports-lineups__team--${side}` },
      crest(team, 'sports-lineups__crest'),
      el('span', { class: 'sports-lineups__name', text: team.name }),
      team.formation && el('span', { class: 'sports-lineups__formation', text: team.formation }),
    );
  }

  function half(team, side) {
    return el(
      'div',
      { class: `sports-pitch__half sports-pitch__half--${side}`, role: 'list', 'aria-label': `${team.name} line-up` },
      ...team.lines.map((line) => el('div', { class: 'sports-pitch__line' }, ...line.map((player) => playerNode(player, team)))),
    );
  }

  function playerNode(player, team) {
    const shirt = el('span', {
      class: 'sports-player__shirt',
      style: team.color ? `--shirt: #${team.color}; --ink: ${inkOn(team.color)}` : null,
      text: player.number ?? '',
    });
    if (player.goals > 0 || player.ownGoals > 0) {
      const goals = el('span', { class: 'sports-player__badge sports-player__badge--goal', html: svg.ball });
      const count = player.goals + player.ownGoals;
      if (count > 1) goals.append(el('span', { class: 'sports-player__count', text: count }));
      if (player.ownGoals > 0) goals.classList.add('sports-player__badge--own');
      shirt.append(goals);
    }
    if (player.assists > 0) shirt.append(el('span', { class: 'sports-player__badge sports-player__badge--assist', html: svg.boot }));
    if (player.red || player.yellow) {
      shirt.append(el('span', { class: 'sports-player__badge sports-player__badge--card' }, card(player.red ? 'red' : 'yellow')));
    }
    const off = player.off && el('span', { class: 'sports-player__off' }, el('span', { class: 'sports-player__minute', text: player.off }), el('span', { html: svg.off }));
    return el(
      'div',
      { class: 'sports-player', role: 'listitem', 'aria-label': playerLabel(player) },
      off,
      shirt,
      el('span', { class: 'sports-player__name', text: player.name }),
    );
  }

  function bench(team, side) {
    const rows = team.bench.map((player) =>
      el(
        'li',
        { class: 'sports-bench__player', 'aria-label': playerLabel(player) },
        el('span', { class: 'sports-bench__number', text: player.number ?? '' }),
        el('span', { class: 'sports-bench__name', text: player.full }),
        player.goals > 0 && el('span', { class: 'sports-bench__icon', html: svg.ball }),
        (player.red || player.yellow) && card(player.red ? 'red' : 'yellow'),
        player.on && el('span', { class: 'sports-bench__on' }, el('span', { html: svg.on }), el('span', { text: player.on })),
      ),
    );
    return el(
      'section',
      { class: `sports-bench__side sports-bench__side--${side}` },
      el('h3', { class: 'sports-bench__title', text: `${team.short} substitutes` }),
      rows.length ? el('ul', { class: 'sports-bench__list' }, ...rows) : el('p', { class: 'sports-bench__none', text: 'Not named yet' }),
    );
  }

  function noLineups(match, now) {
    const when = isUpcoming(match) ? kickoffLabel(match, now) : '';
    return message(
      'No line-ups yet',
      isUpcoming(match)
        ? `They usually come out about an hour before kickoff (${when}). This page fills in by itself.`
        : 'ESPN didn’t publish line-ups for this match.',
    );
  }

  // Stats

  function stats(match) {
    const [possession, ...rest] = detail.stats[0]?.key === 'possessionPct' ? detail.stats : [null, ...detail.stats];
    return el(
      'div',
      { class: 'sports-stats' },
      el(
        'div',
        { class: 'sports-stats__teams' },
        el('span', { class: 'sports-stats__team sports-stats__team--home' }, crest(match.home, 'sports-stats__crest'), match.home.short),
        el('span', { class: 'sports-stats__team sports-stats__team--away' }, match.away.short, crest(match.away, 'sports-stats__crest')),
      ),
      possession &&
        el(
          'div',
          { class: 'sports-possession' },
          el('p', { class: 'sports-possession__label', text: 'Possession' }),
          el(
            'div',
            { class: 'sports-possession__bar', role: 'img', 'aria-label': `Possession: ${match.home.short} ${possession.home}%, ${match.away.short} ${possession.away}%` },
            el('span', { class: 'sports-possession__home', style: `flex-grow: ${Math.max(possession.home, 1)}`, text: `${possession.home}%` }),
            el('span', { class: 'sports-possession__away', style: `flex-grow: ${Math.max(possession.away, 1)}`, text: `${possession.away}%` }),
          ),
        ),
      el('ul', { class: 'sports-stats__list' }, ...rest.map((stat) => statRow(stat, match))),
    );
  }

  function statRow(stat, match) {
    const leader = statLeader(stat);
    const share = statShare(stat);
    return el(
      'li',
      { class: 'sports-stat', 'aria-label': `${stat.label}: ${match.home.short} ${statValue(stat, 'home')}, ${match.away.short} ${statValue(stat, 'away')}` },
      el(
        'div',
        { class: 'sports-stat__values' },
        el('span', { class: `sports-stat__value sports-stat__value--home${leader === 'home' ? ' sports-stat__value--ahead' : ''}`, text: statValue(stat, 'home') }),
        el('span', { class: 'sports-stat__label', text: stat.label }),
        el('span', { class: `sports-stat__value sports-stat__value--away${leader === 'away' ? ' sports-stat__value--ahead' : ''}`, text: statValue(stat, 'away') }),
      ),
      el(
        'div',
        { class: 'sports-stat__bars', 'aria-hidden': 'true' },
        el('span', { class: 'sports-stat__bar sports-stat__bar--home' }, el('span', { style: `transform: scaleX(${share.toFixed(3)})` })),
        el('span', { class: 'sports-stat__bar sports-stat__bar--away' }, el('span', { style: `transform: scaleX(${(1 - share).toFixed(3)})` })),
      ),
    );
  }

  // Timeline: newest first, home on the left and away on the right.

  function timeline(match) {
    const events = [...detail.events].reverse();
    if (!events.length) {
      return message(isUpcoming(match) ? 'Not kicked off yet' : 'Nothing yet', 'Goals, cards and substitutions show up here as they happen.');
    }
    return el('ol', { class: 'sports-timeline' }, ...events.map((event) => timelineRow(event, match)));
  }

  function timelineRow(event, match) {
    if (event.type === 'break') {
      return el(
        'li',
        { class: 'sports-timeline__break' },
        el('span', { text: `${event.label === 'HT' ? 'Half-time' : event.label === 'AET' ? 'After extra time' : 'Full time'} ${event.score.join(' – ')}` }),
      );
    }
    const side = el('div', { class: 'sports-timeline__event' }, ...eventContent(event, match));
    return el(
      'li',
      { class: `sports-timeline__row sports-timeline__row--${event.side}` },
      event.side === 'home' ? side : el('span'),
      el('span', { class: 'sports-timeline__minute', text: event.minute }),
      event.side === 'away' ? side : el('span'),
    );
  }

  function eventContent(event, match) {
    const team = event.side === 'home' ? match.home : match.away;
    const main = (text) => el('span', { class: 'sports-timeline__main', text });
    const sub = (text) => text && el('span', { class: 'sports-timeline__sub', text });
    if (event.type === 'goal' || event.type === 'penalty' || event.type === 'own-goal') {
      const what = event.type === 'penalty' ? 'Penalty' : event.type === 'own-goal' ? 'Own goal' : event.assist ? `Assist: ${event.assist}` : null;
      return [
        el('span', { class: 'sports-timeline__icon', html: svg.ball }),
        el('span', { class: 'sports-timeline__text' }, main(`${event.player ?? team.short} ${event.score.join(' – ')}`), sub(what)),
      ];
    }
    if (event.type === 'yellow' || event.type === 'red') {
      return [
        el('span', { class: 'sports-timeline__icon' }, card(event.type)),
        el('span', { class: 'sports-timeline__text' }, main(event.player ?? team.short), sub(event.type === 'red' ? 'Red card' : 'Yellow card')),
      ];
    }
    if (event.type === 'sub') {
      return [
        el('span', { class: 'sports-timeline__icon sports-timeline__icon--sub', html: svg.on }),
        el('span', { class: 'sports-timeline__text' }, main(event.player ?? 'Substitution'), sub(event.out && `Off: ${event.out}`)),
      ];
    }
    return [
      el('span', { class: 'sports-timeline__icon', html: svg.off }),
      el('span', { class: 'sports-timeline__text' }, main(event.player ?? team.short), sub('Missed penalty')),
    ];
  }

  // Helpers

  function playerLabel(player) {
    const parts = [`${player.number ? `${player.number} ` : ''}${player.full}`];
    if (player.goals) parts.push(player.goals === 1 ? 'scored' : `scored ${player.goals}`);
    if (player.ownGoals) parts.push('own goal');
    if (player.assists) parts.push(player.assists === 1 ? 'an assist' : `${player.assists} assists`);
    if (player.red) parts.push('sent off');
    else if (player.yellow) parts.push('booked');
    if (player.on) parts.push(`on at ${player.on}`);
    if (player.off) parts.push(`off at ${player.off}`);
    return parts.join(', ');
  }

  function message(title, text) {
    return el(
      'div',
      { class: 'empty-state sports-page__message' },
      el('p', { class: 'empty-state__title', text: title }),
      text && el('p', { class: 'empty-state__text', text }),
    );
  }

  // What, in the live stream, means the page is out of date.
  const keyOf = (match) => (match ? JSON.stringify([match.detail, match.status, match.home.score, match.away.score]) : null);

  return {
    node,
    // The live stream's latest state.
    update(state) {
      const match = state.matches.find((m) => m.id === matchId) ?? null;
      summary = match;
      const key = keyOf(match);
      if (key === shownKey) return;
      shownKey = key;
      if (match) load();
      if (match || detail) paint();
      else content.replaceChildren(message('This match isn’t on the board', 'It may be too long ago, or too far ahead, for the board to keep.'));
    },
    // Labels that change with the time ("Kickoff in 20 min").
    tick() {
      if (current() && isUpcoming(current())) paint();
    },
    destroy() {
      destroyed = true;
      clearTimeout(retryTimer);
    },
  };
}
