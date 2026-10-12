// GroceryService: the grocery list for Lidl and Trader Joe's. Stored on the Pi in
// data/grocery.json; product lookups and searches go through the Pi too, which
// asks Open Food Facts and caches the answers for every screen.
import { getJson, newId, postBlob, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// Version -1 until the board has answered, so nothing says "nothing to get" too early.
const EMPTY = { version: -1, currency: 'USD', items: [], catalog: [], people: [], texting: [], texts: false };

export const isReady = (state) => state.version >= 0;

export function createGroceryService({ live }) {
  const synced = createSyncedState({
    initial: EMPTY,
    send: (action, body) => postJson(`/api/grocery/${action}`, body),
    fetchState: () => getJson('/api/grocery'),
  });
  live.on('grocery', synced.receive);

  return {
    getState: () => synced.state,
    getItems: () => synced.state.items,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    // { product } for a barcode: what the board remembers, or what's known online.
    lookup(code) {
      return getJson(`/api/grocery/lookup?code=${encodeURIComponent(code)}`);
    },

    // { known, online, offline }: things bought before first, then products online.
    search(query, store = null) {
      const params = new URLSearchParams({ q: query });
      if (store) params.set('store', store);
      return getJson(`/api/grocery/search?${params}`);
    },

    // { online, ready }: Trader Joe's and Lidl products that could be what's being typed, from
    // the list the Pi keeps (`ready` is false until it has downloaded it the first time).
    suggest(query, store = null) {
      const params = new URLSearchParams({ q: query });
      if (store) params.set('store', store);
      return getJson(`/api/grocery/suggest?${params}`);
    },

    // Saves a photo (a JPEG Blob) on the Pi. Resolves to the name to give an item as `photo`.
    async uploadPhoto(blob) {
      const { photo } = await postBlob('/api/grocery/photo', blob);
      return photo;
    },

    // fields: name, and optionally code, brand, size, store, price (cents), qty, by, photo.
    addItem(fields) {
      const id = newId();
      return synced.mutate('add', { ...fields, id }, (s) => {
        const same = s.items.find((i) => !i.done && (fields.code ? i.code === fields.code : !i.code && i.name.toLowerCase() === fields.name.trim().toLowerCase()));
        if (same) {
          same.qty = Math.min(99, same.qty + (fields.qty ?? 1));
          return s;
        }
        s.items.unshift({
          id,
          name: fields.name.trim(),
          code: fields.code ?? null,
          brand: fields.brand ?? null,
          size: fields.size ?? null,
          store: fields.store ?? null,
          price: fields.price ?? null,
          by: fields.by ?? null,
          photo: fields.photo ?? null,
          qty: fields.qty ?? 1,
          done: false,
          added: new Date().toISOString(),
          checked: null,
        });
        return s;
      });
    },

    // Only the fields given change.
    updateItem(id, changes) {
      return synced.mutate('update', { id, ...changes }, (s) => {
        const item = s.items.find((i) => i.id === id);
        if (item) Object.assign(item, changes);
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

    // Texts when things are added. `texting` in the state lists who gets them, with
    // only the last four digits of each number; `texts` says whether the Pi can send.
    // fields: name, phone, carrier (tmobile, verizon or googlefi).
    addTexter(fields) {
      return synced.mutate('texting/add', { ...fields, id: newId() });
    },

    removeTexter(id) {
      return synced.mutate('texting/remove', { id }, (s) => {
        s.texting = s.texting.filter((t) => t.id !== id);
        return s;
      });
    },

    restoreTexters(ids) {
      return synced.mutate('texting/restore', { ids });
    },
  };
}
