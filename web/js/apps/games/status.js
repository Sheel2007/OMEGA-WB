// One-line summaries of a saved game, for the picker and the widget.
import { RULES } from './rules/index.js';

export function summary(kind, saved) {
  const rules = RULES[kind];
  const state = rules.restore(saved);
  if (!state || state.moves.length === 0) return { playing: false, text: 'New game' };
  const st = rules.status(state);
  // A game can word its own progress when "whose turn" doesn't describe it.
  if (rules.summaryText) return { playing: !st.over, text: rules.summaryText(state, st) };
  if (st.over) return { playing: false, text: st.winner ? `${state.vsComputer ? (st.winner === 1 ? 'You' : 'Board') : rules.PLAYERS[st.winner]} won` : 'Draw' };
  return { playing: true, text: state.vsComputer ? (st.turn === 1 ? 'Your move' : 'Board\u2019s move') : `${rules.PLAYERS[st.turn]} to move` };
}
