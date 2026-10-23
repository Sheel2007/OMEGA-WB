// What falls past the Blocks scenery: rain or snow while it's really raining or
// snowing at home, otherwise petals in spring and leaves in autumn (in short gusts
// every few minutes), and nothing in a dry summer or winter.
//
// One repeating tile of pixel art slid diagonally across the sky: the scene moves
// a single layer by transform a few times a second, and it wraps after one tile,
// so it never repaints. Pure, so the timings can be tested.
import { dataUri, pixelSvg } from '../pixel-art.js';
import { seededRandom } from '../random.js';

// Art pixels square: big enough that the repeat doesn't show as a grid.
export const TILE = 48;

// tickMs: how often the scene moves it. vx, vy: art pixels per second (vy > 0
// falls). gusts: comes and goes rather than falling all the time.
export const FALLS = {
  rain: { tickMs: 125, vx: -4, vy: 32, gusts: false },
  snow: { tickMs: 250, vx: 1, vy: 4, gusts: false },
  petals: { tickMs: 250, vx: 4, vy: 3, gusts: true },
  leaves: { tickMs: 250, vx: 5, vy: 4, gusts: true },
};

const GUST_MS = [16000, 24000];
const GUST_GAP_MS = [60000, 180000];
const FIRST_GUST_MS = [8000, 30000];
// How long a gust takes to fade in or out (matches the animations in scene.css).
export const FADE_MS = 1500;

// The season's fall, unless the weather has something to say.
export function fallFor({ season, precipitation = null }) {
  if (precipitation === 'rain' || precipitation === 'snow') return precipitation;
  if (season === 'spring') return 'petals';
  if (season === 'autumn') return 'leaves';
  return null;
}

// Where the layer is, in whole art pixels, each between 0 and one tile: worked out
// from the time alone, so it doesn't matter how often (or late) the ticker runs.
export function fallOffset(runMs, fall) {
  const wrap = (v) => ((Math.floor((runMs * v) / 1000) % TILE) + TILE) % TILE;
  return { x: wrap(fall.vx), y: wrap(fall.vy) };
}

const between = (random, [lo, hi]) => lo + random() * (hi - lo);

// The next gust: how long until it starts, and how long it blows.
export function planGust(random, { first = false } = {}) {
  return {
    in: Math.round(between(random, first ? FIRST_GUST_MS : GUST_GAP_MS)),
    lasts: Math.round(between(random, GUST_MS)),
  };
}

// The ticker's next wait: as soon as anything needs moving or starting.
export function tickDelay({ visit = false, untilVisit = Infinity, fallTickMs = null, untilChange = Infinity, cloudTickMs = 1000, critterTickMs = 125 }) {
  const moving = [cloudTickMs];
  if (visit) moving.push(critterTickMs);
  else moving.push(untilVisit);
  if (fallTickMs !== null) moving.push(fallTickMs);
  moving.push(untilChange);
  return Math.max(0, Math.min(...moving));
}

const SPRITES = {
  rain: [['b', 'b', 'B'], ['b', 'B'], ['b', 'b', 'b', 'B']],
  snow: [['w'], ['ww', 'ww'], ['.w.', 'www', '.w.'], ['W']],
  petals: [['pP'], ['p'], ['P', 'p'], ['pp']],
  leaves: [['oo', 'o.'], ['rr', '.r'], ['y', 'yy'], ['.o', 'oO'], ['r']],
};

const COUNTS = { rain: 24, snow: 22, petals: 12, leaves: 12 };

const PALETTES = {
  rain: { b: '#9ec4ff', B: '#d6e6ff' },
  snow: { w: '#ffffff', W: '#d8e4f6' },
  petals: { p: '#f7b6cf', P: '#ffe3ee' },
  leaves: { o: '#e2781f', O: '#b8561a', r: '#c8452a', y: '#eba33a' },
};

// One tile: a few bits placed at random (the same every time), none touching,
// none cut by the tile's edge.
const SEEDS = { rain: 11, snow: 23, petals: 37, leaves: 41 };

export function fallTile(kind) {
  const random = seededRandom(SEEDS[kind]);
  const rows = Array.from({ length: TILE }, () => Array(TILE).fill('.'));
  const taken = (x, y, w, h) => {
    for (let r = Math.max(0, y - 1); r <= Math.min(TILE - 1, y + h); r++) {
      for (let c = Math.max(0, x - 1); c <= Math.min(TILE - 1, x + w); c++) if (rows[r][c] !== '.') return true;
    }
    return false;
  };
  const sprites = SPRITES[kind];
  let placed = 0;
  for (let tries = 0; placed < COUNTS[kind] && tries < 2000; tries++) {
    const sprite = sprites[placed % sprites.length];
    const h = sprite.length;
    const w = Math.max(...sprite.map((line) => line.length));
    const x = Math.floor(random() * (TILE - w));
    const y = Math.floor(random() * (TILE - h));
    if (taken(x, y, w, h)) continue;
    sprite.forEach((line, r) => [...line].forEach((ch, c) => ch !== '.' && (rows[y + r][x + c] = ch)));
    placed++;
  }
  return rows.map((row) => row.join(''));
}

const art = new Map();

// The tile as a CSS url(), made once per kind.
export function fallArt(kind) {
  if (!art.has(kind)) art.set(kind, `url("${dataUri(pixelSvg(fallTile(kind), PALETTES[kind]))}")`);
  return art.get(kind);
}

// ?weather=rain, snow or none previews the scenery in other weather.
export function parseWeather(value) {
  return ['rain', 'snow', 'none'].includes(value) ? value : null;
}

export { PALETTES as FALL_PALETTES };
