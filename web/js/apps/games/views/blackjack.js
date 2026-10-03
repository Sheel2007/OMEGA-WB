// Blackjack table: the dealer's hand, yours, and the three things you can tap.
// Nothing here decides anything — the rules module settles every hand.
import { el, reducedMotion } from '../../../ui.js';
import { BLACKJACK, MAX_HANDS, RANKS, SUITS, handValue, isBlackjack, rankOf, suitOf, view } from '../rules/blackjack.js';

const DEAL_MS = 260;
// Red on white, black on white: the usual card colours, and well past 3:1 either way.
const PIPS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

export function createBlackjackView({ onMove }) {
  const dealerCards = el('div', { class: 'bj-hand__cards' });
  const dealerTotal = el('span', { class: 'bj-hand__total' });
  const playerCards = el('div', { class: 'bj-hand__cards' });
  const playerTotal = el('span', { class: 'bj-hand__total' });
  const outcome = el('p', { class: 'bj-table__outcome', role: 'status' });

  const hit = action('Hit', 'hit');
  const stand = action('Stand', 'stand');
  const next = action('Next hand', 'deal', 'bj-action--primary');
  const actions = el('div', { class: 'bj-table__actions' }, hit, stand, next);

  const node = el(
    'div',
    { class: 'bj-table', role: 'group', 'aria-label': 'Blackjack table' },
    hand('Dealer', dealerCards, dealerTotal),
    outcome,
    hand('You', playerCards, playerTotal),
    actions,
  );

  function action(label, move, extra = '') {
    return el('button', { class: `bj-action ${extra}`.trim(), type: 'button', text: label, onclick: () => onMove(move) });
  }

  function hand(who, cards, total) {
    return el(
      'section',
      { class: `bj-hand bj-hand--${who.toLowerCase()}`, 'aria-label': `${who}’s hand` },
      el('header', { class: 'bj-hand__head' }, el('h2', { class: 'bj-hand__who', text: who }), total),
      cards,
    );
  }

  // One card. `null` is the dealer's face-down card.
  function card(value) {
    if (value === null) return el('div', { class: 'bj-card bj-card--back', 'aria-label': 'Face-down card' });
    const suit = SUITS[suitOf(value)];
    const rank = RANKS[rankOf(value)];
    const red = suit === 'hearts' || suit === 'diamonds';
    return el(
      'div',
      {
        class: `bj-card bj-card--${red ? 'red' : 'black'}`,
        'aria-label': `${rank} of ${suit}`,
        dataset: { card: String(value) },
      },
      el('span', { class: 'bj-card__rank', text: rank }),
      el('span', { class: 'bj-card__pip', text: PIPS[suit] }),
    );
  }

  // Rebuilds a hand, animating only cards that weren't there before (one-shot).
  function renderHand(parent, cards, { animate }) {
    const before = new Set([...parent.children].map((node_) => node_.dataset.card ?? 'back'));
    parent.replaceChildren(...cards.map(card));
    if (!animate || reducedMotion.matches) return;
    [...parent.children].forEach((node_) => {
      if (before.has(node_.dataset.card ?? 'back')) return;
      node_.animate([{ opacity: 0, transform: 'translateY(-1.2rem) scale(0.94)' }, { opacity: 1, transform: 'none' }], {
        duration: DEAL_MS,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    });
  }

  function totalLabel(cards, hidden) {
    if (hidden) return '?';
    const { total, soft } = handValue(cards);
    if (isBlackjack(cards)) return 'Blackjack';
    if (total > BLACKJACK) return `${total} — bust`;
    return soft ? `${total} (soft)` : String(total);
  }

  let shownMoves = -1;

  function render(state, { locked }) {
    const { hand: current, over, handNumber } = view(state);
    const animate = state.moves.length !== shownMoves;
    shownMoves = state.moves.length;

    // The hole card is a blank until the dealer plays.
    const dealerShown = current.hidden ? [current.dealer[0], null] : current.dealer;
    renderHand(dealerCards, dealerShown, { animate });
    renderHand(playerCards, current.player, { animate });
    dealerTotal.textContent = totalLabel(current.dealer, current.hidden);
    playerTotal.textContent = totalLabel(current.player, false);

    outcome.textContent = current.done && current.reason ? current.reason : '';
    outcome.hidden = !outcome.textContent;
    outcome.dataset.result = current.done ? current.result : '';

    const playing = !current.done && !over;
    hit.hidden = !playing;
    stand.hidden = !playing;
    hit.disabled = locked;
    stand.disabled = locked;
    next.hidden = !current.done || over;
    next.disabled = locked;
    next.textContent = handNumber >= MAX_HANDS ? 'Last hand' : 'Next hand';
    actions.hidden = over;
  }

  return { node, render, destroy() {} };
}
