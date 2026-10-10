// Reads QR codes from a greyscale image, written from the QR Code spec (ISO/IEC
// 18004) so the board needs no third-party packages (board/qr.py is its encoder
// twin). Pure, so node can test it.
//
//   1. binarize: dark or light, against the average brightness nearby;
//   2. find the three finder squares (dark, light, 3 dark, light, dark across);
//   3. work out the code's size, find the alignment square, and map every module
//      through the perspective those four points describe;
//   4. read the format, unmask, de-interleave, fix errors (Reed-Solomon), and read
//      the data: numbers, letters, bytes (UTF-8) or Kanji, with GS1's FNC1.

// GF(256) arithmetic, with QR's polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
const alpha = (e) => EXP[((e % 255) + 255) % 255];

// Polynomial with coefficients lowest power first.
function evaluate(poly, x) {
  let y = 0;
  for (let i = poly.length - 1; i >= 0; i--) y = mul(y, x) ^ poly[i];
  return y;
}

function syndromes(block, count) {
  const out = new Array(count);
  for (let j = 0; j < count; j++) {
    const a = alpha(j);
    let s = 0;
    for (let i = 0; i < block.length; i++) s = mul(s, a) ^ block[i];
    out[j] = s;
  }
  return out;
}

// Fixes up to ecCount/2 wrong codewords in `block` (data then error correction,
// first codeword the highest power) in place. False if it can't be fixed.
export function correctErrors(block, ecCount) {
  const S = syndromes(block, ecCount);
  if (S.every((s) => s === 0)) return true;
  const n = block.length;

  // Berlekamp-Massey: the error locator polynomial C.
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let k = 0; k < ecCount; k++) {
    let d = S[k];
    for (let i = 1; i <= L; i++) d ^= mul(C[i] ?? 0, S[k - i]);
    if (d === 0) {
      m++;
      continue;
    }
    const scale = div(d, b);
    const previous = C.slice();
    while (C.length < B.length + m) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= mul(scale, B[i]);
    if (2 * L <= k) {
      L = k + 1 - L;
      B = previous;
      b = d;
      m = 1;
    } else {
      m++;
    }
  }
  if (2 * L > ecCount) return false;

  // Chien search: codeword i is wrong where C(X⁻¹) = 0, X = α^(n-1-i).
  const wrong = [];
  for (let i = 0; i < n; i++) if (evaluate(C, alpha(-(n - 1 - i))) === 0) wrong.push(i);
  if (wrong.length !== L) return false;

  // Forney: each error's value from Ω = S·C mod x^ecCount and C's derivative.
  const omega = new Array(ecCount).fill(0);
  for (let i = 0; i < ecCount; i++) {
    for (let j = 0; j < C.length && i + j < ecCount; j++) omega[i + j] ^= mul(S[i], C[j]);
  }
  const derivative = C.slice(1).map((c, i) => (i % 2 === 0 ? c : 0));
  for (const i of wrong) {
    const X = alpha(n - 1 - i);
    const Xinv = alpha(-(n - 1 - i));
    const denominator = evaluate(derivative, Xinv);
    if (!denominator) return false;
    block[i] ^= div(mul(X, evaluate(omega, Xinv)), denominator);
  }
  return syndromes(block, ecCount).every((s) => s === 0);
}

