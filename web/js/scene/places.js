// Zen mode's places: closer, more detailed views of the Blocks world, from a
// meadow dressed for the real season to forests, deserts, snowy taiga, beaches,
// caves, a fiery underworld and floating isles. All our own pixel art, drawn here
// from a few tools (silhouettes, trees, ground, plants) and a palette per place,
// with seeded randomness so a place always looks the same. Pure: main.js turns a
// place into the --zen-* custom properties scene.css draws Zen's land with.
//
// Layers, back to front: far (mountains, dunes, mesas…), mid (hills, sea…),
// trees, floor (a 16 x 16 block repeated), flora (plants along the turf), and for
// places with no sky a backdrop (rock or void) and a ceiling.
import { dataUri, pixelSvg } from '../pixel-art.js';
import { seededRandom } from '../random.js';
import { nightColour } from './scenery-art.js';

// Art pixels: width x height of each layer's repeating strip.
export const LAYERS = {
  far: [240, 52],
  mid: [160, 30],
  trees: [128, 44],
  floor: [16, 16],
  flora: [64, 8],
  ceiling: [128, 20],
  backdrop: [64, 64],
};

class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.cells = Array.from({ length: h }, () => Array(w).fill('.'));
  }

  // Strips repeat sideways, so anything drawn off one edge comes in at the other.
  set(x, y, ch) {
    const row = Math.round(y);
    if (row < 0 || row >= this.h) return;
    this.cells[row][((Math.round(x) % this.w) + this.w) % this.w] = ch;
  }

  get(x, y) {
    const row = Math.round(y);
    if (row < 0 || row >= this.h) return '.';
    return this.cells[row][((Math.round(x) % this.w) + this.w) % this.w];
  }

  fill(x, y, w, h, ch) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
  }

  rows() {
    return this.cells.map((row) => row.join(''));
  }
}

// A height that repeats exactly across the strip's width: a few sine waves with
// whole numbers of cycles.
function wave(width, random, terms) {
  const phases = terms.map(() => random() * Math.PI * 2);
  return (x) => terms.reduce((sum, [cycles, amp], i) => sum + amp * Math.sin((2 * Math.PI * cycles * x) / width + phases[i]), 0);
}

// Silhouettes ---------------------------------------------------------------

// Land against the sky: filled up to a wavy height, a light edge along the top,
// specks of shade, and optional snow above a line or flat bands (mesas).
function skyline(g, random, { base, terms, step = 1, flat = null, snowAbove = null, bands = null }) {
  const f = wave(g.w, random, terms);
  const heights = [];
  for (let x = 0; x < g.w; x++) {
    let h = base + f(x);
    if (flat !== null) h = Math.min(h, flat);
    heights.push(Math.max(0, Math.min(g.h, Math.round(h / step) * step)));
  }
  for (let x = 0; x < g.w; x++) {
    const top = g.h - heights[x];
    for (let y = top; y < g.h; y++) {
      let ch = bands ? bands[Math.floor((g.h - y) / 3) % bands.length] : 'a';
      if (snowAbove !== null && g.h - y > snowAbove && y - top < 3) ch = 's';
      else if (y === top) ch = heights[x] >= heights[(x + g.w - 1) % g.w] ? 'b' : 'c';
      else if (!bands && random() < 0.05) ch = 'c';
      g.set(x, y, ch);
    }
  }
}

// Calm water across the bottom rows, with light glints and a line of foam.
function sea(g, random, { rows, lilies = false }) {
  for (let y = g.h - rows; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let ch = y === g.h - rows ? 'w' : 'v';
      if (y > g.h - rows && random() < 0.06) ch = 'w';
      if (y === g.h - 1 && random() < 0.5) ch = 'f';
      g.set(x, y, ch);
    }
  }
  if (lilies) {
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(random() * g.w);
      const y = g.h - rows + 1 + Math.floor(random() * (rows - 2));
      g.fill(x, y, 3, 1, 'l');
      if (random() < 0.4) g.set(x + 1, y - 1, 'p');
    }
  }
}

// Islands floating in the void: a flat top, rock narrowing in steps below it,
// and the odd strand hanging off the bottom.
function floatingIsles(g, random) {
  const spacing = g.w / 4;
  for (let i = 0; i < 4; i++) {
    const w = 18 + Math.floor(random() * 18);
    const x = Math.round(i * spacing + random() * (spacing - w));
    const y = 4 + Math.floor(random() * (g.h - 30));
    g.fill(x, y, w, 2, 'b');
    let left = x;
    let width = w;
    for (let row = 2; width > 2; row++) {
      g.fill(left, y + row, width, 1, row % 3 === 0 ? 'c' : 'a');
      if (row % 2 === 0) {
        const cut = 1 + Math.floor(random() * 3);
        left += cut;
        width -= cut + 1 + Math.floor(random() * 3);
      }
    }
    for (let k = 0; k < 3; k++) {
      const sx = x + 3 + Math.floor(random() * (w - 6));
      for (let s = 0; s < 3 + Math.floor(random() * 5); s++) if (g.get(sx, y + 2 + s) === '.') g.set(sx, y + 2 + s, 'c');
    }
  }
}

// Thin spikes of ice standing up from the ground.
function spikes(g, random) {
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(random() * g.w);
    const h = 14 + Math.floor(random() * (g.h - 16));
    const w = 2 + Math.floor(random() * 3);
    for (let y = 0; y < h; y++) {
      const width = Math.max(1, Math.round(w * (1 - y / h) + 0.5));
      for (let dx = 0; dx < width; dx++) g.set(x + dx - Math.floor(width / 2), g.h - 1 - y, dx === 0 ? 'b' : 'a');
    }
  }
}

