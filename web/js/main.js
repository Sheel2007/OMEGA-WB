// Starts the board: services, wallpaper, clock, widgets, apps and the menu.
import { createAppHost } from './app-host.js';
import { APPS, DEFAULT_WIDGETS } from './apps/index.js';
import { createHomeEditor } from './home-editor.js';
import { createWidgetHost } from './home.js';
import { createPager } from './pager.js';
import { initKiosk } from './kiosk.js';
import { createBoardMenu } from './menu.js';
import { exitKiosk, fetchInfo } from './services/board.js';
import { createCalendarService } from './services/calendar.js';
import { createGamesStore } from './services/games.js';
import { createLiveConnection } from './services/live.js';
import { createNotesService } from './services/notes.js';
import { createSettingsService } from './services/settings.js';
import { createShoppingService } from './services/shopping.js';
import { createWeatherService } from './services/weather.js';
import { createBlocksScene } from './scene/blocks-scene.js';
import { dayPhase, guessLocation, parseTimeOverride, startSky } from './sky.js';
import { appIcon, el, icons, reducedMotion, toast } from './ui.js';

// In kiosk mode, an app left open goes back to the home screen after this long.
const IDLE_RETURN_MS = 90 * 1000;
const CLOCK_TICK_MS = 1000;

const params = new URLSearchParams(location.search);
const kiosk = params.has('kiosk') && params.get('kiosk') !== '0';
// ?at=19:30 previews the board at another time of day.
const fixedTime = parseTimeOverride(params.get('at'));
const now = () => fixedTime ?? new Date();

// Services: the only code that talks to the server or to storage.

const live = createLiveConnection({ streams: ['shopping', 'notes', 'calendar', 'calendar-sources'], onServerRestart: () => location.reload() });
const services = {
  shopping: createShoppingService({ live }),
  notes: createNotesService({ live }),
  calendar: createCalendarService({ live }),
  weather: createWeatherService(),
  games: createGamesStore(),
  settings: createSettingsService({
    widgetSizes: Object.fromEntries(APPS.filter((app) => app.createWidget).map((app) => [app.id, app.widgetSize])),
    defaultWidgets: DEFAULT_WIDGETS,
  }),
};
const info = fetchInfo();

// Wallpaper and theme

let place = guessLocation();
// Blocks scenery (clouds and critters): exists only while the theme is Blocks.
let scene = null;
let phase = 'day';
const scenePaused = { app: false, edit: false };

const sky = startSky({
  starsEl: document.querySelector('.sky__stars'),
  getLocation: () => place,
  getTime: now,
  mode: services.settings.getTheme(),
  onPaint: (sun) => {
    phase = dayPhase(sun);
  },
});
info.then((details) => {
  if (details?.location) {
    place = details.location;
    sky.repaint();
  }
});
services.settings.subscribe(({ theme }) => sky.setMode(theme));

// Clock and status bar

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const clockTime = document.querySelector('.clock__time');
const clockDate = document.querySelector('.clock__date');
const statusTime = document.querySelector('.statusbar__time');

// Lock-screen style: just the hour and minutes, no AM/PM.
function shortTime(date) {
  const parts = timeFormat.formatToParts(date);
  const from = parts.findIndex((p) => p.type === 'hour');
  const to = parts.findIndex((p) => p.type === 'minute');
  return parts.slice(from, to + 1).map((p) => p.value).join('');
}

function tick() {
  const date = now();
  const time = shortTime(date);
  if (clockTime.textContent !== time) {
    clockTime.textContent = time;
    statusTime.textContent = time;
    clockTime.setAttribute('datetime', date.toISOString());
    clockDate.textContent = dateFormat.format(date);
  }
}
tick();
setInterval(tick, CLOCK_TICK_MS);

const sync = document.querySelector('.sync');
function showStatus(status) {
  const offline = status === 'offline';
  sync.classList.toggle('sync--offline', offline);
  sync.innerHTML = offline ? `${icons.wifiOff}<span class="sync__label">Offline — changes won’t save</span>` : icons.wifi;
  sync.setAttribute('aria-label', offline ? 'Offline' : 'Connected');
}
showStatus('live');
live.onStatus(showStatus);

// Apps, dock and widgets

const context = { services, kiosk, info };
const dock = document.querySelector('.dock');
const appHost = createAppHost({
  layer: document.querySelector('.app-shell'),
  dock,
  apps: APPS,
  context,
  onChange: (appId) => {
    scenePaused.app = Boolean(appId);
    scene?.setPaused('app', scenePaused.app);
  },
});
context.openApp = appHost.openApp;

