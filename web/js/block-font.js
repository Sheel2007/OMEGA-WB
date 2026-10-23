// The Blocks theme's digits as a font, so every number on every widget reads as
// clearly as the clock. The pixel font's own digits smear at a distance (its 5
// looks like an S, its 8 pinches in the middle); these are the clock's square-
// cornered block digits (block-text.js), built into a tiny TrueType font right
// here in the page. main.js adds it as "Blocks Digits" for 0-9 only, and the
// theme lists it first, so digits come from it and everything else from the
// pixel font. Pure (bytes in, no DOM), so tests can read the font back.
import { GLYPHS } from './block-text.js';

export const FONT_FAMILY = 'Blocks Digits';
export const UNICODE_RANGE = 'U+0030-0039';

// Sized like the pixel font's digits: 0.63em tall, about 0.45em wide, 0.6em apart.
const UNITS_PER_EM = 1000;
const BLOCK = 90;
const ADVANCE = 600;
const LEFT = (ADVANCE - 5 * BLOCK) / 2;
// The pixel font's line metrics, so swapping digits never changes a line's height.
const ASCENT = 920;
const DESCENT = 280;

const DIGITS = '0123456789';

// A digit as rectangles (in font units, y up): runs of blocks along each row,
// joined with the run below when it's the same width.
export function digitRects(digit) {
  const rows = GLYPHS[digit];
  const open = [];
  const done = [];
  rows.forEach((line, r) => {
    const runs = [];
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== '#') continue;
      let end = c;
      while (end < line.length && line[end] === '#') end++;
      runs.push([c, end]);
      c = end - 1;
    }
    const still = [];
    for (const [c0, c1] of runs) {
      const above = open.find((rect) => rect.c0 === c0 && rect.c1 === c1 && rect.r1 === r);
      if (above) {
        above.r1 = r + 1;
        still.push(above);
      } else {
        still.push({ c0, c1, r0: r, r1: r + 1 });
      }
    }
    for (const rect of open) if (!still.includes(rect)) done.push(rect);
    open.length = 0;
    open.push(...still);
  });
  done.push(...open);
  return done.map(({ c0, c1, r0, r1 }) => ({
    x0: LEFT + c0 * BLOCK,
    x1: LEFT + c1 * BLOCK,
    y0: (rows.length - r1) * BLOCK,
    y1: (rows.length - r0) * BLOCK,
  }));
}

// --- Writing TrueType -----------------------------------------------------

class Writer {
  constructor() {
    this.bytes = [];
  }
  u8(v) {
    this.bytes.push(v & 0xff);
  }
  u16(v) {
    this.u8(v >> 8);
    this.u8(v);
  }
  i16(v) {
    this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v) {
    this.u16(Math.floor(v / 0x10000) & 0xffff);
    this.u16(v & 0xffff);
  }
  tag(s) {
    for (const ch of s) this.u8(ch.charCodeAt(0));
  }
  pad4() {
    while (this.bytes.length % 4) this.u8(0);
  }
}

function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + ((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>> 0;
  }
  return sum;
}

// One simple glyph: each rectangle a clockwise contour of four on-curve points.
function glyphData(rects) {
  const w = new Writer();
  if (!rects.length) return w.bytes;
  const xs = rects.flatMap((r) => [r.x0, r.x1]);
  const ys = rects.flatMap((r) => [r.y0, r.y1]);
  w.i16(rects.length);
  w.i16(Math.min(...xs));
  w.i16(Math.min(...ys));
  w.i16(Math.max(...xs));
  w.i16(Math.max(...ys));
  rects.forEach((_, i) => w.u16(i * 4 + 3));
  w.u16(0); // no instructions
  const points = rects.flatMap((r) => [
    [r.x0, r.y0],
    [r.x0, r.y1],
    [r.x1, r.y1],
    [r.x1, r.y0],
  ]);
  points.forEach(() => w.u8(0x01)); // on curve, full-size coordinates
  let x = 0;
  let y = 0;
  for (const [px] of points) {
    w.i16(px - x);
    x = px;
  }
  for (const [, py] of points) {
    w.i16(py - y);
    y = py;
  }
  return w.bytes;
}

function nameTable() {
  const names = [
    [1, FONT_FAMILY],
    [2, 'Regular'],
    [3, `${FONT_FAMILY} Regular`],
    [4, FONT_FAMILY],
    [5, 'Version 1.000'],
    [6, 'BlocksDigits-Regular'],
  ];
  const w = new Writer();
  const strings = names.map(([, text]) => [...text].flatMap((ch) => [0, ch.charCodeAt(0)]));
  w.u16(0);
  w.u16(names.length);
  w.u16(6 + names.length * 12);
  let offset = 0;
  names.forEach(([id], i) => {
    w.u16(3); // Windows
    w.u16(1); // Unicode BMP
    w.u16(0x0409); // English (US)
    w.u16(id);
    w.u16(strings[i].length);
    w.u16(offset);
    offset += strings[i].length;
  });
  strings.forEach((s) => s.forEach((b) => w.u8(b)));
  return w.bytes;
}