// A wall of dark rock with molten falls pouring down it (the underworld's distance).
function lavaFalls(g, random) {
  skyline(g, random, { base: 34, terms: [[2, 6], [5, 3], [11, 2]] });
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(random() * g.w);
    const w = 2 + Math.floor(random() * 3);
    for (let y = 0; y < g.h; y++) {
      if (g.get(x, y) === '.') continue;
      for (let dx = 0; dx < w; dx++) g.set(x + dx, y, (y + dx) % 4 === 0 ? 'F' : 'f');
    }
  }
}

const FAR = {
  mountains: (g, r) => skyline(g, r, { base: 26, terms: [[1, 9], [3, 6], [7, 3], [13, 1.5]], snowAbove: 38 }),
  softMountains: (g, r) => skyline(g, r, { base: 22, terms: [[1, 7], [2, 5], [5, 3]] }),
  peaks: (g, r) => skyline(g, r, { base: 30, terms: [[2, 12], [5, 7], [11, 3]], step: 2, snowAbove: 30 }),
  dunes: (g, r) => skyline(g, r, { base: 14, terms: [[2, 6], [3, 4], [7, 1.5]] }),
  mesas: (g, r) => skyline(g, r, { base: 22, terms: [[2, 14], [3, 8], [9, 2]], flat: 30, step: 3, bands: ['a', 'b', 'c', 'd'] }),
  plateaus: (g, r) => skyline(g, r, { base: 12, terms: [[2, 8], [5, 3]], flat: 16, step: 2 }),
  islands: (g, r) => skyline(g, r, { base: -6, terms: [[3, 10], [7, 5], [13, 2]] }),
  spikes: (g, r) => spikes(g, r),
  lavaFalls: (g, r) => lavaFalls(g, r),
  floating: (g, r) => floatingIsles(g, r),
  none: () => {},
};

const MID = {
  hills: (g, r) => skyline(g, r, { base: 12, terms: [[2, 5], [3, 3], [5, 2]] }),
  lowHills: (g, r) => skyline(g, r, { base: 7, terms: [[2, 3], [5, 2]] }),
  dunes: (g, r) => skyline(g, r, { base: 9, terms: [[2, 4], [5, 2]] }),
  crags: (g, r) => skyline(g, r, { base: 14, terms: [[3, 6], [7, 4], [13, 2]], step: 2 }),
  mesas: (g, r) => skyline(g, r, { base: 10, terms: [[3, 7], [5, 3]], flat: 14, step: 2, bands: ['a', 'b', 'c', 'd'] }),
  sea: (g, r) => sea(g, r, { rows: 9 }),
  swamp: (g, r) => sea(g, r, { rows: 7, lilies: true }),
  ice: (g, r) => skyline(g, r, { base: 5, terms: [[4, 2], [9, 1]], step: 1 }),
  rubble: (g, r) => skyline(g, r, { base: 6, terms: [[5, 3], [11, 2]], step: 1 }),
  none: () => {},
};

// Trees and other tall things -------------------------------------------------

// A rounded clump of leaves: lit from the top left, shaded bottom right.
function canopy(g, cx, cy, rx, ry, random, [leaf, light, dark] = ['l', 'L', 'k']) {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (d > 1 + (random() - 0.5) * 0.3) continue;
      let ch = leaf;
      if (dy < -ry / 3 && dx < rx / 3 && random() < 0.55) ch = light;
      else if ((dy > ry / 3 || dx > rx / 2) && random() < 0.5) ch = dark;
      else if (random() < 0.07) ch = light;
      g.set(cx + dx, cy + dy, ch);
    }
  }
}

function trunk(g, x, height, wide = 2, [wood, bark] = ['t', 'T']) {
  const base = g.h - 1;
  g.fill(x, base - height + 1, wide, height, wood);
  for (let y = base - height + 2; y <= base; y += 3) g.set(x + wide - 1, y, bark);
}

