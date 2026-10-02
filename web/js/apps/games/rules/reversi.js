// Reversi: place a disc to trap a line of the other colour, which flips over.
// A player with no move passes; when neither can move, most discs wins.
import { newState, restoreState, undoMove, winnerOf } from './common.js';

export const KIND = 'reversi';
export const NAME = 'Reversi';
export const PLAYERS = { 1: 'Black', 2: 'White' };
export const SIZE = 8;

const DIRECTIONS = [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => [dr, dc])).filter(([dr, dc]) => dr || dc);
// Corners can never be flipped back; the squares next to them give corners away.
const WEIGHTS = [
  [100, -20, 10, 5, 5, 10, -20, 100],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [10, -2, 1, 1, 1, 1, -2, 10],
  [5, -2, 1, 0, 0, 1, -2, 5],
  [5, -2, 1, 0, 0, 1, -2, 5],
  [10, -2, 1, 1, 1, 1, -2, 10],
  [-20, -50, -2, -2, -2, -2, -50, -20],
  [100, -20, 10, 5, 5, 10, -20, 100],
];

function startBoard() {
  const board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  board[3][3] = 2;
  board[3][4] = 1;
  board[4][3] = 1;
  board[4][4] = 2;
  return board;
}

function flipsFor(board, row, col, player) {
  if (board[row][col] !== 0) return [];
  const flips = [];
  for (const [dr, dc] of DIRECTIONS) {
    const run = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === 3 - player) {
      run.push([r, c]);
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) flips.push(...run);
  }
  return flips;
}

function movesFor(board, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (flipsFor(board, r, c, player).length) moves.push([r, c]);
  return moves;
}

const isMove = (m) => Array.isArray(m) && m.length === 2 && m.every((n) => Number.isInteger(n) && n >= 0 && n < SIZE);

function replay(moves) {
  const board = startBoard();
  let turn = 1;
  let over = false;
  let passed = null;
  let last = null;
  for (const move of moves) {
    if (over || !isMove(move)) return null;
    const [row, col] = move;
    const flips = flipsFor(board, row, col, turn);
    if (!flips.length) return null;
    board[row][col] = turn;
    for (const [r, c] of flips) board[r][c] = turn;
    last = { row, col };
    passed = null;
    if (movesFor(board, 3 - turn).length) turn = 3 - turn;
    else if (movesFor(board, turn).length) passed = 3 - turn;
    else over = true;
  }
  const scores = { 1: 0, 2: 0 };
  for (const row of board) for (const cell of row) if (cell) scores[cell]++;
  return { board, turn, over, passed, last, scores };
}

export const newGame = (options) => newState(KIND, options);

export function view(state) {
  const result = replay(state.moves);
  return { ...result, legal: result.over ? [] : movesFor(result.board, result.turn) };
}

export function status(state) {
  const { turn, over, scores, passed } = replay(state.moves);
  const winner = over ? winnerOf(scores) : null;
  return { over, winner, draw: over && !winner, turn, scores, passed };
}

export function legalMoves(state) {
  return view(state).legal;
}

export function play(state, move) {
  const moves = [...state.moves, move];
  return replay(moves) ? { ...state, moves } : null;
}

export const undo = (state) => undoMove({ status }, state);

export const restore = (raw) => restoreState({ play }, KIND, raw, isMove);

export function computerMove(state, random) {
  const { board, turn } = replay(state.moves);
  const score = ([r, c]) => WEIGHTS[r][c] + flipsFor(board, r, c, turn).length * 0.1 + random() * 0.01;
  return legalMoves(state).reduce((best, move) => (score(move) > score(best) ? move : best));
}
