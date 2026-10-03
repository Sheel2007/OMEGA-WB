import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as blackjack from '../../web/js/apps/games/rules/blackjack.js';

const { BLACKJACK, MAX_HANDS, RANKS, handValue, isBlackjack, legalMoves, newGame, play, rankOf, restore, status, view } =
  blackjack;

// A card by name, so the tests read like a hand of cards rather than indices.
const card = (rank, suit = 0) => suit * RANKS.length + RANKS.indexOf(rank);
const totalOf = (names) => handValue(names.map((n) => card(n))).total;

// Plays `moves` from a seed, which is all a saved game is. An illegal move fails
// here rather than quietly handing back null for a later line to trip over.
function game(seed, ...moves) {
  let state = newGame({ seed });
  for (const move of moves) {
    const next = play(state, move);
    assert.ok(next, `"${move}" was not a legal move for seed ${seed}`);
    state = next;
  }
  return state;
}

// Some seeds deal a natural, which settles before anyone can act.
const needsADecision = (seed) => !view(newGame({ seed })).hand.done;

// Plays the current hand to the end, whatever it takes.
function finishHand(state) {
  while (!status(state).handOver) state = play(state, 'stand');
  return state;
}

test('a court card is ten and an ace is eleven until that would bust', () => {
  assert.equal(totalOf(['K', '7']), 17);
  assert.equal(totalOf(['Q', 'J']), 20);
  assert.equal(totalOf(['A', '9']), 20);
  assert.equal(totalOf(['A', 'K']), BLACKJACK);
  // The ace drops to one rather than busting the hand.
  assert.equal(totalOf(['A', '9', '5']), 15);
  assert.equal(totalOf(['A', 'A', '9']), 21);
  assert.equal(totalOf(['A', 'A', 'A', '8']), 21);
  assert.equal(totalOf(['K', 'Q', '5']), 25);
});

test('a hand is soft only while an ace is still counting as eleven', () => {
  assert.equal(handValue([card('A'), card('6')]).soft, true);
  assert.equal(handValue([card('A'), card('6'), card('K')]).soft, false, 'the ace had to drop to one');
  assert.equal(handValue([card('9'), card('8')]).soft, false);
});

test('blackjack is twenty-one on the first two cards and nothing else', () => {
  assert.equal(isBlackjack([card('A'), card('K')]), true);
  assert.equal(isBlackjack([card('A', 1), card('10', 2)]), true);
  assert.equal(isBlackjack([card('7'), card('7'), card('7')]), false, '21 on three cards is not blackjack');
  assert.equal(isBlackjack([card('K'), card('9')]), false);
});

test('a new game deals two cards each and keeps the dealer’s second face down', () => {
  const { hand, handNumber, tally } = view(newGame({ seed: 1 }));
  assert.equal(hand.player.length, 2);
  assert.equal(hand.dealer.length, 2);
  assert.equal(handNumber, 1);
  assert.deepEqual(tally, { you: 0, dealer: 0, push: 0 });
  // Only a natural ends things before anyone acts.
  assert.equal(hand.hidden, !hand.done);
});

test('the same seed always deals the same cards, which is what makes a save replayable', () => {
  const one = view(game(4242, 'hit'));
  const two = view(game(4242, 'hit'));
  assert.deepEqual(one.hand.player, two.hand.player);
  assert.deepEqual(one.hand.dealer, two.hand.dealer);
  assert.notDeepEqual(view(newGame({ seed: 1 })).hand.player, view(newGame({ seed: 2 })).hand.player);
});

test('every hand is dealt from a full deck, so no card comes out twice', () => {
  for (const seed of [1, 2, 99, 12345]) {
    const { hand } = view(newGame({ seed }));
    const dealt = [...hand.player, ...hand.dealer];
    assert.equal(new Set(dealt).size, dealt.length, `seed ${seed} dealt a duplicate`);
    assert.ok(dealt.every((c) => c >= 0 && c < 52));
  }
});

test('you can hit or stand during a hand, and only deal once it is done', () => {
  const start = newGame({ seed: 7 });
  assert.deepEqual(legalMoves(start).sort(), ['hit', 'stand']);
  assert.equal(play(start, 'deal'), null, 'no dealing in the middle of a hand');

  const stood = play(start, 'stand');
  assert.deepEqual(legalMoves(stood), ['deal']);
  assert.equal(play(stood, 'hit'), null, 'the hand is over');
  assert.equal(play(stood, 'stand'), null);
});

