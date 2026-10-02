import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fourInARow from '../../web/js/apps/games/rules/four-in-a-row.js';
import * as reversi from '../../web/js/apps/games/rules/reversi.js';
import * as dots from '../../web/js/apps/games/rules/dots-and-boxes.js';
import { RULES } from '../../web/js/apps/games/rules/index.js';
import { seededRandom } from '../../web/js/random.js';

const playAll = (rules, moves, options = {}) =>
  moves.reduce((state, move) => {
    const next = rules.play(state, move);
    assert.ok(next, `move ${JSON.stringify(move)} should be legal`);
    return next;
  }, rules.newGame(options));

// Four in a Row

test('four in a row: discs stack and players alternate', () => {
  const s = playAll(fourInARow, [3, 3]);
  const { board } = fourInARow.view(s);
  assert.equal(board[5][3], 1);
  assert.equal(board[4][3], 2);
  assert.equal(fourInARow.status(s).turn, 1);
});

test('four in a row: wins across, up, and on both diagonals', () => {
  const across = fourInARow.status(playAll(fourInARow, [0, 0, 1, 1, 2, 2, 3]));
  assert.deepEqual([across.over, across.winner], [true, 1]);
  assert.equal(across.line.length, 4);
  const up = fourInARow.status(playAll(fourInARow, [0, 1, 0, 1, 0, 1, 0]));
  assert.equal(up.winner, 1);
  const rising = fourInARow.status(playAll(fourInARow, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]));
  assert.equal(rising.winner, 1);
  const falling = fourInARow.status(playAll(fourInARow, [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]));
  assert.equal(falling.winner, 1);
});

test('four in a row: full columns and finished games refuse moves', () => {
  const full = playAll(fourInARow, [0, 0, 0, 0, 0, 0]);
  assert.equal(fourInARow.play(full, 0), null);
  assert.ok(!fourInARow.legalMoves(full).includes(0));
  const won = playAll(fourInARow, [0, 1, 0, 1, 0, 1, 0]);
  assert.equal(fourInARow.play(won, 5), null);
  assert.deepEqual(fourInARow.legalMoves(won), []);
});

test('four in a row: the computer takes a win, and blocks yours', () => {
  // Red has three along the bottom; Yellow (the computer) must take column 3.
  const threat = playAll(fourInARow, [0, 6, 1, 6, 2]);
  assert.equal(fourInARow.computerMove(threat, seededRandom(1)), 3, 'blocks the open three');
  const winning = playAll(fourInARow, [0, 6, 1, 6, 5, 6]);
  assert.equal(fourInARow.status(winning).turn, 1);
  assert.equal(fourInARow.computerMove(playAll(fourInARow, [0, 6, 1, 6, 5, 6, 4]), seededRandom(1)), 6, 'takes its own win');
});

test('four in a row: undo against the computer goes back to your turn', () => {
  const s = playAll(fourInARow, [3, 2, 4, 2], { vsComputer: true });
  const back = fourInARow.undo(s);
  assert.deepEqual(back.moves, [3, 2]);
  assert.equal(fourInARow.status(back).turn, 1);
  assert.deepEqual(fourInARow.undo(playAll(fourInARow, [3, 2])).moves, [3]);
});

test('four in a row: restore replays saved moves and rejects tampering', () => {
  const s = playAll(fourInARow, [3, 3, 4]);
  assert.deepEqual(fourInARow.restore(JSON.parse(JSON.stringify(s))), s);
  assert.equal(fourInARow.restore({ ...s, moves: [3, 9] }), null);
  assert.equal(fourInARow.restore({ kind: 'reversi', moves: [] }), null);
  assert.equal(fourInARow.restore('nope'), null);
});

// Reversi

test('reversi: starts with four discs and black (player 1) to move', () => {
  const s = reversi.newGame();
  const st = reversi.status(s);
  assert.deepEqual(st.scores, { 1: 2, 2: 2 });
  assert.equal(st.turn, 1);
  assert.deepEqual(reversi.legalMoves(s).map(([r, c]) => `${r}${c}`).sort(), ['23', '32', '45', '54']);
});

