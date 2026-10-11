// Sports: notifications at the foot of page 1 for Arsenal's and Tottenham's next
// matches, laid out like a game alert on an iPhone. Each has the app's icon, the
// match in bold with when it is beside it ("in 2 days"), a line saying where and
// when under that, and both crests at the right where a notification's picture
// goes. While a match is on it shows the score; for half an hour after, the
// result. When the two teams play each other it's one note: the North London
// Derby. Tap a note for its match page.
//
// The notes' own timer ticks once a minute, for "in 3h 20m" and the like.
import { appIcon, el, reconcile } from '../../ui.js';
import { describe, hasScore, isHalfTime, isLive, isUpcoming, meetingName, nextMatches, timeLabel, untilLabel } from './format.js';
import * as meta from './meta.js';
import { crest, liveBadge, setCrest } from './views.js';

// Whose next matches get a note (follow ids, board/sports.py).
const TEAMS = ['arsenal', 'tottenham'];
const TICK_MS = 60 * 1000;
const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// onShow(shown): the notes have come or gone (page 1 makes room for them).
export function createNextMatchNotes({ services, openApp, onShow }) {
  const { sports } = services;
  const node = el('div', { class: 'match-notes', role: 'group', 'aria-label': 'Next matches' });
  node.hidden = true;
  let state = sports.getState();
  let shown = false;

  function createNote() {
    const note = el('button', {
      class: 'match-note',
      type: 'button',
      onclick: () => openApp(meta.id, { origin: note, intent: `match-${note.dataset.key}` }),
    });
    note.append(
      appIcon(meta, 'match-note__icon'),
      el(
        'span',
        { class: 'match-note__text' },
        el('span', { class: 'match-note__head' }, el('span', { class: 'match-note__title' }), liveBadge(), el('span', { class: 'match-note__when' })),
        el('span', { class: 'match-note__body' }),
      ),
      el('span', { class: 'match-note__crests', 'aria-hidden': 'true' }, crest(null, 'match-note__crest'), crest(null, 'match-note__crest match-note__crest--away')),
    );
    return note;
  }

  function updateNote(note, match, now) {
    const [, text, crests] = note.children;
    const [title, live, when] = text.firstChild.children;
    const body = text.lastChild;
    const { home, away } = match;
    title.textContent = meetingName(match);
    live.hidden = !isLive(match);
    live.lastChild.textContent = isLive(match) ? (isHalfTime(match) ? 'HT' : match.status.clock || 'Live') : '';
    when.textContent = untilLabel(match, now);
    when.hidden = isLive(match);
    setCrest(crests.firstChild, home);
    setCrest(crests.lastChild, away);
    if (isUpcoming(match)) {
      const where = match.venue ? ` · ${match.venue}` : '';
      body.textContent = `${match.competition} · ${DATE.format(match.kickoff)} at ${timeLabel(match.kickoff)}${where}`;
    } else if (hasScore(match)) {
      body.textContent = `${home.short} ${home.score} – ${away.score} ${away.short} · ${match.competition}`;
    } else {
      body.textContent = `${match.status.detail || 'Off'} · ${match.competition}`;
    }
    note.setAttribute('aria-label', `${meetingName(match)}: ${describe(match, now)}. Open the match.`);
  }

  function render() {
    const now = new Date();
    const matches = nextMatches(state.matches, TEAMS, now);
    reconcile(node, matches, (m) => m.id, createNote, (note, m) => updateNote(note, m, now));
    node.hidden = matches.length === 0;
    if (!node.hidden !== shown) {
      shown = !node.hidden;
      onShow?.(shown);
    }
  }

  const unsubscribe = sports.subscribe((next) => {
    state = next;
    render();
  });
  const ticker = setInterval(render, TICK_MS);

  return {
    node,
    destroy() {
      unsubscribe();
      clearInterval(ticker);
    },
  };
}