// Error correction blocks for each version, at levels L, M, Q, H:
// [codewords of correction per block, blocks, data codewords, blocks, data codewords].
const EC_BLOCKS = [
  null,
  [[7, 1, 19], [10, 1, 16], [13, 1, 13], [17, 1, 9]],
  [[10, 1, 34], [16, 1, 28], [22, 1, 22], [28, 1, 16]],
  [[15, 1, 55], [26, 1, 44], [18, 2, 17], [22, 2, 13]],
  [[20, 1, 80], [18, 2, 32], [26, 2, 24], [16, 4, 9]],
  [[26, 1, 108], [24, 2, 43], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]],
  [[18, 2, 68], [16, 4, 27], [24, 4, 19], [28, 4, 15]],
  [[20, 2, 78], [18, 4, 31], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]],
  [[24, 2, 97], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]],
  [[30, 2, 116], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]],
  [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]],
  [[20, 4, 81], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]],
  [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]],
  [[26, 4, 107], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]],
  [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]],
  [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13]],
  [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]],
  [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47], [28, 1, 22, 15, 23], [28, 2, 14, 17, 15]],
  [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44], [28, 17, 22, 1, 23], [28, 2, 14, 19, 15]],
  [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45], [26, 17, 21, 4, 22], [26, 9, 13, 16, 14]],
  [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42], [30, 15, 24, 5, 25], [28, 15, 15, 10, 16]],
  [[28, 4, 116, 4, 117], [26, 17, 42], [28, 17, 22, 6, 23], [30, 19, 16, 6, 17]],
  [[28, 2, 111, 7, 112], [28, 17, 46], [30, 7, 24, 16, 25], [24, 34, 13]],
  [[30, 4, 121, 5, 122], [28, 4, 47, 14, 48], [30, 11, 24, 14, 25], [30, 16, 15, 14, 16]],
  [[30, 6, 117, 4, 118], [28, 6, 45, 14, 46], [30, 11, 24, 16, 25], [30, 30, 16, 2, 17]],
  [[26, 8, 106, 4, 107], [28, 8, 47, 13, 48], [30, 7, 24, 22, 25], [30, 22, 15, 13, 16]],
  [[28, 10, 114, 2, 115], [28, 19, 46, 4, 47], [28, 28, 22, 6, 23], [30, 33, 16, 4, 17]],
  [[30, 8, 122, 4, 123], [28, 22, 45, 3, 46], [30, 8, 23, 26, 24], [30, 12, 15, 28, 16]],
  [[30, 3, 117, 10, 118], [28, 3, 45, 23, 46], [30, 4, 24, 31, 25], [30, 11, 15, 31, 16]],
  [[30, 7, 116, 7, 117], [28, 21, 45, 7, 46], [30, 1, 23, 37, 24], [30, 19, 15, 26, 16]],
  [[30, 5, 115, 10, 116], [28, 19, 47, 10, 48], [30, 15, 24, 25, 25], [30, 23, 15, 25, 16]],
  [[30, 13, 115, 3, 116], [28, 2, 46, 29, 47], [30, 42, 24, 1, 25], [30, 23, 15, 28, 16]],
  [[30, 17, 115], [28, 10, 46, 23, 47], [30, 10, 24, 35, 25], [30, 19, 15, 35, 16]],
  [[30, 17, 115, 1, 116], [28, 14, 46, 21, 47], [30, 29, 24, 19, 25], [30, 11, 15, 46, 16]],
  [[30, 13, 115, 6, 116], [28, 14, 46, 23, 47], [30, 44, 24, 7, 25], [30, 59, 16, 1, 17]],
  [[30, 12, 121, 7, 122], [28, 12, 47, 26, 48], [30, 39, 24, 14, 25], [30, 22, 15, 41, 16]],
  [[30, 6, 121, 14, 122], [28, 6, 47, 34, 48], [30, 46, 24, 10, 25], [30, 2, 15, 64, 16]],
  [[30, 17, 122, 4, 123], [28, 29, 46, 14, 47], [30, 49, 24, 10, 25], [30, 24, 15, 46, 16]],
  [[30, 4, 122, 18, 123], [28, 13, 46, 32, 47], [30, 48, 24, 14, 25], [30, 42, 15, 32, 16]],
  [[30, 20, 117, 4, 118], [28, 40, 47, 7, 48], [30, 43, 24, 22, 25], [30, 10, 15, 67, 16]],
  [[30, 19, 118, 6, 119], [28, 18, 47, 31, 48], [30, 34, 24, 34, 25], [30, 20, 15, 61, 16]],
];

