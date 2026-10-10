// The Apple theme's wallpaper: soft purple and blue light over a deep night blue,
// with the sky's faint stars on top (sky.js). Pure, so its contrast is tested in node.
//
// Its glass cards don't blur for real: backdrop-filter is too much for the Pi's GPU
// (see CLAUDE.md). Each card shows a copy of the wallpaper lined up with what's
// behind it (glass.js), made ahead of time the way blur(30px) saturate(180%) would
// make it. The blobs fade out over hundreds of pixels, so a 30px blur leaves them
// as they are; what it would wash away is the stars, and the copy leaves them out.
// The saturation is worked out here with the filter's own matrix.
import { mixHex } from './color.js';

// The glass's own frosting over the copy (rgba(255, 255, 255, 0.08)).
export const FROST = 0.08;
export const SATURATE = 1.8;

// Top and bottom of the base gradient.
export const BASE = { top: '#0c0a26', bottom: '#100c2c' };

// Painted first to last, each over the ones before. x, y are the centre and w, h the
// radii, all as percentages of the screen; the colour fades from `alpha` to nothing.
export const BLOBS = [
  { color: '#3d55d6', alpha: 0.32, x: 84, y: 16, w: 46, h: 62 },
  { color: '#6a3fd0', alpha: 0.3, x: 14, y: 18, w: 44, h: 60 },
  { color: '#8a3aa8', alpha: 0.2, x: 70, y: 92, w: 48, h: 58 },
  { color: '#2b6fc4', alpha: 0.22, x: 22, y: 96, w: 40, h: 50 },
  { color: '#5b47c9', alpha: 0.12, x: 48, y: 50, w: 34, h: 40 },
];

function channels(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v)));
  return '#' + ((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, '0');
}

// CSS saturate(): https://drafts.fxtf.org/filter-effects/#funcdef-filter-saturate
export function saturate(hex, s = SATURATE) {
  const [r, g, b] = channels(hex);
  return toHex([
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ]);
}

const rgba = (hex, alpha) => `rgb(${channels(hex).join(' ')} / ${alpha})`;

function background({ tone = (hex) => hex } = {}) {
  // CSS lists backgrounds top layer first.
  const blobs = [...BLOBS]
    .reverse()
    .map(({ color, alpha, x, y, w, h }) => `radial-gradient(${w}% ${h}% at ${x}% ${y}%, ${rgba(tone(color), alpha)}, ${rgba(tone(color), 0)})`);
  return [...blobs, `linear-gradient(180deg, ${tone(BASE.top)}, ${tone(BASE.bottom)})`].join(', ');
}

// The wallpaper itself, and the copy the glass shows (both fill the board).
export const wallpaperCss = () => background();
export const backdropCss = () => background({ tone: (hex) => saturate(hex) });

// The colour at (x, y), in percent of the screen: the wallpaper, or with `glass`
// what a glass card shows there (its copy plus the frosting).
export function colorAt(x, y, { glass = false } = {}) {
  const tone = glass ? (hex) => saturate(hex) : (hex) => hex;
  let color = mixHex(tone(BASE.top), tone(BASE.bottom), y / 100);
  for (const blob of BLOBS) {
    const t = Math.hypot((x - blob.x) / blob.w, (y - blob.y) / blob.h);
    if (t < 1) color = mixHex(color, tone(blob.color), blob.alpha * (1 - t));
  }
  return glass ? mixHex(color, '#ffffff', FROST) : color;
}

// What text of `hex` at `alpha` ends up as over `behind`.
export function over(hex, alpha, behind) {
  return mixHex(behind, hex, alpha);
}