// The whole font, as bytes for new FontFace().
export function blockDigitsFont() {
  // Glyph 0 is .notdef (empty); 1-10 are 0-9.
  const glyphs = [[], ...[...DIGITS].map(digitRects)];
  const glyphBytes = glyphs.map((rects) => {
    const bytes = glyphData(rects);
    while (bytes.length % 4) bytes.push(0);
    return bytes;
  });
  const bounds = glyphs.flat();
  const xMin = Math.min(...bounds.map((r) => r.x0));
  const xMax = Math.max(...bounds.map((r) => r.x1));
  const yMax = Math.max(...bounds.map((r) => r.y1));
  const lsb = (rects) => (rects.length ? Math.min(...rects.map((r) => r.x0)) : 0);
  const tables = {};

  const os2 = new Writer();
  os2.u16(4);
  os2.i16(ADVANCE);
  os2.u16(400);
  os2.u16(5);
  os2.u16(0);
  [650, 600, 0, 75, 650, 600, 0, 350, 50, 300, 0].forEach((v) => os2.i16(v));
  for (let i = 0; i < 10; i++) os2.u8(0);
  [1, 0, 0, 0].forEach((v) => os2.u32(v));
  os2.tag('NONE');
  os2.u16(0x0040); // regular
  os2.u16(DIGITS.charCodeAt(0));
  os2.u16(DIGITS.charCodeAt(DIGITS.length - 1));
  os2.i16(ASCENT);
  os2.i16(-DESCENT);
  os2.i16(0);
  os2.u16(ASCENT);
  os2.u16(DESCENT);
  os2.u32(1);
  os2.u32(0);
  os2.i16(450);
  os2.i16(yMax);
  os2.u16(0);
  os2.u16(0x20);
  os2.u16(0);
  tables['OS/2'] = os2.bytes;

  const cmap = new Writer();
  cmap.u16(0);
  cmap.u16(1);
  cmap.u16(3);
  cmap.u16(1);
  cmap.u32(12);
  // Format 4: one segment for 0-9, then the required closing one.
  const first = DIGITS.charCodeAt(0);
  const last = DIGITS.charCodeAt(DIGITS.length - 1);
  cmap.u16(4);
  cmap.u16(32);
  cmap.u16(0);
  cmap.u16(4); // segCountX2
  cmap.u16(4); // searchRange
  cmap.u16(1); // entrySelector
  cmap.u16(0); // rangeShift
  cmap.u16(last);
  cmap.u16(0xffff);
  cmap.u16(0);
  cmap.u16(first);
  cmap.u16(0xffff);
  cmap.i16(1 - first);
  cmap.i16(1);
  cmap.u16(0);
  cmap.u16(0);
  tables.cmap = cmap.bytes;

  tables.glyf = glyphBytes.flat();

  const head = new Writer();
  head.u16(1);
  head.u16(0);
  head.u32(0x00010000);
  head.u32(0); // checkSumAdjustment, filled in below
  head.u32(0x5f0f3cf5);
  head.u16(0x0009);
  head.u16(UNITS_PER_EM);
  for (let i = 0; i < 16; i++) head.u8(0); // created, modified
  head.i16(xMin);
  head.i16(0);
  head.i16(xMax);
  head.i16(yMax);
  head.u16(0);
  head.u16(8);
  head.i16(2);
  head.i16(1); // long loca offsets
  head.i16(0);
  tables.head = head.bytes;

  const hhea = new Writer();
  hhea.u16(1);
  hhea.u16(0);
  hhea.i16(ASCENT);
  hhea.i16(-DESCENT);
  hhea.i16(0);
  hhea.u16(ADVANCE);
  hhea.i16(Math.min(...glyphs.filter((g) => g.length).map(lsb)));
  hhea.i16(ADVANCE - xMax);
  hhea.i16(xMax);
  hhea.i16(1);
  hhea.i16(0);
  hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0);
  hhea.u16(glyphs.length);
  tables.hhea = hhea.bytes;

  const hmtx = new Writer();
  glyphs.forEach((rects) => {
    hmtx.u16(ADVANCE);
    hmtx.i16(lsb(rects));
  });
  tables.hmtx = hmtx.bytes;

  const loca = new Writer();
  let at = 0;
  loca.u32(0);
  glyphBytes.forEach((bytes) => {
    at += bytes.length;
    loca.u32(at);
  });
  tables.loca = loca.bytes;

  const maxp = new Writer();
  maxp.u32(0x00010000);
  maxp.u16(glyphs.length);
  maxp.u16(Math.max(...glyphs.map((g) => g.length * 4)));
  maxp.u16(Math.max(...glyphs.map((g) => g.length)));
  maxp.u16(0);
  maxp.u16(0);
  maxp.u16(2);
  for (let i = 0; i < 8; i++) maxp.u16(0);
  tables.maxp = maxp.bytes;

  tables.name = nameTable();

  const post = new Writer();
  post.u32(0x00030000);
  post.u32(0);
  post.i16(-100);
  post.i16(50);
  post.u32(1); // every digit is the same width
  for (let i = 0; i < 4; i++) post.u32(0);
  tables.post = post.bytes;

  // The table directory, tags in order, then the tables, each padded to 4 bytes.
  const tags = Object.keys(tables).sort();
  const font = new Writer();
  font.u32(0x00010000);
  font.u16(tags.length);
  const pow2 = 2 ** Math.floor(Math.log2(tags.length));
  font.u16(pow2 * 16);
  font.u16(Math.log2(pow2));
  font.u16(tags.length * 16 - pow2 * 16);
  let offset = 12 + tags.length * 16;
  const placed = tags.map((tag) => {
    const bytes = tables[tag];
    const entry = { tag, bytes, offset, sum: checksum(bytes) };
    offset += Math.ceil(bytes.length / 4) * 4;
    return entry;
  });
  for (const { tag, bytes, offset: o, sum } of placed) {
    font.tag(tag);
    font.u32(sum);
    font.u32(o);
    font.u32(bytes.length);
  }
  for (const { bytes } of placed) {
    bytes.forEach((b) => font.u8(b));
    font.pad4();
  }
  const out = Uint8Array.from(font.bytes);
  const headAt = placed.find((p) => p.tag === 'head').offset;
  const adjust = (0xb1b0afba - checksum(out)) >>> 0;
  new DataView(out.buffer).setUint32(headAt + 8, adjust);
  return out;
}
