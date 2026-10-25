// The Blocks theme's moving parts: drifting clouds, an occasional critter (an
// animal by day, a monster at night), and whatever is falling: rain or snow when
// it's really raining or snowing, gusts of petals or leaves in spring and autumn.
//
// Cheap on the Pi by design (measured: a looping CSS steps() animation keeps
// Chromium producing ~60 frames/s even when nothing changes; this doesn't):
// - one setTimeout ticker writes only `transform`, on elements that are already
//   their own compositor layers, so nothing is ever repainted;
// - it ticks once a second for clouds, 8 times a second while a critter is on
//   stage or rain is falling, 4 times a second for snow or a gust, and not at all
//   while paused (app open, editing, hidden tab, reduced motion, phone layout, or
//   "Moving scenery" turned off).
import { haptic, el } from '../ui.js';
import { CRITTERS, CRITTERS_FOR_PHASE, FRAMES, SIZE, spriteSheetSvg } from './critters.js';
import { cloudX, critterAt, nextVisitDelay, pickCritter, planVisit } from './director.js';
import { FADE_MS, fallArt, fallOffset, FALLS, planGust, tickDelay, TILE } from './fall.js';

const CLOUD_TICK_MS = 1000;
const CRITTER_TICK_MS = 125;
// Where each cloud starts (share of its loop) and how fast it drifts (px/s).
const CLOUD_DRIFT = [
  { start: 0.4, speed: 6 },
  { start: 0.7, speed: 4 },
  { start: 0.95, speed: 8 },
];
const STAY_MS = 10 * 60 * 1000;
// How long a visitor called from Zen mode stays (always finite: see planVisit's blinks).
const SUMMON_MS = 3 * 60 * 1000;
// Pauses that hide the falling layer as well as stopping it (nothing would see it,
// or there should be no motion at all); the rest just freeze it where it is.
const HIDE_FALL_FOR = new Set(['setting', 'motion', 'compact', 'app', 'screen', 'hidden']);

