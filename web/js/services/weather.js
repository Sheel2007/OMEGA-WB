// WeatherService: the forecast from the board server (which caches Open-Meteo).
// Polls only while something is subscribed.
import { getJson } from './http.js';

const REFRESH_MS = 10 * 60 * 1000;

export function createWeatherService() {
  const listeners = new Set();
  let snapshot = { forecast: null, error: null, loading: true };
  let timer = null;

  async function load() {
    try {
      snapshot = { forecast: await getJson('/api/weather'), error: null, loading: false };
    } catch (err) {
      // Keep the last forecast on screen; say why it's old.
      snapshot = { forecast: snapshot.forecast, error: err.message, loading: false };
    }
    listeners.forEach((fn) => fn(snapshot));
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot);
      if (listeners.size === 1) {
        load();
        timer = setInterval(load, REFRESH_MS);
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}