// The two format bits for each level, in EC_BLOCKS order (L, M, Q, H).
const LEVEL_BITS = [1, 0, 3, 2];

export function blocksFor(version, level) {
  const [ec, ...groups] = EC_BLOCKS[version][level];
  const blocks = [];
  for (let g = 0; g < groups.length; g += 2) {
    for (let i = 0; i < groups[g]; i++) blocks.push({ data: groups[g + 1], ec });
  }
  return blocks;
}

export function alignmentPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

// Codewords a version holds: every module that isn't part of a fixed pattern, in bytes.
export function rawCodewords(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    modules -= (25 * count - 10) * count - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

function functionModules(version) {
  const size = version * 4 + 17;
  const fixed = new Uint8Array(size * size);
  const mark = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) fixed[j * size + i] = 1;
  };
  // Finders with their separators and format bits (and the dark module).
  mark(0, 0, 9, 9);
  mark(size - 8, 0, 8, 9);
  mark(0, size - 8, 9, 8);
  mark(6, 0, 1, size);
  mark(0, 6, size, 1);
  const centers = alignmentPositions(version);
  const last = centers.length - 1;
  centers.forEach((cx, i) =>
    centers.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      mark(cx - 2, cy - 2, 5, 5);
    }),
  );
  if (version >= 7) {
    mark(size - 11, 0, 3, 6);
    mark(0, size - 11, 6, 3);
  }
  return fixed;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function bitDistance(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}

const FORMAT_CODES = Array.from({ length: 32 }, (_, data) => {
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
});

const VERSION_CODES = Array.from({ length: 41 }, (_, version) => {
  if (version < 7) return -1;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return (version << 12) | (rem & 0xfff);
});

function closest(codes, ...reads) {
  let best = -1;
  let bestDistance = 4;
  codes.forEach((code, value) => {
    if (code < 0) return;
    for (const read of reads) {
      const d = bitDistance(code, read);
      if (d < bestDistance) {
        bestDistance = d;
        best = value;
      }
    }
  });
  return best;
}

function readFormat(get, size) {
  let first = 0;
  let second = 0;
  const copy = (bits, x, y) => (bits << 1) | (get(x, y) ? 1 : 0);
  for (let x = 0; x <= 5; x++) first = copy(first, x, 8);
  first = copy(first, 7, 8);
  first = copy(first, 8, 8);
  first = copy(first, 8, 7);
  for (let y = 5; y >= 0; y--) first = copy(first, 8, y);
  for (let y = size - 1; y >= size - 7; y--) second = copy(second, 8, y);
  for (let x = size - 8; x < size; x++) second = copy(second, x, 8);
  const data = closest(FORMAT_CODES, first, second);
  if (data < 0) return null;
  return { level: LEVEL_BITS.indexOf(data >> 3), mask: data & 7 };
}

function readVersion(get, size) {
  let first = 0;
  let second = 0;
  for (let i = 17; i >= 0; i--) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    first = (first << 1) | (get(a, b) ? 1 : 0);
    second = (second << 1) | (get(b, a) ? 1 : 0);
  }
  const version = closest(VERSION_CODES, first, second);
  return version < 0 ? null : version;
}

const COUNT_BITS = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16], 8: [8, 10, 12] };
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function bytesToText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

