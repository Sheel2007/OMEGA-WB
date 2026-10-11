// Sports: the page before page 1 (side-page.js slides it in when you swipe right
// on the first home page). The match that matters most right now (a followed team
// playing, else its latest result or next match) big on the left with what's
// coming up under it, the followed teams' results in the middle, and a table on
// the right with the followed teams picked out. Tap any match for its match
// page; "All matches" opens the Sports app.
//
// The server pushes new scores; the page's only timer is a one-minute tick for
// labels that change with the time ("Kickoff in 20 min", "Tomorrow").
import { el, fitRows, icons, reconcile } from '../../ui.js';
import {
  comingList,
  countdown,
  dayLabel,
  describe,
  followedTeamIds,
  hasScore,
  isDone,
  isHalfTime,
  isLive,
  pickFeatured,
  resultsList,
  shootoutText,
  signed,
  statusText,
  tableFor,
  tableWindow,
  timeLabel,
} from './format.js';
import { id as appId, name } from './meta.js';
import { createMatchRow, crest, liveBadge, setCrest, updateMatchRow } from './views.js';

const TICK_MS = 60 * 1000;
// Rows kept in each list's DOM; fitRows() shows as many as fit.
const MAX_LISTED = 12;

export function createSportsPage({ services, openApp }) {
  const { sports } = services;
  const headline = el('p', { class: 'sports-today__meta' });

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
  const empty = el(
    'div',
    { class: 'sports-today__empty' },
    el('p', { class: 'sports-today__empty-title', text: 'No matches yet' }),
    el('p', { class: 'sports-today__empty-text', text: 'Fixtures show up once the board has read them.' }),
  );

  // The lists and the table
  const coming = list('Coming up');
  const results = list('Results');
  const tableTitle = el('h2', { class: 'sports-card__title' });
  const tablePicker = el('div', { class: 'sports-tabs sports-tabs--small', role: 'group', 'aria-label': 'Table' });
  const tableRows = el('ol', { class: 'sports-mini-table', 'aria-label': 'Table' });
  const tableCard = el(
    'section',
    { class: 'sports-card sports-card--table' },
    el('header', { class: 'sports-card__head' }, tableTitle, tablePicker),
    tableRows,
  );

  const node = el(
    'div',
    { class: 'sports-today' },
    el(
      'header',
      { class: 'sports-today__header' },
      el('div', { class: 'sports-today__heading' }, el('h1', { class: 'sports-today__title', text: name }), headline),
      el('button', {
        class: 'sports-today__all',
        type: 'button',
        html: `<span>All matches and tables</span>${icons.chevronRight}`,
        onclick: (event) => openApp(appId, { origin: event.currentTarget }),
      }),
    ),
    el(
      'div',
      { class: 'sports-today__grid' },
      el('section', { class: 'sports-card sports-card--feature', 'aria-label': 'Featured match' }, feature, empty),
      coming.card,
      results.card,
      tableCard,
    ),
  );

  let state = sports.getState();
  let shown = null;
  let chosenTable = null;
  let logged = null;

  function list(title) {
    const rows = el('ul', { class: 'sports-card__list', 'aria-label': title });
    const more = el('p', { class: 'sports-card__more' });
    const none = el('p', { class: 'sports-card__none', text: title === 'Results' ? 'No results yet.' : 'Nothing coming up.' });
    const card = el(
      'section',
      { class: `sports-card sports-card--${title === 'Results' ? 'results' : 'coming'}` },
      el('h2', { class: 'sports-card__title', text: title }),
      rows,
      more,
      none,
    );
    return { card, rows, more, none, total: 0 };
  }

  function openMatch(id, origin) {
    openApp(appId, { origin, intent: `match-${id}` });
  }

  function headlineText(featured, now) {
    if (!featured) return state.follows.length ? 'Live scores from ESPN' : 'Sports is turned off in config.json';
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
    homeName.textContent = match.home.name;
    awayName.textContent = match.away.name;
    const scored = hasScore(match);
    feature.classList.toggle('sports-feature--upcoming', !scored);
    homeName.classList.toggle('sports-feature__name--lost', Boolean(match.away.winner));
    awayName.classList.toggle('sports-feature__name--lost', Boolean(match.home.winner));
    score.textContent = scored ? `${match.home.score} – ${match.away.score}` : timeLabel(match.kickoff);
    clock.textContent = scored ? statusText(match, now) : dayLabel(match.kickoff, now);
    clock.hidden = isLive(match);
    foot.textContent = countdown(match, now) ?? shootoutText(match) ?? match.note ?? match.venue ?? '';
    foot.hidden = !foot.textContent;
    feature.setAttribute('aria-label', `${describe(match, now)}. Open the match.`);
  }

  function renderList(target, matches, now) {
    const rows = matches.slice(0, MAX_LISTED);
    target.total = matches.length;
    reconcile(target.rows, rows, (m) => m.id, () => createMatchRow(openMatch, { day: true }), (row, m) => updateMatchRow(row, m, now));
    target.none.hidden = matches.length > 0;
    target.rows.hidden = matches.length === 0;
  }

  const fit = (target) => fitRows(target.rows, target.more, target.total, (hidden) => `${hidden} more in ${name}`);

  // `again`: measure once more after the first row exists (the first pass has nothing to measure).
  function renderTable(again = true) {
    const ids = Object.keys(state.tables);
    const table = (chosenTable && state.tables[chosenTable]) || tableFor(state, shown);
    tableCard.hidden = !table;
    if (!table) return;
    tableTitle.textContent = table.name;
    reconcile(
      tablePicker,
      ids.map((id) => state.tables[id]),
      (t) => t.id,
      (t) =>
        el('button', {
          class: 'sports-tabs__tab',
          type: 'button',
          onclick: () => {
            chosenTable = t.id;
            renderTable();
          },
        }),
      (button, t) => {
        button.textContent = t.name;
        button.setAttribute('aria-pressed', String(t.id === table.id));
      },
    );
    // With more than one table, the tabs name the one showing.
    tablePicker.hidden = ids.length < 2;
    tableTitle.hidden = !tablePicker.hidden;
    const rows = table.groups[0]?.rows ?? [];
    const wanted = followedTeamIds(state.follows);
    // As many rows as the card holds.
    const rowHeight = tableRows.firstElementChild?.offsetHeight || 0;
    const fits = rowHeight ? Math.max(1, Math.floor((tableRows.clientHeight + 1) / rowHeight)) : 8;
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
          el('span', { class: 'sports-mini-table__num sports-mini-table__played' }),
          el('span', { class: 'sports-mini-table__num sports-mini-table__diff' }),
          el('span', { class: 'sports-mini-table__num sports-mini-table__points' }),
        ),
      (li, row) => {
        const [rank, badge, teamName, played, diff, points] = li.children;
        li.className = `sports-mini-table__row${wanted.has(row.team.id) ? ' sports-mini-table__row--ours' : ''}${row.zone ? ` sports-zone sports-zone--${row.zone.level}` : ''}`;
        rank.textContent = row.rank;
        setCrest(badge, row.team);
        teamName.textContent = row.team.name;
        played.textContent = row.played ?? '';
        diff.textContent = row.diff != null ? signed(row.diff) : `${row.won}-${row.lost}-${row.drawn}`;
        points.textContent = row.points ?? '';
        li.setAttribute('aria-label', `${row.rank}. ${row.team.name}, ${row.points} points`);
      },
    );
    if (again && !rowHeight && tableRows.firstElementChild?.offsetHeight) renderTable(false);
  }

  function render(next = state) {
    state = next;
    const now = new Date();
    if (state.error && state.error !== logged) console.warn(`Sports: ${state.error}`);
    logged = state.error;
    const featured = pickFeatured(state.matches, state.follows, now);
    shown = featured?.match ?? null;
    headline.textContent = headlineText(featured, now);
    feature.hidden = !shown;
    empty.hidden = Boolean(shown) || state.version < 0;
    if (shown) renderFeature(shown, now);
    renderList(coming, comingList(state.matches, state.follows, now, shown?.id), now);
    renderList(results, resultsList(state.matches, state.follows, shown?.id), now);
    fit(coming);
    fit(results);
    renderTable();
  }

  const unsubscribe = sports.subscribe(render);
  // The page is hidden until it slides in, so it's measured again once it has a size.
  const resizes = new ResizeObserver(() => {
    fit(coming);
    fit(results);
    renderTable();
  });
  resizes.observe(coming.rows);
  resizes.observe(results.rows);
  resizes.observe(tableRows);
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
