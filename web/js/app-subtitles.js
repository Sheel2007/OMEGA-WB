// What each app's icon says under its name, on the phone's home screen and in the
// board's app library: enough to know whether it's worth opening.
import { dayKey, mergeEvents, nextLabel } from './apps/calendar/agenda.js';
import { summaryLabel as grocerySummary } from './apps/grocery/format.js';
import { statusLabel as lightsStatus } from './apps/lights/format.js';
import { countLabel as notesCount } from './apps/notes/format.js';
import { leaderLabel } from './apps/roommate-games/format.js';

// Each returns a subscribe(fn) that reports the line, and stops when the handle is called.
// Services only report changes, so the ones that can say how things are now do that first.
const SUBTITLES = {
  notes: ({ notes }) => (set) => {
    set(notesCount(notes.getNotes().length));
    return notes.subscribe((state) => set(notesCount(state.notes.length)));
  },

  calendar: ({ calendar }) => (set) =>
    calendar.subscribe(({ events, sources }) =>
      set(nextLabel(mergeEvents({ events, feed: sources.events }), dayKey(new Date()))),
    ),

  lights: ({ lights }) => (set) => {
    set(lightsStatus(lights.getState()));
    return lights.subscribe((state) => set(lightsStatus(state)));
  },

  'roommate-games': ({ roommateGames }) => (set) => {
    const line = (state) => set(leaderLabel(state.players) || 'Sign up to play');
    line(roommateGames.getState());
    return roommateGames.subscribe(line);
  },

  grocery: ({ grocery }) => (set) => {
    const line = (state) => set(grocerySummary(state.items, state.currency));
    line(grocery.getState());
    return grocery.subscribe(line);
  },

  games: () => (set) => {
    set('Pick a game');
    return () => {};
  },
};

// Keeps `set` told of the app's line; returns the function that stops it. Apps
// without a live line get their description, once.
export function watchSubtitle(app, services, set) {
  const watch = SUBTITLES[app.id]?.(services);
  if (watch) return watch(set) ?? (() => {});
  set(app.description);
  return () => {};
}