// The text in a QR code's data codewords. GS1 codes (FNC1) separate their fields
// with GS (\x1d), the way a barcode scanner reports them. Null if it isn't valid.
export function parseData(bytes, version) {
  let bit = 0;
  const total = bytes.length * 8;
  const read = (n) => {
    if (bit + n > total) throw new RangeError('out of data');
    let value = 0;
    for (let i = 0; i < n; i++, bit++) value = (value << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  const sizeClass = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  let text = '';
  let gs1 = false;
  try {
    while (total - bit >= 4) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 7) {
        // ECI: which character set follows. Bytes are read as UTF-8 either way.
        const first = read(8);
        if ((first & 0xc0) === 0x80) read(8);
        else if ((first & 0xe0) === 0xc0) read(16);
        continue;
      }
      if (mode === 5 || mode === 9) {
        if (mode === 9) read(8);
        gs1 = true;
        continue;
      }
      if (mode === 3) {
        read(16);
        continue;
      }
      const bits = COUNT_BITS[mode];
      if (!bits) return null;
      let count = read(bits[sizeClass]);
      if (mode === 1) {
        for (; count >= 3; count -= 3) text += String(read(10)).padStart(3, '0');
        if (count === 2) text += String(read(7)).padStart(2, '0');
        else if (count === 1) text += String(read(4));
      } else if (mode === 2) {
        let part = '';
        for (; count >= 2; count -= 2) {
          const v = read(11);
          part += ALPHANUMERIC[Math.floor(v / 45)] + ALPHANUMERIC[v % 45];
        }
        if (count === 1) part += ALPHANUMERIC[read(6)];
        text += gs1 ? part.replace(/%%|%/g, (m) => (m === '%%' ? '%' : '\x1d')) : part;
      } else if (mode === 4) {
        const raw = new Uint8Array(count);
        for (let i = 0; i < count; i++) raw[i] = read(8);
        text += bytesToText(raw);
      } else {
        const raw = new Uint8Array(count * 2);
        for (let i = 0; i < count; i++) {
          const v = read(13);
          let assembled = (Math.floor(v / 0xc0) << 8) | v % 0xc0;
          assembled += assembled < 0x1f00 ? 0x8140 : 0xc140;
          raw[i * 2] = assembled >> 8;
          raw[i * 2 + 1] = assembled & 0xff;
        }
        try {
          text += new TextDecoder('shift_jis').decode(raw);
        } catch {
          return null;
        }
      }
    }
  } catch {
    return null;
  }
  return gs1 ? `]Q3${text}` : text;
}

// The text in a grid of modules, read through get(x, y) → dark. Null if unreadable.
export function decodeMatrix(get, size) {
  if (size < 21 || size > 177 || (size - 17) % 4 !== 0) return null;
  const format = readFormat(get, size);
  if (!format) return null;
  let version = (size - 17) / 4;
  if (version >= 7) {
    const read = readVersion(get, size);
    if (read !== null && read !== version) return null;
  }
  const fixed = functionModules(version);
  const mask = MASKS[format.mask];
  const raw = new Uint8Array(rawCodewords(version));
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const y = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (fixed[y * size + x] || bit >= raw.length * 8) continue;
        if (get(x, y) !== mask(x, y)) raw[bit >> 3] |= 0x80 >> (bit & 7);
        bit++;
      }
    }
  }

  const blocks = blocksFor(version, format.level);
  const longest = Math.max(...blocks.map((b) => b.data));
  const parts = blocks.map((b) => ({ ...b, words: new Uint8Array(b.data + b.ec) }));
  let k = 0;
  for (let i = 0; i < longest; i++) for (const p of parts) if (i < p.data) p.words[i] = raw[k++];
  for (let i = 0; i < blocks[0].ec; i++) for (const p of parts) p.words[p.data + i] = raw[k++];
  const data = [];
  for (const p of parts) {
    if (!correctErrors(p.words, p.ec)) return null;
    for (let i = 0; i < p.data; i++) data.push(p.words[i]);
  }
  return parseData(Uint8Array.from(data), version);
}

// Locating the code in a picture

const BLOCK = 8;
const MIN_DYNAMIC_RANGE = 24;