test('standing plays the dealer out: draws to 16, stands on all 17s', () => {
  // Across many seeds the dealer must always land on a legal final total.
  let checked = 0;
  for (let seed = 0; seed < 60; seed++) {
    if (!needsADecision(seed)) continue;
    checked++;
    const { hand } = view(game(seed, 'stand'));
    const dealer = handValue(hand.dealer).total;
    assert.ok(hand.done, `seed ${seed}: hand should be settled`);
    assert.ok(dealer >= 17, `seed ${seed}: dealer stopped on ${dealer}`);
    if (dealer > BLACKJACK) assert.equal(hand.result, 'you', `seed ${seed}: a dealer bust is your hand`);
  }
  assert.ok(checked > 40, `only ${checked} seeds needed a decision`);
});

test('the dealer’s hole card stays hidden until they play', () => {
  const dealt = view(newGame({ seed: 11 }));
  if (!dealt.hand.done) assert.equal(dealt.hand.hidden, true);
  assert.equal(view(game(11, 'stand')).hand.hidden, false);
});

test('going over 21 loses the hand there and then', () => {
  // Hit until the hand resolves; if it resolved by busting, the dealer takes it.
  let state = newGame({ seed: 3 });
  while (!status(state).handOver) state = play(state, 'hit');
  const { hand } = view(state);
  if (handValue(hand.player).total > BLACKJACK) {
    assert.equal(hand.result, 'dealer');
    assert.equal(hand.reason, 'Bust');
  }
});

test('reaching 21 on a hit needs no decision, so the dealer answers it', () => {
  let found = false;
  for (let seed = 0; seed < 200 && !found; seed++) {
    let state = newGame({ seed });
    while (!status(state).handOver && handValue(view(state).hand.player).total < BLACKJACK) {
      state = play(state, 'hit');
    }
    const { hand } = view(state);
    if (handValue(hand.player).total === BLACKJACK && hand.player.length > 2) {
      found = true;
      assert.equal(hand.done, true, 'twenty-one settles without another tap');
      assert.equal(hand.hidden, false, 'the dealer had to play, so the hole card is up');
    }
  }
  assert.ok(found, 'expected some seed to reach 21 on a hit');
});

test('a natural settles the hand before anyone acts', () => {
  let found = false;
  for (let seed = 0; seed < 400 && !found; seed++) {
    const { hand } = view(newGame({ seed }));
    if (!hand.done) continue;
    found = true;
    assert.ok(isBlackjack(hand.player) || isBlackjack(hand.dealer));
    assert.equal(hand.hidden, false, 'a settled hand shows both dealer cards');
    assert.deepEqual(legalMoves(newGame({ seed })), ['deal'], 'nothing to do but deal the next one');
  }
  assert.ok(found, 'expected some seed to deal a natural');
});

test('equal totals push, and both naturals push', () => {
  let pushes = 0;
  for (let seed = 0; seed < 150; seed++) {
    if (!needsADecision(seed)) continue;
    const { hand } = view(game(seed, 'stand'));
    const player = handValue(hand.player).total;
    const dealer = handValue(hand.dealer).total;
    if (hand.result !== 'push') continue;
    pushes++;
    assert.ok(player === dealer || (isBlackjack(hand.player) && isBlackjack(hand.dealer)), `seed ${seed}`);
  }
  assert.ok(pushes > 0, 'expected at least one push across 150 seeds');
});

test('a dealt blackjack beats a 21 built from three cards', () => {
  // Checked directly, since which seed produces the pairing is incidental.
  assert.equal(isBlackjack([card('A'), card('K')]), true);
  assert.equal(isBlackjack([card('7'), card('7'), card('7')]), false);
  assert.equal(totalOf(['7', '7', '7']), totalOf(['A', 'K']));
});

test('the tally counts finished hands and the score line reads them back', () => {
  const state = finishHand(play(finishHand(newGame({ seed: 5 })), 'deal'));
  const st = status(state);
  assert.equal(st.tally.you + st.tally.dealer + st.tally.push, 2);
  assert.deepEqual(st.scores, { 1: st.tally.you, 2: st.tally.dealer });
  assert.match(blackjack.scoreText(state, st), /^You \d+ {2}· {2}Dealer \d+/);
});

test('a session runs for a fixed number of hands and then it is over', () => {
  let state = newGame({ seed: 8 });
  for (let hand = 0; hand < MAX_HANDS; hand++) {
    state = finishHand(state);
    if (hand < MAX_HANDS - 1) {
      state = play(state, 'deal');
      assert.ok(state, `should be able to deal hand ${hand + 2}`);
    }
  }
  const st = status(state);
  assert.equal(st.over, true);
  assert.equal(status(state).handNumber, MAX_HANDS);
  assert.deepEqual(legalMoves(state), [], 'no more hands in this session');
  assert.equal(play(state, 'deal'), null);
  assert.equal(st.tally.you + st.tally.dealer + st.tally.push, MAX_HANDS);
  // The session winner is whoever took more hands; equal is a draw.
  if (st.tally.you > st.tally.dealer) assert.equal(st.winner, 1);
  else if (st.tally.dealer > st.tally.you) assert.equal(st.winner, 2);
  else assert.equal(st.draw, true);
});

