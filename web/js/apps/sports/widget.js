// Sports: the home-screen widget. The match that matters most right now (a
// followed team playing, else its latest result or next match) with both crests
// and the score or kickoff time. Medium adds what's coming up, and large adds the
// table that match is in, around the followed teams. Tapping the match opens its
// match page; anywhere else opens the Sports app.
//
// The server pushes new scores; the widget's only timer is a one-minute tick for
// labels that change with the time ("Kickoff in 20 min", "Tomorrow").
import { appIcon, el, fitRows, reconcile } from '../../ui.js';
import {
  countdown,
  dayLabel,
  describe,
  followedTeamIds,
  hasScore,
  isDone,
  isHalfTime,
  isLive,
  pickFeatured,
  shootoutText,
  signed,
  statusText,
  tableFor,
  tableWindow,
  timeLabel,
  widgetList,
} from './format.js';
import * as meta from './meta.js';
import { createMatchRow, crest, liveBadge, setCrest, updateMatchRow } from './views.js';

const TICK_MS = 60 * 1000;

export function createWidget({ services, openApp }) {
  const { sports } = services;
  const status = el('p', { class: 'widget-head__meta' });

  // The featured match
  const featureComp = el('span', { class: 'sports-feature__comp' });
  const featureLive = liveBadge();
  const homeCrest = crest(null, 'sports-feature__crest');
  const awayCrest = crest(null, 'sports-feature__crest');
  const homeName = el('span', { class: 'sports-feature__name' });
  const awayName = el('span', { class: 'sports-feature__name' });
  const score = el('span', { class: 'sports-feature__score' });
  const clock = el('span', { class: 'sports-feature__status' });
  const foot = el('p', { class: 'sports-feature__foot' });
  const feature = el(
    'button',
    { class: 'sports-feature', type: 'button', onclick: () => shown && openMatch(shown.id, feature) },
    el('span', { class: 'sports-feature__top' }, featureComp, featureLive),
    el(
      'span',
      { class: 'sports-feature__teams' },
      el('span', { class: 'sports-feature__team' }, homeCrest, homeName),
      el('span', { class: 'sports-feature__middle' }, score, clock),
      el('span', { class: 'sports-feature__team' }, awayCrest, awayName),
    ),
    foot,
  );

  // What's next, and the table
  const list = el('ul', { class: 'sports-widget__list', 'aria-label': 'More matches' });
  const more = el('p', { class: 'sports-widget__more' });
  const tableTitle = el('h3', { class: 'sports-widget__table-title' });
  const tableRows = el('ol', { class: 'sports-mini-table', 'aria-label': 'Table' });
  const table = el('section', { class: 'sports-widget__table' }, tableTitle, tableRows);
  const empty = el(
    'div',
    { class: 'sports-widget__empty' },
    el('p', { class: 'sports-widget__empty-title', text: 'No matches yet' }),
    el('p', { class: 'sports-widget__empty-text', text: 'Fixtures show up once the board has read them.' }),
  );

  const node = el(
    'article',
    { class: 'sports-widget', 'aria-label': meta.name },
    el('a', {
      class: 'widget__link',
      href: `#/app/${meta.id}`,
      'aria-label': `Open ${meta.name}`,
      onclick: (event) => {
        event.preventDefault();
        openApp(meta.id, { origin: node });
      },
    }),
    el(
      'header',
      { class: 'widget-head' },
      appIcon(meta, 'widget-head__icon'),
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), status),
    ),
    feature,
    list,
    more,
    table,
    empty,
  );

  let state = sports.getState();
  let shown = null;
  let listTotal = 0;
  let logged = null;

  function openMatch(id, origin) {
    openApp(meta.id, { origin, intent: `match-${id}` });
  }

  function headline(featured, now) {
    if (!featured) return '';
    const { match, why } = featured;
    if (why === 'live') return 'Live now';
    if (why === 'result') return isDone(match) ? `${dayLabel(match.kickoff, now)} · Full time` : 'Latest';
    const day = dayLabel(match.kickoff, now);
    return day === 'Today' ? 'Game day' : `Next match ${day}`;
  }

  function renderFeature(match, now) {
    featureComp.textContent = match.competition;
    featureLive.hidden = !isLive(match);
    featureLive.lastChild.textContent = isLive(match) ? (isHalfTime(match) ? 'HT' : match.status.clock || 'Live') : '';
    setCrest(homeCrest, match.home);
    setCrest(awayCrest, match.away);
    homeName.textContent = match.home.short;
    awayName.textContent = match.away.short;
    const scored = hasScore(match);
    feature.classList.toggle('sports-feature--upcoming', !scored);
    feature.classList.toggle('sports-feature--live', isLive(match));
    homeName.classList.toggle('sports-feature__name--lost', Boolean(match.away.winner));
    awayName.classList.toggle('sports-feature__name--lost', Boolean(match.home.winner));
    score.textContent = scored ? `${match.home.score} – ${match.away.score}` : timeLabel(match.kickoff);
    clock.textContent = scored ? (isLive(match) ? 'Live' : statusText(match, now)) : dayLabel(match.kickoff, now);
    clock.hidden = isLive(match);
    foot.textContent = countdown(match, now) ?? shootoutText(match) ?? match.note ?? match.venue ?? '';
    foot.hidden = !foot.textContent;
    feature.setAttribute('aria-label', `${describe(match, now)}. Open the match.`);
  }

  // `again`: measure once more after the first row exists (the first pass has nothing to measure).
  function renderTable(again = true) {
    const found = tableFor(state, shown);
    table.hidden = !found || node.dataset.size !== 'large';
    if (!found || table.hidden) return;
    tableTitle.textContent = found.name;
    const rows = found.groups[0]?.rows ?? [];
    const wanted = followedTeamIds(state.follows);
    // As many rows as the space under the title holds.
    const rowHeight = tableRows.firstElementChild?.offsetHeight || 0;
    const fits = rowHeight ? Math.max(1, Math.floor((tableRows.clientHeight + 1) / rowHeight)) : 6;
    const picked = tableWindow(rows, wanted, fits).map((i) => rows[i]);
    reconcile(
      tableRows,
      picked,
      (row) => `${row.rank}:${row.team.name}`,
      () =>
        el(
          'li',
          { class: 'sports-mini-table__row' },
          el('span', { class: 'sports-mini-table__rank' }),
          crest(null, 'sports-mini-table__crest'),
          el('span', { class: 'sports-mini-table__name' }),
          el('span', { class: 'sports-mini-table__num sports-mini-table__diff' }),
          el('span', { class: 'sports-mini-table__num sports-mini-table__points' }),
        ),
      (li, row) => {
        const [rank, badge, name, diff, points] = li.children;
        li.classList.toggle('sports-mini-table__row--ours', wanted.has(row.team.id));
        rank.textContent = row.rank;
        setCrest(badge, row.team);
        name.textContent = row.team.short;
        diff.textContent = row.diff != null ? signed(row.diff) : `${row.won}-${row.lost}-${row.drawn}`;
        points.textContent = row.points ?? '';
        li.setAttribute('aria-label', `${row.rank}. ${row.team.name}, ${row.points} points`);
      },
    );
    if (again && !rowHeight && tableRows.firstElementChild?.offsetHeight) renderTable(false);
  }

  const fit = () => fitRows(list, more, listTotal, (hidden) => `${hidden} more in ${meta.name}`);

  function render(next = state) {
    state = next;
    const now = new Date();
    if (state.error && state.error !== logged) console.warn(`Sports: ${state.error}`);
    logged = state.error;
    const featured = pickFeatured(state.matches, state.follows, now);
    shown = featured?.match ?? null;
    status.textContent = headline(featured, now);
    feature.hidden = !shown;
    empty.hidden = Boolean(shown) || state.version < 0;
    if (shown) renderFeature(shown, now);

    const rest = shown ? widgetList(state.matches, state.follows, now, shown.id).slice(0, 12) : [];
    listTotal = rest.length;
    reconcile(list, rest, (m) => m.id, () => createMatchRow(openMatch, { day: true }), (row, m) => updateMatchRow(row, m, now));
    list.hidden = rest.length === 0;
    fit();
    renderTable();
  }

  const unsubscribe = sports.subscribe(render);
  const resizes = new ResizeObserver(() => {
    fit();
    renderTable();
  });
  resizes.observe(list);
  resizes.observe(node);
  const ticker = setInterval(() => render(), TICK_MS);

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      clearInterval(ticker);
    },
  };
}
