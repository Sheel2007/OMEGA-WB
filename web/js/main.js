// Starts the board: services, wallpaper, clock, widgets, apps and the menu.
import { createAppHost } from './app-host.js';
import { createAppLibrary } from './app-library.js';
import { blockDigitsFont, FONT_FAMILY as BLOCK_DIGITS, UNICODE_RANGE as BLOCK_DIGITS_RANGE } from './block-font.js';
import { blockClockMarkup } from './block-text.js';
import { backdropCss, wallpaperCss } from './apple-wallpaper.js';
import { APPS, DEFAULT_WIDGETS, WIDGETS_SINCE } from './apps/index.js';
import { createGlass } from './glass.js';
import { createHomeEditor } from './home-editor.js';
import { createWidgetHost } from './home.js';
import { createPager } from './pager.js';
import { createPhoneHome } from './phone-home.js';
import { createScreenGuard } from './screen-guard.js';
import { initKiosk } from './kiosk.js';
import { createBoardMenu } from './menu.js';
import { exitKiosk, fetchInfo } from './services/board.js';
import { createCalendarService } from './services/calendar.js';
import { createGamesStore } from './services/games.js';
import { createGroceryService } from './services/grocery.js';
import { createLightsService } from './services/lights.js';
import { createLiveConnection } from './services/live.js';
import { createNotesService } from './services/notes.js';
import { createRoommateGamesService } from './services/roommate-games.js';
import { createSettingsService } from './services/settings.js';
import { createSpotifyService } from './services/spotify.js';
import { createSportsService } from './services/sports.js';
import { createGameDay } from './apps/sports/game-day.js';
import { dotGlyph as sportsDot, name as sportsName } from './apps/sports/meta.js';
import { createSportsPage } from './apps/sports/page.js';
import { createSidePage } from './side-page.js';
import { createWeatherService } from './services/weather.js';
import { createBlocksScene } from './scene/blocks-scene.js';
import { precipitation } from './apps/weather/conditions.js';
import { fallFor, parseWeather } from './scene/fall.js';
import { sceneryVars } from './scene/scenery-art.js';
import { parseSeason, seasonAt } from './scene/seasons.js';
import { dayPhase, guessLocation, parseTimeOverride, startSky } from './sky.js';
import { icons, reducedMotion, toast } from './ui.js';

// In kiosk mode, an app left open goes back to the home screen after this long.
const IDLE_RETURN_MS = 90 * 1000;
const CLOCK_TICK_MS = 1000;

// A phone (or any screen too small for the 12 x 4 grid) gets the compact layout.
// Turning a phone sideways only swaps which side is the short one, so this never
// changes after startup and the home screen can be chosen once.
const compact = matchMedia('(max-width: 900px), (max-height: 560px)');

const params = new URLSearchParams(location.search);
const kiosk = params.has('kiosk') && params.get('kiosk') !== '0';
// ?glass=live gives the Apple theme real backdrop-filter blur instead of its
// pre-made copy of the wallpaper, to compare the two on the Pi itself.
if (params.get('glass') === 'live') document.documentElement.dataset.glass = 'live';
// ?at=19:30 previews the board at another time of day.
const fixedTime = parseTimeOverride(params.get('at'));
const now = () => fixedTime ?? new Date();

// The Blocks theme's digits (block-font.js), built here rather than downloaded.
// Its fonts list this first, for 0-9 only; if it can't load, the pixel font's
// own digits show instead.
try {
  const digits = new FontFace(BLOCK_DIGITS, blockDigitsFont(), { unicodeRange: BLOCK_DIGITS_RANGE, weight: '100 900' });
  document.fonts.add(digits);
  digits.load().catch(() => document.fonts.delete(digits));
} catch {
  // A browser without FontFace keeps the pixel font's digits.
}

// Services: the only code that talks to the server or to storage.

const live = createLiveConnection({
  streams: ['notes', 'calendar', 'calendar-sources', 'lights', 'roommate-games', 'grocery', 'spotify', 'sports'],
  onServerRestart: () => location.reload(),
});
const services = {
  notes: createNotesService({ live }),
  calendar: createCalendarService({ live }),
  lights: createLightsService({ live }),
  roommateGames: createRoommateGamesService({ live }),
  grocery: createGroceryService({ live }),
  spotify: createSpotifyService({ live }),
  sports: createSportsService({ live }),
  weather: createWeatherService(),
  games: createGamesStore(),
  settings: createSettingsService({
    widgets: Object.fromEntries(
      APPS.filter((app) => app.createWidget).map((app) => [app.id, { size: app.widgetSize, sizes: app.widgetSizes }]),
    ),
    defaultWidgets: DEFAULT_WIDGETS,
    widgetsSince: WIDGETS_SINCE,
  }),
};
const info = fetchInfo();

