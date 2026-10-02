// Weather: current conditions and the next few days. Display only.
import { appIcon, el } from '../../ui.js';
import { describeWeather, localDate } from './conditions.js';
import { weatherIcon } from './icons.js';
import * as meta from './meta.js';

const DAYS_SHOWN = 4;
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function createWidget({ services }) {
  const { weather } = services;
  const status = el('p', { class: 'widget-head__meta' });
  const icon = el('span', { class: 'weather-widget__icon' });
  const temp = el('p', { class: 'weather-widget__temp' });
  const label = el('p', { class: 'weather-widget__label' });
  const range = el('p', { class: 'weather-widget__range' });
  const days = el('ol', { class: 'weather-widget__days', 'aria-label': 'Next few days' });
  const now = el('div', { class: 'weather-widget__now' }, icon, temp, el('div', { class: 'weather-widget__details' }, label, range));
  const message = el('p', { class: 'weather-widget__message' });
  const node = el(
    'article',
    { class: 'weather-widget', 'aria-label': meta.name },
    el(
      'header',
      { class: 'widget-head' },
      appIcon(meta, 'widget-head__icon'),
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), status),
    ),
    now,
    days,
    message,
  );

  function renderDays(forecast) {
    days.replaceChildren(
      ...forecast.daily.slice(1, 1 + DAYS_SHOWN).map((day) => {
        const condition = describeWeather(day.code);
        return el(
          'li',
          { class: 'weather-widget__day' },
          el('span', { class: 'weather-widget__day-name', text: dayFormat.format(localDate(day.date)) }),
          el('span', { class: 'weather-widget__day-icon', html: weatherIcon(condition.icon), title: condition.label }),
          el(
            'span',
            { class: 'weather-widget__day-temps' },
            el('span', { class: 'weather-widget__high', text: `${day.high}°` }),
            el('span', { class: 'weather-widget__low', text: `${day.low}°` }),
          ),
        );
      }),
    );
  }

  function render({ forecast, error, loading }) {
    const hasForecast = Boolean(forecast?.daily?.length);
    now.hidden = !hasForecast;
    days.hidden = !hasForecast;
    message.hidden = hasForecast;
    if (!hasForecast) {
      status.textContent = '';
      message.textContent = loading ? 'Checking the sky…' : error || 'No forecast right now.';
      return;
    }
    const current = describeWeather(forecast.current.code, forecast.current.is_day);
    const today = forecast.daily[0];
    icon.innerHTML = weatherIcon(current.icon);
    temp.textContent = `${forecast.current.temperature}°`;
    temp.setAttribute('aria-label', `${forecast.current.temperature} degrees ${forecast.unit === 'F' ? 'Fahrenheit' : 'Celsius'}`);
    label.textContent = current.label;
    range.textContent = `H ${today.high}°  ·  L ${today.low}°`;
    const updated = forecast.updated ? timeFormat.format(new Date(forecast.updated)) : '';
    status.textContent = error || forecast.stale ? `Offline · from ${updated}` : `Updated ${updated}`;
    renderDays(forecast);
  }

  const unsubscribe = weather.subscribe(render);
  return { node, destroy: unsubscribe };
}