const TREES = {
  oak(g, x, r) {
    const h = 8 + Math.floor(r() * 5);
    trunk(g, x, h);
    canopy(g, x + 1, g.h - h - 3, 6 + Math.floor(r() * 3), 5 + Math.floor(r() * 2), r);
  },
  birch(g, x, r) {
    const h = 12 + Math.floor(r() * 6);
    trunk(g, x, h, 2, ['w', 'w']);
    for (let y = g.h - h; y < g.h; y += 2 + Math.floor(r() * 3)) g.set(x + (r() < 0.5 ? 0 : 1), y, 'm');
    canopy(g, x + 1, g.h - h - 4, 4 + Math.floor(r() * 2), 6, r, ['y', 'Y', 'z']);
  },
  spruce(g, x, r, { snow = false } = {}) {
    const h = 26 + Math.floor(r() * 12);
    trunk(g, x, 5);
    const top = g.h - h;
    for (let y = top; y < g.h - 4; y++) {
      const tier = (y - top) % 6;
      const width = Math.round(((y - top) / (h - 4)) * 7) + tier;
      for (let dx = -width; dx <= width + 1; dx++) {
        let ch = dx > width / 2 ? 'G' : 'g';
        if (snow && tier === 0) ch = 's';
        else if (snow && tier === 1 && Math.abs(dx) > width - 2) ch = 's';
        g.set(x + dx, y, ch);
      }
    }
  },
  snowySpruce(g, x, r) {
    TREES.spruce(g, x, r, { snow: true });
  },
  cherry(g, x, r) {
    const h = 9 + Math.floor(r() * 4);
    trunk(g, x, h, 2, ['t', 'T']);
    g.fill(x - 3, g.h - h - 1, 3, 1, 't');
    g.fill(x + 2, g.h - h - 2, 3, 1, 't');
    canopy(g, x - 3, g.h - h - 4, 6, 4, r, ['p', 'P', 'q']);
    canopy(g, x + 5, g.h - h - 5, 6, 4, r, ['p', 'P', 'q']);
  },
  jungle(g, x, r) {
    const h = 24 + Math.floor(r() * 10);
    trunk(g, x, h, 3);
    const cy = g.h - h - 2;
    canopy(g, x + 1, cy, 9, 4, r);
    for (let i = 0; i < 6; i++) {
      const vx = x + 1 - 8 + Math.floor(r() * 17);
      const len = 3 + Math.floor(r() * 8);
      for (let y = cy + 3; y < cy + 3 + len; y++) g.set(vx, y, 'v');
    }
  },
  bush(g, x, r) {
    canopy(g, x, g.h - 4, 4, 3, r);
  },
  acacia(g, x, r) {
    const h = 10 + Math.floor(r() * 4);
    trunk(g, x, Math.round(h / 2));
    for (let y = 0; y < h / 2; y++) g.fill(x + 1 + Math.round(y * 0.8), g.h - h / 2 - y, 2, 1, 't');
    const cx = x + Math.round(h * 0.45);
    const cy = g.h - h - 2;
    for (let dy = 0; dy < 3; dy++) g.fill(cx - 9 + dy, cy + dy, 19 - dy * 2, 1, dy === 0 ? 'L' : dy === 2 ? 'k' : 'l');
  },
  cactus(g, x, r) {
    const h = 7 + Math.floor(r() * 7);
    g.fill(x, g.h - h, 2, h, 'c');
    for (let y = g.h - h; y < g.h; y += 2) g.set(x + 1, y, 'C');
    if (h > 9) {
      const ay = g.h - h + 3;
      g.fill(x - 2, ay, 2, 1, 'c');
      g.fill(x - 2, ay - 3, 1, 3, 'c');
      g.fill(x + 2, ay + 2, 2, 1, 'c');
      g.fill(x + 3, ay - 1, 1, 3, 'c');
    }
  },
  deadTree(g, x, r) {
    const h = 6 + Math.floor(r() * 5);
    trunk(g, x, h, 1);
    g.set(x - 1, g.h - h + 1, 't');
    g.set(x - 2, g.h - h, 't');
    g.set(x + 1, g.h - h + 2, 't');
    g.set(x + 2, g.h - h + 1, 't');
  },
  swampOak(g, x, r) {
    const h = 9 + Math.floor(r() * 4);
    trunk(g, x, h);
    canopy(g, x + 1, g.h - h - 3, 8, 4, r);
    for (let i = 0; i < 7; i++) {
      const vx = x + 1 - 7 + Math.floor(r() * 15);
      const len = 2 + Math.floor(r() * 6);
      for (let y = g.h - h + 1; y < g.h - h + 1 + len; y++) g.set(vx, y, 'v');
    }
  },
  redMushroom(g, x, r) {
    const h = 9 + Math.floor(r() * 6);
    g.fill(x, g.h - h, 3, h, 'b');
    g.set(x + 2, g.h - 3, 'B');
    const cy = g.h - h - 1;
    for (let dy = 0; dy < 4; dy++) g.fill(x + 1 - 6 + dy, cy - 3 + dy, 13 - dy * 2, 1, 'r');
    g.fill(x + 1 - 6, cy + 1, 13, 1, 'R');
    for (let i = 0; i < 5; i++) g.set(x - 4 + Math.floor(r() * 10), cy - 2 + Math.floor(r() * 3), 'W');
  },
  brownMushroom(g, x, r) {
    const h = 8 + Math.floor(r() * 6);
    g.fill(x, g.h - h, 3, h, 'b');
    g.fill(x + 1 - 8, g.h - h - 2, 17, 2, 'u');
    g.fill(x + 1 - 7, g.h - h - 3, 15, 1, 'U');
  },
  stalagmite(g, x, r) {
    const h = 10 + Math.floor(r() * 16);
    for (let y = 0; y < h; y++) {
      const w = Math.max(1, Math.round(5 * (1 - y / h) + 0.4));
      g.fill(x - Math.floor(w / 2), g.h - 1 - y, w, 1, y % 4 === 1 ? 'O' : 'o');
    }
  },
  crystal(g, x, r) {
    for (let i = 0; i < 3; i++) {
      const h = 4 + Math.floor(r() * 8);
      const cx = x + i * 2 - 2;
      for (let y = 0; y < h; y++) g.set(cx + Math.round(y * (i - 1) * 0.3), g.h - 1 - y, y > h - 3 ? 'I' : i === 1 ? 'j' : 'i');
    }
  },
  glowVine(g, x, r) {
    const len = 10 + Math.floor(r() * 20);
    for (let y = 0; y < len; y++) g.set(x + (y % 7 < 3 ? 0 : 1), y, y % 5 === 4 ? 'h' : 'v');
  },
  basalt(g, x, r) {
    const h = 8 + Math.floor(r() * 18);
    const w = 3 + Math.floor(r() * 2);
    g.fill(x, g.h - h, w, h, 'n');
    for (let y = g.h - h; y < g.h; y += 3) g.set(x + w - 1, y, 'N');
    g.fill(x, g.h - h, w, 1, 'N');
    g.fill(x - 1, g.h - 1, w + 2, 1, 'F');
  },
  spire(g, x, r) {
    const h = 10 + Math.floor(r() * 14);
    for (let y = 0; y < h; y++) {
      const w = Math.max(1, Math.round(3 * (1 - y / h) + 0.6));
      g.fill(x - Math.floor(w / 2), g.h - 1 - y, w, 1, y % 3 === 0 ? 'E' : 'e');
    }
    g.set(x, g.h - h - 1, 'h');
    g.set(x, g.h - h - 2, 'H');
  },
  iceSpike(g, x, r) {
    const h = 10 + Math.floor(r() * 18);
    for (let y = 0; y < h; y++) {
      const w = Math.max(1, Math.round(4 * (1 - y / h) + 0.5));
      for (let dx = 0; dx < w; dx++) g.set(x + dx - Math.floor(w / 2), g.h - 1 - y, dx === 0 ? 'I' : 'i');
    }
  },
};

