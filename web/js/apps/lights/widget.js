// Lights: the home-screen widget. Tap a light to switch it; tap anywhere else to open
// the app for schedules and settings. The button in the corner pairs a new switch.
import { appIcon, el, fitRows, icons, reconcile } from '../../ui.js';
import { lowBatteryLabel, nextLabel, nextSchedule, pairingCountdown, pairingMessage, statusLabel } from './format.js';
import * as meta from './meta.js';
import { announcePairing, canPair, createTile, toggleLight, togglePairing, updateTile } from './tile.js';

// "Off at 11:00 PM" moves on to the next schedule as the minutes pass.
const STATUS_REFRESH_MS = 60 * 1000;
// The pairing countdown, which only ticks while pairing is open.
const COUNTDOWN_MS = 1000;

export function createWidget({ services, openApp }) {
  const { lights } = services;
  const status = el('p', { class: 'widget-head__meta' });
  const pairButton = el('button', { class: 'widget-head__action', type: 'button', onclick: () => togglePairing(lights) });
  const grid = el('ul', { class: 'light-grid light-grid--widget', 'aria-label': 'Lights' });
  const more = el('p', { class: 'lights-widget__more' });
  const messageTitle = el('p', { class: 'lights-widget__message-title' });
  const messageText = el('p', { class: 'lights-widget__message-text' });
  const message = el('div', { class: 'lights-widget__message' }, messageTitle, messageText);
  const pairingTime = el('span', { class: 'lights-widget__pairing-time' });
  const pairingText = el('p', { class: 'lights-widget__message-text', 'aria-live': 'polite' });
  const pairing = el(
    'div',
    { class: 'lights-widget__message lights-widget__pairing' },
    el('p', { class: 'lights-widget__message-title' }, 'Pairing ', pairingTime),
    pairingText,
  );
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
      pairButton,
    ),
    grid,
    more,
    message,
    pairing,
  );

  let total = 0;
  let countdown = null;
  const fit = () => fitRows(grid, more, total, (hidden) => `${hidden} more in Lights`);

  function showStatus(state) {
    const next = nextLabel(nextSchedule(state.schedules, new Date()), new Date());
    const healthy = state.configured && state.connected && state.hub !== false && state.lights.length;
    // A battery running low matters more than the next schedule, so it comes first.
    const parts = [statusLabel(state), healthy && lowBatteryLabel([...state.lights, ...state.motion]), healthy && next];
    status.textContent = parts.filter(Boolean).join(' · ');
  }

  function emptyMessage(state) {
    if (state.configured === null) return ['Connecting…', ''];
    if (!state.configured) return ['Turned off', 'Take "lights": false out of config.json.'];
    if (!state.connected) return ['Can’t reach the lights', 'Plug in the Zigbee dongle and run sudo ./pi/install.sh.'];
    return ['No lights yet', 'Tap + to pair a switch.'];
  }

  function tick() {
    const { until } = lights.getState().pairing;
    pairingTime.textContent = pairingCountdown(until);
  }

  function renderPairing(state) {
    const ready = canPair(state);
    const open = ready && state.pairing.open;
    pairButton.innerHTML = open ? icons.close : icons.plus;
    // Still shown when pairing can't start, so a tap can say what's missing.
    pairButton.classList.toggle('lights-widget__stop', open || !ready);
    pairButton.setAttribute('aria-label', open ? 'Stop pairing' : 'Pair a new light');
    pairing.hidden = !open;
    pairingText.textContent = pairingMessage(state.pairing.found, state.pairing.kind);
    tick();
    if (open && !countdown) countdown = setInterval(tick, COUNTDOWN_MS);
    if (!open && countdown) {
      clearInterval(countdown);
      countdown = null;
    }

    announcePairing(state.pairing, (id) => openApp(meta.id, { origin: node, intent: `name-${id}` }));
    return open;
  }

  function render(state) {
    const pairingOpen = renderPairing(state);
    const shown = state.configured ? state.lights : [];
    total = shown.length;
    showStatus(state);
    reconcile(grid, shown, (light) => light.id, () => createTile({ onToggle: (id) => toggleLight(lights, id) }), updateTile);
    grid.hidden = pairingOpen || shown.length === 0;
    message.hidden = pairingOpen || shown.length > 0;
    if (!shown.length) {
      const [title, text] = emptyMessage(state);
      messageTitle.textContent = title;
      messageText.textContent = text;
      messageText.hidden = !text;
    }
    if (pairingOpen) more.hidden = true;
    else fit();
  }

  const unsubscribe = lights.subscribe(render);
  const resizes = new ResizeObserver(() => grid.hidden || fit());
  resizes.observe(grid);
  const clock = setInterval(() => showStatus(lights.getState()), STATUS_REFRESH_MS);
  render(lights.getState());

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      clearInterval(clock);
      clearInterval(countdown);
    },
  };
}
