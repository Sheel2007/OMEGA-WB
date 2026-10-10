// SpotifyService: what the board's linked Spotify account is playing. The server
// asks Spotify on its own schedule and pushes the answer over the live connection
// (the `spotify` stream); screens never talk to Spotify themselves.
import { getJson, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

const EMPTY = { version: -1, configured: false, linked: false, account: null, track: null, error: null };

export function createSpotifyService({ live }) {
  const state = createSyncedState({
    initial: EMPTY,
    send: (action, body) => postJson(`/api/spotify/${action}`, body),
    fetchState: () => getJson('/api/spotify'),
  });
  live.on('spotify', state.receive);

  return {
    getState: () => state.state,

    subscribe(fn) {
      const stop = state.subscribe(fn);
      fn(state.state);
      return stop;
    },

    // Only from the board's own screen: resolves to { url } to send the browser to.
    // `back` is the page Spotify's sign-in returns to afterwards.
    link: (back) => postJson('/api/spotify/link', { back }),
    unlink: () => state.mutate('unlink', {}),
  };
}
