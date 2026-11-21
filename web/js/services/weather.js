// WeatherService: the forecast from the board server (which caches Open-Meteo).
// Asks only while something is subscribed: every ten minutes, or after a minute when
// the last try failed, so one bad answer (the server just restarted, Open-Meteo had a
// blip) doesn't leave "Offline" on the screen for ten minutes after it's fixed. The
// server itself asks Open-Meteo again two minutes after a failure.
import { getJson } from './http.js';

const REFRESH_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;

export function createWeatherService({
  fetchForecast = () => getJson('/api/weather'),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const listeners = new Set();
  let snapshot = { forecast: null, error: null, loading: true };
  let timer = null;
  // Which run of asking a load belongs to: a load still out from before everyone
  // unsubscribed mustn't start a second chain of timers.
  let run = 0;

  async function load(mine) {
    let ok = false;
    try {
      snapshot = { forecast: await fetchForecast(), error: null, loading: false };
      ok = true;
    } catch (err) {
      // Keep the last forecast on screen; say why it's old.
      snapshot = { forecast: snapshot.forecast, error: err.message, loading: false };
    }
    if (mine !== run || listeners.size === 0) return;
    listeners.forEach((fn) => fn(snapshot));
    timer = setTimer(() => load(mine), ok ? REFRESH_MS : RETRY_MS);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot);
      if (listeners.size === 1) {
        run += 1;
        load(run);
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) {
          clearTimer(timer);
          timer = null;
          run += 1;
        }
      };
    },
  };
}
