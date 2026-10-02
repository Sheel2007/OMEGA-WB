// The Blocks theme's moving parts: drifting clouds and an occasional critter.
//
// Cheap on the Pi by design (measured: a looping CSS steps() animation keeps
// Chromium producing ~60 frames/s even when nothing changes; this doesn't):
// - one setTimeout ticker writes only `transform`, on elements that are already
//   their own compositor layers, so nothing is ever repainted;
// - it ticks once a second for clouds, 8 times a second while a critter is on
//   stage, and not at all while paused (app open, editing, hidden tab, reduced
//   motion, phone layout, or "Moving scenery" turned off).
import { haptic, el } from '../ui.js';
import { CRITTER_FOR_PHASE, CRITTERS, FRAMES, SIZE, spriteSheetSvg } from './critters.js';
import { cloudX, critterAt, nextVisitDelay, planVisit } from './director.js';

const CLOUD_TICK_MS = 1000;
const CRITTER_TICK_MS = 125;
// Where each cloud starts (share of its loop) and how fast it drifts (px/s).
const CLOUD_DRIFT = [
  { start: 0.4, speed: 6 },
  { start: 0.7, speed: 4 },
  { start: 0.95, speed: 8 },
];
const STAY_MS = 10 * 60 * 1000;

function remToPx(value) {
  return parseFloat(value) * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// params: the page's URL parameters. ?critter=now sends one straight away,
// ?critter=stay keeps it on stage for ten minutes (for measuring).
export function createBlocksScene({ skyEl, sceneEl, getPhase, getAvoid, params, random = Math.random }) {
  const lifetime = new AbortController();
  const pauses = new Set();
  const clouds = [...skyEl.querySelectorAll('.sky__cloud')];
  const sheets = new Map();
  const written = new Map();

  const strip = el('div', { class: 'critter__strip' });
  const body = el('div', { class: 'critter__body' }, el('div', { class: 'critter__window' }, strip));
  const coin = el('span', { class: 'critter__coin', 'aria-hidden': 'true' });
  const critter = el('div', { class: 'critter', role: 'img' }, body, coin);
  critter.hidden = true;
  sceneEl.append(critter);

  let runMs = 0;
  let lastTick = performance.now();
  let timer = null;
  let visit = null;
  let nextVisitAt = params.get('critter') ? 0 : nextVisitDelay(random, { first: true });

  // Only touch the DOM when a value actually changes.
  function setTransform(node, value) {
    if (written.get(node) === value) return;
    written.set(node, value);
    node.style.transform = value;
  }

  function artPixel() {
    return remToPx(getComputedStyle(document.documentElement).getPropertyValue('--px'));
  }

  function drawClouds() {
    const width = skyEl.clientWidth;
    const step = artPixel();
    clouds.forEach((cloud, i) => {
      const drift = CLOUD_DRIFT[i % CLOUD_DRIFT.length];
      const cloudWidth = cloud.offsetWidth;
      const x = cloudX(runMs, { offset: drift.start * (width + cloudWidth), speed: drift.speed, width: cloudWidth }, { width, step });
      setTransform(cloud, `translate3d(${x}px, 0, 0)`);
    });
  }

  function sheetFor(name) {
    if (!sheets.has(name)) sheets.set(name, `url("${spriteSheetSvg(CRITTERS[name])}")`);
    return sheets.get(name);
  }

  function startVisit() {
    const name = CRITTER_FOR_PHASE[getPhase()] ?? 'cat';
    const size = artPixel() * SIZE;
    const stay = params.get('critter') === 'stay';
    const plan = planVisit(random, {
      width: sceneEl.clientWidth,
      size,
      avoid: getAvoid(),
      ...(stay ? { kind: 'visit', lingerMs: STAY_MS } : {}),
    });
    strip.style.backgroundImage = sheetFor(name);
    critter.setAttribute('aria-label', `A ${CRITTERS[name].name} passing by`);
    visit = { plan, startedAt: runMs, size };
    critter.hidden = false;
  }

  function endVisit() {
    visit = null;
    critter.hidden = true;
    critter.classList.remove('critter--jump');
    nextVisitAt = runMs + nextVisitDelay(random);
  }

  function drawCritter() {
    const state = critterAt(visit.plan, runMs - visit.startedAt);
    if (state.done) {
      endVisit();
      return;
    }
    const { size } = visit;
    setTransform(critter, `translate3d(${state.x}px, 0, 0)`);
    const column = FRAMES.indexOf(state.frame);
    const row = state.facing < 0 ? 1 : 0;
    setTransform(strip, `translate3d(${-column * size}px, ${-row * size}px, 0)`);
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (pauses.size) return;
    const untilVisit = Math.max(0, nextVisitAt - runMs);
    timer = setTimeout(tick, visit ? CRITTER_TICK_MS : Math.min(CLOUD_TICK_MS, untilVisit));
  }

  function tick() {
    const now = performance.now();
    runMs += now - lastTick;
    lastTick = now;
    drawClouds();
    if (!visit && runMs >= nextVisitAt) startVisit();
    if (visit) drawCritter();
    schedule();
  }

  function setPaused(reason, on) {
    const was = pauses.size > 0;
    if (on) pauses.add(reason);
    else pauses.delete(reason);
    const now = pauses.size > 0;
    if (now && !was) {
      clearTimeout(timer);
      timer = null;
      if (visit) endVisit();
    } else if (!now && was) {
      lastTick = performance.now();
      tick();
    }
  }

  // Tap the critter: it jumps and a sparkle pops out (one-shot, no loop).
  critter.addEventListener(
    'pointerdown',
    (event) => {
      event.stopPropagation();
      if (critter.classList.contains('critter--jump')) return;
      critter.classList.add('critter--jump');
      haptic();
    },
    { signal: lifetime.signal },
  );
  coin.addEventListener('animationend', () => critter.classList.remove('critter--jump'), { signal: lifetime.signal });

  document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden), { signal: lifetime.signal });
  if (document.hidden) pauses.add('hidden');
  drawClouds();
  schedule();

  return {
    setPaused,
    destroy() {
      clearTimeout(timer);
      lifetime.abort();
      critter.remove();
      clouds.forEach((cloud) => cloud.style.removeProperty('transform'));
    },
  };
}
