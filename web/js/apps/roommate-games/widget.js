// Roommate Cup: the home-screen widget. A small scoreboard, everyone's points in
// order, and when game night is under the name.
import { isReady } from '../../services/roommate-games.js';
import { appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { avatarColor, initials, widgetMeta } from './format.js';
import * as meta from './meta.js';

// "Tonight" turns into "Tomorrow" and so on as the day goes by.
const META_REFRESH_MS = 60 * 1000;

export function createWidget({ services, openApp }) {
  const cup = services.roommateGames;
  const status = el('p', { class: 'widget-head__meta' });
  const board = el('ol', { class: 'cup-board', 'aria-label': 'Scoreboard' });
  const more = el('p', { class: 'cup-widget__more' });
  const signUp = el('button', {
    class: 'widget-head__action',
    type: 'button',
    'aria-label': 'Sign up a roommate',
    html: icons.plus,
    onclick: () => openApp(meta.id, { origin: node, intent: 'signup' }),
  });
  const empty = el(
    'div',
    { class: 'cup-widget__empty' },
    el('p', { class: 'cup-widget__empty-title', text: 'No roommates yet' }),
    el('p', { class: 'cup-widget__empty-text', text: 'Tap + to sign everyone up.' }),
  );
  const node = el(
    'article',
    { class: 'cup-widget', 'aria-label': meta.name },
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
      signUp,
    ),
    board,
    more,
    empty,
  );

  let total = 0;
  const fit = () => fitRows(board, more, total, (hidden) => `${hidden} more in ${meta.name}`);

  function render(state) {
    const ready = isReady(state);
    total = state.players.length;
    status.textContent = ready ? widgetMeta(state, new Date()) : '';
    reconcile(
      board,
      state.players,
      (player) => player.id,
      () =>
        el(
          'li',
          { class: 'cup-row' },
          el('span', { class: 'cup-rank' }),
          el('span', { class: 'cup-avatar', 'aria-hidden': 'true' }),
          el('span', { class: 'cup-row__name' }),
          el('span', { class: 'cup-row__points' }),
        ),
      (row, player) => {
        const [rank, avatar, name, points] = row.children;
        rank.textContent = player.rank;
        rank.className = `cup-rank${player.points > 0 && player.rank <= 3 ? ` cup-rank--${player.rank}` : ''}`;
        avatar.className = `cup-avatar cup-avatar--${avatarColor(player.id)}`;
        avatar.textContent = initials(player.name);
        name.textContent = player.name;
        points.textContent = player.points;
        row.setAttribute('aria-label', `${player.rank}. ${player.name}, ${player.points} points`);
      },
    );
    board.hidden = total === 0;
    empty.hidden = !ready || total > 0;
    signUp.hidden = !ready || total > 0;
    fit();
  }

  const unsubscribe = cup.subscribe(render);
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(board);
  const clock = setInterval(() => {
    const state = cup.getState();
    if (isReady(state)) status.textContent = widgetMeta(state, new Date());
  }, META_REFRESH_MS);
  render(cup.getState());

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      clearInterval(clock);
    },
  };
}
