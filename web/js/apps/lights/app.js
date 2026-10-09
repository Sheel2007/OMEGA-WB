// Lights: the full-screen app. The lights as big buttons on the left, the schedules
// that switch them on the right, and a sheet for adding or changing a schedule or for
// a light's own settings (swapping On and Off).
import { createKeyboard } from '../../keyboard.js';
import { animateLayout, el, icons, reconcile, toast } from '../../ui.js';
import {
  clockLabel,
  clockParts,
  DAY_LETTERS,
  DAY_NAMES,
  nextLabel,
  nextSchedule,
  pairingCountdown,
  pairingMessage,
  repeatLabel,
  scheduleSummary,
  setPeriod,
  statusLabel,
  stepHour,
  stepMinute,
  toTime,
} from './format.js';
import { name } from './meta.js';
import {
  announcePairing,
  bulbIcon,
  canPair,
  createTile,
  toggleLight,
  togglePairing,
  unreachableMessage,
  updateTile,
} from './tile.js';

const MINUTE_STEP = 5;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// "Next: Off at 11:00 PM" moves on as the minutes pass.
const STATUS_REFRESH_MS = 60 * 1000;
// The pairing countdown, which only ticks while pairing is open.
const COUNTDOWN_MS = 1000;

const chevronUp =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 15l6.5-6.5 6.5 6.5"/></svg>';
const chevronDown =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 9l6.5 6.5L18.5 9"/></svg>';

