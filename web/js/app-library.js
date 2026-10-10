// The board's app library: every app, one swipe away, in place of a dock that was
// always on screen. Swipe up on the home screen (the way you'd scroll down a page)
// and it slides up under the finger; pager.js hands it those vertical drags. It also
// opens from the "All apps" hint at the bottom (tap it or drag it up) and the mouse
// wheel. Swipe it down, tap outside it, tap the grabber or press Escape to close it.
// While a finger is down it's moved with translate3d once per frame; on release a
// composited CSS transition settles it. Phones don't get one: their home screen is
// already the apps (phone-home.js).
import { watchSubtitle } from './app-subtitles.js';
import { libraryProgress, libraryTarget, velocity } from './swipe.js';
import { appIcon, el, icons, reducedMotion } from './ui.js';

// Movement (px) before a press on the hint or the library becomes a drag.
const SLOP = 12;
// A little longer than the settling transition in home.css (0.32s).
const SETTLE_MS = 360;
// Wheel scrolling (px) that opens or closes it, and the pause after, so a
// trackpad's coasting doesn't flip it straight back.
const WHEEL_PX = 40;
const WHEEL_RESET_MS = 200;
const WHEEL_QUIET_MS = 600;
// A click that follows a drag must not open what's under the finger.
const CLICK_GUARD_MS = 400;
const MAX_SAMPLES = 20;

const chevronUp =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 15l6.5-6.5 6.5 6.5"/></svg>';