test('a saved game comes back exactly, and a tampered one is refused', () => {
  const state = finishHand(play(finishHand(newGame({ seed: 31337 })), 'deal'));
  const saved = JSON.parse(JSON.stringify(state));
  assert.ok(saved.moves.length >= 2, 'the save should hold a couple of hands');
  assert.deepEqual(restore(saved), state);

  assert.equal(restore(null), null);
  assert.equal(restore({ ...saved, kind: 'reversi' }), null, 'another game');
  assert.equal(restore({ ...saved, moves: 'hit' }), null, 'moves must be a list');
  assert.equal(restore({ ...saved, moves: [...saved.moves, 'fold'] }), null, 'not a move this game has');
  assert.equal(restore({ ...saved, moves: ['deal'] }), null, 'cannot deal before the hand is done');
  assert.equal(restore({ ...saved, moves: ['stand', 'stand'] }), null, 'cannot act on a finished hand');
});

test('a save with a different seed replays to different cards, not to a crash', () => {
  const state = finishHand(newGame({ seed: 31337 }));
  const moved = restore({ ...JSON.parse(JSON.stringify(state)), seed: 999 });
  assert.ok(moved, 'still a legal sequence of moves');
  assert.notDeepEqual(view(moved).hand.player, view(state).hand.player);
});

test('a save with no seed still loads rather than throwing', () => {
  const { seed, ...seedless } = JSON.parse(JSON.stringify(finishHand(newGame({ seed: 5 }))));
  const loaded = restore(seedless);
  assert.ok(loaded);
  assert.equal(loaded.seed, 0);
});

test('there is nothing to undo, and no sides to pick', () => {
  const state = game(2, 'hit');
  assert.deepEqual(blackjack.undo(state), state);
  assert.equal(blackjack.MODES, false);
  assert.equal(blackjack.UNDO, false);
});

test('playing itself, the board stands on a hard 17 and hits below it', () => {
  for (let seed = 0; seed < 80; seed++) {
    let state = newGame({ seed });
    let guard = 0;
    while (!status(state).over && guard++ < 200) {
      const move = blackjack.computerMove(state);
      assert.ok(legalMoves(state).includes(move), `seed ${seed}: ${move} was not legal`);
      if (move === 'stand') {
        const { total, soft } = handValue(view(state).hand.player);
        assert.ok(soft ? total >= 19 : total >= 17, `seed ${seed}: stood on ${total}`);
      }
      if (move === 'hit') {
        const { total, soft } = handValue(view(state).hand.player);
        assert.ok(soft ? total < 19 : total < 17, `seed ${seed}: hit on ${total}`);
      }
      state = play(state, move);
    }
    assert.equal(status(state).over, true, `seed ${seed}: the session should finish`);
  }
});

test('the one-line summaries say where the game is up to', () => {
  const fresh = newGame({ seed: 5 });
  assert.equal(blackjack.summaryText(fresh, status(fresh)), 'New game');

  const mid = finishHand(newGame({ seed: 5 }));
  assert.match(blackjack.summaryText(mid, status(mid)), /next hand$/);

  const playing = play(mid, 'deal');
  assert.match(blackjack.summaryText(playing, status(playing)), /^Hand 2 · your move$/);
});

test('the headline names the hand, then the result, then the session', () => {
  const fresh = newGame({ seed: 5 });
  assert.equal(blackjack.headline(fresh, status(fresh)), `Hand 1 of ${MAX_HANDS}`);

  const done = finishHand(newGame({ seed: 5 }));
  assert.match(blackjack.headline(done, status(done)), /You win the hand|Dealer takes it|Push/);
});

test('replaying a long session stays cheap enough for the Pi', () => {
  let state = newGame({ seed: 21 });
  for (let hand = 0; hand < MAX_HANDS - 1; hand++) {
    state = play(finishHand(state), 'deal');
  }
  const started = performance.now();
  for (let i = 0; i < 50; i++) view(state);
  const each = (performance.now() - started) / 50;
  assert.ok(each < 10, `a full session replayed in ${each.toFixed(2)}ms, which is too slow`);
});

test('the deck never runs out, however many times you hit', () => {
  for (let seed = 0; seed < 40; seed++) {
    let state = newGame({ seed });
    let guard = 0;
    while (!status(state).handOver && guard++ < 60) state = play(state, 'hit');
    assert.ok(guard < 60, `seed ${seed}: hitting never ended the hand`);
    const { hand } = view(state);
    assert.ok(hand.done, `seed ${seed}: hitting should always end the hand`);
    assert.ok(hand.player.every((c) => Number.isInteger(c) && c >= 0 && c < 52), `seed ${seed}: dealt a card off the deck`);
  }
});
