// Unspeakable: the home-screen widget. The newest cases, each under its own censor
// bar, dressed up as one of three looks (looks.js) so a guest notices it from across
// the room: a file under crime-scene tape, a classified dossier, or an evidence wall.
// It says how much the board is holding without saying what, and it plays two jokes:
// a first tap is told "Access denied" (a second gets in), and a new case is stamped
// SEALED on every screen.
import { appIcon, el, fitRows, haptic, icons, nudge, reconcile } from '../../ui.js';
import { caseDate, caseLabel, moreLabel, numbered, shortCountLabel, tallyLabel } from './format.js';
import {
  DENY_MS,
  WALL_CARDS,
  barWidth,
  denialLine,
  fileNumber,
  lookOf,
  newlySealed,
  stringPoints,
  tapAgain,
  tapeLines,
  tapeText,
  wallSlots,
} from './looks.js';
import * as meta from './meta.js';

// Newest first. The list looks hide whichever of these don't fit (fitRows); the
// evidence wall pins up as many as its size has room for (WALL_CARDS).
const CASES_IN_WIDGET = Math.max(...Object.values(WALL_CARDS));

export function createWidget({ services, openApp }) {
  const { unspeakable } = services;
  const count = el('p', { class: 'widget-head__meta' });
  const list = el('ul', { class: 'ledger-widget__list' });
  const more = el('p', { class: 'ledger-widget__more' });
  const tally = el('p', { class: 'ledger-widget__tally' });
  const empty = el(
    'div',
    { class: 'ledger-widget__empty' },
    el('p', { class: 'ledger-widget__empty-title', text: 'Nothing on the record' }),
    el('p', { class: 'ledger-widget__empty-text', text: 'Suspicious. Tap + to fix that.' }),
  );

  // What each look adds to the file. All of it is always here; unspeakable.css shows
  // the pieces that belong to the look on screen.
  const tab = el('p', { class: 'ledger-scene__tab' });
  const tapes = [1, 2].map((n) =>
    el('p', { class: `ledger-scene__tape ledger-scene__tape--${n}`, 'aria-hidden': 'true' }),
  );
  const secret = el('p', { class: 'ledger-scene__stamp ledger-scene__stamp--secret', 'aria-hidden': 'true', text: 'Top secret' });
  const string = el('div', {
    class: 'ledger-scene__string',
    'aria-hidden': 'true',
    html: '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="" /></svg>',
  });
  const stringLine = string.querySelector('polyline');
  const note = el('p', { class: 'ledger-scene__note', 'aria-hidden': 'true' }, el('span', { class: 'ledger-card__pin' }), 'Who??');
  const sealed = el('p', { class: 'ledger-scene__stamp ledger-scene__stamp--sealed', 'aria-hidden': 'true', text: 'Sealed' });

  // Access denied: what a first tap gets instead of the app.
  const deniedLine = el('p', { class: 'ledger-denied__line' });
  const denied = el(
    'div',
    { class: 'ledger-denied', 'aria-hidden': 'true' },
    el('p', { class: 'ledger-scene__stamp ledger-denied__stamp', text: 'Access denied' }),
    deniedLine,
  );
  const live = el('p', { class: 'ledger-widget__live', 'aria-live': 'polite' });

  const scene = el(
    'div',
    { class: 'ledger-widget__scene' },
    tab,
    el('div', { class: 'ledger-scene__paper' }, list, empty, el('div', { class: 'ledger-scene__foot' }, more, tally)),
    string,
    note,
    ...tapes,
    secret,
    sealed,
    denied,
  );

  const node = el('article', { class: 'ledger-widget', 'aria-label': meta.name });
  node.append(
    el('a', {
      class: 'widget__link',
      href: `#/app/${meta.id}`,
      'aria-label': `Open ${meta.name}`,
      onclick: (event) => {
        event.preventDefault();
        tap();
      },
    }),
    el(
      'header',
      { class: 'widget-head' },
      appIcon(meta, 'widget-head__icon'),
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), count),
      el('button', {
        class: 'widget-head__action',
        type: 'button',
        'aria-label': 'Seal an unspeakable thing',
        html: icons.plus,
        onclick: () => openApp(meta.id, { origin: node, intent: 'add' }),
      }),
    ),
    scene,
    live,
  );

  // Two taps to get in

  // The taps still inside the window (tapAgain), and the one timer that ends it.
  let taps = [];
  let denyTimer = null;

  function shut() {
    clearTimeout(denyTimer);
    denyTimer = null;
    taps = [];
    node.classList.remove('is-denied');
    live.textContent = '';
  }

  function tap() {
    const result = tapAgain(taps, Date.now());
    taps = result.taps;
    if (result.opened) {
      shut();
      openApp(meta.id, { origin: node });
      return;
    }
    clearTimeout(denyTimer);
    deniedLine.textContent = denialLine(unspeakable.getAttempts());
    // Off and on again, so the stamp lands afresh if it was already showing.
    node.classList.remove('is-denied');
    void node.offsetWidth;
    node.classList.add('is-denied');
    nudge(node);
    haptic();
    live.textContent = 'Access denied. Tap again to open.';
    // Nobody tapped again: they gave up, which is what the tally counts. A roommate's
    // second tap ends this first, so getting in is never counted.
    denyTimer = setTimeout(() => {
      shut();
      unspeakable.reportAttempt().catch(() => {});
    }, DENY_MS);
  }

  // One-shot animations clean up after themselves, so moving the widget to another
  // page (which re-inserts it) doesn't play them again.
  function onAnimationEnd(event) {
    if (event.target === node) node.classList.remove('is-nudged');
    if (event.target === sealed) {
      scene.classList.remove('is-sealing');
      list.querySelector('.is-inking')?.classList.remove('is-inking');
    }
  }
  node.addEventListener('animationend', onAnimationEnd);

  // Drawing

  let total = 0;
  // Beside the tally, the count of cases that don't fit keeps to a few words, so the
  // foot stays one line.
  const describeMore = (hidden) => moreLabel(hidden, !tally.hidden);
  let look = lookOf(unspeakable.getLook());
  // The ids drawn last time, to tell a case that was just sealed from the rest.
  let seen = null;

  // Which cases show, and where. Runs again whenever the widget changes size.
  function arrange() {
    const rows = [...list.children];
    if (look !== 'wall') {
      stringLine.setAttribute('points', '');
      fitRows(list, more, total, describeMore);
      return;
    }
    const slots = wallSlots(rows.length, node.dataset.size);
    rows.forEach((row, index) => {
      const pin = slots.cards[index];
      row.hidden = !pin;
      if (!pin) return;
      row.style.setProperty('--pin-x', `${pin.x}%`);
      row.style.setProperty('--pin-y', `${pin.y}%`);
      row.style.setProperty('--pin-tilt', `${pin.rot}deg`);
    });
    note.style.setProperty('--pin-x', `${slots.note.x}%`);
    note.style.setProperty('--pin-y', `${slots.note.y}%`);
    note.style.setProperty('--pin-tilt', `${slots.note.rot}deg`);
    stringLine.setAttribute('points', stringPoints(slots));
    const hidden = total - slots.cards.length;
    more.hidden = hidden <= 0;
    if (hidden > 0) more.textContent = describeMore(hidden);
  }

  function render(state) {
    const all = numbered(state.entries);
    total = all.length;
    look = lookOf(state.look);
    node.dataset.look = look;
    count.textContent = shortCountLabel(total);
    reconcile(
      list,
      all.slice(0, CASES_IN_WIDGET),
      (e) => e.id,
      () =>
        el(
          'li',
          { class: 'ledger-card ledger-card--mini' },
          el('span', { class: 'ledger-card__pin' }),
          el('span', { class: 'ledger-card__label' }, el('span', { class: 'ledger-card__case' }), el('span', { class: 'ledger-card__date' })),
          el('span', { class: 'ledger-card__bar' }),
        ),
      (card, entry) => {
        const [, label, bar] = card.children;
        const [caseNumber, date] = label.children;
        caseNumber.textContent = caseLabel(entry.number);
        date.textContent = caseDate(entry.created);
        // Never the text itself: nothing on the board gives an entry away.
        card.setAttribute('aria-label', `${caseLabel(entry.number)}, sealed`);
        bar.style.setProperty('--bar', `${barWidth(entry.text)}%`);
      },
    );
    list.hidden = total === 0;
    empty.hidden = total > 0;

    const [first, second] = tapeLines(total);
    tapes[0].textContent = tapeText(first);
    tapes[1].textContent = tapeText(second);
    tab.textContent = `File ${fileNumber(total)}`;
    const attempts = state.attempts ?? 0;
    tally.hidden = attempts <= 0;
    tally.textContent = tallyLabel(attempts);

    // Until the ledger has arrived from the board (version -1), the whole file is
    // about to turn up at once, and none of it was just sealed.
    const loaded = state.version >= 0;
    const fresh = loaded ? newlySealed(seen, state.entries) : null;
    seen = loaded ? new Set(state.entries.map((entry) => entry.id)) : null;
    if (fresh) {
      list.querySelector('.is-inking')?.classList.remove('is-inking');
      list.querySelector(`[data-key="${fresh}"]`)?.classList.add('is-inking');
      scene.classList.remove('is-sealing');
      void scene.offsetWidth;
      scene.classList.add('is-sealing');
    }
    arrange();
  }

  const unsubscribe = unspeakable.subscribe(render);
  // The scene changes size with the widget (and the list with the scene), and both
  // decide what fits.
  const resizes = new ResizeObserver(() => arrange());
  resizes.observe(scene);
  resizes.observe(list);
  render(unspeakable.getState());

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      shut();
      node.removeEventListener('animationend', onAnimationEnd);
    },
  };
}
