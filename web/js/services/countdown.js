// CountdownService: the days the house is waiting for. Stored on the Pi in
// data/countdowns.json and shared by every screen; each screen counts the days left
// on its own calendar.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

export function createCountdownService({ live }) {
  const synced = createSyncedState({
    initial: { version: -1, countdowns: [] },
    send: (action, body) => postJson(`/api/countdown/${action}`, body),
    fetchState: () => getJson('/api/countdown'),
  });
  live.on('countdown', synced.receive);

  return {
    getState: () => synced.state,
    getCountdowns: () => synced.state.countdowns,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    // `date` is a "YYYY-MM-DD" day; `event` the calendar event it's counted down
    // from (the hourglass), which it then stands for instead of getting its own.
    addCountdown(rawTitle, date, { event } = {}) {
      const title = rawTitle.trim().replace(/\s+/g, ' ');
      const id = newId();
      const link = event ? { event, made: false } : {};
      return synced.mutate('add', { title, date, id, ...(event ? { event } : {}) }, (s) => {
        s.countdowns.push({ id, title, date, created: new Date().toISOString(), ...link });
        s.countdowns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        return s;
      });
    },

    removeCountdown(id) {
      return synced.mutate('remove', { id }, (s) => {
        s.countdowns = s.countdowns.filter((c) => c.id !== id);
        return s;
      });
    },

    restoreCountdowns(ids) {
      return synced.mutate('restore', { ids });
    },
  };
}
