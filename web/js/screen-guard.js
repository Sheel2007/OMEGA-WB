// While the board has switched its monitor off (no motion for a while), the first tap
// on the dark screen only wakes it, so nothing gets switched or opened unseen. The
// guard stays until that finger lifts, so the tap that woke the screen never lands
// on whatever is under it. Kiosk only: phones never cover their screens.

// How long after the finger lifts the guard stays, so the tap's own click lands on it.
const RELEASE_MS = 400;

export function createScreenGuard({ lights, onDark }) {
  const lifetime = new AbortController();
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'screen-guard';
  node.setAttribute('aria-label', 'Wake the screen');
  node.hidden = true;
  document.body.append(node);

  let dark = false;
  let holding = false;
  let release = null;

  const sync = () => {
    node.hidden = !(dark || holding);
  };

  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  node.addEventListener(
    'pointerdown',
    (event) => {
      swallow(event);
      holding = true;
      clearTimeout(release);
      sync();
      if (dark) lights.wakeScreen().catch(() => {});
    },
    { signal: lifetime.signal },
  );
  node.addEventListener('click', swallow, { signal: lifetime.signal });
  // A keyboard's Enter or Space wakes it too.
  node.addEventListener('keydown', () => dark && lights.wakeScreen().catch(() => {}), { signal: lifetime.signal });
  for (const type of ['pointerup', 'pointercancel']) {
    addEventListener(
      type,
      () => {
        if (!holding) return;
        clearTimeout(release);
        release = setTimeout(() => {
          holding = false;
          sync();
        }, RELEASE_MS);
      },
      { signal: lifetime.signal },
    );
  }

  const unsubscribe = lights.subscribe((state) => {
    const next = state.screen?.on === false;
    if (next === dark) return;
    dark = next;
    sync();
    onDark?.(dark);
  });

  return {
    destroy() {
      unsubscribe();
      lifetime.abort();
      clearTimeout(release);
      node.remove();
    },
  };
}
