// LightsService: the ceiling lights (Zigbee switches, reached through Zigbee2MQTT on
// the Pi), the schedules that switch them, and the motion sensors paired with them,
// which can switch the board's own screen off when nobody's around. The server owns both and pushes them to
// every screen over the live connection; a tap shows up here straight away.
import { getJson, newId, postJson } from './http.js';
import { createSyncedState } from './synced-state.js';

// `configured: null` until the board has answered, so nothing says "not set up" too early.
const EMPTY = {
  version: -1,
  configured: null,
  connected: false,
  hub: null,
  lights: [],
  schedules: [],
  pairing: { open: false, until: null, kind: 'light', found: null, error: null },
  sensors: [],
  motion: [],
  screen: null,
  dark: { enabled: false, lights: [], level: 'sunset', until: '23:00', sensor: null, using: null, sunTimes: null, ranAt: null },
};
// Matches PAIR_SECONDS in board/lights.py.
const PAIR_MS = 254 * 1000;

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
    getDark: () => synced.state.dark,
    getSensors: () => synced.state.sensors,
    getMotion: () => synced.state.motion,
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

    // What every screen calls this light (or motion sensor). Zigbee2MQTT is asked to use a tidy version of it too.
    renameLight(id, name) {
      const tidy = name.trim().replace(/\s+/g, ' ');
      return synced.mutate('rename', { id, name: tidy }, (state) => {
        const device = state.lights.find((l) => l.id === id) ?? state.motion.find((m) => m.id === id);
        if (device) device.name = tidy;
        return state;
      });
    },

    // What a motion sensor does: changes: { enabled (keeps the screen on), offAfter: minutes without motion }.
    setMotion(id, changes) {
      return synced.mutate('motion', { ...changes, id }, (state) => {
        const sensor = state.motion.find((m) => m.id === id);
        if (sensor) sensor.rule = { ...sensor.rule, ...changes };
        return state;
      });
    },

    // One of the sensor's own settings (like how long it waits to say it's clear), sent through Zigbee2MQTT.
    setMotionSetting(id, property, value) {
      return synced.mutate('motion/setting', { id, property, value }, (state) => {
        const setting = state.motion.find((m) => m.id === id)?.settings.find((s) => s.property === property);
        if (setting) setting.value = value;
        return state;
      });
    },

    // "When it gets dark": changes: { enabled, lights: [ids] (none = every light),
    //   level: 'early'|'sunset'|'late', until: 'HH:MM' ('00:00' = midnight), sensor: id or null (the sun) }.
    setDark(changes) {
      return synced.mutate('dark', changes, (state) => {
        state.dark = { ...state.dark, ...changes };
        return state;
      });
    },

    // Switches the board's screen off for a few seconds and on again. Resolves once it's back on.
    testScreen() {
      // Dark here straight away: this screen hears nothing else until the test is over.
      return synced.mutate('screen/test', {}, (state) => {
        if (state.screen) state.screen = { ...state.screen, on: false, testing: true };
        return state;
      });
    },

    // Someone tapped the dark screen.
    wakeScreen() {
      return synced.mutate('screen/wake', {}, (state) => {
        if (state.screen) state.screen.on = true;
        return state;
      });
    },

    // Lets a new switch (kind 'light') or motion sensor ('motion') join through
    // Zigbee2MQTT for a few minutes, or stops that early.
    pair(open, kind = 'light') {
      return synced.mutate('pair', { open, kind }, (state) => {
        state.pairing = {
          open,
          until: open ? Date.now() + PAIR_MS : null,
          kind: open ? kind : state.pairing.kind,
          found: open ? null : state.pairing.found,
          error: null,
        };
        return state;
      });
    },

    // fields: { time: 'HH:MM', on, lights: [ids] (none = every light), days: [0-6] (none = once),
    //          offAgain: minutes (0 = never), watchFor: hours } — the last two only for Turn off.
    addSchedule(fields) {
      const id = newId();
      const schedule = {
        time: fields.time,
        on: fields.on,
        lights: [...fields.lights],
        days: [...fields.days],
        enabled: true,
        offAgain: fields.on ? 0 : fields.offAgain ?? 0,
        watchFor: fields.watchFor ?? 8,
      };
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
