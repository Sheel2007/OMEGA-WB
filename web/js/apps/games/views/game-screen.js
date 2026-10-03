// The frame around a game: whose turn it is, scores, 2 players vs Computer,
// Undo and New game. Every move is saved, so a game survives the nightly reload.
import { el, icons } from '../../../ui.js';
import { createBlackjackView } from './blackjack.js';
import { createDotsAndBoxesView } from './dots-and-boxes.js';
import { createFourInARowView } from './four-in-a-row.js';
import { createReversiView } from './reversi.js';

// A short pause so you can see the computer "think" and follow its move.
const COMPUTER_DELAY_MS = 600;
const BOARDS = {
  'four-in-a-row': createFourInARowView,
  reversi: createReversiView,
  'dots-and-boxes': createDotsAndBoxesView,
  blackjack: createBlackjackView,
};
const SHOWS_SCORE = new Set(['reversi', 'dots-and-boxes']);

export function createGameScreen({ rules, store, onBack, random = Math.random }) {
  let state = rules.restore(store.get(rules.KIND)) ?? rules.newGame();
  let timer = null;

  const board = BOARDS[rules.KIND]({ onMove: (move) => humanMove(move) });
  const chip = el('span', { class: 'game-chip', 'aria-hidden': 'true' });
  const turnText = el('span', {});
  const turn = el('p', { class: 'game-screen__turn', role: 'status' }, chip, turnText);
  const note = el('p', { class: 'game-screen__note' });
  const scores = el('p', { class: 'game-screen__scores' });
  const modes = [
    ['2 players', false],
    ['vs Computer', true],
  ].map(([label, vs]) =>
    el('button', { class: 'game-screen__mode', type: 'button', role: 'radio', dataset: { vs: String(vs) }, text: label, onclick: () => vs !== state.vsComputer && newGame(vs) }),
  );
  const undoButton = el('button', { class: 'game-screen__action', type: 'button', html: `${icons.undo}<span>Undo</span>`, onclick: () => set(rules.undo(state)) });
  // One game is you against the house: no sides to choose, and dealt cards can't
  // be taken back. Everything else keeps both controls.
  const modeGroup = el('div', { class: 'game-screen__modes', role: 'radiogroup', 'aria-label': 'Who plays' }, modes);
  modeGroup.hidden = rules.MODES === false;
  undoButton.hidden = rules.UNDO === false;
  const node = el(
    'div',
    { class: `game-screen game-screen--${rules.KIND}` },
    el('div', { class: 'game-screen__board' }, board.node),
    el(
      'aside',
      { class: 'game-screen__panel' },
      el('button', { class: 'game-screen__back', type: 'button', html: `${icons.chevronLeft}<span>All games</span>`, onclick: onBack }),
      el('h1', { class: 'game-screen__title', text: rules.NAME }),
      turn,
      note,
      scores,
      modeGroup,
      el(
        'div',
        { class: 'game-screen__actions' },
        undoButton,
        el('button', { class: 'game-screen__action game-screen__action--primary', type: 'button', html: `${icons.plus}<span>New game</span>`, onclick: () => newGame() }),
      ),
    ),
  );

  const computerToMove = () => {
    const st = rules.status(state);
    return state.vsComputer && !st.over && st.turn === 2;
  };

  function set(next) {
    clearTimeout(timer);
    timer = null;
    state = next;
    store.save(state);
    render();
    if (computerToMove()) {
      timer = setTimeout(() => set(rules.play(state, rules.computerMove(state, random))), COMPUTER_DELAY_MS);
    }
  }

  function humanMove(move) {
    if (computerToMove()) return;
    const next = rules.play(state, move);
    if (next) set(next);
  }

  function newGame(vsComputer = state.vsComputer) {
    set(rules.newGame({ vsComputer }));
  }

  function headline(st) {
    const name = (player) => rules.PLAYERS[player];
    if (rules.headline) return rules.headline(state, st);
    if (st.over) {
      if (!st.winner) return 'It’s a draw';
      if (state.vsComputer) return st.winner === 1 ? 'You win!' : 'The board wins';
      return `${name(st.winner)} wins!`;
    }
    if (state.vsComputer) return st.turn === 1 ? `Your turn (${name(1)})` : 'Thinking…';
    return `${name(st.turn)}’s turn`;
  }

  function render() {
    const st = rules.status(state);
    const shown = st.over ? st.winner : st.turn;
    chip.className = `game-chip game-chip--${rules.KIND}${shown ? ` game-chip--p${shown}` : ''}`;
    turnText.textContent = headline(st);
    note.textContent = st.passed && !st.over ? `${rules.PLAYERS[st.passed]} had no move, so ${rules.PLAYERS[st.turn]} goes again.` : '';
    note.hidden = !note.textContent;
    scores.hidden = !rules.scoreText && !SHOWS_SCORE.has(rules.KIND);
    if (rules.scoreText) scores.textContent = rules.scoreText(state, st);
    else if (st.scores) scores.textContent = `${rules.PLAYERS[1]} ${st.scores[1]}  ·  ${rules.PLAYERS[2]} ${st.scores[2]}`;
    modes.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.vs === String(state.vsComputer))));
    undoButton.disabled = state.moves.length === 0;
    board.render(state, { locked: computerToMove(), showHints: !state.vsComputer || st.turn === 1 });
  }

  render();
  if (computerToMove()) set(state);

  return {
    node,
    destroy() {
      clearTimeout(timer);
      board.destroy();
    },
  };
}
