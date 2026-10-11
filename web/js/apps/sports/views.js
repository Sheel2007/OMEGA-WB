// Pieces the Sports widget, app and match page share: crests, match rows and the
// live badge.
import { el } from '../../ui.js';
import { describe, hasScore, isLive, shortDay, shortStatus } from './format.js';

// A team's crest from the Pi's copy, with its abbreviation underneath until (or
// unless) the picture loads.
export function crest(team, className = '') {
  const node = el('span', { class: `sports-crest ${className}`.trim(), 'aria-hidden': 'true' });
  setCrest(node, team);
  return node;
}

export function setCrest(node, team) {
  const id = team?.crest ?? '';
  const abbr = team?.abbr ?? '';
  if (node.dataset.crest === id && node.dataset.abbr === abbr) return;
  node.dataset.crest = id;
  node.dataset.abbr = abbr;
  node.classList.remove('sports-crest--loaded');
  node.replaceChildren(el('span', { class: 'sports-crest__abbr', text: abbr }));
  if (!id) return;
  const img = el('img', {
    class: 'sports-crest__img',
    alt: '',
    decoding: 'async',
    draggable: 'false',
    src: `/api/sports/crest?id=${encodeURIComponent(id)}`,
  });
  img.addEventListener('load', () => node.classList.add('sports-crest--loaded'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  node.append(img);
}

export function liveBadge(text = 'Live') {
  return el('span', { class: 'sports-live' }, el('span', { class: 'sports-live__dot', 'aria-hidden': 'true' }), el('span', { text }));
}

// A team's name in a row: its short name, or its abbreviation where the row is
// narrow (the stylesheet picks, from the list's width).
function teamName() {
  return el('span', { class: 'sports-row__name' }, el('span', { class: 'sports-row__short' }), el('span', { class: 'sports-row__abbr' }));
}

function setTeamName(node, team) {
  node.firstChild.textContent = team.short;
  node.lastChild.textContent = team.abbr;
}

// One match in a list: when (or the minute), both teams with their crests, the
// score, and optionally the day above the time and the competition. Tapping it
// opens the match page.
export function createMatchRow(onOpen, { competition = false, day = false } = {}) {
  const row = el('li', { class: `sports-row${day ? ' sports-row--dated' : ''}` });
  const open = el(
    'button',
    { class: 'sports-row__open', type: 'button', onclick: () => onOpen(row.dataset.key, open) },
    el('span', { class: 'sports-row__when' }, day && el('span', { class: 'sports-row__day' }), el('span', { class: 'sports-row__time' })),
    el('span', { class: 'sports-row__team sports-row__team--home' }, teamName(), crest(null, 'sports-row__crest')),
    el('span', { class: 'sports-row__score' }),
    el('span', { class: 'sports-row__team sports-row__team--away' }, crest(null, 'sports-row__crest'), teamName()),
    competition && el('span', { class: 'sports-row__comp' }),
  );
  row.append(open);
  return row;
}

export function updateMatchRow(row, match, now) {
  const open = row.firstChild;
  const [when, home, score, away, comp] = open.children;
  const live = isLive(match);
  row.classList.toggle('sports-row--live', live);
  when.lastChild.textContent = shortStatus(match);
  if (when.children.length > 1) when.firstChild.textContent = live ? 'Live' : shortDay(match.kickoff, now);
  setTeamName(home.firstChild, match.home);
  setCrest(home.lastChild, match.home);
  setCrest(away.firstChild, match.away);
  setTeamName(away.lastChild, match.away);
  home.classList.toggle('sports-row__team--lost', Boolean(match.away.winner));
  away.classList.toggle('sports-row__team--lost', Boolean(match.home.winner));
  score.textContent = hasScore(match) ? `${match.home.score} – ${match.away.score}` : 'v';
  score.classList.toggle('sports-row__score--none', !hasScore(match));
  if (comp) comp.textContent = match.competition;
  open.setAttribute('aria-label', `${describe(match, now)}. Open the match.`);
}
