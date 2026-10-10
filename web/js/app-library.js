// The board's app library: every app, one swipe away, without a dock taking room
// on the home screen. Swipe up anywhere on the home screen (the way you'd scroll
// down a page) and the pages lift away while the apps rise under the finger, one
// for one; let go and a spring carries it the rest of the way at the speed the
// finger was going. The mouse wheel works too. Swipe down, tap anywhere that isn't
// an app, or press Escape to close it.
//
// Only transform and opacity ever change. While a finger is down they're written
// once per frame; the settle is a Web Animation (a spring as a CSS linear() easing,
// see swipe.js), so the compositor runs it however busy the page is. Phones don't
// get one: their home screen is already the apps (phone-home.js).
import { libraryProgress, libraryTarget, spring, velocity } from './swipe.js';
import { appIcon, el, reducedMotion } from './ui.js';

// Movement (px) before a press on the edges or the library becomes a drag.
const SLOP = 10;
// How far (as a share of the home screen's height) the finger travels to open it.
const DISTANCE = 0.4;
// The pages lift this much of that distance as they fade, shrinking a touch.
const PAGES_LIFT = 0.3;
const PAGES_SHRINK = 0.06;
// Opening has a little life in it; closing doesn't bounce.
const OPEN_SPRING = { response: 0.46, damping: 0.82 };
const CLOSE_SPRING = { response: 0.36, damping: 1 };
// Keyframes along the way, so the settle follows the same path as the finger.
const PATH_FRAMES = 8;
// Fastest start a flick can give the spring (whole distances per second).
const MAX_SPRING_SPEED = 24;
// Wheel scrolling (px) that opens or closes it, and the pause after, so a
// trackpad's coasting doesn't flip it straight back.
const WHEEL_PX = 40;
const WHEEL_RESET_MS = 200;
const WHEEL_QUIET_MS = 700;
// A click that follows a drag must not open what's under the finger.
const CLICK_GUARD_MS = 400;
const MAX_SAMPLES = 20;
// Presses here are the pages' (pager.js), the library's own, or a critter's.
const NOT_AN_EDGE = '.pager, .app-library, .critter';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// canOpen(): false while something else owns the home screen (edit mode).
// onShow(shown): the library has started showing, or is gone again.
export function createAppLibrary({ home, apps, openApp, canOpen = () => true, onShow }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let progress = 0; // 0 closed … 1 open (a little more while stretched)
  let open = false;
  let distance = 0;
  let drag = null; // { from, y, samples, frame }
  let settling = null; // { from, to, curve, start, animations }
  let finger = null; // listeners for a press on the edges or the library
  const wheel = { sum: 0, at: 0, quietUntil: 0 };

  const shown = apps.filter((app) => app.mount);
  const grid = el(
    'ul',
    { class: 'app-library__grid', 'aria-label': 'Apps', style: `--library-cols: ${columns(shown.length)}` },
    shown.map((app) =>
      el(
        'li',
        { class: 'app-library__item' },
        el(
          'button',
          {
            class: 'app-library__app',
            type: 'button',
            dataset: { app: app.id },
            onclick: (event) => openApp(app.id, { origin: event.currentTarget.firstChild }),
          },
          appIcon(app, 'app-library__icon'),
          el('span', { class: 'app-library__name', text: app.name }),
        ),
      ),
    ),
  );
  const panel = el(
    'section',
    {
      class: 'app-library',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'All apps',
      tabindex: '-1',
      // A tap anywhere that isn't an app closes it.
      onclick: (event) => event.target.closest('.app-library__app') || close(),
    },
    grid,
  );
  const scrim = el('div', { class: 'app-library__scrim', 'aria-hidden': 'true', onclick: () => close() });
  panel.hidden = true;
  scrim.hidden = true;

  // Where everything is at a given progress. The settle animates through these too.

  // The pages, their dots and (in Blocks) the critters all lift away together.
  const pageNodes = () => [...home.querySelectorAll(':scope > .pager, :scope > .page-dots, :scope > .home__scene')];

  function look(p) {
    const lift = (-p * distance * PAGES_LIFT).toFixed(1);
    return {
      pages: {
        transform: `translate3d(0, ${lift}px, 0) scale(${(1 - PAGES_SHRINK * clamp01(p)).toFixed(4)})`,
        opacity: (1 - clamp01(p / 0.6)).toFixed(3),
      },
      panel: { transform: `translate3d(0, ${((1 - p) * distance).toFixed(1)}px, 0)`, opacity: clamp01(p * 1.6).toFixed(3) },
      scrim: { opacity: clamp01(p).toFixed(3) },
    };
  }

  function targets() {
    return [...pageNodes().map((node) => [node, 'pages']), [panel, 'panel'], [scrim, 'scrim']];
  }

  function paint(p) {
    const styles = look(p);
    for (const [node, part] of targets()) Object.assign(node.style, styles[part]);
  }

  // Showing and hiding

  function reveal() {
    if (!panel.hidden) return;
    distance = Math.round(home.clientHeight * DISTANCE);
    // Promoted only while it's in use: the pages are a big layer to keep around.
    home.classList.add('home--library');
    panel.hidden = false;
    scrim.hidden = false;
    paint(progress);
    onShow?.(true);
  }

  function conceal() {
    if (panel.hidden) return;
    panel.hidden = true;
    scrim.hidden = true;
    for (const node of pageNodes()) {
      node.style.transform = '';
      node.style.opacity = '';
    }
    home.classList.remove('home--library');
    onShow?.(false);
  }

  // The home screen behind can't be reached (or read out) while the library covers it.
  function setCovered(covered) {
    for (const node of pageNodes()) node.inert = covered;
  }

  // Settling: a spring from where it is to open or closed, starting at `speed`
  // (progress per ms, from the finger), along the same path the finger drew.

  function stopSettling() {
    if (!settling) return;
    const { from, to, curve, start, animations } = settling;
    settling = null;
    progress = from + (to - from) * curve.at((performance.now() - start) / curve.duration);
    paint(progress);
    animations.forEach((animation) => animation.cancel());
  }

  function settle(toOpen, speed = 0) {
    if (toOpen && !open && !canOpen()) return;
    stopSettling();
    const wasOpen = open;
    const from = progress;
    const to = toOpen ? 1 : 0;
    open = toOpen;
    setCovered(open);
    if (open) reveal();
    if (open && !wasOpen) panel.focus({ preventScroll: true });
    if (reducedMotion.matches || Math.abs(to - from) < 0.002) {
      progress = to;
      paint(to);
      if (!open) conceal();
      return;
    }
    const span = to - from;
    const startSpeed = Math.max(-MAX_SPRING_SPEED, Math.min(MAX_SPRING_SPEED, (speed * 1000) / span));
    const curve = spring({ ...(open ? OPEN_SPRING : CLOSE_SPRING), velocity: startSpeed });
    const path = Array.from({ length: PATH_FRAMES + 1 }, (_, i) => look(from + (span * i) / PATH_FRAMES));
    const animations = targets().map(([node, part]) =>
      node.animate(
        path.map((styles) => styles[part]),
        { duration: curve.duration, easing: curve.easing, fill: 'forwards' },
      ),
    );
    const own = { from, to, curve, start: performance.now(), animations };
    settling = own;
    animations[0].finished.then(
      () => {
        if (settling !== own) return;
        settling = null;
        progress = to;
        paint(to);
        animations.forEach((animation) => animation.cancel());
        if (!open) conceal();
      },
      () => {},
    );
  }

  function close({ animate = true } = {}) {
    if (!animate) {
      stopSettling();
      endDrag();
      open = false;
      progress = 0;
      setCovered(false);
      conceal();
      return;
    }
    if (open || !panel.hidden) settle(false);
  }

  // Dragging: begin where the finger is when it's clearly going up or down.

  function begin(y, dy) {
    if (drag) return false;
    if (!open && (dy > 0 || !canOpen())) return false;
    stopSettling();
    reveal();
    drag = { from: progress, y, samples: [], frame: 0 };
    return true;
  }

  function move(y, t) {
    if (!drag) return;
    drag.samples.push({ t, x: y });
    if (drag.samples.length > MAX_SAMPLES) drag.samples.shift();
    progress = libraryProgress({ from: drag.from, dy: y - drag.y, distance });
    if (!drag.frame) {
      drag.frame = requestAnimationFrame(() => {
        if (!drag) return;
        drag.frame = 0;
        paint(progress);
      });
    }
  }

  function endDrag() {
    if (!drag) return null;
    const ended = drag;
    cancelAnimationFrame(ended.frame);
    drag = null;
    return ended;
  }

  function end() {
    const ended = endDrag();
    if (!ended) return;
    const vy = velocity(ended.samples);
    settle(libraryTarget({ from: ended.from, progress, vy }), -vy / distance);
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
  function followDrags(node, skip = () => false) {
    node.addEventListener(
      'pointerdown',
      (down) => {
        if (drag || finger || down.button > 0 || skip(down)) return;
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
              if (Math.abs(dy) <= Math.abs(dx) || !begin(event.clientY, dy)) return release();
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

  followDrags(panel);
  // The bottom edge, the page dots and the scrim: anywhere the pages don't cover.
  followDrags(home, (event) => Boolean(event.target.closest(NOT_AN_EDGE)));
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
      if (Math.abs(wheel.sum) < WHEEL_PX || wheel.sum > 0 === open) return;
      wheel.sum = 0;
      wheel.quietUntil = event.timeStamp + WHEEL_QUIET_MS;
      settle(!open);
    },
    { passive: true, signal },
  );

  addEventListener('keydown', (event) => event.key === 'Escape' && open && close(), { signal });

  return {
    // The library and the scrim behind it go on top of the home screen.
    nodes: [scrim, panel],
    get isOpen() {
      return open;
    },
    // For pager.js: a vertical drag that started on the home pages.
    drag: { begin, move, end },
    open: () => settle(true),
    close,
    destroy() {
      close({ animate: false });
      finger?.abort();
      finger = null;
      lifetime.abort();
      scrim.remove();
      panel.remove();
    },
  };
}

// Up to four in a row; more than that make two even rows (six is three and three).
function columns(count) {
  return count <= 4 ? Math.max(1, count) : Math.ceil(count / 2);
}
