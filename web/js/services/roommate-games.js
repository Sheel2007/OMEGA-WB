// RoommateGamesService: the weekly Roommate Cup. The roommates who signed up, the
// catalog of games, the weekly schedule and every game night live on the Pi in
// data/roommate-games.json; the server works out the points and pushes everything
// to every screen. Email addresses and phone numbers only ever arrive masked.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// Version -1 until the board has answered (see isReady), so nothing says "no
// roommates" too early.
const EMPTY = {
  version: -1,
  players: [],
  names: {},
  games: [],
  schedule: { on: true, day: 5, time: '19:00', announce: '10:00', perNight: 1 },
  weeks: [],
  ledger: {},
  channels: { email: false, sms: false },
  sending: false,
  bonus: 1,
};

export const isReady = (state) => state.version >= 0;

export function createRoommateGamesService({ live }) {
  const synced = createSyncedState({
    initial: EMPTY,
    send: (action, body) => postJson(`/api/roommate-games/${action}`, body),
    fetchState: () => getJson('/api/roommate-games'),
  });
  live.on('roommate-games', synced.receive);

  return {
    getState: () => synced.state,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    // Signing up: a name, an email and a phone number. No passwords.
    addPlayer({ name, email, phone }) {
      return synced.mutate('players/add', { id: newId(), name, email, phone });
    },

    // Only the fields given change; an empty email or phone clears it.
    updatePlayer(id, changes) {
      return synced.mutate('players/update', { id, ...changes });
    },

    removePlayer(id) {
      return synced.mutate('players/remove', { id }, (state) => {
        state.players = state.players.filter((player) => player.id !== id);
        return state;
      });
    },

    restorePlayers(ids) {
      return synced.mutate('players/restore', { ids });
    },

    // kind is 'general' or 'specialized'; a specialized game names its specialist.
    addGame({ name, kind, specialist }) {
      return synced.mutate('games/add', { id: newId(), name, kind, specialist });
    },

    updateGame(id, changes) {
      return synced.mutate('games/update', { id, ...changes });
    },

    removeGame(id) {
      return synced.mutate('games/remove', { id }, (state) => {
        state.games = state.games.filter((game) => game.id !== id);
        return state;
      });
    },

    restoreGames(ids) {
      return synced.mutate('games/restore', { ids });
    },

    setSchedule(changes) {
      return synced.mutate('schedule', changes, (state) => {
        state.schedule = { ...state.schedule, ...changes };
        return state;
      });
    },

    // Picks the next game night's games; `again` redraws the ones without a result.
    draw({ again = false } = {}) {
      return synced.mutate('draw', { again });
    },

    // order: places in finishing order, each a list of the roommates tied there.
    // null takes the result away.
    record(week, pick, order) {
      return synced.mutate('record', { week, pick, order });
    },

    notify(week) {
      return synced.mutate('notify', { week });
    },
  };
}