// Puts `count` trees along the strip, spread out, back ones first.
function forest(g, random, kinds, count) {
  const spacing = g.w / Math.max(1, count);
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  for (let i = 0; i < count; i++) {
    let pick = random() * total;
    const [kind] = kinds.find(([, weight]) => (pick -= weight) < 0) ?? kinds[0];
    const x = Math.round(i * spacing + random() * spacing * 0.5);
    TREES[kind](g, x, random);
  }
}

// Ground and plants -------------------------------------------------------------

// One 16 x 16 block of ground: a top layer (a, b, c) over what's below (d, e, f).
function floorTile(random, { top = 3, solid = false }) {
  const g = new Grid(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const depth = top + (random() < 0.35 ? 1 : 0);
      const inTop = solid || y < depth;
      const roll = random();
      const ch = inTop ? (roll < 0.15 ? 'b' : roll < 0.3 ? 'c' : 'a') : roll < 0.12 ? 'e' : roll < 0.22 ? 'f' : 'd';
      g.set(x, y, ch);
    }
  }
  return g;
}

const PLANTS = {
  flower(g, x, r, colour) {
    const h = 2 + Math.floor(r() * 2);
    g.fill(x, g.h - h, 1, h, 'G');
    g.set(x, g.h - h - 1, colour);
    if (r() < 0.5) g.set(x + 1, g.h - h - 1, colour);
  },
  tuft(g, x, r) {
    for (let i = 0; i < 3; i++) g.fill(x + i, g.h - 2 - (i % 2), 1, 2 + (i % 2), i === 1 ? 'G' : 'g');
  },
  fern(g, x, r) {
    for (let i = -2; i <= 2; i++) g.fill(x + i, g.h - 3 + Math.abs(i), 1, 3 - Math.abs(i) + 1, Math.abs(i) === 1 ? 'G' : 'g');
  },
  mushroom(g, x, r) {
    g.set(x + 1, g.h - 1, 'b');
    g.fill(x, g.h - 2, 3, 1, r() < 0.5 ? 'r' : 'u');
  },
  rock(g, x, r) {
    g.fill(x, g.h - 2, 3, 2, 'o');
    g.set(x, g.h - 2, 'O');
  },
  deadBush(g, x, r) {
    g.set(x + 1, g.h - 1, 't');
    g.set(x, g.h - 2, 't');
    g.set(x + 2, g.h - 2, 't');
    g.set(x - 1, g.h - 3, 't');
    g.set(x + 3, g.h - 3, 't');
  },
  snowLump(g, x, r) {
    g.fill(x, g.h - 1, 4, 1, 's');
    g.fill(x + 1, g.h - 2, 2, 1, 's');
  },
  crystal(g, x, r) {
    g.fill(x, g.h - 3, 1, 3, 'i');
    g.fill(x + 1, g.h - 2, 1, 2, 'j');
    g.set(x, g.h - 4, 'I');
  },
  glow(g, x, r) {
    g.set(x, g.h - 1 - Math.floor(r() * 3), 'h');
  },
  lava(g, x, r) {
    g.fill(x, g.h - 1, 5, 1, 'f');
    g.fill(x + 1, g.h - 1, 2, 1, 'F');
  },
  shell(g, x, r) {
    g.fill(x, g.h - 1, 2, 1, 'W');
    g.set(x + 1, g.h - 2, 'p');
  },
  petals(g, x, r) {
    g.set(x, g.h - 1, 'p');
    g.set(x + 2, g.h - 1, 'P');
  },
};

function plants(g, random, kinds) {
  const colours = ['1', '2', '3', '4'];
  for (let x = 1; x < g.w - 3; x += 3 + Math.floor(random() * 5)) {
    const kind = kinds[Math.floor(random() * kinds.length)];
    PLANTS[kind](g, x, random, colours[Math.floor(random() * colours.length)]);
  }
}

// The rock overhead in caves and the underworld, hanging down.
function ceiling(random, kind) {
  const g = new Grid(...LAYERS.ceiling);
  g.fill(0, 0, g.w, 3, 'a');
  for (let x = 0; x < g.w; x++) if (random() < 0.5) g.set(x, 3, 'a');
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(random() * g.w);
    const len = 3 + Math.floor(random() * 14);
    for (let y = 3; y < 3 + len; y++) {
      const w = Math.max(1, Math.round(3 * (1 - (y - 3) / len) + 0.4));
      if (kind === 'vines') g.set(x, y, y === 2 + len ? 'h' : 'v');
      else g.fill(x - Math.floor(w / 2), y, w, 1, y % 4 === 0 ? 'b' : 'a');
    }
    if (kind === 'lava' && random() < 0.6) g.set(x, 3 + len, 'F');
  }
  return g;
}

