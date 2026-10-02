// One live connection to the board server. Every shared store (shopping, notes)
// arrives as a named event on the same stream.

const OFFLINE_GRACE_MS = 3000;
const RECONNECT_MS = 5000;

export function createLiveConnection({ url = '/api/events', streams, onServerRestart }) {
  const handlers = new Map(streams.map((name) => [name, new Set()]));
  const statusListeners = new Set();
  let source = null;
  let bootId = null;
  let status = 'connecting';
  let offlineTimer = null;
  let reconnectTimer = null;

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
      if (source.readyState === EventSource.CLOSED) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      }
    });
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
    start: connect,
    stop() {
      clearTimeout(offlineTimer);
      clearTimeout(reconnectTimer);
      source?.close();
      source = null;
    },
  };
}
