// One live connection to the board server. Every shared store (shopping, notes)
// arrives as a named event on the same stream.

const OFFLINE_GRACE_MS = 3000;
const RECONNECT_MS = 5000;
// A phone carried out of the house retries all day; backing off keeps that cheap.
const MAX_RECONNECT_MS = 60 * 1000;

export function createLiveConnection({ url = '/api/events', streams, onServerRestart }) {
  const handlers = new Map(streams.map((name) => [name, new Set()]));
  const statusListeners = new Set();
  const lifetime = new AbortController();
  let source = null;
  let bootId = null;
  let status = 'connecting';
  let offlineTimer = null;
  let reconnectTimer = null;
  let retryIn = RECONNECT_MS;

  function setStatus(next) {
    clearTimeout(offlineTimer);
    if (next === 'offline' && status !== 'offline') {
      // Brief blips (server restart, Wi-Fi hiccup) shouldn't flash a warning.
      offlineTimer = setTimeout(() => {
        status = 'offline';
        statusListeners.forEach((fn) => fn(status));
      }, OFFLINE_GRACE_MS);
      return;
    }
    if (next === status) return;
    status = next;
    statusListeners.forEach((fn) => fn(status));
  }

  function connect() {
    source?.close();
    source = new EventSource(url);
    source.addEventListener('hello', (event) => {
      const { boot } = JSON.parse(event.data);
      if (bootId && boot !== bootId) onServerRestart?.();
      bootId = boot;
      retryIn = RECONNECT_MS;
      setStatus('live');
    });
    for (const [name, listeners] of handlers) {
      source.addEventListener(name, (event) => {
        const state = JSON.parse(event.data);
        listeners.forEach((fn) => fn(state));
      });
    }
    source.addEventListener('error', () => {
      setStatus('offline');
      // EventSource retries dropped connections itself; it only gives up on HTTP errors.
      if (source.readyState === EventSource.CLOSED) retryLater();
    });
  }

  function retryLater() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retryIn);
    retryIn = Math.min(retryIn * 2, MAX_RECONNECT_MS);
  }

  // Opens a new stream now. The server sends every store's state on connect, so this
  // is also how a screen that missed changes catches up.
  function reconnect() {
    clearTimeout(reconnectTimer);
    retryIn = RECONNECT_MS;
    connect();
  }

  // A phone that was asleep, in another app, or out of the house comes back to a
  // stream the system quietly closed while it wasn't looking, and no error ever
  // reaches this page. Every way back into view reopens it.
  function watchForResume() {
    const { signal } = lifetime;
    addEventListener('online', reconnect, { signal });
    addEventListener('pageshow', (event) => event.persisted && reconnect(), { signal });
    document.addEventListener('visibilitychange', () => document.hidden || reconnect(), { signal });
  }

  return {
    get status() {
      return status;
    },
    on(name, fn) {
      const listeners = handlers.get(name);
      if (!listeners) throw new Error(`No live stream called "${name}"`);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    reconnect,
    start() {
      watchForResume();
      connect();
    },
    stop() {
      clearTimeout(offlineTimer);
      clearTimeout(reconnectTimer);
      lifetime.abort();
      source?.close();
      source = null;
    },
  };
}