// Wallpaper and theme

// The Apple wallpaper and the copy of it its glass cards show (apple-wallpaper.js).
// Fixed, so they're set once; only the Apple theme's CSS uses them.
document.documentElement.style.setProperty('--apple-wallpaper', wallpaperCss());
document.documentElement.style.setProperty('--apple-backdrop', backdropCss());

let place = guessLocation();
// Blocks scenery (clouds and critters): exists only while the theme is Blocks.
let scene = null;
let phase = 'day';
const scenePaused = { app: false, edit: false, library: false, side: false, screen: false };

// The Blocks land is dressed for the real season (?season=winter previews
// another), and drawn darker at night. Declared before startSky(), whose first
// paint calls dressLand().
const fixedSeason = parseSeason(params.get('season'));
let season = null;
let landDressedFor = null;

// What falls past it: rain or snow while it really is raining or snowing at home
// (from the forecast, only fetched while the Blocks scene is up), otherwise the
// season's petals or leaves. ?weather=rain, snow or none previews it.
const fixedWeather = parseWeather(params.get('weather'));
// A forecast this old says nothing about now (the server keeps its last one when
// it can't reach Open-Meteo).
const WEATHER_STALE_MS = 60 * 60 * 1000;
let fallingNow = null;
let stopWeather = null;

// Zen mode (apps/zen) shows the moving Blocks world on its own, whatever this
// screen's theme, and can set what falls (undefined: leave it to the weather).
let zenOpen = false;
let zenFall = undefined;

function updateFall() {
  if (zenFall !== undefined) {
    scene?.setFall(zenFall);
    return;
  }
  const wet = fixedWeather ? (fixedWeather === 'none' ? null : fixedWeather) : fallingNow;
  scene?.setFall(fallFor({ season, precipitation: wet }));
}

function onWeather({ forecast }) {
  const code = forecast?.current?.code;
  const updated = Date.parse(forecast?.updated ?? '');
  const fresh = !Number.isFinite(updated) || Date.now() - updated < WEATHER_STALE_MS;
  fallingNow = fresh && Number.isInteger(code) ? precipitation(code) : null;
  updateFall();
}

function dressLand() {
  const root = document.documentElement;
  season = fixedSeason ?? seasonAt(now(), place.latitude);
  const night = root.dataset.night === 'true';
  const key = `${season} ${night}`;
  if (key === landDressedFor) return;
  landDressedFor = key;
  root.dataset.season = season;
  for (const [name, value] of Object.entries(sceneryVars(season, { night }))) root.style.setProperty(name, value);
  updateFall();
}

const sky = startSky({
  starsEl: document.querySelector('.sky__stars'),
  getLocation: () => place,
  getTime: now,
  mode: services.settings.getTheme(),
  onPaint: (sun) => {
    phase = dayPhase(sun);
    dressLand();
  },
});
info.then((details) => {
  if (details?.location) {
    place = details.location;
    sky.repaint();
  }
});

// Clock and status bar

// A 12-hour clock whatever the browser's locale would do on its own.
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const clockTime = document.querySelector('.clock__time');
const clockHM = clockTime.querySelector('.clock__hm');
const clockPeriod = clockTime.querySelector('.clock__period');
// The Blocks theme's clock, drawn in blocks; CSS shows it only on that theme.
const clockBlocks = clockTime.querySelector('.clock__blocks');
const clockDate = document.querySelector('.clock__date');
const statusTime = document.querySelector('.statusbar__time');

// The hour and minutes, and AM or PM to go beside them. Taking the parts rather
// than the whole string keeps whatever separator the locale uses between them, and
// lets the board draw the AM/PM smaller than the time itself.
function clockParts(date) {
  const parts = timeFormat.formatToParts(date);
  const from = parts.findIndex((p) => p.type === 'hour');
  const to = parts.findIndex((p) => p.type === 'minute');
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return {
    time: parts.slice(from, to + 1).map((p) => p.value).join(''),
    // Some locales write it "a.m."; the board says AM.
    period: period.replace(/\./g, '').toUpperCase(),
  };
}

