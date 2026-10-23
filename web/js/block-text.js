// The Blocks theme's clock, drawn from square blocks instead of a font. Pixel
// fonts at clock size smear their curves (a 5 that reads as a 6 from across the
// room), so these digits are built like a seven-segment display out of whole
// blocks: square corners, open where a curve would be, and every digit at least
// three blocks different from every other. Our own design, not any game's font.
import { dilate8, hconcat, pad, pathData, shift, svgOpen, upscale } from './pixel-art.js';

const ROWS = 7;

export const GLYPHS = {
  0: ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['#####', '....#', '....#', '#####', '#....', '#....', '#####'],
  3: ['#####', '....#', '....#', '.####', '....#', '....#', '#####'],
  4: ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  5: ['#####', '#....', '#....', '#####', '....#', '....#', '#####'],
  // The top stops short of the corner so a 6 never reads as a 5 or an 8.
  6: ['####.', '#....', '#....', '#####', '#...#', '#...#', '#####'],
  7: ['#####', '....#', '....#', '....#', '....#', '....#', '....#'],
  8: ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
  // …and the 9 is the 6 turned round.
  9: ['#####', '#...#', '#...#', '#####', '....#', '....#', '.####'],
  ':': ['.', '.', '#', '.', '#', '.', '.'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  A: ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  P: ['#####', '#...#', '#...#', '#####', '#....', '#....', '#....'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
};

// Each block is drawn as 3 x 3 finer cells, so the dark edge round the letters
// can be a third of a block thick (4px on the board) and the shadow two thirds.
// A whole block of edge would fill the gaps inside and between the digits and
// leave them sitting on a black slab.
export const SCALE = 3;
const EDGE = 1;
const SHADOW = 2;

// The layers of a line of text, as grids of fine cells the same size: null if any
// character has no glyph (a locale that writes the time some other way).
export function blockTextLayers(text) {
  const chars = [...String(text)];
  if (!chars.length || !chars.every((ch) => Object.hasOwn(GLYPHS, ch))) return null;
  const face = pad(upscale(hconcat(chars.map((ch) => GLYPHS[ch]), 1), SCALE), {
    top: EDGE,
    left: EDGE,
    right: EDGE + SHADOW,
    bottom: EDGE + SHADOW,
  });
  const edge = dilate8(face);
  return { face, edge, shadow: shift(edge, SHADOW, SHADOW), width: face[0].length, height: face.length };
}

// How big a drawing is, in blocks.
const blocks = (cells) => Number((cells / SCALE).toFixed(4));

// Inline SVG for a line of text, sized in blocks through CSS (--block-w, --block-h),
// coloured by its classes. '' when the text can't be drawn. Only fixed markup and
// numbers ever go into it, never the text itself.
export function blockTextSvg(text, { small = false } = {}) {
  const layers = blockTextLayers(text);
  if (!layers) return '';
  const { width, height } = layers;
  const cls = small ? 'block-text block-text--small' : 'block-text';
  const paths = ['shadow', 'edge', 'face']
    .map((layer) => `<path class='block-text__${layer}' d='${pathData(layers[layer], '#')}'/>`)
    .join('');
  const size = `--block-w:${blocks(width)};--block-h:${blocks(height)}`;
  return `${svgOpen(width, height, `class='${cls}' style='${size}' aria-hidden='true' focusable='false'`)}${paths}</svg>`;
}

// The clock: the time, then AM or PM drawn half size. '' (so the text clock shows)
// unless every part can be drawn.
export function blockClockMarkup(time, period = '') {
  const big = blockTextSvg(time);
  if (!big) return '';
  if (!period) return big;
  const small = blockTextSvg(period, { small: true });
  return small ? big + small : '';
}

// How wide the clock is in pixels, for checking it fits (gap: the space between
// the time and the AM/PM, one block).
export function blockClockWidth(time, period, { cell, smallCell }) {
  const big = blockTextLayers(time);
  const small = period ? blockTextLayers(period) : null;
  return blocks(big.width) * cell + (small ? cell + blocks(small.width) * smallCell : 0);
}

export { ROWS as GLYPH_ROWS };
