// One-line summaries of a saved game, for the picker and the widget.
import { RULES } from './rules/index.js';

export function summary(kind, saved) {
  const rules = RULES[kind];
  const state = rules.restore(saved);
  if (!state || state.moves.length === 0) return { playing: false, text: 'New game' };
  const st = rules.status(state);
  if (st.over) return { playing: false, text: st.winner ? `${state.vsComputer ? (st.winner === 1 ? 'You' : 'Board') : rules.PLAYERS[st.winner]} won` : 'Draw' };
  return { playing: true, text: state.vsComputer ? (st.turn === 1 ? 'Your move' : 'Board’s move') : `${rules.PLAYERS[st.turn]} to move` };
}
