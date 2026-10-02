// Behaviour for the always-on board screen (enabled with ?kiosk=1).
import { isServerUp } from './services/board.js';

const CURSOR_HIDE_MS = 3000;
const NIGHTLY_RELOAD_HOUR = 4;
const RELOAD_RETRY_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'];

export function initKiosk({ onIdle, idleMs }) {
  const root = document.documentElement;
  const lifetime = new AbortController();
  let cursorTimer = null;
  let idleTimer = null;
  let reloadTimer = null;

  root.classList.add('is-kiosk');

  const activity = () => {
    root.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => root.classList.add('hide-cursor'), CURSOR_HIDE_MS);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, idleMs);
  };
  for (const type of ACTIVITY_EVENTS) {
    addEventListener(type, activity, { passive: true, capture: true, signal: lifetime.signal });
  }
  // Long-press on a touchscreen would otherwise open the browser's menu.
  addEventListener('contextmenu', (event) => event.preventDefault(), { signal: lifetime.signal });
  activity();

  // A browser left open for weeks slowly gets heavier; start fresh once a night,
  // but only if the board server is up (otherwise we'd be stuck on an error page).
  async function reloadWhenServerIsUp() {
    if (await isServerUp()) {
      location.reload();
      return;
    }
    reloadTimer = setTimeout(reloadWhenServerIsUp, RELOAD_RETRY_MS);
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(NIGHTLY_RELOAD_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  reloadTimer = setTimeout(reloadWhenServerIsUp, next - now);

  return {
    stop() {
      lifetime.abort();
      clearTimeout(cursorTimer);
      clearTimeout(idleTimer);
      clearTimeout(reloadTimer);
      root.classList.remove('is-kiosk', 'hide-cursor');
    },
  };
}
