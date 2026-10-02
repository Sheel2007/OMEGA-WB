import { createShoppingStore, fetchInfo } from './api.js';
import { APPS } from './apps/index.js';
import { initKiosk } from './kiosk.js';
import { guessLocation, parseTimeOverride, startSky } from './sky.js';
import { appIcon, el, icons, reducedMotion } from './ui.js';

// In kiosk mode, an app left open goes back to the home screen after this long.
const IDLE_RETURN_MS = 90 * 1000;
const SWIPE_HOME_PX = 60;

const params = new URLSearchParams(location.search);
const kiosk = params.has('kiosk') && params.get('kiosk') !== '0';
// ?at=19:30 previews the board at another time of day.
const fixedTime = parseTimeOverride(params.get('at'));
const now = () => fixedTime ?? new Date();

const root = document.documentElement;
const layer = document.querySelector('.app-layer');
const store = createShoppingStore({ onServerRestart: () => location.reload() });
const info = fetchInfo();

// Wallpaper

let location_ = guessLocation();
const sky = startSky({
  starsEl: document.querySelector('.sky__stars'),
  getLocation: () => location_,
  getTime: now,
});
info.then((details) => {
  if (details?.location) {
    location_ = details.location;
    sky.repaint();
  }
});

// Clock and status bar

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const clockTime = document.querySelector('.clock__time');
const clockDate = document.querySelector('.clock__date');
const statusTime = document.querySelector('.statusbar__time');

// Lock-screen style: just the hour and minutes, no AM/PM.
function shortTime(date) {
  const parts = timeFormat.formatToParts(date);
  const from = parts.findIndex((p) => p.type === 'hour');
  const to = parts.findIndex((p) => p.type === 'minute');
  return parts.slice(from, to + 1).map((p) => p.value).join('');
}

function tick() {
  const date = now();
  const time = shortTime(date);
  if (clockTime.textContent !== time) {
    clockTime.textContent = time;
    statusTime.textContent = time;
    clockTime.setAttribute('datetime', date.toISOString());
    clockDate.textContent = dateFormat.format(date);
  }
}
tick();
setInterval(tick, 1000);

const sync = document.querySelector('.sync');
function showStatus(status) {
  sync.dataset.status = status;
  const offline = status === 'offline';
  sync.innerHTML = (offline ? icons.wifiOff : icons.wifi) + (offline ? '<span>Offline — changes won’t save</span>' : '');
  sync.setAttribute('aria-label', offline ? 'Offline' : 'Connected');
}
showStatus('live');
store.onStatus(showStatus);

// Home screen

const context = { store, kiosk, info };
const dock = document.querySelector('.dock');
const widgets = document.querySelector('.widgets');
for (const app of APPS) {
  dock.append(
    el(
      'button',
      {
        class: 'dock__app',
        type: 'button',
        'aria-label': app.name,
        dataset: { app: app.id },
        onclick: (event) => openApp(app.id, { origin: event.currentTarget }),
      },
      appIcon(app),
    ),
  );
  if (app.widget) widgets.append(app.widget({ ...context, openApp }));
}

// Apps

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

function zoomFrames(origin) {
  const rect = origin?.getBoundingClientRect();
  if (!rect?.width || reducedMotion.matches) {
    return [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }];
  }
  const from = `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / innerWidth}, ${rect.height / innerHeight})`;
  return [
    { opacity: 0, transform: from, offset: 0 },
    { opacity: 1, offset: 0.55 },
    { opacity: 1, transform: 'none', offset: 1 },
  ];
}

function showApp(app, intent) {
  if (current?.app === app) {
    current.instance.intent?.(intent);
    return;
  }
  if (current) closeApp({ animate: false });

  const body = el('div', { class: 'app__body' });
  const indicator = el('button', {
    class: 'home-indicator',
    type: 'button',
    'aria-label': 'Go to the home screen',
    onclick: goHome,
  });
  indicator.addEventListener('pointerdown', (start) => {
    const move = (event) => {
      if (start.clientY - event.clientY > SWIPE_HOME_PX) {
        cleanup();
        goHome();
      }
    };
    const cleanup = () => removeEventListener('pointermove', move);
    addEventListener('pointermove', move);
    addEventListener('pointerup', cleanup, { once: true });
  });
  layer.replaceChildren(
    el(
      'div',
      { class: 'app__bar' },
      el('button', { class: 'home-button', type: 'button', onclick: goHome, html: `${icons.home}<span>Home</span>` }),
    ),
    body,
    indicator,
  );
  layer.dataset.app = app.id;
  layer.hidden = false;
  layer.getAnimations().forEach((animation) => animation.cancel());

  const instance = app.mount(body, context);
  current = { app, instance };
  root.classList.add('is-app-open');
  layer.style.transformOrigin = '0 0';
  layer.animate(zoomFrames(pendingOrigin), {
    duration: reducedMotion.matches ? 150 : 460,
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
  const frames = zoomFrames(origin).reverse().map((frame, i, all) => ({ ...frame, offset: 1 - (frame.offset ?? (all.length - 1 - i) / (all.length - 1)) }));
  layer
    .animate(frames, { duration: reducedMotion.matches ? 120 : 380, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
    .finished.then(finish, finish);
}

function route() {
  const match = /^#\/app\/([\w-]+)(?:\/([\w-]+))?/.exec(location.hash);
  const app = match && APPS.find((a) => a.id === match[1]);
  if (app) showApp(app, match[2]);
  else closeApp();
  pendingOrigin = null;
}

addEventListener('hashchange', route);
route();
store.start();

if (kiosk) {
  initKiosk({ onIdle: goHome, idleMs: IDLE_RETURN_MS });
}
