// JukeboxService: the hidden "play this on the board" channel.
//
// There is nothing to sign in to. The way in is the knock on the phone; this only
// carries what was asked for to the server, which plays it on the board.
import { postJson } from './http.js';

const EMPTY = { version: -1, track: null, volume: 60, player: 'idle', detail: null };

export function createJukeboxService({ live }) {
  const listeners = new Set();
  let state = EMPTY;

  live.on('jukebox', (next) => {
    state = next;
    listeners.forEach((fn) => fn(state));
  });

  const send = (action, body = {}) => postJson(`/api/jukebox/${action}`, body);

  return {
    getState: () => state,

    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },

    play: (url) => send('play', { url }),
    stop: () => send('stop'),
    setVolume: (volume) => send('volume', { volume }),

    // Only the board's own screen may say what its player is doing; everywhere
    // else the server answers 404 and this quietly gives up.
    report: (player, detail) => postJson('/api/jukebox/report', { player, detail }).catch(() => null),
  };
}