// What's behind everything where there's no sky: cave wall, underworld rock, or the void.
function backdrop(random, kind) {
  const g = new Grid(...LAYERS.backdrop);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let ch = random() < 0.12 ? 'c' : 'a';
      if (kind === 'void') ch = random() < 0.006 ? 'h' : random() < 0.004 ? 'H' : 'a';
      g.set(x, y, ch);
    }
  }
  if (kind !== 'void') {
    // Natural rock: darker patches, and cracks wandering across it.
    for (let i = 0; i < 12; i++) {
      const cx = Math.floor(random() * g.w);
      const cy = Math.floor(random() * g.h);
      const r = 2 + Math.floor(random() * 4);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && random() < 0.6) g.set(cx + dx, cy + dy, 'b');
      }
    }
    for (let i = 0; i < 5; i++) {
      let y = Math.floor(random() * g.h);
      const from = Math.floor(random() * g.w);
      const length = 10 + Math.floor(random() * 30);
      for (let x = from; x < from + length; x++) {
        g.set(x, y, 'b');
        if (random() < 0.3) y = Math.max(0, Math.min(g.h - 1, y + (random() < 0.5 ? 1 : -1)));
      }
    }
  }
  if (kind === 'cave') {
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(random() * g.w);
      const y = Math.floor(random() * g.h);
      const ore = random() < 0.5 ? 'o' : 'i';
      g.set(x, y, ore);
      g.set(x + 1, y, ore);
      g.set(x, y + 1, ore);
    }
  }
  if (kind === 'underworld') {
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(random() * g.w);
      for (let y = 0; y < g.h; y++) {
        g.set(x, y, y % 5 === 0 ? 'F' : 'f');
        if (random() < 0.3) x += random() < 0.5 ? 1 : -1;
      }
    }
  }
  return g;
}

// The places -------------------------------------------------------------------

const GREEN = { G: '#3d8a24', g: '#5aa83a' };
const DIRT = { d: '#8a5a2b', e: '#6e4520', f: '#a06c38' };
const OAK_WOOD = { t: '#7a4e24', T: '#5c3a1a' };
const FLOWERS = { 1: '#e0403a', 2: '#f5c518', 3: '#ffffff', 4: '#7a6cf0' };
const BLUE_HAZE = { a: '#7e9cc9', b: '#9fb8de', c: '#6d88b5', s: '#eef4fc' };
const GREEN_HILLS = { a: '#5f9c48', b: '#78b55a', c: '#4e8a3a' };

// Leaves and ground for the meadow and forest, by season.
const SEASON_LEAVES = {
  spring: { l: '#f2a7c3', L: '#fde0ea', k: '#d97fa3' },
  summer: { l: '#3f8a2a', L: '#5aa83a', k: '#2f6e1f' },
  autumn: { l: '#d9702b', L: '#f2b33d', k: '#b34d1c' },
  winter: { l: '#e8eef8', L: '#ffffff', k: '#b9c6dd' },
};
const SEASON_GRASS = {
  spring: { a: '#66b23e', b: '#8fd05a', c: '#4f9a2f' },
  summer: { a: '#5fa83a', b: '#7cc24c', c: '#4c8f2c' },
  autumn: { a: '#8f9a3a', b: '#b3ab45', c: '#727c2c' },
  winter: { a: '#eef4fc', b: '#ffffff', c: '#c9d6ea' },
};
const SEASON_HILLS = {
  spring: GREEN_HILLS,
  summer: GREEN_HILLS,
  autumn: { a: '#a8953a', b: '#c9ad4a', c: '#86702c' },
  winter: { a: '#dfe8f4', b: '#ffffff', c: '#bccbe2' },
};