test('reversi: a move flips the discs it brackets', () => {
  const s = playAll(reversi, [[2, 3]]);
  const { board } = reversi.view(s);
  assert.equal(board[3][3], 1, 'flipped');
  assert.deepEqual(reversi.status(s).scores, { 1: 4, 2: 1 });
  assert.equal(reversi.play(s, [0, 0]), null, 'no bracket, not allowed');
});

test('reversi: a player with no moves passes, and the game ends when nobody can move', () => {
  // The shortest possible game (E6 F4 E3 F6 G5 D6 E7 F5 C5): white is wiped out after 9 moves.
  const s = playAll(reversi, [[5, 4], [3, 5], [2, 4], [5, 5], [4, 6], [5, 3], [6, 4], [4, 5], [4, 2]]);
  const st = reversi.status(s);
  assert.equal(st.over, true);
  assert.equal(st.winner, 1);
  assert.equal(st.scores[2], 0);
});

test('reversi: the computer always takes a corner when it can', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const random = seededRandom(seed);
    let s = reversi.newGame();
    while (!reversi.status(s).over) {
      const legal = reversi.legalMoves(s).map((m) => m.join(','));
      if (['0,0', '0,7', '7,0', '7,7'].some((corner) => legal.includes(corner))) {
        assert.ok(['0,0', '0,7', '7,0', '7,7'].includes(reversi.computerMove(s, random).join(',')));
        checked++;
      }
      const moves = reversi.legalMoves(s);
      s = reversi.play(s, moves[Math.floor(random() * moves.length)]);
    }
  }
  assert.ok(checked > 5, `found ${checked} positions with a corner on offer`);
});

// Dots and Boxes

test('dots and boxes: closing a box scores it and earns another turn', () => {
  const s = playAll(dots, ['h-0-0', 'v-0-0', 'h-1-0']);
  assert.equal(dots.status(s).turn, 2, 'no box yet: turns alternate');
  const closed = dots.play(s, 'v-0-1');
  const st = dots.status(closed);
  assert.deepEqual(st.scores, { 1: 0, 2: 1 });
  assert.equal(st.turn, 2, 'scorer goes again');
  assert.equal(dots.view(closed).boxes['0-0'], 2);
});

test('dots and boxes: one line can close two boxes', () => {
  const s = playAll(dots, ['h-0-0', 'h-0-1', 'h-1-0', 'h-1-1', 'v-0-0', 'v-0-2']);
  const closed = dots.play(s, 'v-0-1');
  assert.deepEqual(dots.status(closed).scores, { 1: 2, 2: 0 });
});

test('dots and boxes: the game ends when every line is drawn', () => {
  let s = dots.newGame();
  while (!dots.status(s).over) s = dots.play(s, dots.legalMoves(s)[0]);
  const { scores } = dots.status(s);
  assert.equal(scores[1] + scores[2], dots.BOXES * dots.BOXES);
  assert.equal(s.moves.length, 2 * dots.BOXES * (dots.BOXES + 1));
});

test('dots and boxes: the computer completes boxes and avoids giving them away', () => {
  const three = playAll(dots, ['h-0-0', 'v-0-0', 'h-1-0']);
  assert.equal(dots.computerMove(three, seededRandom(1)), 'v-0-1', 'takes the box');
  const s = playAll(dots, ['h-0-0', 'v-3-4']);
  const opponent = 3 - dots.status(s).turn;
  const after = dots.play(s, dots.computerMove(s, seededRandom(1)));
  assert.ok(!dots.legalMoves(after).some((m) => dots.status(dots.play(after, m)).scores[opponent] > 0), 'no free box handed over');
});

// All games

test('every game plays to the end against itself without breaking the rules', () => {
  for (const [kind, rules] of Object.entries(RULES)) {
    for (let seed = 1; seed <= 5; seed++) {
      const random = seededRandom(seed);
      let s = rules.newGame({ vsComputer: true });
      let guard = 0;
      while (!rules.status(s).over && guard++ < 200) {
        const move = rules.computerMove(s, random);
        assert.ok(rules.legalMoves(s).some((m) => JSON.stringify(m) === JSON.stringify(move)), `${kind}: computer move is legal`);
        s = rules.play(s, move);
      }
      assert.ok(rules.status(s).over, `${kind} finishes`);
      assert.deepEqual(rules.restore(JSON.parse(JSON.stringify(s))), s, `${kind}: a finished game restores`);
    }
  }
});
