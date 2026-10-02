// SettingsService: this screen's own choices (theme, which widgets are on which
// home page, moving scenery), kept in localStorage. Each phone and the board can
// set these differently.
import { THEME_MODES } from '../sky.js';
import { insertWidget, moveWidget, paginate, removeWidget, SPANS } from '../widget-layout.js';

export const STORAGE_KEY = 'widget-board:settings';
const SCHEMA_VERSION = 2;
// Version 1 called the Blocks theme "retro".
const RENAMED_THEMES = { retro: 'blocks' };

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createSettingsService({ storage = browserStorage(), widgetSizes, defaultWidgets }) {
  const known = (id) => Object.hasOwn(widgetSizes, id);
  const spanOf = (id) => SPANS[widgetSizes[id]];
  const layout = (pages) => paginate(pages, spanOf).pages;
  const listeners = new Set();

  const defaults = () => ({ theme: 'auto', pages: layout([defaultWidgets.filter(known)]), scenery: true });

  // Drops anything unknown, malformed or repeated (across all pages), then lays it out.
  function validPages(raw) {
    if (!Array.isArray(raw)) return null;
    const seen = new Set();
    const pages = raw
      .filter(Array.isArray)
      .map((ids) => ids.filter((id) => typeof id === 'string' && known(id) && !seen.has(id) && seen.add(id)));
    return layout(pages);
  }

  function validTheme(theme) {
    const name = RENAMED_THEMES[theme] ?? theme;
    return THEME_MODES.includes(name) ? name : 'auto';
  }

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved?.version === 1) {
        return { theme: validTheme(saved.theme), pages: validPages([saved.widgets]) ?? defaults().pages, scenery: true };
      }
      if (saved?.version !== SCHEMA_VERSION) return defaults();
      return {
        theme: validTheme(saved.theme),
        pages: validPages(saved.pages) ?? defaults().pages,
        scenery: typeof saved.scenery === 'boolean' ? saved.scenery : true,
      };
    } catch {
      return defaults();
    }
  }

  let current = load();

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...current }));
    } catch {
      // Private browsing or a full disk: keep the change for this visit only.
    }
  }

  function get() {
    return {
      theme: current.theme,
      pages: current.pages.map((ids) => [...ids]),
      widgets: current.pages.flat(),
      scenery: current.scenery,
    };
  }

  function update(changes) {
    const next = { ...current, ...changes };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    save();
    const snapshot = get();
    listeners.forEach((fn) => fn(snapshot));
  }

  const pageOf = (id) => current.pages.findIndex((ids) => ids.includes(id));

  return {
    get,
    getTheme: () => current.theme,
    getPages: () => get().pages,
    getWidgets: () => current.pages.flat(),
    getScenery: () => current.scenery,

    setTheme(theme) {
      if (THEME_MODES.includes(theme)) update({ theme });
    },

    setScenery(on) {
      update({ scenery: Boolean(on) });
    },

    // Goes on `page` if given; otherwise on the first page with room for it (or a new
    // page at the end). Returns the page it ended up on, or null if it couldn't be added.
    addWidget(id, { page } = {}) {
      if (!known(id) || pageOf(id) !== -1) return null;
      const tryPage = (p) => layout(insertWidget(current.pages, id, { page: p }));
      let pages = null;
      if (page != null) {
        pages = tryPage(page);
      } else {
        for (let p = 0; p <= current.pages.length && !pages; p++) {
          const attempt = tryPage(p);
          if (attempt[p]?.includes(id)) pages = attempt;
        }
      }
      update({ pages });
      return pageOf(id);
    },

    // Returns where it was, for Undo.
    removeWidget(id) {
      const { pages, from } = removeWidget(current.pages, id);
      if (from) update({ pages: layout(pages) });
      return from;
    },

    restoreWidget(id, from) {
      if (!known(id) || pageOf(id) !== -1) return;
      update({ pages: layout(insertWidget(current.pages, id, from)) });
    },

    moveWidget(id, target) {
      if (pageOf(id) === -1) return;
      update({ pages: layout(moveWidget(current.pages, id, target)) });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