// 1 for dark, 0 for light, each pixel against the average of the 40 × 40 around it.
export function binarize(lum, width, height) {
  const out = new Uint8Array(width * height);
  if (width < BLOCK * 5 || height < BLOCK * 5) {
    let sum = 0;
    for (let i = 0; i < lum.length; i++) sum += lum[i];
    const threshold = sum / lum.length;
    for (let i = 0; i < lum.length; i++) out[i] = lum[i] <= threshold ? 1 : 0;
    return out;
  }
  const bw = Math.ceil(width / BLOCK);
  const bh = Math.ceil(height / BLOCK);
  const level = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    const y0 = Math.min(by * BLOCK, height - BLOCK);
    for (let bx = 0; bx < bw; bx++) {
      const x0 = Math.min(bx * BLOCK, width - BLOCK);
      let sum = 0;
      let min = 255;
      let max = 0;
      for (let y = y0; y < y0 + BLOCK; y++) {
        for (let x = x0, i = y * width + x0; x < x0 + BLOCK; x++, i++) {
          const v = lum[i];
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      let average = sum / (BLOCK * BLOCK);
      // A flat block is all light, unless it's darker than its neighbours.
      if (max - min <= MIN_DYNAMIC_RANGE) {
        average = min / 2;
        if (by > 0 && bx > 0) {
          const around = (level[(by - 1) * bw + bx] + 2 * level[by * bw + bx - 1] + level[(by - 1) * bw + bx - 1]) / 4;
          if (min < around) average = around;
        }
      }
      level[by * bw + bx] = average;
    }
  }
  for (let by = 0; by < bh; by++) {
    const y0 = Math.min(by * BLOCK, height - BLOCK);
    const top = Math.min(Math.max(by, 2), bh - 3);
    for (let bx = 0; bx < bw; bx++) {
      const x0 = Math.min(bx * BLOCK, width - BLOCK);
      const left = Math.min(Math.max(bx, 2), bw - 3);
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += level[(top + dy) * bw + left + dx];
      const threshold = sum / 25;
      for (let y = y0; y < y0 + BLOCK; y++) {
        for (let x = x0, i = y * width + x0; x < x0 + BLOCK; x++, i++) out[i] = lum[i] <= threshold ? 1 : 0;
      }
    }
  }
  return out;
}

function isFinderRatio(counts) {
  let total = 0;
  for (const c of counts) {
    if (c === 0) return false;
    total += c;
  }
  if (total < 7) return false;
  const unit = total / 7;
  const slack = unit / 2;
  return (
    Math.abs(unit - counts[0]) < slack &&
    Math.abs(unit - counts[1]) < slack &&
    Math.abs(3 * unit - counts[2]) < 3 * slack &&
    Math.abs(unit - counts[3]) < slack &&
    Math.abs(unit - counts[4]) < slack
  );
}

const centerFromEnd = (counts, end) => end - counts[4] - counts[3] - counts[2] / 2;

// Walks out from (x, y) along (dx, dy) through a finder's five bands; the centre
// along that line, or NaN if it isn't one.
function crossCheck(bits, width, height, x, y, dx, dy, maxCount, expectedTotal) {
  const dark = (i) => bits[(y + i * dy) * width + (x + i * dx)] === 1;
  const inside = (i) => x + i * dx >= 0 && x + i * dx < width && y + i * dy >= 0 && y + i * dy < height;
  const counts = [0, 0, 0, 0, 0];
  let i = 0;
  while (inside(i) && dark(i)) (counts[2]++, i--);
  if (!inside(i)) return NaN;
  while (inside(i) && !dark(i) && counts[1] <= maxCount) (counts[1]++, i--);
  if (!inside(i) || counts[1] > maxCount) return NaN;
  while (inside(i) && dark(i) && counts[0] <= maxCount) (counts[0]++, i--);
  if (counts[0] > maxCount) return NaN;
  i = 1;
  while (inside(i) && dark(i)) (counts[2]++, i++);
  if (!inside(i)) return NaN;
  while (inside(i) && !dark(i) && counts[3] < maxCount) (counts[3]++, i++);
  if (!inside(i) || counts[3] >= maxCount) return NaN;
  while (inside(i) && dark(i) && counts[4] < maxCount) (counts[4]++, i++);
  if (counts[4] >= maxCount) return NaN;
  const total = counts.reduce((a, c) => a + c, 0);
  if (5 * Math.abs(total - expectedTotal) >= 2 * expectedTotal) return NaN;
  return isFinderRatio(counts) ? centerFromEnd(counts, i) : NaN;
}

function findFinders(bits, width, height) {
  const found = [];
  const consider = (counts, row, end) => {
    const total = counts.reduce((a, c) => a + c, 0);
    let cx = centerFromEnd(counts, end);
    const offsetY = crossCheck(bits, width, height, Math.floor(cx), row, 0, 1, counts[2], total);
    if (Number.isNaN(offsetY)) return false;
    const cy = row + offsetY;
    const offsetX = crossCheck(bits, width, height, Math.floor(cx), Math.floor(cy), 1, 0, counts[2], total);
    if (Number.isNaN(offsetX)) return false;
    cx = Math.floor(cx) + offsetX;
    const size = total / 7;
    const same = found.find(
      (f) => Math.abs(cy - f.y) <= size && Math.abs(cx - f.x) <= size && (Math.abs(size - f.size) <= 1 || Math.abs(size - f.size) <= f.size),
    );
    if (same) {
      const n = same.count;
      same.x = (same.x * n + cx) / (n + 1);
      same.y = (same.y * n + cy) / (n + 1);
      same.size = (same.size * n + size) / (n + 1);
      same.count++;
    } else {
      found.push({ x: cx, y: cy, size, count: 1 });
    }
    return true;
  };

  for (let y = 0; y < height; y++) {
    const counts = [0, 0, 0, 0, 0];
    let state = 0;
    const shift = () => {
      counts[0] = counts[2];
      counts[1] = counts[3];
      counts[2] = counts[4];
      counts[3] = 1;
      counts[4] = 0;
      state = 3;
    };
    for (let x = 0; x < width; x++) {
      if (bits[y * width + x]) {
        if (state & 1) state++;
        counts[state]++;
      } else if (state & 1) {
        counts[state]++;
      } else if (state === 4) {
        if (isFinderRatio(counts) && consider(counts, y, x)) {
          counts.fill(0);
          state = 0;
        } else {
          shift();
        }
      } else {
        state++;
        counts[state]++;
      }
    }
    if (isFinderRatio(counts)) consider(counts, y, width);
  }
  return found;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// The likeliest sets of three finders, each as { topLeft, topRight, bottomLeft }.
function finderTriples(found) {
  const strong = found.filter((f) => f.count >= 2);
  const pool = (strong.length >= 3 ? strong : found).sort((a, b) => b.count - a.count).slice(0, 10);
  const triples = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const three = [pool[i], pool[j], pool[k]];
        const sizes = three.map((f) => f.size);
        if (Math.max(...sizes) / Math.min(...sizes) > 1.5) continue;
        // The top left is the corner opposite the longest side.
        const sides = [distance(three[1], three[2]), distance(three[0], three[2]), distance(three[0], three[1])];
        const corner = sides.indexOf(Math.max(...sides));
        const topLeft = three[corner];
        let [a, c] = three.filter((_, n) => n !== corner);
        if ((c.x - topLeft.x) * (a.y - topLeft.y) - (c.y - topLeft.y) * (a.x - topLeft.x) < 0) [a, c] = [c, a];
        const across = distance(topLeft, c);
        const down = distance(topLeft, a);
        const diagonal = sides[corner];
        const squareness = Math.abs(across * across + down * down - diagonal * diagonal) / (diagonal * diagonal);
        const ratio = Math.abs(across - down) / Math.max(across, down);
        const unit = sizes.reduce((s, v) => s + v, 0) / 3;
        if (squareness > 0.35 || ratio > 0.4 || across / unit < 10) continue;
        triples.push({ topLeft, topRight: c, bottomLeft: a, unit, score: squareness + ratio });
      }
    }
  }
  return triples.sort((p, q) => p.score - q.score).slice(0, 3);
}

