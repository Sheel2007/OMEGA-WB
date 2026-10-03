// Blackjack: get closer to 21 than the dealer without going over.
//
// The other games are decided entirely by their moves. This one deals cards, so the
// state carries a seed and every hand's deck is shuffled from it: replaying the same
// moves deals the same cards, which is what lets a saved game be checked by replaying
// it. The dealer never makes a "move" — it plays itself out by the house rule once
// you stand, so there is nothing to store for it.
import { seededRandom } from '../../../random.js';
import { newState, restoreState } from './common.js';

export const KIND = 'blackjack';
export const NAME = 'Blackjack';
export const PLAYERS = { 1: 'You', 2: 'Dealer' };
// One player against the house, so there is nothing to choose and nothing to take back.
export const MODES = false;
export const UNDO = false;

export const MOVES = ['hit', 'stand', 'deal'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const DECK_SIZE = RANKS.length * SUITS.length;
export const BLACKJACK = 21;
// The house rule this board plays: the dealer draws to 16 and stands on all 17s.
const DEALER_STANDS = 17;
// A session is this many hands, which keeps a saved game small and quick to replay.
export const MAX_HANDS = 20;

export const rankOf = (card) => card % RANKS.length;
export const suitOf = (card) => Math.floor(card / RANKS.length);
export const isAce = (card) => rankOf(card) === 0;

// Court cards are worth ten; an ace counts as eleven until that would bust.
function faceValue(card) {
  const rank = rankOf(card);
  if (rank === 0) return 11;
  return Math.min(rank + 1, 10);
}

export function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + faceValue(card), 0);
  let aces = cards.filter(isAce).length;
  while (total > BLACKJACK && aces > 0) {
    total -= 10;
    aces--;
  }
  // "Soft" means an ace is still counting as eleven, so the hand can't bust on a hit.
  return { total, soft: aces > 0 && total <= BLACKJACK };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === BLACKJACK;

