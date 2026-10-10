import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDigit, expandUpcE, normalizeCode, readScan } from '../../web/js/apps/grocery/codes.js';
import { decodeBarcode, decodeLine } from '../../web/js/apps/grocery/scan/ean.js';
import {
  alignmentPositions,
  blocksFor,
  correctErrors,
  decodeMatrix,
  decodeQR,
  parseData,
  rawCodewords,
} from '../../web/js/apps/grocery/scan/qr.js';
import { decodeImage } from '../../web/js/apps/grocery/scan/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// QR codes drawn by the board's own encoder (board/qr.py), as rows of 0 and 1.
function encodeQR(texts) {
  const script = 'import json, sys\nfrom board import qr\nprint(json.dumps([["".join("1" if m else "0" for m in row) for row in qr.encode(t)] for t in json.load(sys.stdin)]))';
  return JSON.parse(execFileSync('python3', ['-c', script], { cwd: ROOT, input: JSON.stringify(texts) }));
}

// A deterministic stand-in for Math.random, so a failure can be reproduced.
function random(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Draws a module grid as a photo might see it: scaled, turned, with uneven light and noise.
function photograph(rows, { scale = 4, quiet = 4, angle = 0, noise = 0, width, height, seed = 1 } = {}) {
  const size = rows.length;
  const span = (size + quiet * 2) * scale;
  const w = width ?? Math.ceil(span * 1.5);
  const h = height ?? Math.ceil(span * 1.5);
  const lum = new Uint8Array(w * h);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rand = random(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2;
      const dy = y - h / 2;
      const u = (cos * dx + sin * dy) / scale + size / 2;
      const v = (-sin * dx + cos * dy) / scale + size / 2;
      const mx = Math.floor(u);
      const my = Math.floor(v);
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && rows[my][mx] === '1';
      const light = 170 + 60 * (x / w);
      const value = (dark ? 40 : light) + (rand() - 0.5) * noise;
      lum[y * w + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { lum, width: w, height: h };
}

test('the QR tables agree with each version’s size', () => {
  for (let version = 1; version <= 40; version++) {
    for (let level = 0; level < 4; level++) {
      const total = blocksFor(version, level).reduce((sum, b) => sum + b.data + b.ec, 0);
      assert.equal(total, rawCodewords(version), `version ${version} level ${level}`);
    }
  }
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(36), [6, 24, 50, 76, 102, 128, 154]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('Reed-Solomon fixes up to half its correction codewords and no more', () => {
  const [rows] = encodeQR(['https://id.gs1.org/01/04056489011293']);
  const size = rows.length;
  const read = (flips) => decodeMatrix((x, y) => (rows[y][x] === '1') !== flips.has(`${x},${y}`), size);
  assert.equal(read(new Set()), 'https://id.gs1.org/01/04056489011293');
  // Spoil a few modules in the data area (away from the finders and format bits).
  const flips = new Set();
  for (let i = 0; i < 12; i++) flips.add(`${size - 1 - (i % 4)},${size - 12 - Math.floor(i / 4)}`);
  assert.equal(read(flips), 'https://id.gs1.org/01/04056489011293');

  const block = Uint8Array.from({ length: 26 }, (_, i) => (i * 37 + 11) & 0xff);
  assert.equal(correctErrors(block.slice(), 10), false, 'random bytes are not a codeword');
});

test('QR codes read from the matrix straight off the encoder, every version it makes', () => {
  const texts = ['Hi', 'http://192.168.1.20:8080/#/app/grocery', 'x'.repeat(60), 'Grüße aus der Küche 🍅', 'y'.repeat(100)];
  encodeQR(texts).forEach((rows, i) => {
    assert.equal(decodeMatrix((x, y) => rows[y][x] === '1', rows.length), texts[i]);
  });
});

test('QR codes read from pictures: small, turned, unevenly lit and noisy', () => {
  const texts = ['https://id.gs1.org/01/00000000016285', 'https://www.traderjoes.com/home/products/pdp/marinara-sauce-016285', 'z'.repeat(90)];
  const codes = encodeQR(texts);
  codes.forEach((rows, i) => {
    for (const options of [{ scale: 4 }, { scale: 3, angle: 0.35, noise: 40 }, { scale: 6, angle: Math.PI / 2 + 0.1, noise: 60, seed: 7 }]) {
      const { lum, width, height } = photograph(rows, options);
      assert.equal(decodeQR(lum, width, height), texts[i], `${texts[i]} ${JSON.stringify(options)}`);
    }
  });
});

test('a picture with no QR code in it reads as nothing', () => {
  const rand = random(3);
  const lum = Uint8Array.from({ length: 200 * 150 }, () => Math.floor(rand() * 255));
  assert.equal(decodeQR(lum, 200, 150), null);
  assert.equal(decodeQR(new Uint8Array(200 * 150).fill(220), 200, 150), null);
});

// A tiny bit writer for hand-made QR data streams.
function bitsToBytes(fields) {
  const bits = fields.map(([value, length]) => value.toString(2).padStart(length, '0')).join('');
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  return Uint8Array.from(padded.match(/.{8}/g), (b) => parseInt(b, 2));
}

test('QR data: numbers, letters, GS1 FNC1 and ECI', () => {
  // FNC1 (GS1), then "0100000000016285" as numbers.
  const gs1 = bitsToBytes([[5, 4], [1, 4], [16, 10], [10, 10], [0, 10], [0, 10], [1, 10], [628, 10], [5, 4], [0, 4]]);
  assert.equal(parseData(gs1, 1), ']Q30100000000016285');
  assert.deepEqual(readScan(parseData(gs1, 1)), { code: '00016285' });
  // ECI 26 (UTF-8), then "AB" in letters.
  const letters = bitsToBytes([[7, 4], [26, 8], [2, 4], [2, 9], [10 * 45 + 11, 11], [0, 4]]);
  assert.equal(parseData(letters, 1), 'AB');
  assert.equal(parseData(Uint8Array.of(0xf0), 1), null, 'an unknown mode is not data');
});

// Draws a barcode from its modules (1 = bar) along a line, with blur and noise.
function drawLine(modules, { unit = 3, quiet = 12, noise = 20, seed = 2, slant = 0 } = {}) {
  const rand = random(seed);
  const out = [];
  const pad = '0'.repeat(quiet);
  let position = 0;
  for (const m of pad + modules + pad) {
    const width = unit * (1 + slant * (position / (modules.length + quiet * 2)));
    position++;
    const pixels = Math.max(1, Math.round(out.length + width) - out.length);
    for (let i = 0; i < pixels; i++) out.push(m === '1' ? 50 : 200);
  }
  const blurred = out.map((v, i) => (out[Math.max(0, i - 1)] + v * 2 + out[Math.min(out.length - 1, i + 1)]) / 4);
  return Uint8Array.from(blurred, (v) => Math.max(0, Math.min(255, Math.round(v + (rand() - 0.5) * noise))));
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((code) => [...code].map((b) => (b === '1' ? '0' : '1')).join(''));
const G = R.map((code) => [...code].reverse().join(''));
const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const UPCE = ['EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO', 'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE'];

function ean13Modules(code) {
  const parity = FIRST[code[0]];
  const left = [...code.slice(1, 7)].map((d, i) => (parity[i] === 'L' ? L : G)[d]).join('');
  const right = [...code.slice(7)].map((d) => R[d]).join('');
  return `101${left}01010${right}101`;
}

function ean8Modules(code) {
  return `101${[...code.slice(0, 4)].map((d) => L[d]).join('')}01010${[...code.slice(4)].map((d) => R[d]).join('')}101`;
}

function upcEModules(code) {
  const parity = UPCE[code[7]];
  return `101${[...code.slice(1, 7)].map((d, i) => (parity[i] === 'O' ? L : G)[d]).join('')}010101`;
}

test('check digits, UPC-E and codes as the board stores them', () => {
  assert.equal(checkDigit('0001628'), '5');
  assert.equal(normalizeCode('036000291452'), '0036000291452');
  assert.equal(normalizeCode('00000000016285'), '00016285');
  assert.equal(normalizeCode('00016286'), null);
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(expandUpcE('04252615'), null);
});

test('barcodes read along a line, either way round and slanted', () => {
  const cases = [
    ['4056489011293', ean13Modules('4056489011293'), '4056489011293'],
    ['UPC-A 036000291452', ean13Modules('0036000291452'), '0036000291452'],
    ['Trader Joe’s EAN-8', ean8Modules('00016285'), '00016285'],
    ['UPC-E 04252614', upcEModules('04252614'), '0042100005264'],
  ];
  for (const [label, modules, expected] of cases) {
    assert.deepEqual(decodeLine(drawLine(modules)), [expected], label);
    assert.deepEqual(decodeLine(drawLine([...modules].reverse().join(''), { seed: 5 })).at(0), expected, `${label} upside down`);
    assert.deepEqual(decodeLine(drawLine(modules, { unit: 2, slant: 0.5, noise: 30 })).at(0), expected, `${label} slanted`);
  }
  // One digit changed: the check digit no longer matches, so nothing is read.
  assert.deepEqual(decodeLine(drawLine(ean13Modules('4056489011294'))), []);
});

function barcodeImage(modules, { width = 480, height = 160, vertical = false } = {}) {
  const line = drawLine(modules, { noise: 0 });
  const length = vertical ? height : width;
  const lum = new Uint8Array(width * height).fill(200);
  const offset = Math.floor((length - line.length) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const along = (vertical ? y : x) - offset;
      if (along >= 0 && along < line.length) lum[y * width + x] = line[along];
    }
  }
  return lum;
}

test('decodeBarcode wants two lines to agree, and finds sideways barcodes', () => {
  const lum = barcodeImage(ean8Modules('00016285'));
  assert.equal(decodeBarcode(lum, 480, 160), '00016285');
  const tall = barcodeImage(ean13Modules('4056489011293'), { width: 160, height: 480, vertical: true });
  assert.equal(decodeBarcode(tall, 160, 480), '4056489011293');
  assert.equal(decodeBarcode(new Uint8Array(480 * 160).fill(200), 480, 160), null);
});

test('decodeImage takes RGBA pixels and says what it read', () => {
  const [rows] = encodeQR(['https://id.gs1.org/01/04056489011293']);
  const { lum, width, height } = photograph(rows, { scale: 4 });
  const rgba = new Uint8ClampedArray(width * height * 4);
  lum.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
  assert.deepEqual(decodeImage({ data: rgba, width, height }), { text: 'https://id.gs1.org/01/04056489011293', format: 'qr_code' });
  const bar = barcodeImage(ean13Modules('4056489011293'));
  const rgbaBar = new Uint8ClampedArray(480 * 160 * 4);
  bar.forEach((v, i) => rgbaBar.set([v, v, v, 255], i * 4));
  assert.deepEqual(decodeImage({ data: rgbaBar, width: 480, height: 160 }), { text: '4056489011293', format: 'ean_13' });
});

test('readScan: barcodes, GS1 Digital Links, store pages and words', () => {
  assert.deepEqual(readScan('036000291452', 'upc_a'), { code: '0036000291452' });
  assert.deepEqual(readScan('04252614', 'upc_e'), { code: '0042100005264' });
  assert.deepEqual(readScan('00016285', 'ean_8'), { code: '00016285' });
  assert.deepEqual(readScan('https://id.gs1.org/01/04056489011293/10/ABC'), { code: '4056489011293' });
  assert.deepEqual(readScan('https://lidl.example/01/4056489011293?x=1'), { code: '4056489011293' });
  assert.deepEqual(readScan('\x1d0100000000016285'), { code: '00016285' });
  assert.deepEqual(readScan('https://www.traderjoes.com/home/products/pdp/organic-tomato-basil-marinara-016285'), {
    name: 'Organic tomato basil marinara',
    store: 'traderjoes',
  });
  assert.deepEqual(readScan('https://example.com/promo'), { unknown: 'https://example.com/promo' });
  assert.deepEqual(readScan('Oat milk'), { query: 'Oat milk' });
  assert.deepEqual(readScan('12345'), { unknown: '12345' });
});