// sky: 'open' (the real or a mood's sky), or 'cave', 'underworld', 'void' (no sky:
// a backdrop instead, and night visitors). fall: what falls there unless a mood
// says otherwise (undefined: the real weather; null: nothing). seasonal: dressed
// for the real season.
export const PLACES = [
  {
    id: 'meadow',
    label: 'Meadow',
    sky: 'open',
    seasonal: true,
    far: 'softMountains',
    mid: 'hills',
    trees: [['oak', 1]],
    treeCount: 3,
    plants: ['flower', 'flower', 'tuft'],
    floor: { top: 3 },
    palette: (season) => ({
      far: BLUE_HAZE,
      mid: SEASON_HILLS[season],
      trees: { ...OAK_WOOD, ...SEASON_LEAVES[season] },
      floor: { ...SEASON_GRASS[season], ...DIRT },
      flora: { ...GREEN, ...FLOWERS },
    }),
  },
  {
    id: 'forest',
    label: 'Forest',
    sky: 'open',
    seasonal: true,
    far: 'mountains',
    mid: 'hills',
    trees: [['oak', 2], ['birch', 2]],
    treeCount: 6,
    plants: ['fern', 'mushroom', 'tuft'],
    floor: { top: 3 },
    palette: (season) => ({
      far: BLUE_HAZE,
      mid: SEASON_HILLS[season],
      trees: {
        ...OAK_WOOD,
        ...SEASON_LEAVES[season],
        w: '#e9e6dc',
        m: '#3a3632',
        ...(season === 'autumn' ? { y: '#f2c23d', Y: '#ffe07a', z: '#d99a1f' } : season === 'winter' ? { y: '#e8eef8', Y: '#ffffff', z: '#b9c6dd' } : { y: '#7cc24c', Y: '#a6dc6e', z: '#5a9e34' }),
      },
      floor: { ...SEASON_GRASS[season], ...DIRT },
      flora: { ...GREEN, r: '#c8402c', u: '#9a6a40', b: '#efe3c8' },
    }),
  },
  {
    id: 'taiga',
    label: 'Snowy taiga',
    sky: 'open',
    fall: 'snow',
    far: 'peaks',
    mid: 'hills',
    trees: [['snowySpruce', 1]],
    treeCount: 6,
    plants: ['snowLump', 'rock'],
    floor: { top: 4 },
    palette: () => ({
      far: { a: '#8fa6c8', b: '#b0c3df', c: '#7a92b6', s: '#ffffff' },
      mid: { a: '#dfe8f4', b: '#ffffff', c: '#bccbe2' },
      trees: { t: '#5c3a1a', T: '#40280f', g: '#2f5a3a', G: '#244a2f', s: '#f4f8ff' },
      floor: { a: '#eef4fc', b: '#ffffff', c: '#c9d6ea', ...DIRT },
      flora: { s: '#ffffff', o: '#8d8f96', O: '#a8aab0' },
    }),
  },
  {
    id: 'desert',
    label: 'Desert',
    sky: 'open',
    fall: null,
    far: 'dunes',
    mid: 'dunes',
    trees: [['cactus', 3], ['deadTree', 1]],
    treeCount: 4,
    plants: ['deadBush', 'rock'],
    floor: { solid: true },
    palette: () => ({
      far: { a: '#e8c98a', b: '#f3dba6', c: '#d4b373' },
      mid: { a: '#ead09a', b: '#f6e2b4', c: '#d9b97e' },
      trees: { c: '#3f8f3a', C: '#2f6e2c', t: '#8a6a40', T: '#6e5230' },
      floor: { a: '#eed7a1', b: '#f7e6bb', c: '#dcc086', d: '#eed7a1', e: '#dcc086', f: '#f7e6bb' },
      flora: { t: '#8a6a40', o: '#c9a36a', O: '#e0bd85' },
    }),
  },
  {
    id: 'cherry',
    label: 'Cherry grove',
    sky: 'open',
    fall: 'petals',
    far: 'mountains',
    mid: 'hills',
    trees: [['cherry', 1]],
    treeCount: 3,
    plants: ['petals', 'flower', 'tuft'],
    floor: { top: 3 },
    palette: () => ({
      far: BLUE_HAZE,
      mid: { a: '#6fb24f', b: '#8fcc66', c: '#5a9c3e' },
      trees: { t: '#4a2c2a', T: '#36201f', p: '#f4a9c8', P: '#ffd6e6', q: '#de84ab' },
      floor: { a: '#6cbb44', b: '#93d466', c: '#57a334', ...DIRT },
      flora: { ...GREEN, ...FLOWERS, p: '#f4a9c8', P: '#ffd6e6' },
    }),
  },
  {
    id: 'jungle',
    label: 'Jungle',
    sky: 'open',
    far: 'mountains',
    mid: 'hills',
    trees: [['jungle', 2], ['bush', 2]],
    treeCount: 6,
    plants: ['fern', 'flower', 'tuft'],
    floor: { top: 3 },
    palette: () => ({
      far: { a: '#5e8f74', b: '#7aa98c', c: '#4c7a61', s: '#d7e9de' },
      mid: { a: '#3f8a2f', b: '#58a542', c: '#2f7022' },
      trees: { t: '#5b4326', T: '#45321b', l: '#2c7a1f', L: '#47a12f', k: '#1d5a14', v: '#3e9a2a' },
      floor: { a: '#4f9e2f', b: '#6dbb46', c: '#3e8524', ...DIRT },
      flora: { ...GREEN, 1: '#ff6a2a', 2: '#ffd23f', 3: '#ff9ad0', 4: '#ffffff' },
    }),
  },
  {
    id: 'savanna',
    label: 'Savanna',
    sky: 'open',
    fall: null,
    far: 'plateaus',
    mid: 'lowHills',
    trees: [['acacia', 1]],
    treeCount: 2,
    plants: ['tuft', 'tuft', 'deadBush'],
    floor: { top: 3 },
    palette: () => ({
      far: { a: '#b49a6a', b: '#c9b282', c: '#9c8458' },
      mid: { a: '#a6a54a', b: '#c0bf62', c: '#8c8b3a' },
      trees: { t: '#7a6a5a', T: '#5c4f42', l: '#7c9a2e', L: '#9ab842', k: '#5e7a20' },
      floor: { a: '#a8ac4a', b: '#c4c462', c: '#8e9238', ...DIRT },
      flora: { G: '#a39a3a', g: '#c4b84e', t: '#7a6a5a' },
    }),
  },
  {
    id: 'swamp',
    label: 'Swamp',
    sky: 'open',
    far: 'softMountains',
    mid: 'swamp',
    trees: [['swampOak', 1]],
    treeCount: 3,
    plants: ['mushroom', 'tuft', 'fern'],
    floor: { top: 3 },
    palette: () => ({
      far: { a: '#6f7f6a', b: '#87977f', c: '#5d6c58' },
      mid: { v: '#3e5a4a', w: '#5f7f6a', f: '#4e6b58', l: '#4f8a2f', p: '#e7d64e' },
      trees: { t: '#4a3a24', T: '#36291a', l: '#4a6b2a', L: '#5f8434', k: '#3a5420', v: '#3d6b26' },
      floor: { a: '#4f6b32', b: '#64843f', c: '#3e5726', d: '#4a3a2a', e: '#3a2d20', f: '#5a4834' },
      flora: { G: '#3e5a26', g: '#56783a', r: '#a8402c', u: '#8a6a40', b: '#d8ccb0' },
    }),
  },
  {
    id: 'badlands',
    label: 'Badlands',
    sky: 'open',
    fall: null,
    far: 'mesas',
    mid: 'mesas',
    trees: [['deadTree', 1], ['cactus', 1]],
    treeCount: 3,
    plants: ['deadBush', 'rock'],
    floor: { solid: true },
    palette: () => ({
      far: { a: '#c4683a', b: '#d9935a', c: '#a85030', d: '#e6b27a' },
      mid: { a: '#b85a32', b: '#cf7a46', c: '#9a4528', d: '#e0a070' },
      trees: { t: '#6a4a30', T: '#4e3622', c: '#4f8a3a', C: '#3a6e2c' },
      floor: { a: '#c96a3a', b: '#d9844e', c: '#b05530', d: '#c96a3a', e: '#b05530', f: '#d9844e' },
      flora: { t: '#6a4a30', o: '#9a5a3a', O: '#b8744c' },
    }),
  },
  {
    id: 'mushroom',
    label: 'Mushroom isle',
    sky: 'open',
    far: 'islands',
    mid: 'sea',
    trees: [['redMushroom', 1], ['brownMushroom', 1]],
    treeCount: 3,
    plants: ['mushroom', 'mushroom', 'tuft'],
    floor: { top: 3 },
    palette: () => ({
      far: { a: '#7c8f7a', b: '#93a68f', c: '#6a7c68' },
      mid: { v: '#3f6fbf', w: '#7ea6e6', f: '#e8f0ff' },
      trees: { b: '#efe3c8', B: '#d6c8a8', r: '#d0332c', R: '#a82822', W: '#ffffff', u: '#9a6a40', U: '#b88452' },
      floor: { a: '#8a7a96', b: '#a594b0', c: '#76667f', ...DIRT },
      flora: { G: '#76667f', g: '#a594b0', r: '#d0332c', u: '#9a6a40', b: '#efe3c8' },
    }),
  },
  {
    id: 'beach',
    label: 'Beach',
    sky: 'open',
    far: 'islands',
    mid: 'sea',
    trees: [['bush', 1]],
    treeCount: 1,
    plants: ['shell', 'tuft', 'rock'],
    floor: { solid: true },
    palette: () => ({
      far: { a: '#6f8f6a', b: '#87a77f', c: '#5d7c58' },
      mid: { v: '#2f7ad0', w: '#7ec0f0', f: '#ffffff' },
      trees: { l: '#5aa83a', L: '#7cc24c', k: '#3f8a2a' },
      floor: { a: '#f0dca8', b: '#f8ebc4', c: '#dfc68c', d: '#f0dca8', e: '#dfc68c', f: '#f8ebc4' },
      flora: { G: '#7a9a3a', g: '#9ab84e', W: '#fff4ec', p: '#f0a0b0', o: '#a8a49a', O: '#c4c0b6' },
    }),
  },
  {
    id: 'mountains',
    label: 'Mountains',
    sky: 'open',
    far: 'peaks',
    mid: 'crags',
    trees: [['spruce', 1]],
    treeCount: 3,
    plants: ['rock', 'tuft'],
    floor: { top: 2 },
    palette: () => ({
      far: { a: '#8a93a6', b: '#a6aec0', c: '#767f92', s: '#ffffff' },
      mid: { a: '#7d8590', b: '#969ea8', c: '#68707a' },
      trees: { t: '#5c3a1a', T: '#40280f', g: '#2f6a3a', G: '#245530' },
      floor: { a: '#6aa04a', b: '#86b862', c: '#558a3a', d: '#7d8590', e: '#68707a', f: '#969ea8' },
      flora: { G: '#3d8a24', g: '#5aa83a', o: '#7d8590', O: '#969ea8' },
    }),
  },
  {
    id: 'ice',
    label: 'Ice fields',
    sky: 'open',
    fall: 'snow',
    far: 'spikes',
    mid: 'ice',
    trees: [['iceSpike', 1]],
    treeCount: 4,
    plants: ['snowLump', 'snowLump'],
    floor: { top: 5 },
    palette: () => ({
      far: { a: '#a9cbe8', b: '#d6ebfa' },
      mid: { a: '#c6def2', b: '#e8f4fc', c: '#a9c6e0' },
      trees: { i: '#9fd0f2', I: '#e2f4ff' },
      floor: { a: '#eef6fe', b: '#ffffff', c: '#cfe2f4', d: '#a9c6e0', e: '#8fb2d4', f: '#c6def2' },
      flora: { s: '#ffffff' },
    }),
  },
  {
    id: 'cave',
    label: 'Cave',
    sky: 'cave',
    fall: null,
    far: 'none',
    mid: 'rubble',
    trees: [['stalagmite', 3], ['crystal', 1]],
    treeCount: 7,
    plants: ['rock', 'crystal', 'glow'],
    floor: { solid: true },
    ceiling: 'rock',
    backdrop: 'cave',
    palette: () => ({
      backdrop: { a: '#3a3d44', b: '#2c2f35', c: '#45484f', o: '#e0b84a', i: '#5fd0c8' },
      ceiling: { a: '#2f3238', b: '#3c3f46' },
      mid: { a: '#4a4d55', b: '#5c5f67', c: '#3c3f46' },
      trees: { o: '#6a6d75', O: '#80838b', i: '#8a6ae0', I: '#d6c8ff', j: '#6a4fc4' },
      floor: { a: '#5c5f67', b: '#6e717a', c: '#4a4d55', d: '#5c5f67', e: '#4a4d55', f: '#6e717a' },
      flora: { o: '#6a6d75', O: '#80838b', i: '#8a6ae0', I: '#d6c8ff', j: '#6a4fc4', h: '#9cf2e4' },
    }),
  },
  {
    id: 'lush',
    label: 'Lush cave',
    sky: 'cave',
    fall: null,
    far: 'none',
    mid: 'rubble',
    trees: [['bush', 2], ['stalagmite', 1]],
    treeCount: 6,
    plants: ['flower', 'fern', 'glow'],
    floor: { top: 3 },
    ceiling: 'vines',
    backdrop: 'cave',
    palette: () => ({
      backdrop: { a: '#34413a', b: '#2a352f', c: '#3e4c44', o: '#e0b84a', i: '#5fd0c8' },
      ceiling: { a: '#2c3a31', b: '#36463c', v: '#4f9a3a', h: '#ffb84a' },
      mid: { a: '#3e5a40', b: '#4f704f', c: '#334a35' },
      trees: { l: '#4f9a3a', L: '#6fbf4f', k: '#3a7a2a', o: '#5a6a5e', O: '#6e7e72' },
      floor: { a: '#4f9a3a', b: '#6fbf4f', c: '#3a7a2a', d: '#5c5f67', e: '#4a4d55', f: '#6e717a' },
      flora: { ...GREEN, 1: '#ff9ad0', 2: '#ffd23f', 3: '#9cf2e4', 4: '#ffffff', h: '#ffb84a' },
    }),
  },
  {
    id: 'underworld',
    label: 'Underworld',
    sky: 'underworld',
    fall: 'embers',
    far: 'lavaFalls',
    mid: 'rubble',
    trees: [['basalt', 1]],
    treeCount: 5,
    plants: ['lava', 'rock', 'glow'],
    floor: { solid: true },
    ceiling: 'lava',
    backdrop: 'underworld',
    palette: () => ({
      backdrop: { a: '#3a1418', b: '#2c0e12', c: '#4a1c20', f: '#e0582a', F: '#ffb24a' },
      ceiling: { a: '#2c0e12', b: '#3a1418', F: '#ffb24a' },
      far: { a: '#4a1a1e', b: '#5c2428', c: '#3a1418', f: '#ff7a2a', F: '#ffd25a' },
      mid: { a: '#5a2226', b: '#6e2c30', c: '#4a1a1e' },
      trees: { n: '#3a3a40', N: '#55555c', F: '#ff8a2a' },
      floor: { a: '#6a2a2a', b: '#7e3632', c: '#561e20', d: '#6a2a2a', e: '#561e20', f: '#7e3632' },
      flora: { f: '#ff7a2a', F: '#ffd25a', o: '#4a1a1e', O: '#5c2428', h: '#ffb24a' },
    }),
  },
  {
    id: 'isles',
    label: 'Floating isles',
    sky: 'void',
    fall: null,
    far: 'floating',
    mid: 'none',
    trees: [['spire', 1], ['crystal', 1]],
    treeCount: 4,
    plants: ['crystal', 'glow'],
    floor: { solid: true },
    backdrop: 'void',
    palette: () => ({
      backdrop: { a: '#120c24', h: '#ffffff', H: '#b9a6ff' },
      far: { a: '#5a4f7a', b: '#8a7fb0', c: '#463d62' },
      trees: { e: '#c8bfe6', E: '#e4dcff', h: '#9cf2e4', H: '#ffffff', i: '#8a6ae0', I: '#d6c8ff', j: '#6a4fc4' },
      floor: { a: '#b8aed8', b: '#d0c8ea', c: '#9e94c2', d: '#b8aed8', e: '#9e94c2', f: '#d0c8ea' },
      flora: { i: '#8a6ae0', I: '#d6c8ff', j: '#6a4fc4', h: '#9cf2e4' },
    }),
  },
];