function tick() {
  const date = now();
  const { time, period } = clockParts(date);
  const label = period ? `${time} ${period}` : time;
  if (statusTime.textContent !== label) {
    clockHM.textContent = time;
    clockPeriod.textContent = period;
    // Fixed markup from block-text.js's own glyphs (the time itself never goes in);
    // empty, so the text shows instead, if this locale writes the time some other way.
    clockBlocks.innerHTML = blockClockMarkup(time, period);
    statusTime.textContent = label;
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

// Apps, the app library and widgets

const context = { services, kiosk, info };
const home = document.querySelector('.home');
const appHost = createAppHost({
  layer: document.querySelector('.app-shell'),
  apps: APPS,
  context,
  onChange: (appId) => {
    const wasZen = zenOpen;
    zenOpen = appId === 'zen';
    // Zen is the one app that wants the world moving behind it.
    scenePaused.app = Boolean(appId) && !zenOpen;
    scene?.setPaused('app', scenePaused.app);
    if (zenOpen !== wasZen) {
      if (zenOpen) {
        // Whatever Zen was opened over (the app library, the Sports page, edit
        // mode) would keep the world paused underneath it.
        library?.close({ animate: false });
        sidePage?.close({ animate: false });
        editor.exit();
      } else {
        zenFall = undefined;
        sky.setSun(null);
      }
      applyLook();
      updateFall();
    }
    // An app opened from the library comes back to the home screen, not the library.
    if (!appId) library?.close({ animate: false });
  },
  // A closing app shrinks back into its widget when that's on the page in view.
  closeTo: (appId) => pager.pages()[pager.current]?.querySelector(`.widget[data-widget="${appId}"]`) ?? null,
});
context.openApp = appHost.openApp;
context.goHome = appHost.goHome;
// Zen mode's hold on the Blocks world: the sun, what falls, and calling a visitor.
context.world = {
  currentSun: () => sky.currentSun(),
  realSun: () => sky.realSun(),
  setSun: (sun) => sky.setSun(sun),
  setFall: (kind) => {
    zenFall = kind;
    updateFall();
  },
  summon: () => scene?.summon() ?? false,
  isNight: () => document.documentElement.dataset.night === 'true',
};

const track = home.querySelector('.pager__track');
// The page before page 1 (set up below, once the app library and editor exist).
let sidePage = null;
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
  ignore: (event) => Boolean(event.target.closest('.widget__edit, .widget__resize')),
  // Swiping up (scrolling down) brings up every app.
  vertical: {
    begin: (y, dy) => library?.drag.begin(y, dy) ?? false,
    move: (y, t) => library?.drag.move(y, t),
    end: () => library?.drag.end(),
  },
  // Swiping right on page 1 brings in the Sports page. Phones have the app instead.
  side: compact.matches
    ? undefined
    : {
        label: sportsName,
        glyph: sportsDot,
        begin: (x, dx) => sidePage?.drag.begin(x, dx) ?? false,
        move: (x, t) => sidePage?.drag.move(x, t),
        end: () => sidePage?.drag.end(),
        open: () => sidePage?.open(),
        close: () => sidePage?.close(),
        isOpen: () => Boolean(sidePage?.isOpen),
      },
});
const glass = createGlass({
  board: document.querySelector('.board'),
  home,
  isActive: () => document.documentElement.dataset.theme === 'apple' && document.documentElement.dataset.glass !== 'live',
});
const widgets = createWidgetHost({
  track,
  apps: APPS,
  context,
  pager,
  getLayout: () => services.settings.getLayout(),
  onRender: () => glass.refresh(),
});
// On a phone the widgets are never built: the app icons take their place, so there
// are no cards to get in the way of a scroll and nothing to arrange.
const phoneHome = compact.matches
  ? createPhoneHome({ apps: APPS, openApp: (id, options) => appHost.openApp(id, options), services })
  : null;
if (phoneHome) home.insertBefore(phoneHome.node, home.querySelector('.page-dots'));

// Every app, a swipe up from the home screen; the phone's home screen already is the apps.
const library = phoneHome
  ? null
  : createAppLibrary({
      home,
      apps: APPS,
      openApp: (id, options) => appHost.openApp(id, options),
      canOpen: () => !editor.editing && !sidePage?.isOpen,
      // The critters wait while the apps are up.
      onShow: (shown) => {
        scenePaused.library = shown;
        scene?.setPaused('library', shown);
      },
    });
