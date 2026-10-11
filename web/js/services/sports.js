// SportsService: the teams and competitions the board follows, with their
// fixtures, scores and tables. The server reads ESPN (and the Big Ten's site) on
// its own schedule and pushes the result over the live connection (the `sports`
// stream); screens never talk to ESPN themselves. A match page is asked for
// when one is opened, and comes from the Pi's copy too.
import { getJson } from './http.js';
import { createSyncedState } from './synced-state.js';

const EMPTY = { version: -1, follows: [], matches: [], tables: {}, error: null };

export function createSportsService({ live }) {
  const state = createSyncedState({
    initial: EMPTY,
    // Nothing on a screen changes what the board follows.
    send: () => Promise.reject(new Error('Sports is read-only.')),
    fetchState: () => getJson('/api/sports'),
  });
  live.on('sports', state.receive);

  return {
    getState: () => state.state,

    subscribe(fn) {
      const stop = state.subscribe(fn);
      fn(state.state);
      return stop;
    },

    refresh: state.refresh,

    // A match's page: line-ups, what's happened and the team stats.
    match: (id) => getJson(`/api/sports/match?id=${encodeURIComponent(id)}`),
  };
}
