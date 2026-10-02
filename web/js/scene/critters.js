// The Blocks theme's visiting characters: original 16 × 16 pixel critters (not
// any game's real mobs). Each has a base drawing plus small patches for its
// other frames; spriteSheetSvg() turns them into one sprite sheet (frames left
// to right, facing right on the top row and mirrored below), so changing frame
// is a transform, never a repaint.

export const SIZE = 16;
export const FRAMES = ['idle', 'blink', 'walk1', 'walk2'];

// Who visits when (see dayPhase() in sky.js).
export const CRITTER_FOR_PHASE = { dawn: 'fox', day: 'cat', dusk: 'blob', night: 'robot' };

export const CRITTERS = {
  cat: {
    name: 'cat',
    palette: { o: '#26232b', b: '#8f8f99', s: '#6c6c78', w: '#f2f2f2', e: '#3c9a3c', p: '#f2a3b3' },
    base: [
      '................',
      '................',
      '................',
      '...........o..o.',
      '..........oboobo',
      '..........obbbbo',
      '..........obebbo',
      '.oo.......obbbpo',
      'o..o......owbbo.',
      'o...ooooooowwo..',
      '.o.obbsbbsbbbbo.',
      '..obbbbbbbbbbbo.',
      '..obsbbsbbsbbbo.',
      '..obbbbbbbbbbo..',
      '..owo.....owo...',
      '..oo......oo....',
    ],
    blink: { 6: '..........obobbo' },
    walk1: { 14: '..ow.o....ow.o..', 15: '.oo...o..oo...o.' },
    walk2: { 14: '...owo....owo...', 15: '...oo......oo...' },
  },
  fox: {
    name: 'fox',
    palette: { o: '#2a1a12', f: '#e8742a', d: '#c45a1a', w: '#fbf3e6', e: '#1d1d1d', n: '#1d1d1d' },
    base: [
      '................',
      '................',
      '...........o..o.',
      '..........ofoofo',
      '..........offffo',
      '..........ofeffo',
      '.ooo......offffn',
      'offfo.....owwwo.',
      'owffo.ooooowwo..',
      'owwffoffffffffo.',
      '.owwfffdffffffo.',
      '..owffffffdfffo.',
      '...offfffffffo..',
      '...offfffffffo..',
      '...ono.....ono..',
      '...oo......oo...',
    ],
    blink: { 5: '..........ofdffo' },
    walk1: { 14: '..on.o....on.o..', 15: '.oo...o..oo...o.' },
    walk2: { 14: '....ono....ono..', 15: '....oo.....oo...' },
  },
  blob: {
    name: 'blob',
    palette: { o: '#1f3b4d', g: '#4fc3a1', h: '#b8f5e0', d: '#2f8f74', e: '#10202a' },
    base: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....oooooo.....',
      '...oogggggggo...',
      '..oghhgggggggo..',
      '..oghggggggggo..',
      '.oggggeggeggggo.',
      '.oggggeggegggdo.',
      '.ogggggggggggdo.',
      '.oddgggggggddo..',
      '..oddddddddddo..',
      '...oooooooooo...',
    ],
    blink: { 10: '.oggggggggggggo.' },
    // Hopping: squashed low, then stretched up.
    walk1: {
      6: '................',
      7: '.....oooooo.....',
      8: '...oohhgggggoo..',
      9: '..oghggggggggo..',
      12: '.oddgggggggggdo.',
      13: 'oddddggggggddddo',
    },
    walk2: {
      5: '......oooo......',
      6: '....oogggggo....',
      7: '...oghhggggggo..',
      15: '....oooooooo....',
    },
  },
  robot: {
    name: 'robot',
    palette: { o: '#1d1d1d', m: '#9aa3b5', M: '#6b7385', e: '#6ff0ff', a: '#ff5a5a', w: '#3a3f4b', s: '#c3c9d6' },
    base: [
      '................',
      '.......a........',
      '.......o........',
      '....ooooooooo...',
      '....ommmmmmmo...',
      '....omeemeemo...',
      '....ommmmmmmo...',
      '....oMMMMMMMo...',
      '..oooooooooooo..',
      '..ommmmmmmmmmo..',
      '..omMMmmmmMMmo..',
      '..ommmmmmmmmmo..',
      '..oooooooooooo..',
      '..owswo..owswo..',
      '..oswso..oswso..',
      '...ooo....ooo...',
    ],
    blink: { 5: '....ommmmmmmo...' },
    walk1: { 13: '..oswso..oswso..', 14: '..owswo..owswo..' },
    walk2: { 1: '................', 2: '.......a........' },
  },
};

export function frameGrid(def, frame) {
  const grid = [...def.base];
  const patch = frame === 'idle' ? {} : def[frame] ?? {};
  for (const [row, line] of Object.entries(patch)) grid[Number(row)] = line;
  return grid.map((line) => line.slice(0, SIZE).padEnd(SIZE, '.'));
}

// One <path> per colour, built from horizontal runs, so the sheet stays small.
export function spriteSheetSvg(def) {
  const runs = new Map();
  const add = (color, x, y, w) => {
    if (!runs.has(color)) runs.set(color, []);
    runs.get(color).push(`M${x} ${y}h${w}v1h-${w}z`);
  };
  FRAMES.forEach((frame, f) => {
    const grid = frameGrid(def, frame);
    for (const [facingRow, rows] of [
      [0, grid],
      [1, grid.map((line) => [...line].reverse().join(''))],
    ]) {
      rows.forEach((line, y) => {
        let x = 0;
        while (x < SIZE) {
          const ch = line[x];
          if (ch === '.') {
            x++;
            continue;
          }
          let end = x;
          while (end < SIZE && line[end] === ch) end++;
          add(def.palette[ch], f * SIZE + x, facingRow * SIZE + y, end - x);
          x = end;
        }
      });
    }
  });
  const paths = [...runs].map(([color, d]) => `<path fill='${color}' d='${d.join('')}'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${SIZE * FRAMES.length} ${SIZE * 2}' shape-rendering='crispEdges'>${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
