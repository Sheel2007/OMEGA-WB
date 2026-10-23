// The Blocks theme's visiting characters: farm and forest animals by day and
// spooky ones at night, each our own 16 × 16 pixel drawing, not any game's mobs
// (see the copyright notes in CLAUDE.md). Each has a base drawing plus small
// patches for its other frames; spriteSheetSvg() turns them into one sprite sheet
// (frames left to right, facing right on the top row and mirrored below), so
// changing frame is a transform, never a repaint.
import { dataUri, hconcat, mirror, pixelSvg } from '../pixel-art.js';

export const SIZE = 16;
export const FRAMES = ['idle', 'blink', 'walk1', 'walk2'];

// Animals come out by day; at night it's the monsters' turn (see dayPhase() in
// sky.js). Each visit picks one from the list for that part of the day.
export const ANIMALS = ['pig', 'cow', 'sheep', 'chicken', 'wolf'];
export const MONSTERS = ['zombie', 'skeleton', 'spider', 'slime'];
export const CRITTERS_FOR_PHASE = { dawn: ANIMALS, day: ANIMALS, dusk: ANIMALS, night: MONSTERS };

// Each is drawn facing right, with a dark outline ('o') round the whole shape.
// The skeleton's lantern and the spider's legs sit over the outline so they stay
// thin. Every one has a light colour that shows at night and a dark outline that
// shows by day (checked in tests/js/scene.test.js).
export const CRITTERS = {
  pig: {
    name: 'pig',
    palette: { o: '#1c0d11', p: '#f4adb8', d: '#d9798b', n: '#f7c4cb', s: '#7a3442', e: '#1d1d1d' },
    base: [
      '................',
      '................',
      '................',
      '................',
      '...........oo...',
      '..........oddo..',
      '.........oppppo.',
      '.oooooooooppepo.',
      'dpppppppppppppno',
      'opppppppppppppso',
      'opppppppppppppno',
      'oppppppppppppdo.',
      'opdddddddddpoo..',
      '.oddooooddoo....',
      '.oddo..oddo.....',
      '..oo....oo......',
    ],
    blink: { 7: '.oooooooooppppo.' },
    walk1: { 13: 'oddooooooddo....', 14: 'oddo....oddo....', 15: '.oo......oo.....' },
    walk2: { 13: '.ooddooddooo....', 14: '..oddooddo......', 15: '...oo..oo.......' },
  },
  cow: {
    name: 'cow',
    palette: { o: '#170f09', t: '#e0aa72', T: '#f6e3c0', d: '#a8733c', n: '#f0c6a8', s: '#6b3f25', h: '#f1ead6', e: '#1d1d1d', b: '#f2c230', B: '#9c7410', k: '#3a2a20' },
    base: [
      '................',
      '................',
      '................',
      '...........o....',
      '.........ooho...',
      '.ooooooooddhoo..',
      'ottttttttttttto.',
      'dtTTTttttttteto.',
      'dtTTTtTTTttttnno',
      'dtTTTtTTTttttnso',
      'ktttttTTTttttnno',
      'otTTTTTTTTtbboo.',
      '.oddoooddoobBo..',
      '.oddo.oddo.oo...',
      '.okko.okko......',
      '..oo...oo.......',
    ],
    blink: { 7: 'dtTTTttttttttto.' },
    walk1: { 12: 'oddoooooddobBo..', 13: 'oddo...oddooo...', 14: 'okko...okko.....', 15: '.oo.....oo......' },
    walk2: { 12: '.ooddoddooobBo..', 13: '..oddoddo..oo...', 14: '..okkokko.......', 15: '...oo.oo........' },
  },
  sheep: {
    name: 'sheep',
    palette: { o: '#121013', w: '#f6f4ef', W: '#d6d2c8', f: '#3b3236', e: '#f6f4ef' },
    base: [
      '................',
      '................',
      '................',
      '................',
      '...........oooo.',
      '..ooooooooowwffo',
      '.owwwwwwwwfffefo',
      'owwWwwwwwWwffffo',
      'owwwwwWwwwwffffo',
      'owwwwwwwwwwfffo.',
      'owWwwwwwWwwwoo..',
      'owwwwWwwwwWwo...',
      '.owwwwwwwwwo....',
      '.offooooffo.....',
      '.offo..offo.....',
      '..oo....oo......',
    ],
    blink: { 6: '.owwwwwwwwfffffo' },
    walk1: { 13: 'offooooooffo....', 14: 'offo....offo....', 15: '.oo......oo.....' },
    walk2: { 13: '..offooffoo.....', 14: '..offooffo......', 15: '...oo..oo.......' },
  },
  chicken: {
    name: 'chicken',
    palette: { o: '#1c0f07', b: '#f0c07a', r: '#b5552c', c: '#d8402c', k: '#f29a1f', e: '#1d1d1d', l: '#e0a020' },
    base: [
      '................',
      '................',
      '..........oo....',
      '.........occo...',
      '.........obbbo..',
      '.oo.....obbebo..',
      'orro....obbbbko.',
      'orrrooooobbbbo..',
      'orrrbbbbbbbbbo..',
      '.orrbrrrrbboo...',
      '..obbrrrrbbo....',
      '..obbrrrbbbo....',
      '...obbbbbbo.....',
      '....oloolo......',
      '....oloolo......',
      '.....o..o.......',
    ],
    blink: { 5: '.oo.....obbbbo..' },
    walk1: { 13: '...oloooolo.....', 14: '...olo..olo.....', 15: '....o....o......' },
    walk2: { 13: '....oolloo......', 14: '.....ollo.......', 15: '......oo........' },
  },
  wolf: {
    name: 'wolf',
    palette: { o: '#111216', g: '#c9cbd0', G: '#8d9098', w: '#f1f2f4', k: '#1d1d1d', e: '#2a6f9a' },
    base: [
      '................',
      '................',
      '...........o....',
      '..........oGo...',
      '..........oGGo..',
      'oo.......oggggo.',
      'wgo......oggego.',
      'ggoooooooogggwko',
      'oogGGGGGGGgggwwo',
      '.oggggggggggggo.',
      '.oggggggggggoo..',
      '.ogwwwwwwwwgo...',
      '..oggooooggo....',
      '..oggo..oggo....',
      '..oggo..oggo....',
      '...oo....oo.....',
    ],
    blink: { 6: 'wgo......oggggo.' },
    walk1: { 12: '.oggooooooggo...', 13: '.oggo....oggo...', 14: '.oggo....oggo...', 15: '..oo......oo....' },
    walk2: { 12: '..ooggooggoo....', 13: '...oggooggo.....', 14: '...oggooggo.....', 15: '....oo..oo......' },
  },
  zombie: {
    name: 'zombie',
    palette: { o: '#110e15', s: '#c0bbcf', S: '#5c566b', e: '#e8d36a', c: '#b3693a', C: '#7e4523', p: '#58553f', k: '#2c2a22' },
    base: [
      '......oooo......',
      '.....osssso.....',
      '.....ossseo.....',
      '.....osssso.....',
      '.....ossSsoooo..',
      '.....occcccssso.',
      '.....occcccssso.',
      '.....occccoooo..',
      '.....occcco.....',
      '.....oCcCco.....',
      '.....oppppo.....',
      '.....oppppo.....',
      '.....oppppo.....',
      '.....oppppo.....',
      '.....okkkko.....',
      '......oooo......',
    ],
    blink: { 2: '.....osssso.....' },
    walk1: { 13: '....oppooppo....', 14: '....okkookko....', 15: '.....oo..oo.....' },
    walk2: { 4: '.....ossSso.....', 5: '.....occcccooo..', 7: '.....occcccssso.', 8: '.....occccoooo..' },
  },
  skeleton: {
    name: 'skeleton',
    palette: { o: '#111115', b: '#ece9de', g: '#b9b5a8', k: '#2e2e36', y: '#ffd75e', Y: '#ffb02e' },
    base: [
      '......oooo......',
      '.....obbbbo.....',
      '.....obbkko.....',
      '.....obbbbo.....',
      '.....obgggo.....',
      '......obboo.....',
      '.....obbbbbk....',
      '......oggookkk..',
      '.....obbbboYyY..',
      '......obbo.kyk..',
      '.....oggggokkk..',
      '.....oboobo.....',
      '.....oboobo.....',
      '.....oboobo.....',
      '.....oboobo.....',
      '......o..o......',
    ],
    blink: { 2: '.....obbbbo.....' },
    walk1: { 11: '....oboooobo....', 12: '....obo..obo....', 13: '....obo..obo....', 14: '....obo..obo....', 15: '.....o....o.....' },
    walk2: { 11: '......obbo......', 12: '......obbo......', 13: '......obbo......', 14: '......obbo......', 15: '.......oo.......' },
  },
  spider: {
    name: 'spider',
    palette: { o: '#140c1f', v: '#c8b0f2', V: '#8a6cba', e: '#c9f25a', l: '#2e2142' },
    base: [
      '................',
      '................',
      '................',
      '................',
      '..ooooo.........',
      '.ovvvvvo........',
      'ovvvvvvvoooo....',
      'ovVVVVVvvvvvo...',
      'ovvvvvvvvvveeo..',
      'ovVVVVVvvvvveo..',
      '.ovvvvvovvvvvo..',
      '..loolo.olool...',
      '.l...l...l...l..',
      '.l..l.....l...l.',
      'l...l.....l....l',
      'l...l.....l....l',
    ],
    blink: { 8: 'ovvvvvvvvvvvvo..', 9: 'ovVVVVVvvvvvvo..' },
    walk1: { 14: 'l..l.......l..l.', 15: 'l..l.......l..l.' },
    walk2: { 14: '.l...l...l.....l', 15: '.l...l...l.....l' },
  },
  slime: {
    name: 'slime',
    palette: { o: '#0b161c', g: '#6fd6b4', h: '#c6f8e6', d: '#3b9a7e', e: '#0b161c' },
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
};

export function frameGrid(def, frame) {
  const grid = [...def.base];
  const patch = frame === 'idle' ? {} : def[frame] ?? {};
  for (const [row, line] of Object.entries(patch)) grid[Number(row)] = line;
  return grid.map((line) => line.slice(0, SIZE).padEnd(SIZE, '.'));
}

// The whole sheet as one grid: frames left to right, facing right on top and
// mirrored underneath.
export function sheetGrid(def) {
  const frames = FRAMES.map((frame) => frameGrid(def, frame));
  return [...hconcat(frames), ...hconcat(frames.map(mirror))];
}

export function spriteSheetSvg(def) {
  return dataUri(pixelSvg(sheetGrid(def), def.palette));
}