for (const app of APPS.filter((a) => a.mount)) {
  dock.append(
    el(
      'button',
      {
        class: 'dock__app',
        type: 'button',
        'aria-label': app.name,
        dataset: { app: app.id },
        onclick: (event) => {
          editor.exit();
          appHost.openApp(app.id, { origin: event.currentTarget });
        },
      },
      appIcon(app),
    ),
  );
}

const home = document.querySelector('.home');
const track = home.querySelector('.pager__track');
// Long-press a widget to edit the home screen; while editing, a short hold picks it up.
const EDIT_HOLD_MS = 150;
const pager = createPager({
  home,
  viewport: home.querySelector('.pager'),
  track,
  dots: home.querySelector('.page-dots'),
  onLongPress: (press) => editor.startDrag(press),
  onTap: (event) => event.target.closest('.widget') || editor.exit(),
  holdMs: () => (editor.editing ? EDIT_HOLD_MS : undefined),
  ignore: (event) => Boolean(event.target.closest('.widget__edit')),
});
const widgets = createWidgetHost({ track, apps: APPS, context, pager });
widgets.render(services.settings.getPages());

function addWidget(id) {
  const app = APPS.find((a) => a.id === id);
  // While editing, new widgets go on the page you're looking at.
  const page = services.settings.addWidget(id, editor.editing ? { page: pager.current } : {});
  if (page == null) return;
  pager.goTo(page);
  if (page > 0) toast(`${app.name} added to page ${page + 1}`);
}

function removeWidget(id) {
  const app = APPS.find((a) => a.id === id);
  const from = services.settings.removeWidget(id);
  if (!from) return;
  toast(`Removed ${app.name}`, { action: 'Undo', onAction: () => services.settings.restoreWidget(id, from) });
}

// Menu

async function exitToDesktop() {
  try {
    const closing = await exitKiosk();
    toast(closing ? 'Closing the board. Open “Widget Board” from the Pi’s menu to come back.' : 'This screen isn’t the kiosk, so there’s nothing to close.');
  } catch (err) {
    toast(err.message);
  }
}

const editor = createHomeEditor({
  home,
  pager,
  host: widgets,
  settings: services.settings,
  apps: APPS,
  onRemoveWidget: removeWidget,
  onAddWidgetRequest: () => menu.open('widgets'),
  onChange: (editing) => {
    scenePaused.edit = editing;
    scene?.setPaused('edit', editing);
  },
});
services.settings.subscribe((settings) => {
  widgets.render(settings.pages);
  editor.refresh();
});

const menu = createBoardMenu({
  settings: services.settings,
  apps: APPS.filter((app) => app.createWidget),
  kiosk,
  onExit: exitToDesktop,
  onAddWidget: addWidget,
  onRemoveWidget: removeWidget,
  onEditHome: () => editor.enter(),
});
document.querySelector('.statusbar__end').append(menu.node);

// Scenery

const compact = matchMedia('(max-width: 900px), (max-height: 560px)');
const sceneEl = home.querySelector('.home__scene');

function syncScene({ theme, scenery }) {
  if (theme === 'blocks' && !scene) {
    scene = createBlocksScene({
      skyEl: document.querySelector('.sky'),
      sceneEl,
      params,
      getPhase: () => phase,
      // Critters don't stop to linger where the dock would hide them.
      getAvoid: () => {
        const stage = sceneEl.getBoundingClientRect();
        const box = dock.getBoundingClientRect();
        return [{ left: box.left - stage.left, right: box.right - stage.left }];
      },
    });
    scene.setPaused('app', scenePaused.app);
    scene.setPaused('edit', scenePaused.edit);
    scene.setPaused('motion', reducedMotion.matches);
    scene.setPaused('compact', compact.matches);
  } else if (theme !== 'blocks' && scene) {
    scene.destroy();
    scene = null;
  }
  scene?.setPaused('setting', !scenery);
}

syncScene(services.settings.get());
services.settings.subscribe(syncScene);
reducedMotion.addEventListener('change', () => scene?.setPaused('motion', reducedMotion.matches));
compact.addEventListener('change', () => scene?.setPaused('compact', compact.matches));

appHost.start();
live.start();
services.shopping.refresh();
services.notes.refresh();
services.calendar.refresh();

if (kiosk) {
  initKiosk({
    idleMs: IDLE_RETURN_MS,
    onIdle: () => {
      menu.close();
      editor.exit();
      appHost.goHome();
      pager.goTo(0);
    },
  });
}
