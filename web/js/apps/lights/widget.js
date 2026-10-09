// Lights: the home-screen widget. Tap a light to switch it; tap anywhere else to open
// the app for schedules and settings.
import { appIcon, el, fitRows, reconcile } from '../../ui.js';
import { nextLabel, nextSchedule, statusLabel } from './format.js';
import * as meta from './meta.js';
import { createTile, toggleLight, updateTile } from './tile.js';

// "Off at 11:00 PM" moves on to the next schedule as the minutes pass.
const STATUS_REFRESH_MS = 60 * 1000;

export function createWidget({ services, openApp }) {
  const { lights } = services;
  const status = el('p', { class: 'widget-head__meta' });
  const grid = el('ul', { class: 'light-grid light-grid--widget', 'aria-label': 'Lights' });
  const more = el('p', { class: 'lights-widget__more' });
  const messageTitle = el('p', { class: 'lights-widget__message-title' });
  const messageText = el('p', { class: 'lights-widget__message-text' });
  const message = el('div', { class: 'lights-widget__message' }, messageTitle, messageText);
  const node = el('article', { class: 'lights-widget', 'aria-label': meta.name });
  node.append(
    el('a', {
      class: 'widget__link',
      href: `#/app/${meta.id}`,
      'aria-label': `Open ${meta.name}`,
      onclick: (event) => {
        event.preventDefault();
        openApp(meta.id, { origin: node });
      },
    }),
    el(
      'header',
      { class: 'widget-head' },
      appIcon(meta, 'widget-head__icon'),
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), status),
    ),
    grid,
    more,
    message,
  );

  let total = 0;
  const fit = () => fitRows(grid, more, total, (hidden) => `${hidden} more in Lights`);

  function showStatus(state) {
    const next = nextLabel(nextSchedule(state.schedules, new Date()), new Date());
    const healthy = state.configured && state.connected && state.hub !== false && state.lights.length;
    status.textContent = healthy && next ? `${statusLabel(state)} · ${next}` : statusLabel(state);
  }

  function emptyMessage(state) {
    if (state.configured === null) return ['Connecting…', ''];
    if (!state.configured) return ['Not set up', 'Add the lights to config.json on the Pi.'];
    if (!state.connected) return ['Can’t reach the lights', 'Check that Mosquitto is running on the Pi.'];
    return ['No lights yet', 'Pair a switch in Zigbee2MQTT and it appears here.'];
  }

  function render(state) {
    const shown = state.configured ? state.lights : [];
    total = shown.length;
    showStatus(state);
    reconcile(grid, shown, (light) => light.id, () => createTile({ onToggle: (id) => toggleLight(lights, id) }), updateTile);
    grid.hidden = shown.length === 0;
    message.hidden = shown.length > 0;
    if (!shown.length) {
      const [title, text] = emptyMessage(state);
      messageTitle.textContent = title;
      messageText.textContent = text;
      messageText.hidden = !text;
    }
    fit();
  }

  const unsubscribe = lights.subscribe(render);
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(grid);
  const clock = setInterval(() => showStatus(lights.getState()), STATUS_REFRESH_MS);
  render(lights.getState());

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      clearInterval(clock);
    },
  };
}
