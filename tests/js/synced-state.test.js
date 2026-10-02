import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncedState } from '../../web/js/services/synced-state.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const calls = [];
  const server = { state: { version: 1, items: ['a'] }, gate: null };
  const synced = createSyncedState({
    initial: { version: -1, items: [] },
    send: (path, body) => {
      const reply = deferred();
      calls.push({ path, body, reply });
      return reply.promise;
    },
    fetchState: async () => {
      if (server.gate) await server.gate.promise;
      return server.state;
    },
  });
  return { synced, calls, server };
}

test('a change shows up straight away, then the server answer replaces it', async () => {
  const { synced, calls } = setup();
  synced.receive({ version: 1, items: ['a'] });
  const done = synced.mutate('add', { name: 'b' }, (s) => ({ ...s, items: ['b', ...s.items] }));
  assert.deepEqual(synced.state.items, ['b', 'a']);
  calls[0].reply.resolve({ state: { version: 2, items: ['B', 'a'] } });
  await done;
  assert.deepEqual(synced.state, { version: 2, items: ['B', 'a'] });
});

test('broadcasts that arrive mid-change are held back until our change lands', async () => {
  const { synced, calls } = setup();
  synced.receive({ version: 1, items: ['a'] });
  const done = synced.mutate('add', {}, (s) => ({ ...s, items: ['b', ...s.items] }));
  synced.receive({ version: 1, items: ['a'] });
  assert.deepEqual(synced.state.items, ['b', 'a'], 'stale broadcast must not undo the tap');
  calls[0].reply.resolve({ state: { version: 2, items: ['b', 'a'] } });
  await done;
  assert.equal(synced.state.version, 2);
});

test('older states never replace newer ones', () => {
  const { synced } = setup();
  synced.receive({ version: 5, items: ['new'] });
  synced.receive({ version: 4, items: ['old'] });
  assert.deepEqual(synced.state.items, ['new']);
});

test('a failed change rolls back to what the server last said and re-syncs', async () => {
  const { synced, calls, server } = setup();
  synced.receive({ version: 1, items: ['a'] });
  const done = synced.mutate('remove', {}, (s) => ({ ...s, items: [] }));
  assert.deepEqual(synced.state.items, []);
  server.state = { version: 3, items: ['a', 'z'] };
  server.gate = deferred();
  calls[0].reply.reject(new Error('Pi is off'));
  await assert.rejects(done, /Pi is off/);
  assert.deepEqual(synced.state.items, ['a']);
  server.gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(synced.state.items, ['a', 'z']);
});

test('optimistic updates work on a copy, never on the shared state object', async () => {
  const { synced, calls } = setup();
  const original = { version: 1, items: ['a'] };
  synced.receive(original);
  const done = synced.mutate('x', {}, (s) => {
    s.items.push('mutated');
    return s;
  });
  assert.deepEqual(original.items, ['a']);
  calls[0].reply.resolve({});
  await done;
});

test('subscribers hear about changes until they unsubscribe', () => {
  const { synced } = setup();
  const seen = [];
  const off = synced.subscribe((s) => seen.push(s.version));
  synced.receive({ version: 1, items: [] });
  off();
  synced.receive({ version: 2, items: [] });
  assert.deepEqual(seen, [1]);
});
