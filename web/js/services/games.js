// GamesStore: games in progress on this screen, kept in localStorage so a game
// survives the board's nightly reload. Stores raw game states; each game's rules
// check them (by replaying the moves) when they're loaded.

export const GAMES_KEY = 'widget-board:games';
const SCHEMA_VERSION = 1;

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createGamesStore({ storage = browserStorage() } = {}) {
  const listeners = new Set();
  let data = load();

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(GAMES_KEY) ?? 'null');
      if (saved?.version === SCHEMA_VERSION && saved.games && typeof saved.games === 'object') {
        return { last: typeof saved.last === 'string' ? saved.last : null, games: saved.games };
      }
    } catch {
      // Unreadable: start fresh.
    }
    return { last: null, games: {} };
  }

  function persist() {
    try {
      storage?.setItem(GAMES_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...data }));
    } catch {
      // Private browsing or a full disk: keep it for this visit only.
    }
    listeners.forEach((fn) => fn(data.last));
  }

  return {
    get: (kind) => data.games[kind] ?? null,
    getLast: () => data.last,
    save(state) {
      data = { last: state.kind, games: { ...data.games, [state.kind]: state } };
      persist();
    },
    clear(kind) {
      const { [kind]: _, ...rest } = data.games;
      data = { last: data.last === kind ? null : data.last, games: rest };
      persist();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