// The homography taking the four `from` points to the four `to` points.
function perspective(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = from[i];
    const [x, y] = to[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-12) return null;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  const h = A.map((r, i) => r[8] / r[i]);
  return (u, v) => {
    const w = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
  };
}

// The centre of the alignment square near (x, y): dark centre, light ring, dark ring.
function findAlignment(bits, width, height, x, y, unit) {
  const radius = unit * 6;
  const step = Math.max(1, unit / 4);
  const dark = (px, py) => {
    const ix = Math.round(px);
    const iy = Math.round(py);
    return ix >= 0 && iy >= 0 && ix < width && iy < height && bits[iy * width + ix] === 1;
  };
  let best = 0;
  let hits = [];
  for (let cy = y - radius; cy <= y + radius; cy += step) {
    for (let cx = x - radius; cx <= x + radius; cx += step) {
      if (!dark(cx, cy)) continue;
      let score = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          if (dark(cx + dx * unit, cy + dy * unit) === (ring !== 1)) score++;
        }
      }
      if (score > best) {
        best = score;
        hits = [[cx, cy]];
      } else if (score === best) {
        hits.push([cx, cy]);
      }
    }
  }
  if (best < 23) return null;
  // Of the best spots, the cluster nearest the estimate.
  hits.sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
  const near = hits.filter((p) => Math.hypot(p[0] - hits[0][0], p[1] - hits[0][1]) <= unit);
  return {
    x: near.reduce((s, p) => s + p[0], 0) / near.length,
    y: near.reduce((s, p) => s + p[1], 0) / near.length,
  };
}

