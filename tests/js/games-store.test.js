import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGamesStore, GAMES_KEY } from '../../web/js/services/games.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

const game = (kind, moves = []) => ({ kind, vsComputer: false, moves });

test('saves each game and remembers which was played last', () => {
  const storage = memoryStorage();
  const store = createGamesStore({ storage });
  store.save(game('reversi', [[2, 3]]));
  store.save(game('four-in-a-row', [3]));
  const again = createGamesStore({ storage });
  assert.deepEqual(again.get('reversi'), game('reversi', [[2, 3]]));
  assert.equal(again.getLast(), 'four-in-a-row');
  assert.equal(JSON.parse(storage.getItem(GAMES_KEY)).version, 1);
});

test('clearing a game forgets it', () => {
  const store = createGamesStore({ storage: memoryStorage() });
  store.save(game('reversi'));
  store.clear('reversi');
  assert.equal(store.get('reversi'), null);
  assert.equal(store.getLast(), null);
});

test('corrupt or unknown data starts fresh', () => {
  assert.equal(createGamesStore({ storage: memoryStorage({ [GAMES_KEY]: '{bad' }) }).getLast(), null);
  assert.equal(createGamesStore({ storage: memoryStorage({ [GAMES_KEY]: JSON.stringify({ version: 7 }) }) }).get('reversi'), null);
});

test('tells subscribers, and works without storage', () => {
  const store = createGamesStore({ storage: null });
  const seen = [];
  const off = store.subscribe((last) => seen.push(last));
  store.save(game('dots-and-boxes'));
  off();
  store.save(game('reversi'));
  assert.deepEqual(seen, ['dots-and-boxes']);
  assert.equal(store.getLast(), 'reversi');
});
