// Starts the board: services, wallpaper, clock, widgets, apps and the menu.
import { createAppHost } from './app-host.js';
import { APPS, DEFAULT_WIDGETS } from './apps/index.js';
import { createWidgetHost } from './home.js';
import { initKiosk } from './kiosk.js';
import { createBoardMenu } from './menu.js';
import { exitKiosk, fetchInfo } from './services/board.js';
import { createLiveConnection } from './services/live.js';
import { createNotesService } from './services/notes.js';
import { createSettingsService } from './services/settings.js';
import { createShoppingService } from './services/shopping.js';
import { createWeatherService } from './services/weather.js';
import { guessLocation, parseTimeOverride, startSky } from './sky.js';
import { appIcon, el, icons, toast } from './ui.js';

// In kiosk mode, an app left open goes back to the home screen after this long.
const IDLE_RETURN_MS = 90 * 1000;
const CLOCK_TICK_MS = 1000;

const params = new URLSearchParams(location.search);
const kiosk = params.has('kiosk') && params.get('kiosk') !== '0';
// ?at=19:30 previews the board at another time of day.
const fixedTime = parseTimeOverride(params.get('at'));
const now = () => fixedTime ?? new Date();

// Services: the only code that talks to the server or to storage.

const live = createLiveConnection({ streams: ['shopping', 'notes'], onServerRestart: () => location.reload() });
const services = {
  shopping: createShoppingService({ live }),
  notes: createNotesService({ live }),
  weather: createWeatherService(),
  settings: createSettingsService({
    widgetIds: APPS.filter((app) => app.createWidget).map((app) => app.id),
    defaultWidgets: DEFAULT_WIDGETS,
  }),
};
const info = fetchInfo();

// Wallpaper and theme

let place = guessLocation();
const sky = startSky({
  starsEl: document.querySelector('.sky__stars'),
  getLocation: () => place,
  getTime: now,
  mode: services.settings.getTheme(),
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
const appHost = createAppHost({ layer: document.querySelector('.app-shell'), dock, apps: APPS, context });
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
        onclick: (event) => appHost.openApp(app.id, { origin: event.currentTarget }),
      },
      appIcon(app),
    ),
  );
}

const widgets = createWidgetHost({ container: document.querySelector('.home__widgets'), apps: APPS, context });
widgets.render(services.settings.getWidgets());
services.settings.subscribe((settings) => widgets.render(settings.widgets));

// Menu

async function exitToDesktop() {
  try {
    const closing = await exitKiosk();
    toast(closing ? 'Closing the board. Open “Widget Board” from the Pi’s menu to come back.' : 'This screen isn’t the kiosk, so there’s nothing to close.');
  } catch (err) {
    toast(err.message);
  }
}

const menu = createBoardMenu({
  settings: services.settings,
  apps: APPS.filter((app) => app.createWidget),
  kiosk,
  onExit: exitToDesktop,
});
document.querySelector('.statusbar__end').append(menu.node);

appHost.start();
live.start();
services.shopping.refresh();
services.notes.refresh();

if (kiosk) {
  initKiosk({
    idleMs: IDLE_RETURN_MS,
    onIdle: () => {
      menu.close();
      appHost.goHome();
    },
  });
}
