import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockDigitsFont, digitRects, FONT_FAMILY } from '../../web/js/block-font.js';
import { GLYPHS } from '../../web/js/block-text.js';

const font = blockDigitsFont();
const view = new DataView(font.buffer, font.byteOffset, font.byteLength);

function sum(from, length) {
  let total = 0;
  for (let i = 0; i < length; i += 4) {
    const word = [0, 1, 2, 3].reduce((acc, k) => acc * 256 + (from + i + k < font.length && i + k < length ? font[from + i + k] : 0), 0);
    total = (total + word) % 2 ** 32;
  }
  return total;
}

function tables() {
  const count = view.getUint16(4);
  const out = {};
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...font.slice(at, at + 4));
    out[tag] = { checksum: view.getUint32(at + 4), offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  }
  return out;
}

test('a TrueType font with every table it needs, in order, each checksummed', () => {
  assert.equal(view.getUint32(0), 0x00010000);
  const found = tables();
  const tags = Object.keys(found);
  assert.deepEqual(tags, ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
  assert.deepEqual(tags, [...tags].sort(), 'the directory is sorted');
  for (const [tag, { checksum, offset, length }] of Object.entries(found)) {
    assert.equal(offset % 4, 0, `${tag} is aligned`);
    assert.ok(offset + length <= font.length, `${tag} fits`);
    const expected = tag === 'head' ? (sum(offset, length) - view.getUint32(offset + 8) + 2 ** 32) % 2 ** 32 : sum(offset, length);
    assert.equal(checksum, expected, `${tag} checksum`);
  }
  const head = found.head.offset;
  assert.equal(view.getUint32(head + 12), 0x5f0f3cf5, 'head magic number');
  assert.equal(sum(0, font.length), 0xb1b0afba, 'the whole font checks out');
  assert.ok(font.length < 4000, `${font.length} bytes`);
});

function glyphFor(charCode) {
  // cmap format 4: find the segment holding the character.
  const cmap = tables().cmap.offset;
  const sub = cmap + view.getUint32(cmap + 8);
  assert.equal(view.getUint16(sub), 4);
  const segs = view.getUint16(sub + 6) / 2;
  for (let i = 0; i < segs; i++) {
    const end = view.getUint16(sub + 14 + i * 2);
    const start = view.getUint16(sub + 16 + segs * 2 + i * 2);
    const delta = view.getInt16(sub + 16 + segs * 4 + i * 2);
    if (charCode >= start && charCode <= end) return (charCode + delta + 65536) % 65536;
  }
  return 0;
}

// Draws a glyph's rectangles back into a 5 x 7 block grid.
function drawn(glyphId) {
  const { glyf, loca } = tables();
  const at = glyf.offset + view.getUint32(loca.offset + glyphId * 4);
  const contours = view.getInt16(at);
  const ends = Array.from({ length: contours }, (_, i) => view.getUint16(at + 10 + i * 2));
  const points = ends.at(-1) + 1;
  let p = at + 10 + contours * 2;
  p += 2 + view.getUint16(p); // instructions
  p += points; // one flag per point (all on-curve, full-size)
  const read = () => {
    const out = [];
    let v = 0;
    for (let i = 0; i < points; i++) {
      v += view.getInt16(p);
      p += 2;
      out.push(v);
    }
    return out;
  };
  const xs = read();
  const ys = read();
  const grid = Array.from({ length: 7 }, () => Array(5).fill('.'));
  for (let c = 0; c < contours; c++) {
    const idx = [0, 1, 2, 3].map((k) => c * 4 + k);
    const x0 = Math.min(...idx.map((i) => xs[i]));
    const x1 = Math.max(...idx.map((i) => xs[i]));
    const y0 = Math.min(...idx.map((i) => ys[i]));
    const y1 = Math.max(...idx.map((i) => ys[i]));
    for (let x = x0; x < x1; x += 90) for (let y = y0; y < y1; y += 90) grid[6 - (y / 90)][(x - 75) / 90] = '#';
  }
  return grid.map((row) => row.join(''));
}

test('0-9 map to glyphs drawn exactly like the clock digits, and nothing else is in it', () => {
  for (const digit of '0123456789') {
    const id = glyphFor(digit.charCodeAt(0));
    assert.equal(id, Number(digit) + 1);
    assert.deepEqual(drawn(id), GLYPHS[digit], `digit ${digit}`);
  }
  for (const ch of ' A:.-°') assert.equal(glyphFor(ch.charCodeAt(0)), 0, `"${ch}" is left to the pixel font`);
});

test('every digit is the same width, so numbers line up', () => {
  const { hmtx, maxp } = tables();
  const glyphs = view.getUint16(maxp.offset + 4);
  assert.equal(glyphs, 11);
  for (let i = 0; i < glyphs; i++) assert.equal(view.getUint16(hmtx.offset + i * 4), 600);
});

test('rectangles cover each digit once, joined down the rows where they can', () => {
  for (const digit of '0123456789') {
    const rects = digitRects(digit);
    const cells = rects.reduce((n, r) => n + ((r.x1 - r.x0) / 90) * ((r.y1 - r.y0) / 90), 0);
    assert.equal(cells, GLYPHS[digit].join('').split('#').length - 1, `digit ${digit} block count`);
    assert.ok(rects.length <= 7, `digit ${digit} is ${rects.length} rectangles`);
  }

});

test('it is called what the CSS asks for', () => {
  assert.equal(FONT_FAMILY, 'Blocks Digits');
});
