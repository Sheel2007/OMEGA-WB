// Dots and Boxes: take turns drawing a line between neighbouring dots. Close a
// box and it's yours, and you go again. Most boxes wins.
import { newState, restoreState, undoMove, winnerOf } from './common.js';

export const KIND = 'dots-and-boxes';
export const NAME = 'Dots and Boxes';
export const PLAYERS = { 1: 'Red', 2: 'Blue' };
export const BOXES = 4;

// Lines are "h-r-c" (along the top of box r,c; r goes to BOXES) and "v-r-c"
// (down the left of box r,c; c goes to BOXES).
export const EDGES = [
  ...Array.from({ length: (BOXES + 1) * BOXES }, (_, i) => `h-${Math.floor(i / BOXES)}-${i % BOXES}`),
  ...Array.from({ length: BOXES * (BOXES + 1) }, (_, i) => `v-${Math.floor(i / (BOXES + 1))}-${i % (BOXES + 1)}`),
];
const EDGE_SET = new Set(EDGES);

export function sidesOf(row, col) {
  return [`h-${row}-${col}`, `h-${row + 1}-${col}`, `v-${row}-${col}`, `v-${row}-${col + 1}`];
}

function boxesBeside(edge) {
  const [kind, r, c] = edge.split('-');
  const row = Number(r);
  const col = Number(c);
  const boxes = kind === 'h' ? [[row - 1, col], [row, col]] : [[row, col - 1], [row, col]];
  return boxes.filter(([br, bc]) => br >= 0 && br < BOXES && bc >= 0 && bc < BOXES);
}

function replay(moves) {
  const drawn = new Map();
  const boxes = {};
  const scores = { 1: 0, 2: 0 };
  let turn = 1;
  for (const edge of moves) {
    if (!EDGE_SET.has(edge) || drawn.has(edge)) return null;
    drawn.set(edge, turn);
    const closed = boxesBeside(edge).filter(([r, c]) => sidesOf(r, c).every((side) => drawn.has(side)));
    for (const [r, c] of closed) boxes[`${r}-${c}`] = turn;
    scores[turn] += closed.length;
    if (!closed.length) turn = 3 - turn;
  }
  return { drawn, boxes, scores, turn, over: drawn.size === EDGES.length, last: moves.at(-1) ?? null };
}

export const newGame = (options) => newState(KIND, options);

export function view(state) {
  return replay(state.moves);
}

export function status(state) {
  const { turn, over, scores } = replay(state.moves);
  const winner = over ? winnerOf(scores) : null;
  return { over, winner, draw: over && !winner, turn, scores };
}

export function legalMoves(state) {
  const { drawn, over } = replay(state.moves);
  return over ? [] : EDGES.filter((edge) => !drawn.has(edge));
}

export function play(state, edge) {
  const moves = [...state.moves, edge];
  return replay(moves) ? { ...state, moves } : null;
}

export const undo = (state) => undoMove({ status }, state);

export const restore = (raw) => restoreState({ play }, KIND, raw, (m) => typeof m === 'string');

function sidesDrawn(drawn, [r, c]) {
  return sidesOf(r, c).filter((side) => drawn.has(side)).length;
}

// How many boxes the next player could take in a row after `edge` is drawn.
function giveaway(drawn, edge) {
  const lines = new Set([...drawn.keys(), edge]);
  let taken = 0;
  let progress = true;
  while (progress) {
    progress = false;
    for (let r = 0; r < BOXES; r++) {
      for (let c = 0; c < BOXES; c++) {
        const missing = sidesOf(r, c).filter((side) => !lines.has(side));
        if (missing.length === 1) {
          lines.add(missing[0]);
          taken++;
          progress = true;
        }
      }
    }
  }
  return taken;
}

export function computerMove(state, random) {
  const { drawn } = replay(state.moves);
  const legal = legalMoves(state);
  const pick = (list) => list[Math.floor(random() * list.length)];
  // 1. Close a box (two at once if possible).
  const closes = (edge) => boxesBeside(edge).filter((box) => sidesDrawn(drawn, box) === 3).length;
  const best = Math.max(...legal.map(closes));
  if (best > 0) return pick(legal.filter((edge) => closes(edge) === best));
  // 2. Draw a line that doesn't leave a box with three sides.
  const safe = legal.filter((edge) => boxesBeside(edge).every((box) => sidesDrawn(drawn, box) < 2));
  if (safe.length) return pick(safe);
  // 3. Forced to give something away: give away as little as possible.
  const costs = legal.map((edge) => giveaway(drawn, edge));
  const least = Math.min(...costs);
  return pick(legal.filter((_, i) => costs[i] === least));
}
