// ShoppingService: the shared shopping list. Stored on the Pi in data/shopping.json;
// UI code only goes through these methods.
import { nameKey } from '../groceries.js';
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

function tidy(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function createShoppingService({ live }) {
  const synced = createSyncedState({
    initial: { version: -1, items: [], recent: [] },
    send: (action, body) => postJson(`/api/shopping/${action}`, body),
    fetchState: () => getJson('/api/shopping'),
  });
  live.on('shopping', synced.receive);

  return {
    getItems: () => synced.state.items,
    getRecent: () => synced.state.recent,
    getState: () => synced.state,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    addItem(rawName) {
      const name = tidy(rawName);
      const existing = synced.state.items.find((item) => nameKey(item.name) === nameKey(name));
      const id = existing ? existing.id : newId();
      return synced.mutate('add', { name, id }, (s) => {
        if (existing && !existing.done) return s;
        s.items = s.items.filter((item) => item.id !== id);
        s.items.unshift({ id, name: existing ? existing.name : name, done: false, added: new Date().toISOString(), checked: null });
        return s;
      });
    },

    setDone(id, done) {
      return synced.mutate('check', { id, done }, (s) => {
        const item = s.items.find((i) => i.id === id);
        if (item) Object.assign(item, { done, checked: done ? new Date().toISOString() : null });
        return s;
      });
    },

    removeItem(id) {
      return synced.mutate('remove', { id }, (s) => {
        s.items = s.items.filter((item) => item.id !== id);
        return s;
      });
    },

    clearBought() {
      return synced.mutate('clear-checked', {}, (s) => {
        s.items = s.items.filter((item) => !item.done);
        return s;
      });
    },

    restoreItems(ids) {
      return synced.mutate('restore', { ids });
    },
  };
}