export function placeById(id) {
  return PLACES.find((place) => place.id === id) ?? PLACES[0];
}

// Seeds per place, so each always looks the same.
const seedOf = (id, layer) => [...`${id}:${layer}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

// Every layer of a place, as { rows, palette } (null for a layer it doesn't have).
export function placeArt(id, { season = 'summer' } = {}) {
  const place = placeById(id);
  const palette = place.palette(season);
  const layer = (name, draw) => {
    if (!palette[name]) return null;
    const g = new Grid(...LAYERS[name]);
    draw(g, seededRandom(seedOf(place.id, name)));
    return { rows: g.rows(), palette: palette[name] };
  };
  return {
    far: layer('far', (g, r) => FAR[place.far ?? 'none'](g, r)),
    mid: layer('mid', (g, r) => MID[place.mid ?? 'none'](g, r)),
    trees: layer('trees', (g, r) => forest(g, r, place.trees, place.treeCount)),
    floor: palette.floor ? { rows: floorTile(seededRandom(seedOf(place.id, 'floor')), place.floor).rows(), palette: palette.floor } : null,
    flora: layer('flora', (g, r) => plants(g, r, place.plants)),
    ceiling: place.ceiling ? { rows: ceiling(seededRandom(seedOf(place.id, 'ceiling')), place.ceiling).rows(), palette: palette.ceiling } : null,
    backdrop: place.backdrop ? { rows: backdrop(seededRandom(seedOf(place.id, 'backdrop')), place.backdrop).rows(), palette: palette.backdrop } : null,
  };
}

const VAR_NAMES = { far: '--zen-far', mid: '--zen-mid', trees: '--zen-trees', floor: '--zen-floor', flora: '--zen-flora', ceiling: '--zen-ceiling', backdrop: '--zen-backdrop' };

// The --zen-* custom properties for a place (each a url() or none), plus
// --zen-sky, the colour behind a place with no sky. Places under the open sky
// get darker at night; caves, the underworld and the void stay as they are.
export function placeVars(id, { season = 'summer', night = false } = {}) {
  const place = placeById(id);
  const art = placeArt(place.id, { season });
  const shade = night && place.sky === 'open';
  const vars = {};
  for (const [name, piece] of Object.entries(art)) {
    const palette = piece && (shade ? Object.fromEntries(Object.entries(piece.palette).map(([ch, c]) => [ch, nightColour(c)])) : piece.palette);
    vars[VAR_NAMES[name]] = piece ? `url("${dataUri(pixelSvg(piece.rows, palette))}")` : 'none';
  }
  vars['--zen-sky'] = art.backdrop ? art.backdrop.palette.a : 'transparent';
  return vars;
}
