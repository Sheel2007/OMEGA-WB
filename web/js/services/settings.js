// SettingsService: this screen's own choices (theme, where each widget is on the
// home pages and how big it is, moving scenery, and who's
// using a phone's grocery scanner), kept in localStorage. Each phone and the board can set these differently.
//
// Pages are lists of placements { id, size, col, row } (see widget-layout.js).
// The Apple theme has its own grid, so it keeps its own arrangement of the same
// widgets in `applePages`: trying it out and switching back leaves the board's
// pages exactly as they were. Adding or removing a widget changes both; moving or
// resizing one only changes the layout on screen.
import { THEME_MODES } from '../sky.js';
import {
  addWidget,
  findWidget,
  fromOrder,
  LAYOUTS,
  layoutFor,
  normalize,
  placeWidget,
  removeWidget,
  resizeWidget,
  widgetOrder,
} from '../widget-layout.js';

export const STORAGE_KEY = 'widget-board:settings';
const SCHEMA_VERSION = 9;
// Version 1 kept one flat list of widgets and called the Blocks theme "retro";
// version 2 added pages; version 3 picks up widgets the board has gained since;
// versions 4, 5 and 6 pick up the ones named in `widgetsSince` (Lights, the
// Roommate Cup, then Grocery) and nothing else. Up to 6 a page was a list of ids
// laid out in order; version 7 gives each widget its own place and size, so older
// pages are laid out once, in their order, at each widget's default size. From
// version 7 on, a widget named in `widgetsSince` (Spotify in 8, Sports in 9) goes
// in the first free spot that fits it, leaving everything else where it was.
const UPGRADABLE = [1, 2, 3, 4, 5, 6, 7, 8];
const FIRST_PLACED_VERSION = 7;
const MAX_ASKER_LENGTH = 30;
const RENAMED_THEMES = { retro: 'blocks' };

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// widgets: { [id]: { size, sizes } }, each widget's default size and the sizes it
// can be (from its meta.js).
export function createSettingsService({ storage = browserStorage(), widgets, defaultWidgets, widgetsSince = {} }) {
  const known = (id) => Object.hasOwn(widgets, id);
  const specOf = (id) => (known(id) ? widgets[id] : null);
  const defaultSize = (id) => widgets[id].size;
  const listeners = new Set();
  // Where each layout's pages live in the saved settings.
  const FIELD = { board: 'pages', apple: 'applePages' };

  const defaults = () => ({
    theme: 'auto',
    pages: fromOrder([defaultWidgets.filter(known)], defaultSize, LAYOUTS.board),
    applePages: null,
    scenery: true,
    asker: null,
  });

  // Version 6 and older: drops anything unknown, malformed or repeated (across all
  // pages), keeping the order it was saved in. Laying it out comes after, so an
  // upgrade can slot a new widget in first.
  function cleanPages(raw) {
    if (!Array.isArray(raw)) return null;
    const seen = new Set();
    return raw
      .filter(Array.isArray)
      .map((ids) => ids.filter((id) => typeof id === 'string' && known(id) && !seen.has(id) && seen.add(id)));
  }

  const sameWidgets = (a, b) => JSON.stringify(widgetOrder(a).sort()) === JSON.stringify(widgetOrder(b).sort());

  // The pages for `theme`'s layout. A layout this screen hasn't used yet starts as
  // the board's pages laid out in order on its grid, each widget the size it is there.
  function pagesFor(state, theme) {
    const grid = layoutFor(theme);
    const saved = state[FIELD[grid.id]];
    if (saved) return saved;
    const sizeOnBoard = (id) => findWidget(state.pages, id)?.size ?? defaultSize(id);
    return fromOrder(state.pages.map((items) => items.map((item) => item.id)), sizeOnBoard, grid);
  }

  function validAsker(name) {
    if (typeof name !== 'string') return null;
    const clean = name.trim().replace(/\s+/g, ' ');
    return clean && clean.length <= MAX_ASKER_LENGTH ? clean : null;
  }

  function validTheme(theme) {
    const name = RENAMED_THEMES[theme] ?? theme;
    return THEME_MODES.includes(name) ? name : 'auto';
  }

  // Widgets the board has gained since this screen last saved its pages at `version`.
  // Before version 3 that's any default widget it lacks; from then on only those that
  // arrived later (`widgetsSince`), so one taken off the board isn't put back. Each
  // goes in where `defaultWidgets` puts it — after the last widget that comes before
  // it and is already on the board — so an existing board picks up a new widget
  // instead of quietly never showing it.
  function withNewWidgets(pages, version) {
    const next = pages.map((ids) => [...ids]);
    const present = new Set(next.flat());
    const isNew = (id) => version < 3 || (widgetsSince[id] ?? 0) > version;
    for (const [index, id] of defaultWidgets.entries()) {
      if (!known(id) || present.has(id) || !isNew(id)) continue;
      const after = defaultWidgets.slice(0, index).reverse().find((other) => present.has(other));
      const page = after ? next.findIndex((ids) => ids.includes(after)) : 0;
      next[page].splice(after ? next[page].indexOf(after) + 1 : 0, 0, id);
      present.add(id);
    }
    return next;
  }

  // The same for screens saved with places (version 7 on): each new widget goes in
  // the first free spot that fits it, on the first page with room.
  function withNewPlacements(pages, layout, version) {
    let next = pages;
    for (const id of defaultWidgets) {
      if (!known(id) || findWidget(next, id) || (widgetsSince[id] ?? 0) <= version) continue;
      next = addWidget(next, { id, size: defaultSize(id) }, layout).pages;
    }
    return next;
  }

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      const version = saved?.version;
      if (version !== SCHEMA_VERSION && !UPGRADABLE.includes(version)) return defaults();
      let pages;
      let apple = null;
      if (version >= FIRST_PLACED_VERSION) {
        pages = normalize(saved.pages, LAYOUTS.board, specOf) ?? defaults().pages;
        apple = normalize(saved.applePages, LAYOUTS.apple, specOf);
        if (version < SCHEMA_VERSION) {
          pages = withNewPlacements(pages, LAYOUTS.board, version);
          apple = apple && withNewPlacements(apple, LAYOUTS.apple, version);
        }
      } else {
        const raw = version === 1 ? [saved.widgets] : saved.pages;
        pages = fromOrder(withNewWidgets(cleanPages(raw) ?? [defaultWidgets.filter(known)], version), defaultSize, LAYOUTS.board);
      }
      return {
        theme: validTheme(saved.theme),
        pages,
        // Thrown away (and worked out again) if it's lost track of which widgets are on.
        applePages: apple && sameWidgets(apple, pages) ? apple : null,
        scenery: typeof saved.scenery === 'boolean' ? saved.scenery : true,
        asker: validAsker(saved.asker),
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

  const active = () => pagesFor(current, current.theme);

  function get() {
    const pages = active();
    return {
      theme: current.theme,
      pages: pages.map((items) => items.map((item) => ({ ...item }))),
      widgets: widgetOrder(pages),
      scenery: current.scenery,
      asker: current.asker,
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

  const pageOf = (id) => findWidget(active(), id)?.page ?? -1;
  const onScreen = () => layoutFor(current.theme);
  const setActive = (pages) => update({ [FIELD[onScreen().id]]: pages });

  // `nextActive` becomes the on-screen layout's pages; `others(pages, grid)` is
  // applied to every other layout this screen has pages for.
  function updatePages(nextActive, others) {
    const changes = {};
    for (const [id, field] of Object.entries(FIELD)) {
      if (id === onScreen().id) changes[field] = nextActive;
      else if (current[field]) changes[field] = others(current[field], LAYOUTS[id]);
    }
    update(changes);
  }

  // Other layouts get a new widget in their first free spot, at its default size.
  const addElsewhere = (id) => (pages, grid) => addWidget(pages, { id, size: defaultSize(id) }, grid).pages;

  return {
    get,
    getTheme: () => current.theme,
    getPages: () => get().pages,
    getWidgets: () => widgetOrder(active()),
    // The grid the home screen is laid out on for the current theme.
    getLayout: () => layoutFor(current.theme),
    getScenery: () => current.scenery,
    // Who adds things to the grocery list from this screen, or null to ask each time.
    getAsker: () => current.asker,

    setTheme(theme) {
      if (!THEME_MODES.includes(theme)) return;
      const field = FIELD[layoutFor(theme).id];
      // Keep the layout we're leaving, and start the new one if it's the first time.
      update({ theme, [field]: pagesFor(current, theme) });
    },

    setScenery(on) {
      update({ scenery: Boolean(on) });
    },

    setAsker(name) {
      update({ asker: validAsker(name) });
    },

    // Goes in the first free spot on `page` if given (or a later page if it's full);
    // otherwise on the first page with room (or a new page at the end). Returns the
    // page it ended up on, or null if it couldn't be added.
    addWidget(id, { page } = {}) {
      if (!known(id) || pageOf(id) !== -1) return null;
      const added = addWidget(active(), { id, size: defaultSize(id) }, onScreen(), { page });
      updatePages(added.pages, addElsewhere(id));
      return pageOf(id);
    },

    // Returns where it was ({ page, col, row, size }), for Undo.
    removeWidget(id) {
      const { pages, from } = removeWidget(active(), id);
      if (from) updatePages(normalize(pages, onScreen(), specOf), (other) => removeWidget(other, id).pages);
      return from;
    },

    restoreWidget(id, from) {
      if (!known(id) || pageOf(id) !== -1 || !from) return;
      const size = specOf(id).sizes.includes(from.size) ? from.size : defaultSize(id);
      updatePages(placeWidget(active(), { id, size }, from, onScreen()), addElsewhere(id));
    },

    // Puts a widget at { page, col, row }, pushing aside whatever is there.
    moveWidget(id, target) {
      const found = findWidget(active(), id);
      if (!found) return;
      setActive(placeWidget(active(), { id, size: found.size }, target, onScreen()));
    },

    // Changes a widget's size, if it comes in that size.
    resizeWidget(id, size) {
      if (pageOf(id) === -1 || !specOf(id).sizes.includes(size)) return;
      setActive(resizeWidget(active(), id, size, onScreen()));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
