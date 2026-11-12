// UnspeakableService: the house ledger of things that happened and are never to be
// mentioned again. Stored on the Pi in data/unspeakable.json, shared by every screen.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

export function createUnspeakableService({ live }) {
  const synced = createSyncedState({
    initial: { version: -1, entries: [] },
    send: (action, body) => postJson(`/api/unspeakable/${action}`, body),
    fetchState: () => getJson('/api/unspeakable'),
  });
  live.on('unspeakable', synced.receive);

  return {
    getEntries: () => synced.state.entries,
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
  };
}
