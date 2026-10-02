// CalendarService: the events the household adds (stored on the Pi in data/calendar.json
// and pushed to every screen) together with the read-only Google Calendar feeds the
// server fetches. UI code only goes through these methods.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// The server caches each feed for 15 minutes, so asking more often than this buys nothing.
const FEED_REFRESH_MS = 10 * 60 * 1000;

export function createCalendarService({ live }) {
  const synced = createSyncedState({
    initial: { version: -1, events: [] },
    send: (action, body) => postJson(`/api/calendar/${action}`, body),
    fetchState: () => getJson('/api/calendar'),
  });
  live.on('calendar', synced.receive);

  const listeners = new Set();
  let feed = { configured: true, calendars: [], events: [], updated: null, stale: false, loading: true, error: null };
  let timer = null;

  const snapshot = () => ({ events: synced.state.events, feed });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));

  async function loadFeed() {
    try {
      feed = { ...(await getJson('/api/calendar/feed')), loading: false, error: null };
    } catch (err) {
      // Keep whatever was last on screen; say why it may be old.
      feed = { ...feed, loading: false, error: err.message };
    }
    emit();
  }

  synced.subscribe(emit);

  function sorted(events) {
    return [...events].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(Boolean(a.time)) - Number(Boolean(b.time)) ||
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.title.localeCompare(b.title),
    );
  }

  return {
    getSnapshot: snapshot,
    getEvents: () => synced.state.events,
    getFeed: () => feed,
    refresh: synced.refresh,
    refreshFeed: loadFeed,

    // Polling only runs while a widget or the app is on screen.
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
      if (listeners.size === 1) {
        loadFeed();
        timer = setInterval(loadFeed, FEED_REFRESH_MS);
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = null;
        }
      };
    },

    addEvent({ title, date, time = null }) {
      const clean = String(title).trim().replace(/\s+/g, ' ');
      const id = newId();
      return synced.mutate('add', { title: clean, date, time, id }, (s) => {
        s.events = sorted([...s.events, { id, title: clean, date, time, created: new Date().toISOString() }]);
        return s;
      });
    },

    removeEvent(id) {
      return synced.mutate('remove', { id }, (s) => {
        s.events = s.events.filter((event) => event.id !== id);
        return s;
      });
    },

    restoreEvents(ids) {
      return synced.mutate('restore', { ids });
    },
  };
}
