// Unspeakable's looks: what the home-screen widget dresses its redacted file up as,
// and the small decisions behind the jokes it plays (what the tape says, what a
// turned-away tap is told, where the evidence wall pins its cards). Pure, so it's
// tested in node; widget.js draws what this decides.
import { knock } from '../../knock.js';

// The same ids the server stores (LOOKS in board/unspeakable.py).
export const LOOKS = [
  { id: 'tape', label: 'Crime scene' },
  { id: 'dossier', label: 'Dossier' },
  { id: 'wall', label: 'Evidence wall' },
];
export const DEFAULT_LOOK = 'tape';

export function lookOf(id) {
  return LOOKS.some((look) => look.id === id) ? id : DEFAULT_LOOK;
}

// Crime scene: two strips of tape, each saying something different, and a new
// pair every time a case is added or struck.
const TAPE_LINES = ['DO NOT ASK', 'NOTHING HAPPENED HERE', 'MOVE ALONG', 'NOTHING TO SEE'];

export function tapeLines(count) {
  const at = Math.max(0, Math.floor(count) || 0);
  return [TAPE_LINES[at % TAPE_LINES.length], TAPE_LINES[(at + 1) % TAPE_LINES.length]];
}

// A strip is longer than the widget is wide, so its line repeats along it.
export function tapeText(line, times = 6) {
  return Array.from({ length: times }, () => line).join(' · ');
}

// Dossier: the folder's tab.
export function fileNumber(count) {
  return String(Math.max(0, Math.floor(count) || 0)).padStart(3, '0');
}

// A bar as long as the entry, within reason, so the file looks like one (percent).
export function barWidth(text) {
  return Math.min(100, 40 + String(text ?? '').length * 1.6);
}

// Access denied: what the widget tells a first tap. The tally of people turned
// away picks the line, so the next person gets the next one.
const DENIALS = [
  'Your curiosity has been noted.',
  'This incident did not occur.',
  'Nice try.',
  'Clearance level: guest.',
  'We will not be taking questions.',
];
// How long the widget stays shut after a first tap. A second tap inside it opens the app.
export const DENY_MS = 3000;

export function denialLine(attempts) {
  const at = Math.max(0, Math.floor(attempts) || 0);
  return DENIALS[at % DENIALS.length];
}

// Adds a tap on the widget at `now`. Two inside the window open it; `taps` is what
// to remember for next time (see knock.js, which this is a two-tap version of).
export function tapAgain(taps, now) {
  return knock(taps, now, { taps: 2, withinMs: DENY_MS });
}

// The id of the case that was just sealed: one on top of the pile that the widget
// hadn't drawn before. `seen` is null the first time it draws, when nothing is news.
export function newlySealed(seen, entries) {
  const top = entries[0];
  return seen && top && !seen.has(top.id) ? top.id : null;
}

// Evidence wall: where each index card's pin goes, in percent of the corkboard
// (the pin is the middle of the card's top edge), and how far the card hangs
// crooked, in degrees. Newest case first. `note` is the sticky note the string ends at.
const WALL = {
  small: {
    cards: [
      { x: 27, y: 7, rot: -5 },
      { x: 72, y: 13, rot: 4 },
      { x: 30, y: 45, rot: 3 },
    ],
    note: { x: 76, y: 52, rot: -6 },
  },
  medium: {
    cards: [
      { x: 17, y: 7, rot: -5 },
      { x: 49, y: 13, rot: 3 },
      { x: 82, y: 6, rot: -3 },
      { x: 58, y: 51, rot: 4 },
    ],
    note: { x: 86, y: 55, rot: -6 },
  },
  large: {
    cards: [
      { x: 27, y: 5, rot: -5 },
      { x: 72, y: 9, rot: 4 },
      { x: 30, y: 30, rot: 3 },
      { x: 74, y: 35, rot: -4 },
      { x: 27, y: 56, rot: -3 },
      { x: 71, y: 61, rot: 5 },
    ],
    note: { x: 50, y: 83, rot: -6 },
  },
};

// How many cases each size of widget pins up.
export const WALL_CARDS = Object.fromEntries(Object.entries(WALL).map(([size, wall]) => [size, wall.cards.length]));

export function wallSlots(count, size) {
  const wall = WALL[size] ?? WALL.small;
  return { cards: wall.cards.slice(0, Math.max(0, count)), note: wall.note };
}

// The red string: pin to pin, then to the note. `points` for an SVG polyline drawn
// on a 100 × 100 box stretched over the corkboard.
export function stringPoints({ cards, note }) {
  if (cards.length === 0) return '';
  return [...cards, note].map((pin) => `${pin.x},${pin.y}`).join(' ');
}
