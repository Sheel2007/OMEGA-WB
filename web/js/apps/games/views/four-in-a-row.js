// Four in a Row board: each column is one big button; tapping drops a disc.
import { el, reducedMotion } from '../../../ui.js';
import { COLS, PLAYERS, ROWS, view } from '../rules/four-in-a-row.js';

const DROP_MS = 320;

export function createFourInARowView({ onMove }) {
  const columns = Array.from({ length: COLS }, (_, col) =>
    el(
      'button',
      { class: 'four-board__column', type: 'button', onclick: () => onMove(col) },
      Array.from({ length: ROWS }, () => el('span', { class: 'four-board__cell' })),
    ),
  );
  const node = el('div', { class: 'four-board', role: 'group', 'aria-label': 'Four in a Row board' }, columns);
  let shownMoves = 0;

  function render(state, { locked }) {
    const { board, over, line, last } = view(state);
    const winning = new Set(line?.map(([r, c]) => `${r}-${c}`) ?? []);
    columns.forEach((column, col) => {
      const full = board[0][col] !== 0;
      column.disabled = locked || over || full;
      const filled = board.filter((row) => row[col]).length;
      column.setAttribute('aria-label', `Column ${col + 1}, ${filled} of ${ROWS} filled${full ? ', full' : ''}`);
      [...column.children].forEach((cell, row) => {
        const player = board[row][col];
        cell.className = `four-board__cell${player ? ` four-board__cell--p${player}` : ''}${winning.has(`${row}-${col}`) ? ' four-board__cell--win' : ''}`;
        cell.title = player ? PLAYERS[player] : '';
      });
    });
    // Drop the newest disc in from the top (one-shot).
    if (last && state.moves.length > shownMoves && !reducedMotion.matches) {
      const cell = columns[last.col].children[last.row];
      cell.animate([{ transform: `translateY(${-(last.row + 1) * 100}%)` }, { transform: 'none' }], {
        duration: DROP_MS,
        easing: 'cubic-bezier(.5,0,1,1)',
      });
    }
    shownMoves = state.moves.length;
  }

  return { node, render, destroy() {} };
}