function remToPx(value) {
  return parseFloat(value) * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// params: the page's URL parameters. ?critter=now sends one straight away,
// ?critter=stay keeps it on stage for ten minutes (for measuring), and
// ?critter=<name> (say ?critter=spider) sends that one, for checking the art.
export function createBlocksScene({ skyEl, sceneEl, getPhase, getAvoid = () => [], params, random = Math.random }) {
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

  // In front of the land, behind the widgets: a window onto one big sheet of the
  // repeating tile, which slides and wraps after a tile.
  const fallSheet = el('div', { class: 'sky__fall-sheet' });
  const fall = el('div', { class: 'sky__fall', 'aria-hidden': 'true' }, fallSheet);
  fall.hidden = true;
  fall.style.setProperty('--fall-tile', `calc(${TILE} * var(--px))`);
  skyEl.append(fall);

  let runMs = 0;
  let lastTick = performance.now();
  let timer = null;
  let visit = null;
  let lastCritter = null;
  const asked = params.get('critter');
  const only = Object.hasOwn(CRITTERS, asked ?? '') ? asked : null;
  let nextVisitAt = asked ? 0 : nextVisitDelay(random, { first: true });
  let fallKind = null;
  let gust = null; // { endsAt, hideAt } while petals or leaves are blowing past
  let nextGust = null; // { at, lasts }
  let step = artPixel();

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

  // lingerMs: stay this long once it's walked in (a summoned visitor, or the dev
  // ?critter= modes); otherwise it plans its own dash or short visit. hurry: it's
  // been called, so it runs in and stops nearby.
  function startVisit({ lingerMs, hurry = false } = {}) {
    const name = only ?? pickCritter(random, CRITTERS_FOR_PHASE[getPhase()] ?? CRITTERS_FOR_PHASE.day, lastCritter);
    lastCritter = name;
    const size = artPixel() * SIZE;
    const stay = lingerMs ?? (asked === 'stay' || only !== null ? STAY_MS : null);
    const plan = planVisit(random, {
      width: sceneEl.clientWidth,
      size,
      avoid: getAvoid(),
      ...(stay ? { kind: 'visit', lingerMs: stay, hurry } : {}),
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

  const gusty = () => fallKind !== null && FALLS[fallKind].gusts;

  function fallShown() {
    if (!fallKind || [...pauses].some((reason) => HIDE_FALL_FOR.has(reason))) return false;
    return !gusty() || gust !== null;
  }

  // Petals and leaves come in gusts: fade in, blow past for a while, fade out,
  // then nothing (and no layer at all) until the next one.
  function updateGust() {
    if (!gusty()) return;
    if (!gust && runMs >= nextGust.at) {
      gust = { endsAt: runMs + nextGust.lasts, hideAt: runMs + nextGust.lasts + FADE_MS };
      fall.classList.remove('sky__fall--out');
      fall.classList.add('sky__fall--in');
    } else if (gust && runMs >= gust.hideAt) {
      gust = null;
      fall.classList.remove('sky__fall--in', 'sky__fall--out');
      const next = planGust(random);
      nextGust = { at: runMs + next.in, lasts: next.lasts };
    } else if (gust && runMs >= gust.endsAt) {
      fall.classList.replace('sky__fall--in', 'sky__fall--out');
    }
  }

  function untilGustChanges() {
    if (!gusty()) return Infinity;
    if (!gust) return Math.max(0, nextGust.at - runMs);
    return Math.max(0, (runMs < gust.endsAt ? gust.endsAt : gust.hideAt) - runMs);
  }

  function drawFall() {
    const shown = fallShown();
    if (fall.hidden === shown) fall.hidden = !shown;
    if (!shown) return;
    const { x, y } = fallOffset(runMs, FALLS[fallKind]);
    setTransform(fallSheet, `translate3d(${x * step}px, ${y * step}px, 0)`);
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (pauses.size) return;
    const delay = tickDelay({
      visit: visit !== null,
      untilVisit: Math.max(0, nextVisitAt - runMs),
      fallTickMs: fallShown() ? FALLS[fallKind].tickMs : null,
      untilChange: untilGustChanges(),
      cloudTickMs: CLOUD_TICK_MS,
      critterTickMs: CRITTER_TICK_MS,
    });
    timer = setTimeout(tick, delay);
  }

  function tick() {
    const now = performance.now();
    runMs += now - lastTick;
    lastTick = now;
    drawClouds();
    if (!visit && runMs >= nextVisitAt) startVisit();
    if (visit) drawCritter();
    updateGust();
    drawFall();
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
      return;
    }
    drawFall();
  }

  // Calls a visitor now (Zen mode), who walks in and stays a while. Someone already
  // out stays as they are. False while the scenery is paused.
  function summon({ lingerMs = SUMMON_MS } = {}) {
    if (pauses.size) return false;
    if (!visit) {
      startVisit({ lingerMs, hurry: true });
      drawCritter();
      schedule();
    }
    return true;
  }

  // What's falling now: 'rain', 'snow', 'petals', 'leaves' or null (see fall.js).
  function setFall(kind) {
    const next = Object.hasOwn(FALLS, kind ?? '') ? kind : null;
    if (next === fallKind) return;
    fallKind = next;
    gust = null;
    fall.classList.remove('sky__fall--in', 'sky__fall--out');
    if (fallKind) {
      fallSheet.style.backgroundImage = fallArt(fallKind);
      const first = planGust(random, { first: true });
      nextGust = { at: runMs + first.in, lasts: first.lasts };
    }
    drawFall();
    if (!pauses.size) schedule();
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
  addEventListener('resize', () => (step = artPixel()), { signal: lifetime.signal });
  if (document.hidden) pauses.add('hidden');
  drawClouds();
  schedule();

  return {
    setPaused,
    setFall,
    summon,
    destroy() {
      clearTimeout(timer);
      lifetime.abort();
      critter.remove();
      fall.remove();
      clouds.forEach((cloud) => cloud.style.removeProperty('transform'));
    },
  };
}
