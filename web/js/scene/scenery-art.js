// The Blocks theme's land, dressed for each season: the floor (grass over dirt),
// the hills, the trees and a strip of flowers, grass or fallen leaves growing out
// of the turf. Our own pixel art. sceneryVars() turns it into the --art-* custom
// properties scene.css draws with; main.js sets them when the season changes or
// night falls (the land goes dark at night, the sky, sun and moon don't).
import { mixHex } from '../color.js';
import { dataUri, pixelSvg } from '../pixel-art.js';
import { SEASONS } from './seasons.js';

// Night: every colour of the land mixed this far towards deep blue.
export const NIGHT_SHADE = { colour: '#060a22', amount: 0.55 };
export const nightColour = (colour) => mixHex(colour, NIGHT_SHADE.colour, NIGHT_SHADE.amount);

// a, b, c: the top (grass, or snow in winter); d, e, f: dirt.
const FLOOR = [
  'aabaaacaaaabaaca',
  'acaaabaacaaaaaab',
  'aaacaaaaaabacaaa',
  'adaadcaadaacdaad',
  'dddedddfddddeddd',
  'dfddddedddfddddd',
  'ddddfdddeddddded',
  'edddddddddfdddfd',
  'ddfdeddfddddeddd',
  'dddddddddedddddd',
  'deddfdddfdddfdde',
  'ddddddedddddddfd',
  'fdddeddddfdedddd',
  'dddfddddeddddddd',
  'ddedddfdddddfded',
  'dddddddddedddddd',
];

const HILL = [
  '............aaaaaaaa............',
  '............abaaacaa............',
  '........aaaaaaaaaaaaaaaa........',
  '........aacaaaaabaaacaaa........',
  '....aaaaaaaaaaaaaaaaaaaaaaaa....',
  '....acaaaabaaaacaaaaaabaaaca....',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'aabaacaaaaaaabaaaacaaaabaaaacaaa',
  'aaaaaaaaacaaaaaaaaaaaaaaaaaaaaaa',
];

// a, b: leaves (or blossom); c, d: trunk.
const TREE = [
  '..aaaaaa..',
  '.aabaaaaa.',
  'aaaaaabaaa',
  'abaaaaaaaa',
  'aaaabaaaba',
  '.aaaaaaaa.',
  '....cc....',
  '....cd....',
  '....cc....',
  '....dc....',
];

// Winter: bare branches (c, d) with snow (s, S) along their tops.
const BARE_TREE = [
  '.ss...ss..',
  '.cc.s.dc.s',
  '..cs.cc.sc',
  'ss.cc.d.c.',
  '.dc.cc.c..',
  '...ccdc...',
  '....cc....',
  '....cd....',
  '....cc....',
  '....dc....',
];

// The strip along the turf, 48 x 5, repeated across the screen. Its bottom two
// rows sit in the grass, so it shows below the widgets too.
const FLORA_SIZE = { width: 48, height: 5 };

const FLOWERS = {
  tulip: ['r.r', 'rrr', '.g.', 'gg.', '.g.'],
  daisy: ['.w.', 'wyw', '.w.', '.g.', '.g.'],
  bell: ['.p.', 'ppp', 'p.p', '.g.', '.g.'],
  tuft: ['...', '...', 'g.g', 'GgG', '.g.'],
  tall: ['.G.', 'g.G', 'gG.', '.gg', '.g.'],
  pile: ['......', '......', '..rl..', '.lrlr.', 'rlrrlr'],
  pumpkin: ['.....', '..t..', '.pPp.', 'pPpPp', '.pPp.'],
  leaf: ['...', '...', '...', '.r.', 'l..'],
};

function strip(placements) {
  const rows = Array.from({ length: FLORA_SIZE.height }, () => Array(FLORA_SIZE.width).fill('.'));
  for (const [name, x] of placements) {
    FLOWERS[name].forEach((line, y) => {
      [...line].forEach((ch, i) => {
        if (ch !== '.') rows[y][x + i] = ch;
      });
    });
  }
  return rows.map((row) => row.join(''));
}

