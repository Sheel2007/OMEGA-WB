// Four in a Row: drop discs into a 7 × 6 grid; four in a line wins.
import { newState, restoreState, undoMove } from './common.js';

export const KIND = 'four-in-a-row';
export const NAME = 'Four in a Row';
export const PLAYERS = { 1: 'Red', 2: 'Yellow' };
export const COLS = 7;
export const ROWS = 6;

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
// The computer likes the middle: more lines run through it.
const COLUMN_WEIGHT = [1, 2, 3, 4, 3, 2, 1];

function lineThrough(board, row, col) {
  const player = board[row][col];
  for (const [dr, dc] of DIRECTIONS) {
    const line = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        line.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

function replay(moves) {
  const board = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  let turn = 1;
  let line = null;
  let winner = null;
  let last = null;
  for (const col of moves) {
    if (winner || !Number.isInteger(col) || col < 0 || col >= COLS || board[0][col] !== 0) return null;
    let row = ROWS - 1;
    while (board[row][col] !== 0) row--;
    board[row][col] = turn;
    last = { row, col };
    line = lineThrough(board, row, col);
    if (line) winner = turn;
    turn = 3 - turn;
  }
  const full = board[0].every((cell) => cell !== 0);
  return { board, turn, winner, line, last, over: Boolean(winner) || full };
}

export const newGame = (options) => newState(KIND, options);

export function view(state) {
  return replay(state.moves);
}

export function status(state) {
  const { turn, winner, line, over } = replay(state.moves);
  return { over, winner, draw: over && !winner, turn, line: line ?? [] };
}

export function legalMoves(state) {
  const { board, over } = replay(state.moves);
  return over ? [] : [...Array(COLS).keys()].filter((col) => board[0][col] === 0);
}

export function play(state, col) {
  const moves = [...state.moves, col];
  return replay(moves) ? { ...state, moves } : null;
}

export const undo = (state) => undoMove({ status }, state);

export const restore = (raw) => restoreState({ play }, KIND, raw, Number.isInteger);

export function computerMove(state, random) {
  const legal = legalMoves(state);
  const me = status(state).turn;
  const winsFor = (s, player) => {
    const st = s && status(s);
    return Boolean(st?.over && st.winner === player);
  };
  // 1. Win now.
  const win = legal.find((col) => winsFor(play(state, col), me));
  if (win !== undefined) return win;
  // 2. Stop the other player winning next move (try their disc in each column).
  const block = legal.find((col) => {
    const { board } = view(state);
    let row = ROWS - 1;
    while (row >= 0 && board[row][col] !== 0) row--;
    if (row < 0) return false;
    board[row][col] = 3 - me;
    return Boolean(lineThrough(board, row, col));
  });
  if (block !== undefined) return block;
  // 3. Don't set up a win for them, then prefer the middle.
  const safe = legal.filter((col) => {
    const after = play(state, col);
    return !legalMoves(after).some((reply) => winsFor(play(after, reply), 3 - me));
  });
  const pool = safe.length ? safe : legal;
  return pool.reduce((best, col) =>
    COLUMN_WEIGHT[col] + random() * 0.5 > COLUMN_WEIGHT[best] + random() * 0.5 ? col : best,
  );
}
