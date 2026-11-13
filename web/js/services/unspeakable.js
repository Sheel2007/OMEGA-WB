// UnspeakableService: the house ledger of things that happened and are never to be
// mentioned again. Stored on the Pi in data/unspeakable.json, shared by every screen,
// along with the look the widget wears and the tally of taps it turned away.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';
import { DEFAULT_LOOK, lookOf } from '../apps/unspeakable/looks.js';

export function createUnspeakableService({ live }) {
  const synced = createSyncedState({
    initial: { version: -1, entries: [], look: DEFAULT_LOOK, attempts: 0 },
    send: (action, body) => postJson(`/api/unspeakable/${action}`, body),
    fetchState: () => getJson('/api/unspeakable'),
  });
  live.on('unspeakable', synced.receive);

  return {
    getState: () => synced.state,
    getEntries: () => synced.state.entries,
    // The widget's look, one of LOOKS in looks.js.
    getLook: () => lookOf(synced.state.look),
    getAttempts: () => synced.state.attempts ?? 0,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    addEntry(rawText) {
      const text = rawText.trim().replace(/\s+/g, ' ');
      const id = newId();
      return synced.mutate('add', { text, id }, (s) => {
        s.entries.unshift({ id, text, created: new Date().toISOString() });
        return s;
      });
    },

    removeEntry(id) {
      return synced.mutate('remove', { id }, (s) => {
        s.entries = s.entries.filter((entry) => entry.id !== id);
        return s;
      });
    },

    restoreEntries(ids) {
      return synced.mutate('restore', { ids });
    },

    setLook(look) {
      if (lookOf(look) !== look) return Promise.reject(new Error('Pick one of the looks.'));
      return synced.mutate('look', { look }, (s) => {
        s.look = look;
        return s;
      });
    },

    // Someone tapped the widget, was told "Access denied" and gave up.
    reportAttempt() {
      return synced.mutate('attempt', {}, (s) => {
        s.attempts = (s.attempts ?? 0) + 1;
        return s;
      });
    },
  };
}
