// The home screen a phone gets: the apps as icons, the way a phone shows apps.
//
// The board keeps its widgets — this is built only when the compact layout is on,
// and nothing here runs on the Pi. A phone can't leave the compact layout (turning
// it sideways only swaps which of width and height is the short one), so the choice
// is made once, when the board starts.
import { watchSubtitle } from './app-subtitles.js';
import { svg as grocerySvg } from './apps/grocery/views.js';
import { describeWeather } from './apps/weather/conditions.js';
import { weatherIcon } from './apps/weather/icons.js';
import { appIcon, el } from './ui.js';

export function createPhoneHome({ apps, openApp, services }) {
  const stops = [];

  // The weather has no screen of its own to open, so it stays a line of its own
  // under the clock rather than becoming an icon that does nothing when tapped.
  const weatherIconEl = el('span', { class: 'phone-weather__icon' });
  const weatherText = el('p', { class: 'phone-weather__text' });
  const weather = el('div', { class: 'phone-weather' }, weatherIconEl, weatherText);
  weather.hidden = true;
  stops.push(
    services.weather.subscribe(({ forecast }) => {
      const today = forecast?.daily?.[0];
      if (!forecast?.current || !today) {
        weather.hidden = true;
        return;
      }
      const condition = describeWeather(forecast.current.code, forecast.current.is_day);
      weatherIconEl.innerHTML = weatherIcon(condition.icon);
      weatherText.textContent = `${forecast.current.temperature}° ${condition.label} · H ${today.high}° L ${today.low}°`;
      weather.hidden = false;
    }),
  );

  const grid = el('ul', { class: 'app-grid', 'aria-label': 'Apps' });
  for (const app of apps.filter((a) => a.mount)) {
    const subtitle = el('span', { class: 'app-grid__meta' });
    const button = el(
      'button',
      {
        class: 'app-grid__app',
        type: 'button',
        'aria-label': `Open ${app.name}`,
        onclick: (event) => openApp(app.id, { origin: event.currentTarget }),
      },
      appIcon(app, 'app-grid__icon'),
      el('span', { class: 'app-grid__name', text: app.name }),
      subtitle,
    );
    grid.append(el('li', { class: 'app-grid__item' }, button));

    stops.push(watchSubtitle(app, services, (text) => (subtitle.textContent = text)));
  }

  // The phone is the grocery scanner: one tap from the home screen to the camera.
  const scan = apps.some((app) => app.id === 'grocery')
    ? el(
        'button',
        {
          class: 'phone-scan',
          type: 'button',
          onclick: (event) => openApp('grocery', { origin: event.currentTarget, intent: 'scan' }),
        },
        el('span', { class: 'phone-scan__icon', html: grocerySvg.scan }),
        el('span', { class: 'phone-scan__label', text: 'Scan' }),
      )
    : null;

  return {
    node: el('div', { class: 'phone-home' }, weather, scan, grid),
    destroy() {
      stops.forEach((stop) => stop?.());
      stops.length = 0;
    },
  };
}
