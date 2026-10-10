// Reads product barcodes (EAN-13 and UPC-A, EAN-8, UPC-E) from a greyscale image.
// Pure, so node can test it, and used wherever the browser has no BarcodeDetector
// (Safari and Firefox).
//
// Each line across the image is turned into runs of dark and light, and every dark
// run is tried as the start of a barcode, both ways round. Each digit is matched by
// the proportions of its four bars and spaces, so a barcode photographed at a slant
// (bars wider at one end than the other) still reads. The check digit and the guard
// bars throw out nearly every misread; a camera frame also needs two lines to agree.

import { checkDigit, expandUpcE, normalizeCode } from '../codes.js';

// Bar and space widths (in modules) of each digit's L code. A G code is the same
// widths reversed; an R code (right half) has the same widths as its L code.
const L_CODES = [
  [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
  [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2],
];
const LG_CODES = [...L_CODES, ...L_CODES.map((code) => [...code].reverse())];
// EAN-13's first digit, from which of the left six digits use G codes (1 = G).
const FIRST_DIGIT = [0x00, 0x0b, 0x0d, 0x0e, 0x13, 0x19, 0x1c, 0x15, 0x16, 0x1a];
// UPC-E's number system 0, by check digit (1 = G); number system 1 is the inverse.
const UPC_E_PARITY = [0x38, 0x34, 0x32, 0x31, 0x2c, 0x26, 0x23, 0x2a, 0x29, 0x25];

// Less difference than this between dark and light nearby is blank paper, not bars.
const MIN_CONTRAST = 24;
const MAX_AVG_VARIANCE = 0.48;
const MAX_INDIVIDUAL_VARIANCE = 0.7;
// Lines tried across the image, as fractions of its height (or width), middle first.
const LINES = [0.5, 0.42, 0.58, 0.34, 0.66, 0.46, 0.54, 0.26, 0.74, 0.38, 0.62, 0.18, 0.82];

function variance(runs, at, pattern) {
  let total = 0;
  let modules = 0;
  for (let i = 0; i < pattern.length; i++) {
    total += runs[at + i];
    modules += pattern[i];
  }
  if (total < modules) return Infinity;
  const unit = total / modules;
  const limit = MAX_INDIVIDUAL_VARIANCE * unit;
  let sum = 0;
  for (let i = 0; i < pattern.length; i++) {
    const off = Math.abs(runs[at + i] - pattern[i] * unit);
    if (off > limit) return Infinity;
    sum += off;
  }
  return sum / total;
}

const GUARD = [1, 1, 1];
const MIDDLE = [1, 1, 1, 1, 1];
const UPC_E_END = [1, 1, 1, 1, 1, 1];

// The digit whose code best fits runs[at..at+3]: 0-9 for L codes, 10-19 for G. -1 if none fits.
function digitAt(runs, at, codes, unit) {
  const width = runs[at] + runs[at + 1] + runs[at + 2] + runs[at + 3];
  if (width < 7 * unit * 0.6 || width > 7 * unit * 1.6) return -1;
  let best = -1;
  let bestVariance = MAX_AVG_VARIANCE;
  for (let d = 0; d < codes.length; d++) {
    const v = variance(runs, at, codes[d]);
    if (v < bestVariance) {
      bestVariance = v;
      best = d;
    }
  }
  return best;
}

function guardUnit(runs, at, pattern) {
  if (variance(runs, at, pattern) >= MAX_AVG_VARIANCE) return 0;
  let total = 0;
  for (let i = 0; i < pattern.length; i++) total += runs[at + i];
  return total / pattern.length;
}

// Reads `count` digits from runs[at...], each four runs. Returns { digits, parity } or null.
function readDigits(runs, at, count, codes, unit) {
  let digits = '';
  let parity = 0;
  for (let i = 0; i < count; i++) {
    const d = digitAt(runs, at + i * 4, codes, unit);
    if (d < 0) return null;
    digits += d % 10;
    parity = (parity << 1) | (d >= 10 ? 1 : 0);
  }
  return { digits, parity };
}

function quietBefore(runs, start, unit) {
  return start === 0 || runs[start - 1] >= unit * 2.5;
}

function ean13(runs, start) {
  if (start + 59 > runs.length) return null;
  const unit = guardUnit(runs, start, GUARD);
  if (!unit || !quietBefore(runs, start, unit)) return null;
  const left = readDigits(runs, start + 3, 6, LG_CODES, unit);
  if (!left || !guardUnit(runs, start + 27, MIDDLE)) return null;
  const right = readDigits(runs, start + 32, 6, L_CODES, unit);
  if (!right || !guardUnit(runs, start + 56, GUARD)) return null;
  const first = FIRST_DIGIT.indexOf(left.parity);
  if (first < 0) return null;
  const code = `${first}${left.digits}${right.digits}`;
  return checkDigit(code.slice(0, -1)) === code.at(-1) ? code : null;
}

function ean8(runs, start) {
  if (start + 43 > runs.length) return null;
  const unit = guardUnit(runs, start, GUARD);
  if (!unit || !quietBefore(runs, start, unit)) return null;
  const left = readDigits(runs, start + 3, 4, L_CODES, unit);
  if (!left || !guardUnit(runs, start + 19, MIDDLE)) return null;
  const right = readDigits(runs, start + 24, 4, L_CODES, unit);
  if (!right || !guardUnit(runs, start + 40, GUARD)) return null;
  const code = left.digits + right.digits;
  return checkDigit(code.slice(0, -1)) === code.at(-1) ? code : null;
}

function upcE(runs, start) {
  if (start + 33 > runs.length) return null;
  const unit = guardUnit(runs, start, GUARD);
  if (!unit || !quietBefore(runs, start, unit)) return null;
  const middle = readDigits(runs, start + 3, 6, LG_CODES, unit);
  if (!middle || !guardUnit(runs, start + 27, UPC_E_END)) return null;
  for (const ns of [0, 1]) {
    const check = UPC_E_PARITY.findIndex((p) => (ns ? p ^ 0x3f : p) === middle.parity);
    if (check < 0) continue;
    const upca = expandUpcE(`${ns}${middle.digits}${check}`);
    if (upca) return upca;
  }
  return null;
}

// Runs of dark and light along one line, starting with a light run (possibly 0 long).
export function toRuns(line) {
  const n = line.length;
  // A gentle blur keeps sensor noise from splitting a wide bar in two, then each
  // pixel is compared with halfway between the darkest and lightest around it, so
  // uneven light doesn't matter and bars beside the white margin keep their width.
  const smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) smooth[i] = (line[Math.max(0, i - 1)] + 2 * line[i] + line[Math.min(n - 1, i + 1)]) / 4;
  const half = Math.max(12, Math.round(n / 16));
  // Darkest and lightest in each stretch of `half`, so each window is a few lookups.
  const chunks = Math.ceil(n / half);
  const lows = new Float32Array(chunks).fill(255);
  const highs = new Float32Array(chunks);
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / half);
    if (smooth[i] < lows[c]) lows[c] = smooth[i];
    if (smooth[i] > highs[c]) highs[c] = smooth[i];
  }
  const runs = [0];
  let dark = false;
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / half);
    let low = 255;
    let high = 0;
    for (let k = Math.max(0, c - 1); k <= Math.min(chunks - 1, c + 1); k++) {
      if (lows[k] < low) low = lows[k];
      if (highs[k] > high) high = highs[k];
    }
    const isDark = high - low > MIN_CONTRAST && smooth[i] < (low + high) / 2;
    if (isDark !== dark) {
      runs.push(0);
      dark = isDark;
    }
    runs[runs.length - 1]++;
  }
  return runs;
}

