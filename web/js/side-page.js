// The page before page 1: swipe right on the first home page (the way you'd go
// back a page) and it slides in from the left under the finger while the home
// pages slide away to the right, like the page before an iPhone's home screen.
// Let go and a spring carries it the rest of the way at the finger's speed. Swipe
// left on it, tap its dot, press Escape, or go back to page 1 to shut it.
//
// It holds whatever `content` is (the Sports page). Only transform changes while
// it moves: once per frame under the finger, then a Web Animation with the
// spring as a CSS linear() easing (swipe.js), so the compositor runs the settle.
// pager.js hands it the swipes that start on page 1; it takes its own swipes back.
import { sideProgress, sideTarget, spring, velocity } from './swipe.js';
import { el, reducedMotion } from './ui.js';

// Movement (px) before a press on the page becomes a drag.
const SLOP = 12;
const OPEN_SPRING = { response: 0.42, damping: 0.9 };
const CLOSE_SPRING = { response: 0.36, damping: 1 };
const MAX_SPRING_SPEED = 24;
const CLICK_GUARD_MS = 400;
const MAX_SAMPLES = 20;

// canOpen(): false while something else owns the home screen (edit mode, the app library).
// onShow(shown): it has started showing, or is gone again.
// onToggle(open): it's on its way open, or on its way shut (for the page dots).
export function createSidePage({ home, content, label, canOpen = () => true, onShow, onToggle }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let progress = 0;
  let open = false;
  let width = 0;
  let drag = null; // { from, x, samples, frame }
  let settling = null; // { from, to, curve, start, animations }
  let finger = null;

  const panel = el('section', { class: 'side-page', 'aria-label': label, tabindex: '-1' }, content);
  panel.hidden = true;

  // The home pages and (in Blocks) the critters slide away together; the page dots stay.
  const pageNodes = () => [...home.querySelectorAll(':scope > .pager, :scope > .home__scene')];

  function look(p) {
    return {
      pages: { transform: `translate3d(${(p * width).toFixed(1)}px, 0, 0)` },
      panel: { transform: `translate3d(${((p - 1) * width).toFixed(1)}px, 0, 0)` },
    };
  }

  const targets = () => [...pageNodes().map((node) => [node, 'pages']), [panel, 'panel']];

  function paint(p) {
    const styles = look(p);
    for (const [node, part] of targets()) Object.assign(node.style, styles[part]);
  }

  function reveal() {
    if (!panel.hidden) return;
    width = home.clientWidth;
    home.classList.add('home--side');
    panel.hidden = false;
    paint(progress);
    onShow?.(true);
  }

  function conceal() {
    if (panel.hidden) return;
    panel.hidden = true;
    for (const node of pageNodes()) node.style.transform = '';
    home.classList.remove('home--side');
    onShow?.(false);
  }

  // Whichever isn't showing can't be reached or read out.
  function setCovered(covered) {
    for (const node of pageNodes()) node.inert = covered;
    panel.inert = !covered;
  }

  function stopSettling() {
    if (!settling) return;
    const { from, to, curve, start, animations } = settling;
    settling = null;
    progress = from + (to - from) * curve.at((performance.now() - start) / curve.duration);
    paint(progress);
    animations.forEach((animation) => animation.cancel());
  }

  // A spring from where it is to open or shut, starting at `speed` (progress per ms).
  function settle(toOpen, speed = 0) {
    if (toOpen && !open && !canOpen()) return;
    stopSettling();
    const wasOpen = open;
    const from = progress;
    const to = toOpen ? 1 : 0;
    open = toOpen;
    if (open !== wasOpen) onToggle?.(open);
    if (open) reveal();
    setCovered(open);
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
    const ends = [look(from), look(to)];
    const animations = targets().map(([node, part]) =>
      node.animate(
        ends.map((styles) => styles[part]),
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
      if (open) onToggle?.(false);
      open = false;
      progress = 0;
      setCovered(false);
      conceal();
      return;
    }
    if (open || !panel.hidden) settle(false);
  }

  // Dragging

  function begin(x, dx) {
    if (drag) return false;
    if (!open && (dx < 0 || !canOpen())) return false;
    if (open && dx > 0) return false;
    stopSettling();
    reveal();
    drag = { from: progress, x, samples: [], frame: 0 };
    return true;
  }

  function move(x, t) {
    if (!drag) return;
    drag.samples.push({ t, x });
    if (drag.samples.length > MAX_SAMPLES) drag.samples.shift();
    progress = sideProgress({ from: drag.from, dx: x - drag.x, width });
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
    const vx = velocity(ended.samples);
    settle(sideTarget({ from: ended.from, progress, vx }), vx / width);
  }

  function guardNextClick() {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    addEventListener('click', stop, { capture: true, once: true, signal });
    setTimeout(() => removeEventListener('click', stop, { capture: true }), CLICK_GUARD_MS);
  }

  // A press on the open page that moves mostly left drags it shut.
  panel.addEventListener(
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
            if (Math.abs(dx) <= Math.abs(dy) || !begin(event.clientX, dx)) return release();
            dragging = true;
            panel.setPointerCapture?.(down.pointerId);
          }
          move(event.clientX, event.timeStamp);
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
  panel.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
  addEventListener('keydown', (event) => event.key === 'Escape' && open && close(), { signal });
  setCovered(false);

  return {
    node: panel,
    get isOpen() {
      return open;
    },
    // For pager.js: a sideways drag that started on page 1.
    drag: { begin, move, end },
    open: () => settle(true),
    close,
    destroy() {
      close({ animate: false });
      finger?.abort();
      finger = null;
      lifetime.abort();
      panel.remove();
    },
  };
}
