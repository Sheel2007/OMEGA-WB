// Sports: one match's page, laid out like a match centre. The score across the
// top with who scored, then tabs: the line-ups on a pitch (each side in its
// formation, with goals, assists, cards, substitutions and FotMob's ratings marked
// on the players, the bench and who's out underneath), the team stats side by
// side, the timeline, and Info (the referee's record, form, head-to-head, the best
// rated players and FotMob's insights). Tapping a rated player opens their stats.
// Before the line-ups are out, FotMob's predicted ones stand in for them.
//
// The page comes from the Pi (/api/sports/match), which keeps it fresh while the
// match is on. The live stream says when there's a newer one (the match's
// `detail` count, its score or its status moves), and only then is it fetched.
import { el, icons } from '../../ui.js';
import {
  countdown,
  describe,
  formText,
  hasScore,
  inkOn,
  isHalfTime,
  isLive,
  isUpcoming,
  kickoffLabel,
  minutesText,
  monthYear,
  outText,
  perMatchText,
  ratingBand,
  ratingText,
  scorers,
  shootoutText,
  statLeader,
  statShare,
  statusText,
  statValue,
  versusAverage,
} from './format.js';
import { crest, liveBadge, setCrest } from './views.js';

// A burst of updates (a goal, then its page) shouldn't fetch the page twice in a row.
const MIN_REFETCH_MS = 4000;
const TABS = [
  { id: 'lineups', label: 'Line-ups' },
  { id: 'stats', label: 'Stats' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'info', label: 'Info' },
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
  // The player whose stats are open: { fm, node, card, title, body, keys }.
  let sheet = null;

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
    const available = { lineups: true, stats: detail.stats.length > 0, timeline: true, info: Boolean(detail.fotmob) };
    if (!available[tab]) tab = 'lineups';
    for (const [id, button] of tabButtons) {
      button.hidden = !available[id];
      button.setAttribute('aria-pressed', String(id === tab));
    }
    if (tab === 'lineups') content.replaceChildren(hasLineups ? lineups(match) : noLineups(match, now));
    else if (tab === 'stats') content.replaceChildren(stats(match));
    else if (tab === 'info') content.replaceChildren(infoTab(match));
    else content.replaceChildren(timeline(match));
    fillSheet();
  }

  function fillScorers(list, lines) {
    list.replaceChildren(...lines.map((line) => el('li', { class: 'sports-score__scorer', text: line })));
    list.hidden = lines.length === 0;
  }

  // Line-ups

  function lineups(match) {
    const predicted = match.home.predicted || match.away.predicted;
    const missing = match.home.out?.length > 0 || match.away.out?.length > 0;
    return el(
      'div',
      { class: 'sports-lineups' },
      el(
        'div',
        { class: 'sports-lineups__head' },
        teamHead(match.home, 'home'),
        teamHead(match.away, 'away'),
      ),
      predicted &&
        el('p', {
          class: 'sports-lineups__note',
          text: 'Predicted line-ups from FotMob. The real ones come out about an hour before kickoff, and this page fills in by itself.',
        }),
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
      missing && el('div', { class: 'sports-bench sports-bench--out' }, out(match.home, 'home'), out(match.away, 'away')),
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
      el('span', { class: 'sports-player__label' }, el('span', { class: 'sports-player__name', text: player.name }), rating(player.rating, 'sports-player__rating')),
      openButton(player, 'sports-player__open'),
    );
  }

  function bench(team, side) {
    const rows = team.bench.map((player) =>
      el(
        'li',
        { class: `sports-bench__player${statsFor(player.fm) ? ' sports-bench__player--open' : ''}`, 'aria-label': playerLabel(player) },
        el('span', { class: 'sports-bench__number', text: player.number ?? '' }),
        el('span', { class: 'sports-bench__name', text: player.full }),
        rating(player.rating, 'sports-bench__rating'),
        player.goals > 0 && el('span', { class: 'sports-bench__icon', html: svg.ball }),
        (player.red || player.yellow) && card(player.red ? 'red' : 'yellow'),
        player.on && el('span', { class: 'sports-bench__on' }, el('span', { html: svg.on }), el('span', { text: player.on })),
        openButton(player, 'sports-bench__open'),
      ),
    );
    return el(
      'section',
      { class: `sports-bench__side sports-bench__side--${side}` },
      el('h3', { class: 'sports-bench__title', text: `${team.short} substitutes` }),
      rows.length ? el('ul', { class: 'sports-bench__list' }, ...rows) : el('p', { class: 'sports-bench__none', text: 'Not named yet' }),
      team.coach && el('p', { class: 'sports-bench__coach', text: `Manager: ${team.coach}` }),
    );
  }

  // Who's injured or suspended (FotMob).
  function out(team, side) {
    const players = team.out ?? [];
    return el(
      'section',
      { class: `sports-bench__side sports-bench__side--${side}` },
      el('h3', { class: 'sports-bench__title', text: `${team.short} out` }),
      players.length
        ? el(
            'ul',
            { class: 'sports-out__list' },
            ...players.map((player) =>
              el('li', { class: 'sports-out__player' }, el('span', { class: 'sports-out__name', text: player.name }), el('span', { class: 'sports-out__why', text: outText(player) })),
            ),
          )
        : el('p', { class: 'sports-bench__none', text: 'Nobody missing' }),
    );
  }

  // A rating in FotMob's colours; screen readers get it from the player's label.
  function rating(value, className) {
    if (typeof value !== 'number') return null;
    return el('span', { class: `sports-rating sports-rating--${ratingBand(value)} ${className}`, 'aria-hidden': 'true', text: ratingText(value) });
  }

  // Covers a player on the pitch or the bench: tapping them opens their stats.
  function openButton(player, className) {
    if (!statsFor(player.fm)) return null;
    return el('button', { class: className, type: 'button', 'aria-label': `${player.full}: match stats`, onclick: () => openPlayer(player.fm) });
  }

  function statsFor(fm) {
    return (fm && detail?.fotmob?.players?.[fm]) || null;
  }

  function noLineups(match, now) {
    const when = isUpcoming(match) ? kickoffLabel(match, now) : '';
    return message(
      'No line-ups yet',
      isUpcoming(match)
        ? `They usually come out about an hour before kickoff (${when}). This page fills in by itself.`
        : 'Neither ESPN nor FotMob published line-ups for this match.',
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

  // Info: the referee, form, head-to-head, the best rated and FotMob's insights.

  function infoTab(match) {
    const { referee, form, h2h, best, insights } = detail.fotmob;
    const meetings = h2h ? h2h.home + h2h.draws + h2h.away : 0;
    const cards = [
      referee && refereeCard(referee),
      (form.home.length > 0 || form.away.length > 0) && formCard(match, form),
      h2h && (meetings > 0 || h2h.meetings.length > 0) && h2hCard(match, h2h),
      (best.potm || best.top.home.length > 0 || best.top.away.length > 0) && bestCard(match, best),
      insights.length > 0 && infoCard('Did you know', el('ul', { class: 'sports-insights' }, ...insights.map((text) => el('li', { class: 'sports-insights__item', text })))),
    ].filter(Boolean);
    if (!cards.length) return message('Nothing more yet', 'FotMob hasn’t anything else on this match yet.');
    return el(
      'div',
      { class: 'sports-info' },
      el('div', { class: 'sports-info__grid' }, ...cards),
      el('p', { class: 'sports-info__source', text: 'Referee, form, ratings and insights from FotMob' }),
    );
  }

  function infoCard(title, ...children) {
    return el('section', { class: 'sports-info__card' }, el('h3', { class: 'sports-info__title', text: title }), ...children);
  }

  function refereeCard(referee) {
    const facts = [referee.country, referee.matches != null && `${referee.matches} ${referee.league ?? ''} matches`.replace('  ', ' ')].filter(Boolean).join(' · ');
    const totals = [
      referee.reds != null && ['Red cards', referee.reds],
      referee.penalties != null && ['Penalties given', referee.penalties],
    ].filter(Boolean);
    return infoCard(
      'Referee',
      el('p', { class: 'sports-ref__name', text: referee.name }),
      facts && el('p', { class: 'sports-ref__facts', text: facts }),
      referee.fouls && refereeStat('Fouls a match', referee.fouls),
      referee.yellows && refereeStat('Yellow cards a match', referee.yellows),
      totals.length > 0 &&
        el(
          'div',
          { class: 'sports-ref__totals' },
          ...totals.map(([label, value]) => el('p', { class: 'sports-ref__total' }, el('span', { class: 'sports-ref__count', text: value }), el('span', { text: label }))),
        ),
    );
  }

  function refereeStat(label, stat) {
    const compared = versusAverage(stat);
    return el(
      'div',
      { class: 'sports-ref__stat', role: 'group', 'aria-label': `${label}: ${perMatchText(stat.perMatch)}. ${compared}` },
      el('p', { class: 'sports-ref__row' }, el('span', { class: 'sports-ref__label', text: label }), el('span', { class: 'sports-ref__value', text: perMatchText(stat.perMatch) })),
      stat.fill != null &&
        el(
          'span',
          { class: 'sports-ref__bar', 'aria-hidden': 'true' },
          el('span', { class: 'sports-ref__fill', style: `transform: scaleX(${(stat.fill / 100).toFixed(3)})` }),
          stat.mark != null && el('span', { class: 'sports-ref__mark', style: `left: ${stat.mark}%` }),
        ),
      compared && el('p', { class: 'sports-ref__average', text: compared }),
    );
  }

  function formCard(match, form) {
    return infoCard(
      'Form',
      ...['home', 'away'].map((side) =>
        el(
          'div',
          { class: 'sports-form' },
          el('p', { class: 'sports-form__team' }, crest(match[side], 'sports-form__crest'), el('span', { text: match[side].short })),
          el(
            'ol',
            { class: 'sports-form__games', 'aria-label': `${match[side].short}’s last matches, oldest first` },
            ...form[side].map((game) =>
              el(
                'li',
                { class: 'sports-form__game', 'aria-label': formText(game) },
                el('span', { class: `sports-form__result sports-form__result--${game.result}`, text: game.result }),
                el('span', { class: 'sports-form__score', text: `${game.for}–${game.against}` }),
                el('span', { class: 'sports-form__opponent', text: game.opponent }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function h2hCard(match, h2h) {
    const count = (value, label, side) => el('p', { class: `sports-h2h__count sports-h2h__count--${side}` }, el('span', { class: 'sports-h2h__number', text: value }), el('span', { text: label }));
    return infoCard(
      'Head to head',
      el(
        'div',
        { class: 'sports-h2h__summary' },
        count(h2h.home, `${match.home.short} wins`, 'home'),
        count(h2h.draws, 'Draws', 'draw'),
        count(h2h.away, `${match.away.short} wins`, 'away'),
      ),
      h2h.home + h2h.draws + h2h.away > 0 &&
        el(
          'span',
          { class: 'sports-h2h__bar', 'aria-hidden': 'true' },
          ...[
            ['home', h2h.home],
            ['draw', h2h.draws],
            ['away', h2h.away],
          ].map(([side, value]) => value > 0 && el('span', { class: `sports-h2h__part sports-h2h__part--${side}`, style: `flex-grow: ${value}` })),
        ),
      h2h.meetings.length > 0 &&
        el(
          'ul',
          { class: 'sports-h2h__list', 'aria-label': 'Last meetings' },
          ...h2h.meetings.map((meeting) =>
            el(
              'li',
              { class: 'sports-h2h__meeting' },
              el('span', { class: 'sports-h2h__date', text: meeting.date ? monthYear(meeting.date) : '' }),
              el('span', { class: 'sports-h2h__teams', text: `${meeting.home} ${meeting.score[0]}–${meeting.score[1]} ${meeting.away}` }),
              meeting.competition && el('span', { class: 'sports-h2h__comp', text: meeting.competition }),
            ),
          ),
        ),
    );
  }

  function bestCard(match, best) {
    const row = (player) =>
      el(
        statsFor(player.fm) ? 'button' : 'div',
        {
          class: 'sports-best__player',
          type: statsFor(player.fm) ? 'button' : null,
          onclick: statsFor(player.fm) ? () => openPlayer(player.fm) : null,
        },
        rating(player.rating, 'sports-best__rating'),
        el('span', { class: 'sports-best__name', text: player.name }),
      );
    return infoCard(
      best.potm ? 'Best rated' : 'Best rated so far',
      best.potm &&
        el(
          'div',
          { class: 'sports-best__potm' },
          el('span', { class: 'sports-best__award', text: 'Player of the match' }),
          row(best.potm),
        ),
      el(
        'div',
        { class: 'sports-best' },
        ...['home', 'away'].map((side) =>
          el(
            'div',
            { class: 'sports-best__side' },
            el('h4', { class: 'sports-best__team', text: match[side].short }),
            el('ul', { class: 'sports-best__list' }, ...best.top[side].map((player) => el('li', {}, row(player)))),
          ),
        ),
      ),
    );
  }

  // A player's stats: a sheet over the page, closed by Done, Escape or a tap outside.
  // It stays open (and up to date) as the page refreshes.

  function openPlayer(fm) {
    closeSheet();
    const keys = new AbortController();
    const title = el('h2', { class: 'sports-sheet__title' });
    const body = el('div', { class: 'sports-sheet__body' });
    const card = el(
      'div',
      { class: 'sports-sheet__card', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
      el(
        'header',
        { class: 'sports-sheet__head' },
        el('span', { class: 'sports-sheet__spacer' }),
        title,
        el('button', { class: 'sports-sheet__done', type: 'button', text: 'Done', onclick: closeSheet }),
      ),
      body,
    );
    const sheetNode = el(
      'div',
      { class: 'sports-sheet' },
      el('button', { class: 'sports-sheet__scrim', type: 'button', tabindex: '-1', 'aria-label': 'Close', onclick: closeSheet }),
      card,
    );
    node.append(sheetNode);
    addEventListener('keydown', (event) => event.key === 'Escape' && closeSheet(), { signal: keys.signal });
    sheet = { fm, node: sheetNode, card, title, body, keys };
    fillSheet();
    card.focus({ preventScroll: true });
  }

  function fillSheet() {
    if (!sheet) return;
    const player = statsFor(sheet.fm);
    if (!player) {
      closeSheet();
      return;
    }
    const team = player.side ? current()[player.side] : null;
    const potm = detail.fotmob.best.potm?.fm === sheet.fm;
    sheet.title.textContent = player.name;
    sheet.card.setAttribute('aria-label', `${player.name}: match stats`);
    sheet.body.replaceChildren(
      el(
        'div',
        { class: 'sports-sheet__summary' },
        el('span', {
          class: 'sports-player__shirt sports-sheet__shirt',
          style: team?.color ? `--shirt: #${team.color}; --ink: ${inkOn(team.color)}` : null,
          text: player.number ?? '',
        }),
        el(
          'div',
          { class: 'sports-sheet__who' },
          el('p', { class: 'sports-sheet__team', text: [team?.name, player.keeper ? 'Goalkeeper' : null].filter(Boolean).join(' · ') }),
          el('p', { class: 'sports-sheet__minutes', text: [minutesText(player.minutes), potm ? 'Player of the match' : null].filter(Boolean).join(' · ') }),
        ),
        typeof player.rating === 'number' &&
          el('span', {
            class: `sports-rating sports-rating--${ratingBand(player.rating)} sports-sheet__rating`,
            'aria-label': `Rated ${ratingText(player.rating)}`,
            text: ratingText(player.rating),
          }),
      ),
      ...player.groups.map((group) =>
        el(
          'section',
          { class: 'sports-sheet__group' },
          el('h3', { class: 'sports-sheet__group-title', text: group.title }),
          el(
            'dl',
            { class: 'sports-sheet__stats' },
            ...group.stats.map((stat) => el('div', { class: 'sports-sheet__stat' }, el('dt', { text: stat.label }), el('dd', { text: stat.value }))),
          ),
        ),
      ),
    );
  }

  function closeSheet() {
    if (!sheet) return;
    const { keys, node: sheetNode } = sheet;
    sheet = null;
    keys.abort();
    sheetNode.remove();
  }

  // Helpers

  function playerLabel(player) {
    const parts = [`${player.number ? `${player.number} ` : ''}${player.full}`];
    if (typeof player.rating === 'number') parts.push(`rated ${ratingText(player.rating)}`);
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
      closeSheet();
    },
  };
}