export function mount(root, { services, kiosk }) {
  const { lights } = services;
  let firstRender = true;
  let sheet = null;
  let countdown = null;

  // The lights

  const meta = el('p', { class: 'lights-app__meta' });
  const grid = el('ul', { class: 'light-grid light-grid--app', 'aria-label': 'Lights' });
  const noticeTitle = el('p', { class: 'empty-state__title' });
  const noticeText = el('p', { class: 'empty-state__text' });
  const notice = el('div', { class: 'empty-state' }, el('div', { class: 'empty-state__art', html: bulbIcon }), noticeTitle, noticeText);

  // Pairing a new switch: the same as + on the widget.

  const pairIcon = el('span', { class: 'lights-app__pair-icon' });
  const pairLabel = el('span');
  const pairButton = el('button', { class: 'lights-app__pair', type: 'button', onclick: () => togglePairing(lights) }, pairIcon, pairLabel);
  const pairingTime = el('span', { class: 'lights-widget__pairing-time' });
  const pairingText = el('p', { class: 'lights-app__pairing-text', 'aria-live': 'polite' });
  const pairing = el(
    'div',
    { class: 'lights-app__pairing' },
    el('p', { class: 'lights-app__pairing-title' }, 'Pairing ', pairingTime),
    pairingText,
  );

  // The schedules

  const next = el('p', { class: 'lights-app__next' });
  const list = el('ul', { class: 'schedule-list', 'aria-label': 'Schedules' });
  const listEmpty = el(
    'div',
    { class: 'schedule-list__empty' },
    el('p', { class: 'schedule-list__empty-title', text: 'No schedules' }),
    el('p', { class: 'schedule-list__empty-text', text: 'Tap + to turn lights on or off at set times.' }),
  );

  const view = el(
    'div',
    { class: 'lights-app' },
    el(
      'section',
      { class: 'lights-app__main', 'aria-label': name },
      el(
        'header',
        { class: 'lights-app__header' },
        el('div', { class: 'lights-app__heading' }, el('h1', { class: 'lights-app__title', text: name }), meta),
        pairButton,
      ),
      el('div', { class: 'lights-app__scroll' }, pairing, grid, notice),
    ),
    el(
      'section',
      { class: 'lights-app__side', 'aria-label': 'Schedules' },
      el(
        'header',
        { class: 'lights-app__side-head' },
        el('div', { class: 'lights-app__side-heading' }, el('h2', { class: 'lights-app__subtitle', text: 'Schedules' }), next),
        el('button', {
          class: 'lights-app__add',
          type: 'button',
          'aria-label': 'Add a schedule',
          html: icons.plus,
          onclick: () => openSchedule(),
        }),
      ),
      list,
      listEmpty,
    ),
  );
  root.append(view);

  function createRow() {
    const row = el('li', { class: 'schedule-row' });
    const toggle = el(
      'button',
      {
        class: 'lights-switch',
        type: 'button',
        role: 'switch',
        onclick: () => setEnabled(row.dataset.key, toggle.getAttribute('aria-checked') !== 'true'),
      },
      el('span', { class: 'lights-switch__track' }),
    );
    row.append(
      el(
        'button',
        { class: 'schedule-row__edit', type: 'button', onclick: () => openSchedule(row.dataset.key) },
        el('span', { class: 'schedule-row__time' }, el('span', { class: 'schedule-row__hm' }), el('span', { class: 'schedule-row__period' })),
        el('span', { class: 'schedule-row__summary' }),
      ),
      toggle,
    );
    return row;
  }

  function updateRow(row, schedule) {
    const [edit, toggle] = row.children;
    const [time, summary] = edit.children;
    const { hour, minute, period } = clockParts(schedule.time);
    const words = scheduleSummary(schedule, lights.getLights());
    time.firstChild.textContent = `${hour}:${minute}`;
    time.lastChild.textContent = period;
    summary.textContent = words;
    row.classList.toggle('schedule-row--off', !schedule.enabled);
    edit.setAttribute('aria-label', `Edit ${clockLabel(schedule.time)}: ${words}`);
    toggle.setAttribute('aria-checked', String(schedule.enabled));
    toggle.setAttribute('aria-label', `Run the ${clockLabel(schedule.time)} schedule`);
  }

  function setEnabled(id, enabled) {
    lights.updateSchedule(id, { enabled }).catch((err) => toast(err.message));
  }

  function showNext(state) {
    const upcoming = nextSchedule(state.schedules, new Date());
    if (upcoming) next.textContent = `Next: ${nextLabel(upcoming, new Date())}`;
    else next.textContent = state.schedules.length ? 'All schedules are off' : '';
  }

  function showNotice(state) {
    if (state.configured === null) {
      noticeTitle.textContent = 'Connecting…';
      noticeText.textContent = '';
    } else if (!state.configured) {
      noticeTitle.textContent = 'Lights are turned off';
      noticeText.textContent = 'Take "lights": false out of config.json on the Pi, then restart the board.';
    } else if (!state.connected) {
      noticeTitle.textContent = 'Can’t reach the lights';
      noticeText.textContent = 'New here? Plug the Zigbee dongle into the Pi and run sudo ./pi/install.sh. Otherwise check that Mosquitto is running. The board keeps trying.';
    } else {
      noticeTitle.textContent = 'No lights yet';
      noticeText.textContent = 'Tap Pair a Light, then hold the new switch’s button for about 30 seconds until its light blinks fast.';
    }
  }

  function tick() {
    pairingTime.textContent = pairingCountdown(lights.getState().pairing.until);
  }

  function renderPairing(state) {
    const ready = canPair(state);
    const open = ready && state.pairing.open;
    pairIcon.innerHTML = open ? icons.close : icons.plus;
    pairLabel.textContent = open ? 'Stop Pairing' : 'Pair a Light';
    // Still shown when pairing can't start, so a tap can say what's missing.
    pairButton.classList.toggle('lights-app__pair--quiet', open || !ready);
    pairing.hidden = !open;
    pairingText.textContent = pairingMessage(state.pairing.found);
    tick();
    if (open && !countdown) countdown = setInterval(tick, COUNTDOWN_MS);
    if (!open && countdown) {
      clearInterval(countdown);
      countdown = null;
    }
    announcePairing(state.pairing, (id) => openLight(id, { rename: true }));
  }

  function render(state) {
    renderPairing(state);
    const shown = state.configured ? state.lights : [];
    meta.textContent = statusLabel(state);
    showNext(state);
    showNotice(state);
    const apply = () => {
      reconcile(
        grid,
        shown,
        (light) => light.id,
        () => createTile({ onToggle: (id) => toggleLight(lights, id), onMore: openLight }),
        updateTile,
      );
      reconcile(list, state.schedules, (schedule) => schedule.id, createRow, updateRow);
      grid.hidden = shown.length === 0;
      notice.hidden = shown.length > 0;
      list.hidden = state.schedules.length === 0;
      listEmpty.hidden = state.schedules.length > 0;
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(view, apply, { selector: '.schedule-row' });
    }
    sheet?.refresh();
  }

  // Sheets: one at a time, over the app, closed by Cancel, Done, Escape or a tap outside.

  function openSheet({ title, content, primary, cancel, refresh, onClose }) {
    closeSheet();
    const keys = new AbortController();
    const primaryButton = el('button', { class: 'lights-sheet__primary', type: 'button', text: primary.label, onclick: primary.onClick });
    const card = el(
      'div',
      { class: 'lights-sheet__card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      el(
        'header',
        { class: 'lights-sheet__head' },
        cancel
          ? el('button', { class: 'lights-sheet__cancel', type: 'button', text: 'Cancel', onclick: closeSheet })
          : el('span', { class: 'lights-sheet__spacer' }),
        el('h2', { class: 'lights-sheet__title', text: title }),
        primaryButton,
      ),
      el('div', { class: 'lights-sheet__body' }, content),
    );
    const node = el(
      'div',
      { class: 'lights-sheet' },
      el('button', { class: 'lights-sheet__scrim', type: 'button', tabindex: '-1', 'aria-label': 'Close', onclick: closeSheet }),
      card,
    );
    root.append(node);
    addEventListener('keydown', (event) => event.key === 'Escape' && closeSheet(), { signal: keys.signal });
    card.focus({ preventScroll: true });
    sheet = { node, keys, primaryButton, refresh, onClose };
    return sheet;
  }

  function closeSheet() {
    if (!sheet) return;
    const { keys, node, onClose } = sheet;
    sheet = null;
    keys.abort();
    node.remove();
    onClose?.();
  }

  // Adding or changing a schedule: a time like an alarm clock, on or off, which lights, which days.

  function openSchedule(id) {
    const existing = id ? lights.getSchedules().find((s) => s.id === id) : null;
    if (id && !existing) return;
    const draft = existing
      ? { time: existing.time, on: existing.on, lights: [...existing.lights], days: [...existing.days] }
      : { time: toTime((new Date().getHours() + 1) * 60), on: true, lights: [], days: [...EVERY_DAY] };

    const hourValue = el('span', { class: 'time-picker__value' });
    const minuteValue = el('span', { class: 'time-picker__value' });
    const am = segment('AM', () => set({ time: setPeriod(draft.time, false) }));
    const pm = segment('PM', () => set({ time: setPeriod(draft.time, true) }));
    const turnOn = segment('Turn on', () => set({ on: true }));
    const turnOff = segment('Turn off', () => set({ on: false }));
    const lightChips = el('div', { class: 'chip-row' });
    const dayPills = DAY_LETTERS.map((letter, day) =>
      el('button', { class: 'day-pill', type: 'button', text: letter, 'aria-label': DAY_NAMES[day], onclick: () => toggleDay(day) }),
    );
    const repeat = el('p', { class: 'schedule-editor__repeat' });

    const content = el(
      'div',
      { class: 'schedule-editor' },
      el(
        'div',
        { class: 'time-picker', role: 'group', 'aria-label': 'Time' },
        wheel('hour', hourValue, (by) => set({ time: stepHour(draft.time, by) })),
        el('span', { class: 'time-picker__colon', 'aria-hidden': 'true', text: ':' }),
        wheel('minute', minuteValue, (by) => set({ time: stepMinute(draft.time, by * MINUTE_STEP) })),
        el('div', { class: 'segmented segmented--stacked', role: 'group', 'aria-label': 'AM or PM' }, am, pm),
      ),
      el('div', { class: 'segmented', role: 'group', 'aria-label': 'What the schedule does' }, turnOn, turnOff),
      group('Lights', lightChips),
      group('Repeat', el('div', { class: 'day-pills' }, dayPills), repeat),
      existing && el('button', { class: 'schedule-editor__delete', type: 'button', text: 'Delete Schedule', onclick: remove }),
    );

    function set(changes) {
      Object.assign(draft, changes);
      paint();
    }

    function toggleDay(day) {
      set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort() });
    }

    // "All lights" is no list at all, so a light paired later is included too.
    function pickLight(lightId) {
      if (!lightId) return set({ lights: [] });
      const picked = draft.lights.includes(lightId) ? draft.lights.filter((i) => i !== lightId) : [...draft.lights, lightId];
      set({ lights: picked });
    }

    function paint() {
      const { hour, minute, period } = clockParts(draft.time);
      hourValue.textContent = hour;
      minuteValue.textContent = minute;
      am.setAttribute('aria-pressed', String(period === 'AM'));
      pm.setAttribute('aria-pressed', String(period === 'PM'));
      turnOn.setAttribute('aria-pressed', String(draft.on));
      turnOff.setAttribute('aria-pressed', String(!draft.on));
      const choices = [{ id: '', name: 'All lights' }, ...lights.getLights()];
      // Lights a schedule names but the board no longer has stay pickable, so they can be taken off.
      for (const lightId of draft.lights) {
        if (!choices.some((c) => c.id === lightId)) choices.push({ id: lightId, name: 'Unpaired light' });
      }
      reconcile(
        lightChips,
        choices,
        (choice) => choice.id || 'all',
        (choice) => el('button', { class: 'chip chip--choice', type: 'button', onclick: () => pickLight(choice.id) }),
        (chip, choice) => {
          chip.textContent = choice.name;
          chip.setAttribute('aria-pressed', String(choice.id ? draft.lights.includes(choice.id) : draft.lights.length === 0));
        },
      );
      dayPills.forEach((pill, day) => pill.setAttribute('aria-pressed', String(draft.days.includes(day))));
      repeat.textContent = draft.days.length ? repeatLabel(draft.days) : 'Once — pick days to repeat it';
    }

    async function save() {
      const own = sheet;
      own.primaryButton.disabled = true;
      try {
        if (existing) await lights.updateSchedule(existing.id, { ...draft, enabled: true });
        else await lights.addSchedule(draft);
        if (sheet === own) closeSheet();
      } catch (err) {
        toast(err.message);
        own.primaryButton.disabled = false;
      }
    }

    function remove() {
      closeSheet();
      lights.removeSchedule(existing.id).then(
        () =>
          toast('Schedule deleted', {
            action: 'Undo',
            onAction: () => lights.restoreSchedules([existing.id]).catch((err) => toast(err.message)),
          }),
        (err) => toast(err.message),
      );
    }

    openSheet({
      title: existing ? 'Edit Schedule' : 'New Schedule',
      content,
      primary: { label: existing ? 'Save' : 'Add', onClick: save },
      cancel: true,
      // Another screen may delete it, or pair a light, while this one is open.
      refresh: () => (existing && !lights.getSchedules().some((s) => s.id === existing.id) ? closeSheet() : paint()),
    });
    paint();
  }

  // A light's own settings: its name, switching it, and swapping On and Off for a
  // switch paired the other way round. `rename` opens it ready to type a name.

  function openLight(lightId, { rename = false } = {}) {
    const light = lights.getLights().find((l) => l.id === lightId);
    if (!light) return;
    const nameInput = el('input', {
      class: 'light-sheet__name-input',
      type: 'text',
      name: 'light-name',
      value: light.name,
      maxlength: '40',
      autocomplete: 'off',
      autocapitalize: 'words',
      enterkeyhint: 'done',
      'aria-label': 'Name',
      // The board brings its own keyboard; the system one would cover half the screen.
      inputmode: kiosk ? 'none' : null,
      onkeydown: (event) => event.key === 'Enter' && (event.preventDefault(), done()),
    });
    const nameField = el(
      'label',
      { class: 'light-sheet__name' },
      el('span', { class: 'light-sheet__name-label', text: 'Name' }),
      nameInput,
    );
    const keyboard = kiosk
      ? createKeyboard({
          input: nameInput,
          enterLabel: 'Done',
          onEnter: done,
          onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
        })
      : null;
    if (keyboard) root.append(keyboard.node);
    const stateText = el('span', { class: 'light-sheet__state' });
    const power = el(
      'button',
      { class: 'light-sheet__power', type: 'button', onclick: () => toggleLight(lights, lightId) },
      el('span', { class: 'light-tile__icon', html: bulbIcon }),
      stateText,
    );
    const swap = el(
      'button',
      { class: 'light-sheet__swap', type: 'button', role: 'switch', onclick: swapOnOff },
      el(
        'span',
        { class: 'light-sheet__swap-text' },
        el('span', { class: 'light-sheet__swap-title', text: 'Swap On and Off' }),
        el('span', {
          class: 'light-sheet__swap-help',
          text: 'Turn this on if the light comes on when the board says Off. It happens when a switch is paired or wired the other way round.',
        }),
      ),
      el('span', { class: 'lights-switch__track' }),
    );

    function paint() {
      const state = lights.getState();
      const now = state.lights.find((l) => l.id === lightId);
      if (!now) return closeSheet();
      power.classList.toggle('light-sheet__power--on', now.on === true);
      power.setAttribute('aria-pressed', String(now.on === true));
      power.setAttribute('aria-disabled', String(!now.reachable));
      if (!now.reachable) stateText.textContent = unreachableMessage(state, now);
      else if (now.on === null) stateText.textContent = 'Checking… Tap to turn on';
      else stateText.textContent = now.on ? 'On — tap to turn off' : 'Off — tap to turn on';
      swap.setAttribute('aria-checked', String(now.swapped));
    }

    // Done keeps a new name; tapping outside the sheet leaves the old one.
    function done() {
      const now = lights.getLights().find((l) => l.id === lightId);
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      closeSheet();
      if (!now || !name || name === now.name) return;
      lights.renameLight(lightId, name).catch((err) => toast(err.message));
    }

    function swapOnOff() {
      const now = lights.getLights().find((l) => l.id === lightId);
      if (!now) return;
      const swapped = !now.swapped;
      lights.setSwapped(lightId, swapped).then(
        () => toast(swapped ? `On and Off swapped for ${now.name}` : `${now.name} is back to normal`),
        (err) => toast(err.message),
      );
    }

    openSheet({
      title: light.name,
      content: el('div', { class: 'light-sheet' }, nameField, power, swap),
      primary: { label: 'Done', onClick: done },
      cancel: false,
      refresh: paint,
      onClose: () => {
        keyboard?.destroy();
        document.documentElement.classList.remove('is-typing');
      },
    });
    paint();
    if (rename) {
      nameInput.select();
      if (keyboard) keyboard.show();
      else nameInput.focus();
    }
  }

  const unsubscribe = lights.subscribe(render);
  const clock = setInterval(() => showNext(lights.getState()), STATUS_REFRESH_MS);
  render(lights.getState());

  return {
    intent(action) {
      if (action === 'add') openSchedule();
      // From "Name it" on the message that says a new light was added.
      else if (action?.startsWith('name-')) openLight(action.slice('name-'.length), { rename: true });
    },
    unmount() {
      unsubscribe();
      clearInterval(clock);
      clearInterval(countdown);
      closeSheet();
    },
  };
}

function segment(label, onclick) {
  return el('button', { class: 'segmented__option', type: 'button', text: label, onclick });
}

function group(label, ...children) {
  return el('div', { class: 'schedule-editor__group' }, el('p', { class: 'schedule-editor__label', text: label }), ...children);
}

// One column of the time picker: up, the number, down.
function wheel(unit, value, step) {
  return el(
    'div',
    { class: 'time-picker__wheel' },
    el('button', { class: 'time-picker__step', type: 'button', html: chevronUp, 'aria-label': `Later ${unit}`, onclick: () => step(1) }),
    value,
    el('button', { class: 'time-picker__step', type: 'button', html: chevronDown, 'aria-label': `Earlier ${unit}`, onclick: () => step(-1) }),
  );
}
