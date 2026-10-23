import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blockClockMarkup,
  blockClockWidth,
  blockTextLayers,
  blockTextSvg,
  GLYPH_ROWS,
  GLYPHS,
} from '../../web/js/block-text.js';
import { contrastRatio } from '../../web/js/color.js';

const DIGITS = '0123456789'.split('');

test('every glyph is 7 rows of one width, drawn only in blocks', () => {
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    assert.equal(rows.length, GLYPH_ROWS, `${ch} rows`);
    const width = rows[0].length;
    for (const row of rows) {
      assert.equal(row.length, width, `${ch} is one width`);
      assert.match(row, /^[#.]+$/, `${ch} uses only blocks`);
    }
    assert.ok(rows.join('').includes('#'), `${ch} draws something`);
  }
  for (const d of DIGITS) assert.equal(GLYPHS[d][0].length, 5, `${d} is 5 wide, so the time doesn't jump about`);
});

test('every digit differs from every other in at least 3 blocks (the 5 that read as a 6)', () => {
  const cells = (d) => GLYPHS[d].join('');
  for (const a of DIGITS) {
    for (const b of DIGITS) {
      if (a >= b) continue;
      const diff = [...cells(a)].filter((ch, i) => ch !== cells(b)[i]).length;
      assert.ok(diff >= 3, `${a} and ${b} differ in only ${diff} blocks`);
    }
  }
});

test('the drawing has a thin edge all round and a shadow, and the face sits inside the edge', () => {
  const { face, edge, shadow, width, height } = blockTextLayers('5');
  // Each block is 3 x 3 fine cells, plus 1 of edge on the left and top, 1 of edge and 2 of shadow right and below.
  assert.equal(width, 5 * 3 + 4);
  assert.equal(height, 7 * 3 + 4);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (face[r][c] === '#') assert.equal(edge[r][c], '#', 'edge under every face cell');
    }
  }
  assert.equal(edge[0][0], '#', 'the edge reaches the corner (8 neighbours)');
  assert.equal(shadow[height - 1][width - 1], '#', 'the shadow falls down and right');
  assert.ok(face.every((row) => row[0] === '.'), 'the edge is outside the face');
  // The 5's open middle-left (block row 4, columns 1-3) keeps sky showing through it.
  const middle = edge[1 + 4 * 3 + 1].slice(1 + 1 * 3, 1 + 4 * 3);
  assert.match(middle, /\.\.\./, 'the edge leaves the inside of the digit open');
});

test('two digits keep a gap of sky between their edges', () => {
  const { edge } = blockTextLayers('88');
  const gapColumn = 1 + 5 * 3 + 1; // the middle of the one-block gap between them
  assert.ok(edge.slice(1, -3).every((row) => row[gapColumn] === '.'));
});

test('an SVG sized in blocks, styled by class', () => {
  const svg = blockTextSvg('12:45');
  assert.match(svg, /viewBox='0 0 79 25'/);
  assert.match(svg, /--block-w:26.3333;--block-h:8.3333/);
  assert.match(svg, /class='block-text'/);
  for (const layer of ['shadow', 'edge', 'face']) assert.match(svg, new RegExp(`block-text__${layer}`));
  assert.match(blockTextSvg('PM', { small: true }), /block-text--small/);
});

test('anything it has no blocks for is left to the text clock, and never ends up in the markup', () => {
  assert.equal(blockTextSvg(''), '');
  assert.equal(blockTextSvg('<img src=x onerror=alert(1)>'), '');
  assert.equal(blockTextSvg('١٢:٤٥'), '');
  assert.equal(blockClockMarkup('12:45', '午後'), '', 'a period it cannot draw means the whole clock falls back');
  assert.equal(blockClockMarkup('12 h 45', 'PM'), '');
  assert.ok(blockClockMarkup('12:45', 'PM').includes('block-text--small'));
  assert.ok(blockClockMarkup('9.05', '').startsWith('<svg'), 'no AM/PM is fine');
});

// The clock's three columns on the 1920 x 1080 board: 3 x 130px plus two 24px gaps.
const CLOCK_BOX = 3 * 130 + 2 * 24;

test('the widest time fits the clock box on the board and on a 320px phone', () => {
  const widest = ['12:59', '10:00', '11:11'];
  for (const time of widest) {
    const board = blockClockWidth(time, 'PM', { cell: 12, smallCell: 6 });
    assert.ok(board <= CLOCK_BOX - 4, `${time} PM is ${board}px on the board`);
    const phone = blockClockWidth(time, 'PM', { cell: 8, smallCell: 4 });
    assert.ok(phone <= 320 - 2 * 16, `${time} PM is ${phone}px on a phone`);
  }
});

test('the clock cells and colours in tokens.css are the ones checked here', () => {
  const css = readFileSync(new URL('../../web/css/tokens.css', import.meta.url), 'utf8');
  const blocks = css.slice(css.indexOf(':root[data-theme="blocks"] {'));
  const token = (name) => blocks.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
  assert.equal(token('--clock-cell'), '0.6rem', '12px blocks on the board');
  assert.equal(token('--clock-cell-sm'), '0.3rem');
  const face = token('--sky-text');
  const edge = token('--clock-edge');
  assert.ok(contrastRatio(face, edge) >= 4.5, `face ${face} on edge ${edge}`);
});
