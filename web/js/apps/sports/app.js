// Sports: the full-screen app. Matches (what's coming up on the left, results on
// the right, for everyone followed or just one of them) and Tables (each
// competition's table with the followed teams picked out). Tapping a match opens
// its match page (#/app/sports/match-<id>). While a followed team is playing, the
// app opens straight onto that match: on game day the match page is the app.
import { el, reconcile } from '../../ui.js';
import { dayLabel, followedTeamIds, liveTeamMatch, matchesFor, signed, splitFixtures, tableFor } from './format.js';
import { createMatchPage } from './match-page.js';
import { name } from './meta.js';
import { createMatchRow, crest, setCrest, updateMatchRow } from './views.js';

// "Today" becomes "Yesterday", and countdowns tick down, as time passes.
const TICK_MS = 30 * 1000;
// Rows per column, so the DOM stays light however much the board keeps.
const MAX_LISTED = 40;
const MATCH_INTENT = /^match-(\d{1,12})$/;

export function mount(root, { services }) {
  const { sports } = services;
  let state = sports.getState();
  let filter = 'all';
  let tab = 'matches';
  let tableId = null;
  let page = null;
  let pageId = null;
  let choseView = false;

  // Home: header, who to show, and the two tabs

  const meta = el('p', { class: 'sports-app__meta' });
  const tabButtons = new Map(
    [
      ['matches', 'Matches'],
      ['tables', 'Tables'],
    ].map(([id, label]) => [
      id,
      el('button', {
        class: 'sports-tabs__tab',
        type: 'button',
        text: label,
        'aria-pressed': 'false',
        onclick: () => {
          tab = id;
          render();
        },
      }),
    ]),
  );
  const chips = el('div', { class: 'sports-chips', role: 'group', 'aria-label': 'Show matches for' });

  const coming = el('div', { class: 'sports-days' });
  const comingEmpty = el('p', { class: 'sports-app__none', text: 'Nothing coming up.' });
  const results = el('div', { class: 'sports-days' });
  const resultsEmpty = el('p', { class: 'sports-app__none', text: 'No results yet.' });
  const matchesPane = el(
    'div',
    { class: 'sports-app__columns' },
    el('section', { class: 'sports-app__column', 'aria-label': 'Coming up' }, el('h2', { class: 'sports-app__subtitle', text: 'Coming up' }), coming, comingEmpty),
    el('section', { class: 'sports-app__column', 'aria-label': 'Results' }, el('h2', { class: 'sports-app__subtitle', text: 'Results' }), results, resultsEmpty),
  );

  const tablePicker = el('div', { class: 'sports-tabs sports-tabs--small', role: 'group', 'aria-label': 'Table' });
  const tableBody = el('tbody');
  const tableHead = el('thead');
  const tableNote = el('p', { class: 'sports-table__note' });
  const tableEl = el('table', { class: 'sports-table' }, tableHead, tableBody);
  const tablesEmpty = el('p', { class: 'sports-app__none', text: 'The tables haven’t been read yet.' });
  const tablesPane = el('div', { class: 'sports-app__tables' }, tablePicker, el('div', { class: 'sports-table__scroll' }, tableEl, tableNote), tablesEmpty);

  const homeView = el(
    'div',
    { class: 'sports-home' },
    el(
      'header',
      { class: 'sports-app__header' },
      el('div', { class: 'sports-app__heading' }, el('h1', { class: 'sports-app__title', text: name }), meta),
      el('div', { class: 'sports-tabs', role: 'group', 'aria-label': 'Show' }, ...tabButtons.values()),
    ),
    chips,
    matchesPane,
    tablesPane,
  );
  const view = el('div', { class: 'sports-app' }, homeView);
  root.append(view);

  // Rendering

  function renderChips() {
    const options = [{ id: 'all', name: 'All' }, ...state.follows];
    if (!options.some((option) => option.id === filter)) filter = 'all';
    reconcile(
      chips,
      options,
      (option) => option.id,
      (option) =>
        el(
          'button',
          {
            class: 'sports-chip',
            type: 'button',
            onclick: () => {
              filter = option.id;
              render();
            },
          },
          crest(null, 'sports-chip__crest'),
          el('span', { class: 'sports-chip__name' }),
        ),
      (button, option) => {
        const [badge, label] = button.children;
        badge.hidden = !option.crest;
        if (option.crest) setCrest(badge, { crest: option.crest, abbr: option.name.slice(0, 3).toUpperCase() });
        label.textContent = option.name;
        button.setAttribute('aria-pressed', String(option.id === filter));
      },
    );
  }

  function renderDays(container, days, now) {
    let left = MAX_LISTED;
    const shown = [];
    for (const day of days) {
      if (left <= 0) break;
      shown.push({ ...day, matches: day.matches.slice(0, left) });
      left -= day.matches.length;
    }
    reconcile(
      container,
      shown,
      (day) => day.key,
      () => el('section', { class: 'sports-day' }, el('h3', { class: 'sports-day__label' }), el('ul', { class: 'sports-day__list' })),
      (section, day) => {
        const [label, list] = section.children;
        label.textContent = dayLabel(day.kickoff, now, { long: true });
        reconcile(list, day.matches, (m) => m.id, () => createMatchRow(openMatch, { competition: true }), (row, m) => updateMatchRow(row, m, now));
      },
    );
    return shown.length;
  }

  function renderMatches(now) {
    const { coming: next, results: done } = splitFixtures(matchesFor(state.matches, filter), now);
    comingEmpty.hidden = renderDays(coming, next, now) > 0;
    resultsEmpty.hidden = renderDays(results, done, now) > 0;
  }

  function renderTables() {
    const ids = Object.keys(state.tables);
    if (!ids.includes(tableId)) tableId = tableFor(state, null)?.id ?? ids[0] ?? null;
    reconcile(
      tablePicker,
      ids.map((id) => state.tables[id]),
      (table) => table.id,
      (table) =>
        el('button', {
          class: 'sports-tabs__tab',
          type: 'button',
          onclick: () => {
            tableId = table.id;
            render();
          },
        }),
      (button, table) => {
        button.textContent = table.name;
        button.setAttribute('aria-pressed', String(table.id === tableId));
      },
    );
    const table = tableId ? state.tables[tableId] : null;
    tablesEmpty.hidden = Boolean(table);
    tableEl.hidden = !table;
    tablePicker.hidden = ids.length < 2;
    tableNote.hidden = true;
    if (!table) return;
    const college = table.kind === 'college';
    const columns = college
      ? [['#', 'rank'], ['Team', 'team'], ['GP', 'num'], ['W', 'num'], ['L', 'num'], ['T', 'num'], ['Pts', 'points'], ['Overall', 'num wide']]
      : [['#', 'rank'], ['Team', 'team'], ['P', 'num'], ['W', 'num wide'], ['D', 'num wide'], ['L', 'num wide'], ['GD', 'num'], ['Pts', 'points']];
    tableHead.replaceChildren(
      el('tr', {}, ...columns.map(([label, kind]) => el('th', { class: `sports-table__${kind.split(' ').join(' sports-table__')}`, scope: 'col', text: label }))),
    );
    const wanted = followedTeamIds(state.follows);
    const rows = table.groups.flatMap((group) => group.rows);
    const zones = new Map();
    tableBody.replaceChildren(
      ...rows.map((row) => {
        if (row.zone && !zones.has(row.zone.label)) zones.set(row.zone.label, row.zone.level);
        const cells = college
          ? [row.played, row.won, row.lost, row.drawn, row.points, row.overall ?? '']
          : [row.played, row.won, row.drawn, row.lost, signed(row.diff), row.points];
        const kinds = columns.slice(2).map(([, kind]) => kind);
        return el(
          'tr',
          { class: `sports-table__row${wanted.has(row.team.id) ? ' sports-table__row--ours' : ''}` },
          el('td', { class: `sports-table__rank${row.zone ? ` sports-zone sports-zone--${row.zone.level}` : ''}`, text: row.rank }),
          el('td', { class: 'sports-table__team' }, crest(row.team, 'sports-table__crest'), el('span', { text: row.team.name })),
          ...cells.map((value, i) => el('td', { class: `sports-table__${kinds[i].split(' ').join(' sports-table__')}`, text: value ?? '–' })),
        );
      }),
    );
    // What the coloured ranks mean.
    tableNote.hidden = zones.size === 0;
    tableNote.replaceChildren(
      ...[...zones].map(([label, level]) => el('span', { class: 'sports-table__key' }, el('span', { class: `sports-zone sports-zone--${level}`, 'aria-hidden': 'true' }), label)),
    );
  }

  function render() {
    const now = new Date();
    meta.textContent = state.error && state.version >= 0 ? 'Showing the last scores the board read' : 'Live scores from ESPN';
    for (const [id, button] of tabButtons) button.setAttribute('aria-pressed', String(id === tab));
    matchesPane.hidden = tab !== 'matches';
    chips.hidden = tab !== 'matches';
    tablesPane.hidden = tab !== 'tables';
    renderChips();
    if (tab === 'matches') renderMatches(now);
    else renderTables();
  }

  // The match page

  function openMatch(id) {
    location.hash = `#/app/sports/match-${id}`;
  }

  function showPage(id) {
    if (pageId === id && page) return;
    closePage();
    pageId = id;
    page = createMatchPage({
      sports,
      matchId: id,
      onBack: () => {
        location.hash = '#/app/sports';
      },
    });
    homeView.hidden = true;
    view.append(page.node);
    page.update(state);
    view.scrollTop = 0;
  }

  function closePage() {
    if (!page) return;
    page.destroy();
    page.node.remove();
    page = null;
    pageId = null;
    homeView.hidden = false;
  }

  function intent(action) {
    choseView = true;
    const found = MATCH_INTENT.exec(action ?? '');
    if (found) showPage(found[1]);
    else {
      closePage();
      render();
    }
  }

  // Opened with nothing in particular in mind while a followed team plays: go to
  // that match. The app host calls intent() straight after mounting when it was
  // opened for something, so this waits until it's had the chance.
  let settled = false;
  function openLiveMatch() {
    if (choseView || !settled || state.version < 0) return;
    choseView = true;
    const live = liveTeamMatch(state.matches, state.follows);
    if (live) location.replace(`#/app/sports/match-${live.id}`);
  }

  const unsubscribe = sports.subscribe((next) => {
    state = next;
    if (page) page.update(state);
    else render();
    openLiveMatch();
  });
  const ticker = setInterval(() => (page ? page.tick() : render()), TICK_MS);
  queueMicrotask(() => {
    settled = true;
    openLiveMatch();
  });

  return {
    intent,
    unmount() {
      unsubscribe();
      clearInterval(ticker);
      closePage();
    },
  };
}
