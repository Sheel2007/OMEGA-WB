// CalendarService: the household's events, wherever they live.
//
// Two shared stores arrive over the live connection: `calendar` (events the board
// keeps itself) and `calendar-sources` (a connected Google account and any
// subscribed iCalendar addresses, which the server reads on its own schedule).
// New events go to Google when an account is connected, and to the board otherwise;
// UI code only goes through these methods.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// Events that live on the board itself; a Google event's id starts with "g:".
export const BOARD_CALENDAR = 'board';

const EMPTY_SOURCES = {
  version: -1,
  configured: false,
  account: { configured: false, linked: false, account: null, target: null, pending: null },
  calendars: [],
  events: [],
  updated: null,
  stale: false,
};

function order(a, b) {
  return (
    a.date.localeCompare(b.date) ||
    Number(Boolean(a.time)) - Number(Boolean(b.time)) ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    a.title.localeCompare(b.title)
  );
}

export function createCalendarService({ live }) {
  const own = createSyncedState({
    initial: { version: -1, events: [] },
    send: (action, body) => postJson(`/api/calendar/${action}`, body),
    fetchState: () => getJson('/api/calendar'),
  });
  const sources = createSyncedState({
    initial: EMPTY_SOURCES,
    send: (action, body) => postJson(`/api/calendar/${action}`, body),
    fetchState: () => getJson('/api/calendar/sources'),
  });
  live.on('calendar', own.receive);
  live.on('calendar-sources', sources.receive);

  const listeners = new Set();
  const snapshot = () => ({ events: own.state.events, sources: sources.state });
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  own.subscribe(emit);
  sources.subscribe(emit);

  const writable = () => sources.state.calendars.filter((calendar) => calendar.writable);
  const onGoogle = (id) => typeof id === 'string' && id.startsWith('g:');

  return {
    getSnapshot: snapshot,
    getEvents: () => own.state.events,
    getSources: () => sources.state,
    getWritable: writable,
    getAccount: () => sources.state.account,

    refresh() {
      own.refresh();
      sources.refresh();
    },

    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
      return () => listeners.delete(fn);
    },

    // `calendar` is a Google calendar id, BOARD_CALENDAR, or left out for the usual place.
    addEvent(fields, { calendar } = {}) {
      const event = {
        title: String(fields.title ?? '').trim().replace(/\s+/g, ' '),
        date: fields.date,
        time: fields.time ?? null,
        endDate: fields.endDate ?? fields.date,
        endTime: fields.endTime ?? null,
        location: fields.location?.trim() || null,
        description: fields.description?.trim() || null,
      };
      const target = calendar ?? (writable().length ? sources.state.account.target : BOARD_CALENDAR);
      if (target !== BOARD_CALENDAR) return sources.mutate('add', { ...event, calendar: target });
      const id = newId();
      return own.mutate('add', { ...event, id, calendar: BOARD_CALENDAR }, (state) => {
        state.events = [...state.events, { ...event, id, created: new Date().toISOString() }].sort(order);
        return state;
      });
    },

    removeEvent(id) {
      if (onGoogle(id)) {
        return sources.mutate('remove', { id }, (state) => {
          state.events = state.events.filter((event) => event.id !== id);
          return state;
        });
      }
      return own.mutate('remove', { id }, (state) => {
        state.events = state.events.filter((event) => event.id !== id);
        return state;
      });
    },

    restoreEvents(ids) {
      const state = ids.some(onGoogle) ? sources : own;
      return state.mutate('restore', { ids });
    },

    // Google
    syncNow: () => sources.mutate('refresh', {}),
    setTarget: (id) => sources.mutate('google/target', { id }),
    unlinkGoogle: () => postJson('/api/calendar/google/unlink', {}),
    linkGoogle: () => postJson('/api/calendar/google/link', {}),
  };
}
