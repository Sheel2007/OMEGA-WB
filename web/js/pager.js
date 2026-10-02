// Home pages that slide sideways under a finger (or mouse). One pointer state
// machine handles swipes and long-presses, so the two never fight. While a
// finger is down the track is moved with translate3d once per frame; on release
// a composited CSS transition settles it.
import { resist, swipeTarget, velocity } from './swipe.js';
import { el, reducedMotion } from './ui.js';

// Movement (px) before a press becomes a swipe; hold time for a long-press.
const SLOP = 12;
const LONG_PRESS_MS = 500;
// Covers the transition in case transitionend never fires (e.g. the tab was hidden).
const SETTLE_FALLBACK_MS = 450;
// A click that follows a swipe or long-press must not open what's under the finger.
const CLICK_GUARD_MS = 400;
const COMPACT = '(max-width: 900px), (max-height: 560px)';

// holdMs(): how long a press on a widget must last to call onLongPress (shorter while editing).
// ignore(event): presses that aren't gestures at all (e.g. a widget's remove button).
// onTap(event): a press that neither moved nor turned into a long-press.
export function createPager({ home, viewport, track, dots, onChange, onLongPress, onTap, holdMs = () => LONG_PRESS_MS, ignore = () => false }) {
  const lifetime = new AbortController();
  const compact = matchMedia(COMPACT);
  let page = 0;
  let count = 1;
  let settleTimer = null;
  let gesture = null;
  let locked = false;

  const pages = () => [...track.children];

  function apply({ animate = false, offset = 0 } = {}) {
    clearTimeout(settleTimer);
    const smooth = animate && !reducedMotion.matches;
    track.classList.toggle('pager__track--animating', smooth);
    if (smooth) settleTimer = setTimeout(() => track.classList.remove('pager__track--animating'), SETTLE_FALLBACK_MS);
    const flat = compact.matches;
    track.style.transform = flat || (page === 0 && offset === 0) ? '' : offset ? `translate3d(${-page * viewport.clientWidth + offset}px, 0, 0)` : `translate3d(${-page * 100}%, 0, 0)`;
    // Pages off to the side can't be focused or read out; on phones everything is one column.
    pages().forEach((node, i) => (node.inert = !flat && i !== page));
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === page)));
  }

  function goTo(next, { animate = true } = {}) {
    const target = Math.min(count - 1, Math.max(0, next));
    const changed = target !== page;
    page = target;
    apply({ animate });
    if (changed) onChange?.(page);
  }

  function setCount(next) {
    count = Math.max(1, next);
    const paged = count > 1;
    home.classList.toggle('home--paged', paged);
    track.classList.toggle('pager__track--paged', paged);
    dots.hidden = !paged;
    dots.replaceChildren(
      ...Array.from({ length: paged ? count : 0 }, (_, i) =>
        el('button', {
          class: 'page-dots__dot',
          type: 'button',
          'aria-label': `Page ${i + 1} of ${count}`,
          onclick: () => goTo(i),
        }),
      ),
    );
    if (page > count - 1) goTo(count - 1, { animate: false });
    else apply();
  }

  function guardNextClick() {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    addEventListener('click', stop, { capture: true, once: true, signal: lifetime.signal });
    setTimeout(() => removeEventListener('click', stop, { capture: true }), CLICK_GUARD_MS);
  }

  function endGesture() {
    if (!gesture) return;
    clearTimeout(gesture.longPress);
    cancelAnimationFrame(gesture.frame);
    gesture.listeners.abort();
    gesture = null;
  }

  function onPointerDown(event) {
    if (gesture || locked || compact.matches || event.button > 0 || ignore(event)) return;
    const listeners = new AbortController();
    const widget = event.target.closest('.widget');
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      mode: 'pressed',
      samples: [{ t: event.timeStamp, x: event.clientX }],
      frame: 0,
      listeners,
      longPress:
        widget && onLongPress
          ? setTimeout(() => {
              if (gesture?.mode !== 'pressed') return;
              const { x, y, id } = gesture;
              endGesture();
              guardNextClick();
              onLongPress({ widget, pointerId: id, x, y });
            }, holdMs() ?? LONG_PRESS_MS)
          : null,
    };
    const opts = { signal: listeners.signal };
    addEventListener('pointermove', onPointerMove, opts);
    addEventListener('pointerup', onPointerUp, opts);
    addEventListener('pointercancel', onPointerUp, opts);
  }

  function onPointerMove(event) {
    if (event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (gesture.mode === 'pressed') {
      if (Math.hypot(dx, dy) < SLOP) return;
      clearTimeout(gesture.longPress);
      if (Math.abs(dx) <= Math.abs(dy) || count < 2) {
        gesture.mode = 'ignored';
        return;
      }
      gesture.mode = 'swiping';
      track.classList.remove('pager__track--animating');
      viewport.setPointerCapture?.(gesture.id);
    }
    if (gesture.mode !== 'swiping') return;
    gesture.dx = dx;
    gesture.samples.push({ t: event.timeStamp, x: event.clientX });
    if (gesture.samples.length > 20) gesture.samples.shift();
    if (!gesture.frame) {
      gesture.frame = requestAnimationFrame(() => {
        if (!gesture) return;
        gesture.frame = 0;
        apply({ offset: resist(gesture.dx, { page, count, width: viewport.clientWidth }) });
      });
    }
  }

  function onPointerUp(event) {
    if (event.pointerId !== gesture.id) return;
    const { mode, dx, samples } = gesture;
    endGesture();
    if (mode === 'pressed') onTap?.(event);
    if (mode !== 'swiping') return;
    guardNextClick();
    const target = swipeTarget({ page, count, dx, vx: velocity(samples), width: viewport.clientWidth });
    const changed = target !== page;
    page = target;
    apply({ animate: true });
    if (changed) onChange?.(page);
  }

  viewport.addEventListener('pointerdown', onPointerDown, { signal: lifetime.signal });
  track.addEventListener('transitionend', () => track.classList.remove('pager__track--animating'), { signal: lifetime.signal });
  // Long-press on a touchscreen would otherwise open the browser's menu.
  viewport.addEventListener('contextmenu', (event) => event.preventDefault(), { signal: lifetime.signal });
  compact.addEventListener('change', () => apply(), { signal: lifetime.signal });
  apply();

  return {
    get current() {
      return page;
    },
    get count() {
      return count;
    },
    pages,
    goTo,
    setCount,
    // While a widget is being dragged, the pager ignores new presses.
    setLocked(on) {
      locked = on;
      if (on) endGesture();
    },
    destroy() {
      endGesture();
      clearTimeout(settleTimer);
      lifetime.abort();
    },
  };
}