// Every barcode on one line, as normalized codes (EAN-8, or 13 digits).
export function decodeLine(line) {
  const found = [];
  const forward = toRuns(line);
  const backward = [...forward].reverse();
  // Reversed, the runs no longer start with a light one; pad so odd indexes stay dark.
  if (backward.length % 2 === 0) backward.unshift(0);
  for (const runs of [forward, backward]) {
    for (let start = 1; start < runs.length; start += 2) {
      const code = ean13(runs, start) ?? ean8(runs, start) ?? upcE(runs, start);
      const normal = code && normalizeCode(code);
      if (normal) found.push(normal);
    }
  }
  return found;
}

function row(lum, width, y) {
  return lum.subarray(y * width, (y + 1) * width);
}

function column(lum, width, height, x) {
  const out = new Uint8Array(height);
  for (let y = 0; y < height; y++) out[y] = lum[y * width + x];
  return out;
}

// The barcode in a greyscale image (Uint8Array, one byte a pixel), or null.
// `agree` is how many lines must read the same code; a single still photo may get by with 1.
export function decodeBarcode(lum, width, height, { agree = 2 } = {}) {
  const votes = new Map();
  const lines = [
    ...LINES.map((f) => () => row(lum, width, Math.floor(f * (height - 1)))),
    ...LINES.map((f) => () => column(lum, width, height, Math.floor(f * (width - 1)))),
  ];
  for (const line of lines) {
    for (const code of new Set(decodeLine(line()))) {
      const count = (votes.get(code) ?? 0) + 1;
      votes.set(code, count);
      if (count >= agree) return code;
    }
  }
  return null;
}
