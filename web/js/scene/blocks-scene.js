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
import { cloudX, critterAt, nextVisitDelay, pickCritter, planAfterDrop, planVisit, stayLeft } from './director.js';
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
// Picking a critter up: a press that moves this far is a drag, not a tap. Held, it
// rides at least this many art pixels off the ground (so it's plainly lifted), at
// most this high, kicks its legs and tilts from side to side as it's carried.
const DRAG_SLOP_PX = 10;
const HELD_LIFT = 4;
const MAX_LIFT = 60;
const HELD_TILT_DEG = 7;
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
  const shadow = el('span', { class: 'critter__shadow', 'aria-hidden': 'true' });
  const critter = el('div', { class: 'critter', role: 'img' }, shadow, body, coin);
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
  // A finger (or mouse) on the critter: { id, x, y } from the press, and once it
  // has moved far enough, `held` is what's being carried.
  let press = null;
  let held = null;
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
    visit = { plan, startedAt: runMs, size, name, x: plan.segments[0].from ?? plan.segments[0].at, facing: 1 };
    critter.hidden = false;
  }

  function endVisit() {
    if (held) letGo({ drop: false });
    press = null;
    visit = null;
    critter.hidden = true;
    critter.classList.remove('critter--jump');
    nextVisitAt = runMs + nextVisitDelay(random);
  }

  function showFrame(frame, facing) {
    const { size } = visit;
    const column = FRAMES.indexOf(frame);
    const row = facing < 0 ? 1 : 0;
    setTransform(strip, `translate3d(${-column * size}px, ${-row * size}px, 0)`);
  }

  function drawCritter() {
    if (held) {
      // Carried: legs kicking, tilting one way then the other, 8 times a second.
      const kick = Math.floor((runMs - held.since) / 125) % 2 === 0;
      showFrame(kick ? 'walk1' : 'walk2', held.facing);
      setTransform(body, `translate3d(0, ${-held.lift}px, 0) rotate(${kick ? HELD_TILT_DEG : -HELD_TILT_DEG}deg)`);
      return;
    }
    const state = critterAt(visit.plan, runMs - visit.startedAt);
    if (state.done) {
      endVisit();
      return;
    }
    visit.x = state.x;
    visit.facing = state.facing;
    setTransform(critter, `translate3d(${state.x}px, 0, 0)`);
    showFrame(state.frame, state.facing);
  }

  // Picking it up, carrying it, putting it down

  function stage() {
    const rect = sceneEl.getBoundingClientRect();
    const floor = parseFloat(getComputedStyle(critter).bottom) || 0;
    return { left: rect.left, width: rect.width, floorTop: rect.bottom - floor };
  }

  function grab(event) {
    const { left, floorTop } = stage();
    held = {
      since: runMs,
      at: runMs - visit.startedAt,
      grabX: event.clientX - left - visit.x,
      below: floorTop - event.clientY,
      lift: HELD_LIFT * step,
      x: visit.x,
      facing: visit.facing ?? 1,
    };
    critter.classList.remove('critter--jump', 'critter--drop', 'critter--land');
    critter.classList.add('critter--held', 'critter--grab');
    critter.setAttribute('aria-label', `Carrying a ${CRITTERS[visit.name].name}`);
    haptic();
    drawCritter();
  }

  function carry(event) {
    const { left, width, floorTop } = stage();
    const x = Math.round(Math.min(width - visit.size / 2, Math.max(-visit.size / 2, event.clientX - left - held.grabX)));
    if (x !== held.x) held.facing = x > held.x ? 1 : -1;
    held.x = x;
    held.lift = Math.round(Math.min(MAX_LIFT * step, Math.max(HELD_LIFT * step, floorTop - event.clientY - held.below + HELD_LIFT * step)));
    setTransform(critter, `translate3d(${x}px, 0, 0)`);
    drawCritter();
  }

  // drop: put it down where it is (falls to the ground and stays a while);
  // otherwise it's just let go of (the visit is ending anyway).
  function letGo({ drop = true } = {}) {
    const from = held;
    held = null;
    critter.classList.remove('critter--held', 'critter--grab');
    setTransform(body, 'none');
    if (!drop || !visit) return;
    const x = Math.round(Math.min(sceneEl.clientWidth - visit.size, Math.max(0, from.x)));
    visit.plan = planAfterDrop(random, {
      x,
      width: sceneEl.clientWidth,
      size: visit.size,
      facing: from.facing,
      lingerMs: stayLeft(visit.plan, from.at),
    });
    visit.startedAt = runMs;
    critter.style.setProperty('--drop-from', `${from.lift}px`);
    critter.classList.add('critter--drop');
    drawCritter();
    schedule();
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

  // The art pixel's size changed (the window, or Zen's closer view): measure again
  // and redraw everything where it now belongs.
  function refresh() {
    step = artPixel();
    drawClouds();
    if (visit) {
      visit.size = artPixel() * SIZE;
      drawCritter();
    }
    drawFall();
  }

  // What's falling now: 'rain', 'snow', 'petals', 'leaves', 'embers' or null (see fall.js).
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

  // Tap the critter: it jumps and a sparkle pops out (one-shot, no loop). Press
  // and drag: it's picked up and carried, and put down where it's let go.
  const { signal } = lifetime;
  critter.addEventListener(
    'pointerdown',
    (event) => {
      event.stopPropagation();
      if (!visit || press) return;
      critter.setPointerCapture(event.pointerId);
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    { signal },
  );
  critter.addEventListener(
    'pointermove',
    (event) => {
      if (!press || event.pointerId !== press.id || !visit) return;
      if (!held) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_SLOP_PX) return;
        grab(event);
      }
      carry(event);
    },
    { signal },
  );
  critter.addEventListener(
    'pointerup',
    (event) => {
      if (!press || event.pointerId !== press.id) return;
      press = null;
      if (held) {
        letGo();
      } else if (!critter.classList.contains('critter--jump')) {
        critter.classList.add('critter--jump');
        haptic();
      }
    },
    { signal },
  );
  critter.addEventListener(
    'pointercancel',
    () => {
      press = null;
      if (held) letGo();
    },
    { signal },
  );
  coin.addEventListener('animationend', () => critter.classList.remove('critter--jump'), { signal });
  // Dropped: it falls back to the ground, then squashes as it lands (both one-shot).
  body.addEventListener(
    'animationend',
    (event) => {
      if (event.animationName !== 'critter-drop') return;
      critter.classList.remove('critter--drop');
      critter.classList.add('critter--land');
    },
    { signal },
  );
  strip.parentElement.addEventListener(
    'animationend',
    (event) => {
      if (event.animationName === 'critter-land') critter.classList.remove('critter--land');
      if (event.animationName === 'critter-grab') critter.classList.remove('critter--grab');
    },
    { signal },
  );

  document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden), { signal: lifetime.signal });
  addEventListener('resize', refresh, { signal: lifetime.signal });
  if (document.hidden) pauses.add('hidden');
  drawClouds();
  schedule();

  return {
    setPaused,
    setFall,
    summon,
    refresh,
    destroy() {
      clearTimeout(timer);
      lifetime.abort();
      critter.remove();
      fall.remove();
      clouds.forEach((cloud) => cloud.style.removeProperty('transform'));
    },
  };
}
