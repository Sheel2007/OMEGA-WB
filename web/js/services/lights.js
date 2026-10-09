// LightsService: the ceiling lights (Zigbee switches, reached through Zigbee2MQTT on
// the Pi) and the schedules that switch them. The server owns both and pushes them to
// every screen over the live connection; a tap shows up here straight away.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// `configured: null` until the board has answered, so nothing says "not set up" too early.
const EMPTY = { version: -1, configured: null, connected: false, hub: null, lights: [], schedules: [] };

const byTime = (a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id);

export function createLightsService({ live }) {
  const synced = createSyncedState({
    initial: EMPTY,
    send: (action, body) => postJson(`/api/lights/${action}`, body),
    fetchState: () => getJson('/api/lights'),
  });
  live.on('lights', synced.receive);

  const findLight = (id) => synced.state.lights.find((light) => light.id === id);

  function setLight(id, on) {
    return synced.mutate('set', { id, on }, (state) => {
      const light = state.lights.find((l) => l.id === id);
      if (light) light.on = on;
      return state;
    });
  }

  return {
    getState: () => synced.state,
    getLights: () => synced.state.lights,
    getSchedules: () => synced.state.schedules,
    subscribe: synced.subscribe,
    refresh: synced.refresh,

    setLight,

    // One tap: whatever the light is doing now (as this screen shows it), the opposite.
    toggleLight(id) {
      const light = findLight(id);
      return setLight(id, !light?.on);
    },

    // For a switch that was paired or wired the other way round: what it reported as
    // On is now Off, so the light's state flips on screen without anything switching.
    setSwapped(id, swapped) {
      return synced.mutate('swap', { id, swapped }, (state) => {
        const light = state.lights.find((l) => l.id === id);
        if (light && light.swapped !== swapped) {
          light.swapped = swapped;
          if (light.on !== null) light.on = !light.on;
        }
        return state;
      });
    },

    // fields: { time: 'HH:MM', on, lights: [ids] (none = every light), days: [0-6] (none = once) }
    addSchedule(fields) {
      const id = newId();
      const schedule = { time: fields.time, on: fields.on, lights: [...fields.lights], days: [...fields.days], enabled: true };
      return synced.mutate('schedules/add', { ...schedule, id }, (state) => {
        state.schedules = [...state.schedules, { ...schedule, id }].sort(byTime);
        return state;
      });
    },

    updateSchedule(id, changes) {
      return synced.mutate('schedules/update', { ...changes, id }, (state) => {
        state.schedules = state.schedules.map((s) => (s.id === id ? { ...s, ...changes } : s)).sort(byTime);
        return state;
      });
    },

    removeSchedule(id) {
      return synced.mutate('schedules/remove', { id }, (state) => {
        state.schedules = state.schedules.filter((s) => s.id !== id);
        return state;
      });
    },

    restoreSchedules(ids) {
      return synced.mutate('schedules/restore', { ids });
    },
  };
}
