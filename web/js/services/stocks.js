// StocksService: the AI Index and the companies in it. The server reads the prices
// on its own schedule and pushes them over the live connection (the `stocks`
// stream); screens never ask a market data service themselves.
import { getJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// Until the server answers: on, with nothing read yet (the widget says "Loading").
const EMPTY = { version: -1, enabled: true, name: 'AI Index', market: null, index: null, series: null, constituents: [], as_of: null, error: null };

export function createStocksService({ live }) {
  const state = createSyncedState({
    initial: EMPTY,
    // Display only: there's nothing to change, so nothing is ever sent.
    send: () => Promise.reject(new Error('The stocks are read-only.')),
    fetchState: () => getJson('/api/stocks'),
  });
  live.on('stocks', state.receive);

  return {
    getState: () => state.state,

    subscribe(fn) {
      const stop = state.subscribe(fn);
      fn(state.state);
      return stop;
    },
  };
}
