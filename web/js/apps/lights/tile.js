// A light's tile, shared by the widget and the app: one big button that switches the
// light the other way. Warm when on, quiet when off, like the lights in a home app.
import { el, haptic, toast } from '../../ui.js';
import { isBatteryLow, lightStateLabel } from './format.js';

export const bulbIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6a6.9 6.9 0 0 0-4 12.5c.6.5 1 1.2 1 2v.4h6v-.4c0-.8.4-1.5 1-2a6.9 6.9 0 0 0-4-12.5z" fill="currentColor"/><path d="M9.4 19.6h5.2M10.4 22h3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export const batteryIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7" width="17" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="20.3" y="10" width="2.2" height="4" rx="1" fill="currentColor"/><rect x="5" y="9.5" width="4" height="5" rx="1" fill="currentColor"/></svg>';

const moreIcon =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="18.5" cy="12" r="2.1"/></svg>';

// Why a light can't be switched right now, in words that say what to check.
export function unreachableMessage(state, light) {
  if (!state.configured) return 'The lights are turned off in config.json.';
  if (!state.connected) return 'Can’t reach the lights. Check that Mosquitto is running on the Pi.';
  if (state.hub === false) return 'Zigbee2MQTT isn’t running, so the lights can’t be switched.';
  return `${light.name} isn’t responding. Check it has power.`;
}

// Pairing: the same button in the widget and the app.

export function canPair(state) {
  return Boolean(state.configured && state.connected && state.hub === true);
}

function pairBlockedMessage(state) {
  if (state.configured === null) return 'Still connecting to the lights. Try again in a moment.';
  if (!state.configured) return 'The lights are turned off in config.json ("lights": false).';
  if (!state.connected) return 'Zigbee isn’t set up on the Pi yet. Plug in the dongle and run sudo ./pi/install.sh.';
  if (state.hub === false) return 'Zigbee2MQTT isn’t running, so pairing can’t start.';
  return 'Zigbee2MQTT hasn’t started on the Pi yet. Plug in the dongle and run sudo ./pi/install.sh.';
}

export function togglePairing(lights) {
  const state = lights.getState();
  if (!canPair(state)) {
    toast(pairBlockedMessage(state));
    return;
  }
  lights.pair(!state.pairing.open).catch((err) => toast(err.message));
}

// Says once (on whichever screen part notices first) that a light was added or
// pairing was refused. The first call only takes note of how things already are.
// onName(id) opens the new light's name, from the message's "Name it" button.
let announced = null;

export function announcePairing({ found, error }, onName) {
  const news = error ? `error:${error}` : found?.state === 'ready' ? `ready:${found.id ?? found.name}` : '';
  if (announced !== null && news && news !== announced) {
    if (error) toast(error);
    else toast(`${found.name} added.`, found.id ? { action: 'Name it', onAction: () => onName(found.id) } : {});
  }
  announced = news;
}

export function toggleLight(lights, id) {
  const state = lights.getState();
  const light = state.lights.find((l) => l.id === id);
  if (!light) return;
  if (!light.reachable) {
    toast(unreachableMessage(state, light));
    return;
  }
  haptic();
  lights.toggleLight(id).catch((err) => toast(err.message));
}

// onMore, when given, adds the ⋯ button that opens the light's settings.
export function createTile({ onToggle, onMore }) {
  const node = el('li', { class: 'light-tile' });
  node.append(
    el(
      'button',
      { class: 'light-tile__toggle', type: 'button', onclick: () => onToggle(node.dataset.key) },
      el('span', { class: 'light-tile__icon', html: bulbIcon }),
      el(
        'span',
        { class: 'light-tile__text' },
        el('span', { class: 'light-tile__name' }),
        el(
          'span',
          { class: 'light-tile__state' },
          el('span', { class: 'light-tile__state-text' }),
          // Only when a battery-powered switch is running low.
          el('span', { class: 'light-tile__battery' }),
        ),
      ),
    ),
  );
  if (onMore) {
    node.append(el('button', { class: 'light-tile__more', type: 'button', html: moreIcon, onclick: () => onMore(node.dataset.key) }));
  }
  return node;
}

export function updateTile(node, light) {
  const toggle = node.firstChild;
  const [name, state] = toggle.lastChild.children;
  node.classList.toggle('light-tile--on', light.on === true);
  node.classList.toggle('light-tile--away', !light.reachable);
  toggle.setAttribute('aria-pressed', String(light.on === true));
  toggle.setAttribute('aria-disabled', String(!light.reachable));
  name.textContent = light.name;
  const [stateText, battery] = state.children;
  stateText.textContent = lightStateLabel(light);
  const low = isBatteryLow(light);
  battery.hidden = !low;
  if (low) {
    battery.innerHTML = `${batteryIcon}<span>${Number(light.battery)}%</span>`;
    battery.setAttribute('aria-label', `Battery low, ${light.battery}%`);
  }
  node.querySelector('.light-tile__more')?.setAttribute('aria-label', `${light.name} settings`);
}
