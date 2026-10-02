// Shared by every game's rules. A game's state is only { kind, vsComputer, moves };
// everything else (board, turn, score) is worked out by replaying the moves, so a
// saved game is checked just by replaying it.

export const HUMAN = 1;

export function newState(kind, { vsComputer = false } = {}) {
  return { kind, vsComputer: Boolean(vsComputer), moves: [] };
}

// Against the computer, undo goes back to the last time it was your move.
export function undoMove(rules, state) {
  if (!state.moves.length) return state;
  let moves = state.moves.slice(0, -1);
  if (state.vsComputer) {
    while (moves.length && rules.status({ ...state, moves }).turn !== HUMAN) moves = moves.slice(0, -1);
  }
  return { ...state, moves };
}

export function restoreState(rules, kind, raw, isMove) {
  if (!raw || typeof raw !== 'object' || raw.kind !== kind || !Array.isArray(raw.moves) || !raw.moves.every(isMove)) return null;
  let state = newState(kind, { vsComputer: raw.vsComputer });
  for (const move of raw.moves) {
    state = rules.play(state, move);
    if (!state) return null;
  }
  return state;
}

export function winnerOf(scores) {
  if (scores[1] === scores[2]) return null;
  return scores[1] > scores[2] ? 1 : 2;
}