const FLORA = {
  spring: strip([['tulip', 3], ['tuft', 9], ['daisy', 14], ['bell', 22], ['tuft', 28], ['tulip', 33], ['daisy', 41]]),
  summer: strip([['tall', 2], ['tuft', 8], ['tall', 15], ['daisy', 21], ['tuft', 27], ['tall', 34], ['tuft', 41]]),
  autumn: strip([['pile', 2], ['leaf', 11], ['pumpkin', 17], ['leaf', 26], ['pile', 31], ['leaf', 42]]),
  winter: null,
};

const PALETTES = {
  spring: {
    floor: { a: '#66b23e', b: '#8fd05a', c: '#4f9a2f', d: '#8a5a2b', e: '#6e4520', f: '#a06c38' },
    hill: { a: '#5aa83a', b: '#7cc24c', c: '#468a2a' },
    tree: { a: '#f2a7c3', b: '#fde0ea', c: '#7a4e24', d: '#5c3a1a' },
    flora: { r: '#e0403a', w: '#ffffff', y: '#f5c518', p: '#7a6cf0', g: '#3d8a24', G: '#7cc24c' },
  },
  summer: {
    floor: { a: '#5fa83a', b: '#7cc24c', c: '#4c8f2c', d: '#8a5a2b', e: '#6e4520', f: '#a06c38' },
    hill: { a: '#4f9a2f', b: '#6db540', c: '#3d7f22' },
    tree: { a: '#3f8a2a', b: '#5aa83a', c: '#7a4e24', d: '#5c3a1a' },
    flora: { w: '#ffffff', y: '#f5c518', g: '#3d8a24', G: '#7cc24c' },
  },
  autumn: {
    floor: { a: '#8f9a3a', b: '#b3ab45', c: '#727c2c', d: '#8a5a2b', e: '#6e4520', f: '#a06c38' },
    hill: { a: '#a8953a', b: '#c9ad4a', c: '#86702c' },
    tree: { a: '#d9702b', b: '#f2b33d', c: '#7a4e24', d: '#5c3a1a' },
    flora: { r: '#c8452a', l: '#eba33a', p: '#e2781f', P: '#b8561a', t: '#5c7a24' },
  },
  winter: {
    floor: { a: '#eef4fc', b: '#ffffff', c: '#c9d6ea', d: '#8a5a2b', e: '#6e4520', f: '#a06c38' },
    hill: { a: '#e3ebf6', b: '#ffffff', c: '#bccbe2' },
    tree: { c: '#7a4e24', d: '#5c3a1a', s: '#ffffff', S: '#c9d6ea' },
    flora: {},
  },
};

// Each season's drawings: { rows, palette } for the floor, hill, tree and flora
// (flora is null when there's none, in winter).
export function sceneryArt(season) {
  const known = Object.hasOwn(PALETTES, season) ? season : 'summer';
  const palette = PALETTES[known];
  const flora = FLORA[known];
  return {
    floor: { rows: FLOOR, palette: palette.floor },
    hill: { rows: HILL, palette: palette.hill },
    tree: { rows: known === 'winter' ? BARE_TREE : TREE, palette: palette.tree },
    flora: flora ? { rows: flora, palette: palette.flora } : null,
  };
}

function shaded(palette, night) {
  return night ? Object.fromEntries(Object.entries(palette).map(([ch, c]) => [ch, nightColour(c)])) : palette;
}

// The --art-* custom properties for a season, by day or by night.
export function sceneryVars(season, { night = false } = {}) {
  const art = sceneryArt(season);
  const url = (piece) => (piece ? `url("${dataUri(pixelSvg(piece.rows, shaded(piece.palette, night)))}")` : 'none');
  return {
    '--art-floor': url(art.floor),
    '--art-hill': url(art.hill),
    '--art-tree': url(art.tree),
    '--art-flora': url(art.flora),
  };
}

// The colours a critter can end up standing in front of: the hills and trees.
export function landColours(season, { night = false } = {}) {
  const art = sceneryArt(season);
  return [...Object.values(art.hill.palette), ...Object.values(art.tree.palette)].map((c) => (night ? nightColour(c) : c));
}

export { FLORA_SIZE, SEASONS };
