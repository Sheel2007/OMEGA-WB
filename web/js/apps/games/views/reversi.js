// Reversi board: 64 square buttons. Legal moves for the player to move show a hint dot.
import { el } from '../../../ui.js';
import { PLAYERS, SIZE, view } from '../rules/reversi.js';

export function createReversiView({ onMove }) {
  const cells = [];
  const node = el('div', { class: 'reversi-board', role: 'grid', 'aria-label': 'Reversi board' });
  for (let r = 0; r < SIZE; r++) {
    const row = el('div', { class: 'reversi-board__row', role: 'row' });
    for (let c = 0; c < SIZE; c++) {
      const cell = el('button', { class: 'reversi-board__cell', type: 'button', role: 'gridcell', onclick: () => onMove([r, c]) }, el('span', { class: 'reversi-board__disc' }));
      cells.push(cell);
      row.append(cell);
    }
    node.append(row);
  }

  function render(state, { locked, showHints }) {
    const { board, legal, last } = view(state);
    const playable = new Set(legal.map(([r, c]) => r * SIZE + c));
    cells.forEach((cell, i) => {
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      const player = board[r][c];
      const canPlay = playable.has(i) && !locked;
      cell.disabled = !canPlay;
      cell.className = [
        'reversi-board__cell',
        player ? `reversi-board__cell--p${player}` : '',
        canPlay && showHints ? 'reversi-board__cell--hint' : '',
        last && last.row === r && last.col === c ? 'reversi-board__cell--last' : '',
      ].filter(Boolean).join(' ');
      cell.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: ${player ? PLAYERS[player] : canPlay ? 'empty, you can play here' : 'empty'}`);
    });
  }

  return { node, render, destroy() {} };
}
