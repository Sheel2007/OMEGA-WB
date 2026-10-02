// Behaviour for the always-on board screen (enabled with ?kiosk=1).

const CURSOR_HIDE_MS = 3000;
const NIGHTLY_RELOAD_HOUR = 4;
const RELOAD_RETRY_MS = 5 * 60 * 1000;

export function initKiosk({ onIdle, idleMs }) {
  const root = document.documentElement;
  root.classList.add('is-kiosk');
  let cursorTimer;
  let idleTimer;

  const activity = () => {
    root.classList.remove('hide-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => root.classList.add('hide-cursor'), CURSOR_HIDE_MS);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, idleMs);
  };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
    addEventListener(type, activity, { passive: true, capture: true });
  }
  // Long-press on a touchscreen would otherwise open the browser's menu.
  addEventListener('contextmenu', (event) => event.preventDefault());
  activity();
  scheduleNightlyReload();
}

// A browser left open for weeks slowly gets heavier; start fresh once a night,
// but only if the board server is up (otherwise we'd be stuck on an error page).
function scheduleNightlyReload() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NIGHTLY_RELOAD_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(reloadWhenServerIsUp, next - now);
}

async function reloadWhenServerIsUp() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (response.ok) {
      location.reload();
      return;
    }
  } catch {
    // fall through and retry
  }
  setTimeout(reloadWhenServerIsUp, RELOAD_RETRY_MS);
}
