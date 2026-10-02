// Client for the shared shopping list. Changes show up instantly on this
// screen, then the server's answer (and live updates from other devices) win.
import { nameKey } from './groceries.js';

const OFFLINE_GRACE_MS = 3000;
const RECONNECT_MS = 5000;

function newId() {
  // crypto.randomUUID needs HTTPS; phones reach the board over plain HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function tidy(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`/api/shopping/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the board. Check that the Pi is on.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "That didn't save. Try again.");
  return data;
}

export function createShoppingStore({ onServerRestart } = {}) {
  let state = { version: -1, items: [], recent: [] };
  let latest = null;
  let pending = 0;
  let bootId = null;
  let status = 'connecting';
  let offlineTimer = null;
  const listeners = new Set();
  const statusListeners = new Set();

  const emit = () => listeners.forEach((fn) => fn(state));

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

  // Server states are held back while our own changes are in flight, so a
  // slightly older broadcast can't undo what the user just tapped.
  function receive(next) {
    if (!latest || next.version >= latest.version) latest = next;
    if (pending === 0 && latest !== state) {
      state = latest;
      emit();
    }
  }

  async function resync() {
    try {
      const response = await fetch('/api/shopping', { cache: 'no-store' });
      if (response.ok) receive(await response.json());
    } catch {
      setStatus('offline');
    }
  }

  async function mutate(path, body, optimistic) {
    pending++;
    if (optimistic) {
      state = optimistic(structuredClone(state));
      emit();
    }
    try {
      const data = await post(path, body);
      pending--;
      if (data?.state) receive(data.state);
      return data;
    } catch (err) {
      pending--;
      if (latest) {
        latest = { ...latest };
        receive(latest);
      }
      resync();
      throw err;
    }
  }

  function connect() {
    const source = new EventSource('/api/shopping/events');
    source.addEventListener('hello', (event) => {
      const { boot } = JSON.parse(event.data);
      if (bootId && boot !== bootId) onServerRestart?.();
      bootId = boot;
      setStatus('live');
    });
    source.addEventListener('state', (event) => receive(JSON.parse(event.data)));
    source.addEventListener('error', () => {
      setStatus('offline');
      if (source.readyState === EventSource.CLOSED) setTimeout(connect, RECONNECT_MS);
    });
  }

  return {
    get state() {
      return state;
    },
    get status() {
      return status;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    start() {
      resync();
      connect();
    },
    add(rawName) {
      const name = tidy(rawName);
      const existing = state.items.find((item) => nameKey(item.name) === nameKey(name));
      const id = existing ? existing.id : newId();
      return mutate('add', { name, id }, (s) => {
        if (existing && !existing.done) return s;
        s.items = s.items.filter((item) => item.id !== id);
        s.items.unshift({ id, name: existing ? existing.name : name, done: false, added: new Date().toISOString(), checked: null });
        return s;
      });
    },
    check(id, done) {
      return mutate('check', { id, done }, (s) => {
        const item = s.items.find((i) => i.id === id);
        if (item) Object.assign(item, { done, checked: done ? new Date().toISOString() : null });
        return s;
      });
    },
    remove(id) {
      return mutate('remove', { id }, (s) => {
        s.items = s.items.filter((item) => item.id !== id);
        return s;
      });
    },
    clearChecked() {
      return mutate('clear-checked', {}, (s) => {
        s.items = s.items.filter((item) => !item.done);
        return s;
      });
    },
    restore(ids) {
      return mutate('restore', { ids });
    },
  };
}

export async function fetchInfo() {
  try {
    const response = await fetch('/api/info', { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