function sampleAndDecode(bits, width, height, size, map) {
  const grid = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [px, py] = map(x + 0.5, y + 0.5);
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      if (!(ix >= -1 && iy >= -1 && ix <= width && iy <= height)) return null;
      grid[y * size + x] = bits[Math.min(height - 1, Math.max(0, iy)) * width + Math.min(width - 1, Math.max(0, ix))];
    }
  }
  return (
    decodeMatrix((x, y) => grid[y * size + x] === 1, size) ??
    // A mirrored code (printed on the back of something clear) reads with x and y swapped.
    decodeMatrix((x, y) => grid[x * size + y] === 1, size)
  );
}

function decodeTriple(bits, width, height, { topLeft, topRight, bottomLeft, unit }) {
  const across = Math.round(distance(topLeft, topRight) / unit);
  const down = Math.round(distance(topLeft, bottomLeft) / unit);
  let estimate = Math.floor((across + down) / 2) + 7;
  if ((estimate & 3) === 0) estimate++;
  else if ((estimate & 3) === 2) estimate--;
  else if ((estimate & 3) === 3) estimate -= 2;
  for (const size of [estimate, estimate + 4, estimate - 4]) {
    if (size < 21 || size > 177) continue;
    const far = size - 3.5;
    const guessX = topRight.x - topLeft.x + bottomLeft.x;
    const guessY = topRight.y - topLeft.y + bottomLeft.y;
    const corners = [];
    if (size > 21) {
      const toward = 1 - 3 / (size - 7);
      const alignment = findAlignment(bits, width, height, topLeft.x + toward * (guessX - topLeft.x), topLeft.y + toward * (guessY - topLeft.y), unit);
      if (alignment) corners.push([[far - 3, far - 3], [alignment.x, alignment.y]]);
    }
    corners.push([[far, far], [guessX, guessY]]);
    for (const [from, to] of corners) {
      const map = perspective(
        [[3.5, 3.5], [far, 3.5], from, [3.5, far]],
        [[topLeft.x, topLeft.y], [topRight.x, topRight.y], to, [bottomLeft.x, bottomLeft.y]],
      );
      const text = map && sampleAndDecode(bits, width, height, size, map);
      if (text != null) return text;
    }
  }
  return null;
}

// The text of the QR code in a greyscale image (one byte a pixel), or null.
export function decodeQR(lum, width, height) {
  const bits = binarize(lum, width, height);
  for (const triple of finderTriples(findFinders(bits, width, height))) {
    const text = decodeTriple(bits, width, height, triple);
    if (text != null) return text;
  }
  return null;
}
