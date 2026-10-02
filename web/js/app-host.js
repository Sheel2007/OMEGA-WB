// Opening and closing full-screen apps, routed by the URL hash (#/app/<id>/<intent>).
import { el, icons, reducedMotion } from './ui.js';

const SWIPE_HOME_PX = 60;
const OPEN_MS = 460;
const CLOSE_MS = 380;
const REDUCED_OPEN_MS = 150;
const REDUCED_CLOSE_MS = 120;

export function createAppHost({ layer, dock, apps, context }) {
  const root = document.documentElement;
  let current = null;
  let pendingOrigin = null;

  function openApp(id, { origin, intent } = {}) {
    pendingOrigin = origin || null;
    const hash = `#/app/${id}${intent ? `/${intent}` : ''}`;
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function goHome() {
    if (location.hash && location.hash !== '#/') location.hash = '#/';
  }

  // Zoom out of (or back into) the widget or dock icon the app was opened from.
  function zoomFrames(origin) {
    const rect = origin?.getBoundingClientRect();
    const board = layer.parentElement.getBoundingClientRect();
    if (!rect?.width || reducedMotion.matches) {
      return [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }];
    }
    const from = `translate(${rect.left - board.left}px, ${rect.top - board.top}px) scale(${rect.width / board.width}, ${rect.height / board.height})`;
    return [
      { opacity: 0, transform: from, offset: 0 },
      { opacity: 1, offset: 0.55 },
      { opacity: 1, transform: 'none', offset: 1 },
    ];
  }

  function homeIndicator() {
    const indicator = el('button', {
      class: 'app-shell__indicator',
      type: 'button',
      'aria-label': 'Go to the home screen',
      onclick: goHome,
    });
    indicator.addEventListener('pointerdown', (start) => {
      const gesture = new AbortController();
      const { signal } = gesture;
      addEventListener(
        'pointermove',
        (event) => {
          if (start.clientY - event.clientY > SWIPE_HOME_PX) {
            gesture.abort();
            goHome();
          }
        },
        { signal },
      );
      addEventListener('pointerup', () => gesture.abort(), { signal });
      addEventListener('pointercancel', () => gesture.abort(), { signal });
    });
    return indicator;
  }

  function showApp(app, intent) {
    if (current?.app === app) {
      current.instance.intent?.(intent);
      return;
    }
    if (current) closeApp({ animate: false });

    const body = el('div', { class: 'app-shell__body' });
    layer.replaceChildren(
      el(
        'div',
        { class: 'app-shell__bar' },
        el('button', { class: 'app-shell__home', type: 'button', onclick: goHome, html: `${icons.home}<span>Home</span>` }),
      ),
      body,
      homeIndicator(),
    );
    layer.dataset.app = app.id;
    layer.hidden = false;
    layer.getAnimations().forEach((animation) => animation.cancel());

    const instance = app.mount(body, context);
    current = { app, instance };
    root.classList.add('is-app-open');
    layer.style.transformOrigin = '0 0';
    layer.animate(zoomFrames(pendingOrigin), {
      duration: reducedMotion.matches ? REDUCED_OPEN_MS : OPEN_MS,
      easing: 'cubic-bezier(.2,.85,.25,1)',
    });
    if (intent) instance.intent?.(intent);
  }

  function closeApp({ animate = true } = {}) {
    if (!current) return;
    const { app, instance } = current;
    current = null;
    root.classList.remove('is-app-open');
    instance.closeKeyboard?.();
    const finish = () => {
      instance.unmount();
      // Another app may have opened while this one was closing.
      if (!current) {
        layer.hidden = true;
        layer.replaceChildren();
      }
    };
    if (!animate) {
      instance.unmount();
      return;
    }
    const origin = dock.querySelector(`[data-app="${app.id}"]`);
    const frames = zoomFrames(origin)
      .reverse()
      .map((frame, i, all) => ({ ...frame, offset: 1 - (frame.offset ?? (all.length - 1 - i) / (all.length - 1)) }));
    layer
      .animate(frames, { duration: reducedMotion.matches ? REDUCED_CLOSE_MS : CLOSE_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
      .finished.then(finish, finish);
  }

  function route() {
    const match = /^#\/app\/([\w-]+)(?:\/([\w-]+))?/.exec(location.hash);
    const app = match && apps.find((a) => a.id === match[1] && a.mount);
    if (app) showApp(app, match[2]);
    else closeApp();
    pendingOrigin = null;
  }

  return {
    openApp,
    goHome,
    start() {
      addEventListener('hashchange', route);
      route();
    },
  };
}