// canOpen(): false while something else owns the home screen (edit mode).
export function createAppLibrary({ home, apps, services, openApp, canOpen = () => true }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let progress = 0; // 0 closed … 1 open
  let open = false;
  let drag = null; // { from, y, height, samples, frame }
  let finger = null; // listeners for a press on the hint or the library
  let settleTimer = null;
  let stops = []; // the apps' subtitle subscriptions, only while it shows
  const wheel = { sum: 0, at: 0, quietUntil: 0 };

  const shown = apps.filter((app) => app.mount);
  const metas = new Map();
  const grid = el(
    'ul',
    { class: 'app-library__grid', 'aria-label': 'Apps' },
    shown.map((app) => {
      const meta = el('span', { class: 'app-library__meta' });
      metas.set(app, meta);
      return el(
        'li',
        { class: 'app-library__item' },
        el(
          'button',
          {
            class: 'app-library__app',
            type: 'button',
            'aria-label': `Open ${app.name}`,
            dataset: { app: app.id },
            onclick: (event) => openApp(app.id, { origin: event.currentTarget }),
          },
          appIcon(app, 'app-library__icon'),
          el('span', { class: 'app-library__name', text: app.name }),
          meta,
        ),
      );
    }),
  );

  const panel = el(
    'section',
    { class: 'app-library', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All apps', tabindex: '-1' },
    el('button', { class: 'app-library__grabber', type: 'button', 'aria-label': 'Close all apps', onclick: () => close() }),
    el(
      'header',
      { class: 'app-library__head' },
      el('h2', { class: 'app-library__title', text: 'All apps' }),
      el('button', { class: 'app-library__close', type: 'button', 'aria-label': 'Close', html: icons.close, onclick: () => close() }),
    ),
    grid,
  );
  const scrim = el('div', { class: 'app-library__scrim', onclick: () => close() });
  const hint = el(
    'button',
    { class: 'app-library-hint', type: 'button', 'aria-label': 'Show all apps', onclick: () => settle(true) },
    el('span', { class: 'app-library-hint__icon', html: chevronUp }),
    el('span', { class: 'app-library-hint__label', text: 'All apps' }),
  );
  panel.hidden = true;
  scrim.hidden = true;

  // Showing and hiding

  function paint() {
    panel.style.transform = progress >= 1 ? '' : `translate3d(0, ${((1 - progress) * 100).toFixed(2)}%, 0)`;
    scrim.style.opacity = String(progress);
  }

  function reveal() {
    if (!panel.hidden) return;
    panel.hidden = false;
    scrim.hidden = false;
    paint();
    // Starts the slide from below rather than from wherever the panel would be.
    void panel.offsetHeight;
    stops = shown.map((app) => watchSubtitle(app, services, (text) => (metas.get(app).textContent = text)));
  }

  function conceal() {
    panel.hidden = true;
    scrim.hidden = true;
    stops.forEach((stop) => stop());
    stops = [];
  }

  // The home screen behind can't be reached (or read out) while the library covers it.
  function setCovered(covered) {
    home.classList.toggle('home--library', covered);
    for (const node of home.querySelectorAll(':scope > .pager, :scope > .page-dots, :scope > .app-library-hint')) {
      node.inert = covered;
    }
  }

  function settle(toOpen, { animate = true } = {}) {
    if (toOpen && !open && !canOpen()) return;
    clearTimeout(settleTimer);
    const smooth = animate && !reducedMotion.matches;
    const wasOpen = open;
    open = toOpen;
    if (open || progress > 0) reveal();
    panel.classList.toggle('app-library--animating', smooth);
    scrim.classList.toggle('app-library--animating', smooth);
    progress = open ? 1 : 0;
    paint();
    setCovered(open);
    const done = () => {
      panel.classList.remove('app-library--animating');
      scrim.classList.remove('app-library--animating');
      if (!open) conceal();
    };
    if (smooth) settleTimer = setTimeout(done, SETTLE_MS);
    else done();
    if (open && !wasOpen) panel.focus({ preventScroll: true });
  }

  function close(options) {
    if (open || drag || !panel.hidden) settle(false, options);
  }

  // Dragging: begin with where the finger started; dy says which way it's going.

  function begin(y, dy) {
    if (drag) return false;
    if (!open && (dy > 0 || !canOpen())) return false;
    if (open && dy < 0) return false;
    clearTimeout(settleTimer);
    panel.classList.remove('app-library--animating');
    scrim.classList.remove('app-library--animating');
    reveal();
    drag = { from: progress, y, height: panel.offsetHeight || home.clientHeight, samples: [], frame: 0 };
    return true;
  }

  function move(y, t) {
    if (!drag) return;
    drag.samples.push({ t, x: y });
    if (drag.samples.length > MAX_SAMPLES) drag.samples.shift();
    progress = libraryProgress({ from: drag.from, dy: y - drag.y, height: drag.height });
    if (!drag.frame) {
      drag.frame = requestAnimationFrame(() => {
        if (!drag) return;
        drag.frame = 0;
        paint();
      });
    }
  }

  function end() {
    if (!drag) return;
    const { from, samples, frame } = drag;
    cancelAnimationFrame(frame);
    drag = null;
    settle(libraryTarget({ from, progress, vy: velocity(samples) }));
  }

  function guardNextClick() {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    addEventListener('click', stop, { capture: true, once: true, signal });
    setTimeout(() => removeEventListener('click', stop, { capture: true }), CLICK_GUARD_MS);
  }

  // A press on `node` that moves mostly up or down becomes a drag of the library.
  function followDrags(node) {
    node.addEventListener(
      'pointerdown',
      (down) => {
        if (drag || finger || down.button > 0) return;
        finger = new AbortController();
        const opts = { signal: finger.signal };
        let dragging = false;
        const release = () => {
          finger?.abort();
          finger = null;
        };
        addEventListener(
          'pointermove',
          (event) => {
            if (event.pointerId !== down.pointerId) return;
            const dx = event.clientX - down.clientX;
            const dy = event.clientY - down.clientY;
            if (!dragging) {
              if (Math.hypot(dx, dy) < SLOP) return;
              if (Math.abs(dy) <= Math.abs(dx) || !begin(down.clientY, dy)) return release();
              dragging = true;
              node.setPointerCapture?.(down.pointerId);
            }
            move(event.clientY, event.timeStamp);
          },
          opts,
        );
        const up = (event) => {
          if (event.pointerId !== down.pointerId) return;
          release();
          if (!dragging) return;
          guardNextClick();
          end();
        };
        addEventListener('pointerup', up, opts);
        addEventListener('pointercancel', up, opts);
      },
      { signal },
    );
  }

  followDrags(hint);
  followDrags(panel);
  // Long-press on a touchscreen would otherwise open the browser's menu.
  panel.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });

  // The mouse wheel (or a trackpad): down opens it, up closes it.
  home.addEventListener(
    'wheel',
    (event) => {
      if (drag || event.timeStamp < wheel.quietUntil) return;
      if (event.timeStamp - wheel.at > WHEEL_RESET_MS) wheel.sum = 0;
      wheel.at = event.timeStamp;
      wheel.sum += event.deltaY;
      if (Math.abs(wheel.sum) < WHEEL_PX || (wheel.sum > 0) === open) return;
      wheel.sum = 0;
      wheel.quietUntil = event.timeStamp + WHEEL_QUIET_MS;
      settle(!open);
    },
    { passive: true, signal },
  );

  addEventListener('keydown', (event) => event.key === 'Escape' && open && close(), { signal });

  return {
    // The panel and the scrim behind it go on top of the home screen; the hint goes where the dock was.
    nodes: [scrim, panel],
    hint,
    get isOpen() {
      return open;
    },
    // For pager.js: a vertical drag that started on the home pages.
    drag: { begin, move, end },
    open: () => settle(true),
    close,
    destroy() {
      clearTimeout(settleTimer);
      if (drag) cancelAnimationFrame(drag.frame);
      drag = null;
      finger?.abort();
      finger = null;
      lifetime.abort();
      conceal();
      setCovered(false);
      scrim.remove();
      panel.remove();
      hint.remove();
    },
  };
}
