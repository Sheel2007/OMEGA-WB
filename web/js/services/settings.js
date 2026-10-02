// SettingsService: this screen's own choices (theme, which widgets are shown),
// kept in localStorage. Each phone and the board can set these differently.
import { THEME_MODES } from '../sky.js';

export const STORAGE_KEY = 'widget-board:settings';
const SCHEMA_VERSION = 1;

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createSettingsService({ storage = browserStorage(), widgetIds, defaultWidgets }) {
  const defaults = () => ({ theme: 'auto', widgets: defaultWidgets.filter((id) => widgetIds.includes(id)) });
  const listeners = new Set();
  let current = load();

  function validWidgets(list) {
    if (!Array.isArray(list)) return null;
    return list.filter((id, i) => widgetIds.includes(id) && list.indexOf(id) === i);
  }

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved?.version !== SCHEMA_VERSION) return defaults();
      return {
        theme: THEME_MODES.includes(saved.theme) ? saved.theme : 'auto',
        widgets: validWidgets(saved.widgets) ?? defaults().widgets,
      };
    } catch {
      return defaults();
    }
  }

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...current }));
    } catch {
      // Private browsing or a full disk: keep the change for this visit only.
    }
  }

  function update(next) {
    if (next.theme === current.theme && next.widgets.join() === current.widgets.join()) return;
    current = next;
    save();
    const snapshot = get();
    listeners.forEach((fn) => fn(snapshot));
  }

  function get() {
    return { theme: current.theme, widgets: [...current.widgets] };
  }

  return {
    get,
    getTheme: () => current.theme,
    getWidgets: () => [...current.widgets],
    setTheme(theme) {
      if (THEME_MODES.includes(theme)) update({ ...current, theme });
    },
    addWidget(id) {
      if (widgetIds.includes(id) && !current.widgets.includes(id)) update({ ...current, widgets: [...current.widgets, id] });
    },
    removeWidget(id) {
      update({ ...current, widgets: current.widgets.filter((w) => w !== id) });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