function shuffled(seed, hand) {
  // Each hand gets its own deck off the same seed, so hands stay independent and no
  // hand can run the shoe dry.
  const random = seededRandom((seed + hand * 7919) | 0);
  const deck = [...Array(DECK_SIZE).keys()];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function settle(hand) {
  const player = handValue(hand.player).total;
  const dealer = handValue(hand.dealer).total;
  const playerNatural = isBlackjack(hand.player);
  const dealerNatural = isBlackjack(hand.dealer);
  hand.done = true;
  hand.hidden = false;
  if (playerNatural || dealerNatural) {
    hand.reason = playerNatural && dealerNatural ? 'Both blackjack' : playerNatural ? 'Blackjack!' : 'Dealer blackjack';
    hand.result = playerNatural && dealerNatural ? 'push' : playerNatural ? 'you' : 'dealer';
    return hand;
  }
  if (player > BLACKJACK) {
    hand.result = 'dealer';
    hand.reason = 'Bust';
    return hand;
  }
  if (dealer > BLACKJACK) {
    hand.result = 'you';
    hand.reason = 'Dealer bust';
    return hand;
  }
  hand.result = player === dealer ? 'push' : player > dealer ? 'you' : 'dealer';
  hand.reason = hand.result === 'push' ? 'Push' : hand.result === 'you' ? `${player} beats ${dealer}` : `${dealer} beats ${player}`;
  return hand;
}

function deal(seed, index) {
  const deck = shuffled(seed, index);
  const hand = {
    index,
    deck,
    next: 4,
    player: [deck[0], deck[2]],
    dealer: [deck[1], deck[3]],
    // The dealer's second card stays face down until it's their turn to play.
    hidden: true,
    done: false,
    result: null,
    reason: null,
  };
  // A natural ends the hand before anyone acts.
  if (isBlackjack(hand.player) || isBlackjack(hand.dealer)) settle(hand);
  return hand;
}

function draw(hand) {
  return hand.deck[hand.next++];
}

function dealerPlays(hand) {
  hand.hidden = false;
  while (handValue(hand.dealer).total < DEALER_STANDS) hand.dealer.push(draw(hand));
  return settle(hand);
}

// Everything the screen needs, worked out from the moves. null if the moves don't fit.
function replay(state) {
  const seed = state.seed | 0;
  const played = [];
  let hand = deal(seed, 0);
  for (const move of state.moves) {
    if (move === 'deal') {
      if (!hand.done || played.length + 1 >= MAX_HANDS) return null;
      played.push(hand);
      hand = deal(seed, played.length);
      continue;
    }
    if (hand.done) return null;
    if (move === 'hit') {
      hand.player.push(draw(hand));
      if (handValue(hand.player).total >= BLACKJACK) {
        // Twenty-one needs no decision, so the dealer answers it straight away.
        if (handValue(hand.player).total > BLACKJACK) settle(hand);
        else dealerPlays(hand);
      }
    } else if (move === 'stand') {
      dealerPlays(hand);
    } else {
      return null;
    }
  }
  const tally = { you: 0, dealer: 0, push: 0 };
  for (const finished of [...played, ...(hand.done ? [hand] : [])]) tally[finished.result]++;
  const last = played.length + 1 >= MAX_HANDS && hand.done;
  return { hands: played, hand, tally, handNumber: played.length + 1, over: last };
}

export const newGame = (options = {}) => ({
  ...newState(KIND, options),
  // Math.random only picks which shuffle you get; from then on the hand is replayable.
  seed: Number.isInteger(options.seed) ? options.seed : (Math.random() * 0x7fffffff) | 0,
});

export function view(state) {
  return replay(state);
}

export function status(state) {
  const game = replay(state);
  const { hand, tally, over } = game;
  const winner = tally.you === tally.dealer ? null : tally.you > tally.dealer ? 1 : 2;
  return {
    over,
    winner: over ? winner : null,
    draw: over && !winner,
    // The dealer plays itself out, so it is always your turn to decide something.
    turn: 1,
    handOver: hand.done,
    result: hand.result,
    reason: hand.reason,
    handNumber: game.handNumber,
    scores: { 1: tally.you, 2: tally.dealer },
    tally,
  };
}

export function legalMoves(state) {
  const { hand, over } = replay(state);
  if (over) return [];
  return hand.done ? ['deal'] : ['hit', 'stand'];
}

export function play(state, move) {
  if (!legalMoves(state).includes(move)) return null;
  const next = { ...state, moves: [...state.moves, move] };
  return replay(next) ? next : null;
}

// Dealt cards can't be taken back, so there is nothing to undo.
export const undo = (state) => state;

export const restore = (raw) =>
  restoreState({ play }, KIND, raw, (move) => MOVES.includes(move), (saved) => ({
    ...newState(KIND, saved),
    seed: Number.isInteger(saved.seed) ? saved.seed : 0,
  }));

// The dealer's own play is forced by the house rule, so this is the player's side:
// the board playing a hand the way a sensible person would. Only used when a game
// plays itself through (the screen never asks for it, since it's always your turn).
export function computerMove(state) {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves.includes('deal')) return 'deal';
  const { total, soft } = handValue(replay(state).hand.player);
  // Stand on a hard 17 or better, and on a soft 19 or better; otherwise take a card.
  if (soft ? total >= 19 : total >= DEALER_STANDS) return 'stand';
  return 'hit';
}

export function summaryText(state, st) {
  if (st.over) return `Session over · you ${st.tally.you}, dealer ${st.tally.dealer}`;
  if (state.moves.length === 0 && !st.handOver) return 'New game';
  if (st.handOver) return `${st.reason} · next hand`;
  return `Hand ${st.handNumber} · your move`;
}

export function headline(state, st) {
  if (st.over) return st.winner === 1 ? 'You finish ahead!' : st.winner === 2 ? 'The dealer finishes ahead' : 'Dead even';
  if (st.handOver) return st.result === 'you' ? 'You win the hand' : st.result === 'dealer' ? 'Dealer takes it' : 'Push';
  return `Hand ${st.handNumber} of ${MAX_HANDS}`;
}

export function scoreText(state, st) {
  const pushes = st.tally.push ? `  ·  ${st.tally.push} push${st.tally.push === 1 ? '' : 'es'}` : '';
  return `You ${st.tally.you}  ·  Dealer ${st.tally.dealer}${pushes}`;
}