if (library) home.append(...library.nodes);

// The page before page 1: Sports.
sidePage = phoneHome
  ? null
  : createSidePage({
      home,
      content: createSportsPage(context).node,
      label: sportsName,
      canOpen: () => !editor.editing && !library?.isOpen,
      onToggle: () => pager.paintDots(),
      onShow: (shown) => {
        scenePaused.side = shown;
        scene?.setPaused('side', shown);
      },
    });
if (sidePage) home.insertBefore(sidePage.node, home.querySelector('.page-dots'));

// On game days, a countdown and then the score under the clock.
document.querySelector('.clock').append(createGameDay(context).node);
if (!phoneHome) widgets.render(services.settings.getPages());

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
    if (editing) {
      library?.close();
      sidePage?.close();
    }
  },
});
services.settings.subscribe((settings) => {
  if (phoneHome) return;
  widgets.render(settings.pages);
  editor.refresh();
});

const menu = createBoardMenu({
  settings: services.settings,
  apps: APPS.filter((app) => app.createWidget),
  kiosk,
  // Arranging widgets is a board job; a phone shows the apps as icons.
  widgetsEditable: !phoneHome,
  onExit: exitToDesktop,
  onAddWidget: (id) => {
    library?.close();
    addWidget(id);
  },
  onRemoveWidget: removeWidget,
  onEditHome: () => editor.enter(),
  onZen: () => appHost.openApp('zen'),
});
document.querySelector('.statusbar__end').append(menu.node);

// Scenery

const sceneEl = home.querySelector('.home__scene');

// What this screen shows: its own theme and Moving scenery setting, except while
// Zen is open, which always shows the moving Blocks world.
function look() {
  const { theme, scenery } = services.settings.get();
  return zenOpen ? { theme: 'blocks', scenery: true } : { theme, scenery };
}

function applyLook() {
  const shown = look();
  sky.setMode(shown.theme);
  syncScene(shown);
  scene?.setPaused('compact', compact.matches && !zenOpen);
}

function syncScene({ theme, scenery }) {
  if (theme === 'blocks' && !scene) {
    scene = createBlocksScene({
      skyEl: document.querySelector('.sky'),
      sceneEl,
      params,
      getPhase: () => phase,
    });
    scene.setPaused('app', scenePaused.app);
    scene.setPaused('edit', scenePaused.edit);
    scene.setPaused('library', scenePaused.library);
    scene.setPaused('side', scenePaused.side);
    scene.setPaused('screen', scenePaused.screen);
    scene.setPaused('motion', reducedMotion.matches);
    scene.setPaused('compact', compact.matches && !zenOpen);
    updateFall();
    // Phones never show it, and ?weather= has already said what's falling.
    if (!compact.matches && !fixedWeather) stopWeather = services.weather.subscribe(onWeather);
  } else if (theme !== 'blocks' && scene) {
    stopWeather?.();
    stopWeather = null;
    fallingNow = null;
    scene.destroy();
    scene = null;
  }
  scene?.setPaused('setting', !scenery);
}

syncScene(look());
services.settings.subscribe(applyLook);
reducedMotion.addEventListener('change', () => scene?.setPaused('motion', reducedMotion.matches));
compact.addEventListener('change', () => scene?.setPaused('compact', compact.matches && !zenOpen));

appHost.start();
live.start();
services.notes.refresh();
services.calendar.refresh();
services.lights.refresh();
services.roommateGames.refresh();
services.grocery.refresh();
services.sports.refresh();

if (kiosk) {
  // A motion sensor can switch the monitor off; the scenery rests while nobody can see it.
  createScreenGuard({
    lights: services.lights,
    onDark: (dark) => {
      scenePaused.screen = dark;
      scene?.setPaused('screen', dark);
    },
  });
  initKiosk({
    idleMs: IDLE_RETURN_MS,
    onIdle: () => {
      // Zen is for sitting with; it only ends when someone leaves it.
      if (zenOpen) return;
      menu.close();
      editor.exit();
      library?.close({ animate: false });
      sidePage?.close({ animate: false });
      appHost.goHome();
      pager.goTo(0);
    },
  });
}
