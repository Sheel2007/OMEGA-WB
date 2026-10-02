// State shared with the board server. Changes show up on this screen straight
// away (optimistic), then the server's answer and live broadcasts take over.

export function createSyncedState({ initial, send, fetchState }) {
  let state = initial;
  let latest = null;
  let pending = 0;
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn(state));

  // Server states are held back while our own changes are in flight, so a
  // slightly older broadcast can't undo what the user just tapped.
  function receive(next) {
    if (!latest || next.version >= latest.version) latest = next;
    if (pending === 0 && latest !== state) {
      state = latest;
      emit();
    }
  }

  async function refresh() {
    try {
      receive(await fetchState());
    } catch {
      // The live connection reports being offline; the next broadcast catches us up.
    }
  }

  async function mutate(path, body, optimistic) {
    pending++;
    if (optimistic) {
      state = optimistic(structuredClone(state));
      emit();
    }
    try {
      const data = await send(path, body);
      pending--;
      if (data?.state) receive(data.state);
      else if (pending === 0 && latest) receive(latest);
      return data;
    } catch (err) {
      pending--;
      if (latest) {
        // Force a re-render from the last real state, undoing the optimistic change.
        latest = { ...latest };
        receive(latest);
      }
      refresh();
      throw err;
    }
  }

  return {
    get state() {
      return state;
    },
    receive,
    refresh,
    mutate,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
