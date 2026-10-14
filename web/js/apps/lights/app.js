// Lights: the full-screen app. The lights as big buttons on the left with the motion
// sensors under them, the schedules that switch them on the right (with "When it gets
// dark" above them), and a sheet for adding or changing a schedule, for the dark
// setting, for a light's own settings (swapping On and Off), or for a motion sensor
// (switching the board's screen off when nobody's around, and the sensor's own settings).
import { createKeyboard } from '../../keyboard.js';
import { animateLayout, el, icons, reconcile, toast } from '../../ui.js';
import {
  batteryLabel,
  isBatteryLow,
  lowBatteryLabel,
  clockLabel,
  clockParts,
  DARK_LEVELS,
  DARK_LUX,
  DARK_UNTIL,
  darkLevelLabel,
  darkSummary,
  durationLabel,
  DAY_LETTERS,
  DAY_NAMES,
  motionStateLabel,
  motionSummary,
  nextLabel,
  nextSchedule,
  pairingCountdown,
  pairingMessage,
  repeatLabel,
  SCREEN_OFF_AFTER,
  SCREEN_TEST_SECONDS,
  screenStatusLabel,
  scheduleSummary,
  setPeriod,
  settingChoices,
  settingLabel,
  settingValueLabel,
  statusLabel,
  stepHour,
  stepMinute,
  sunLevelLabel,
  toTime,
  untilLabel,
  watchEnd,
} from './format.js';
import { name } from './meta.js';
import {
  announcePairing,
  batteryIcon,
  bulbIcon,
  canPair,
  createTile,
  toggleLight,
  togglePairing,
  unreachableMessage,
  updateTile,
} from './tile.js';

const MINUTE_STEP = 5;
// "Turn off again": how long a light may stay on (0 = never), and for how many hours to watch.
const OFF_AGAIN_MINUTES = [0, 15, 30, 60];
const WATCH_HOURS = [2, 4, 6, 8, 10];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// "Next: Off at 11:00 PM" moves on as the minutes pass.
const STATUS_REFRESH_MS = 60 * 1000;
// The pairing countdown, which only ticks while pairing is open.
const COUNTDOWN_MS = 1000;

const moonIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const chevronUp =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 15l6.5-6.5 6.5 6.5"/></svg>';
const motionIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/></svg>';
const screenIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/></svg>';
const chevronDown =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 9l6.5 6.5L18.5 9"/></svg>';

export function mount(root, { services, kiosk }) {
  const { lights } = services;
  let firstRender = true;
  let sheet = null;
  let countdown = null;
  let testingScreen = false;

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

  // Motion sensors: a tile each, under the lights, + to pair one, and a button that
  // switches the screen off for a moment to show the board can.

  const screenTestLabel = el('span');
  const screenTest = el(
    'button',
    { class: 'lights-app__pair lights-app__pair--quiet', type: 'button', onclick: () => testScreen() },
    el('span', { class: 'lights-app__pair-icon', html: screenIcon }),
    screenTestLabel,
  );

  const sensorGrid = el('ul', { class: 'light-grid light-grid--app', 'aria-label': 'Motion sensors' });
  const sensorPair = el('button', { class: 'lights-app__add', type: 'button', onclick: () => togglePairing(lights, 'motion') });
  const sensorEmpty = el('p', {
    class: 'lights-app__sensors-empty',
    text: 'Tap + to pair one. It can switch the board’s screen off when nobody’s around, and back on when someone comes in.',
  });
  const sensors = el(
    'section',
    { class: 'lights-app__sensors', 'aria-label': 'Motion sensors' },
    el(
      'header',
      { class: 'lights-app__sensors-head' },
      el('h2', { class: 'lights-app__subtitle', text: 'Motion Sensors' }),
      screenTest,
      sensorPair,
    ),
    sensorGrid,
    sensorEmpty,
  );

  // The schedules

  const next = el('p', { class: 'lights-app__next' });
  const darkSummaryText = el('span', { class: 'schedule-row__summary' });
  const darkEdit = el(
    'button',
    { class: 'schedule-row__edit', type: 'button', onclick: () => openDark() },
    el('span', { class: 'dark-row__title' }, el('span', { class: 'dark-row__icon', html: moonIcon }), 'When it gets dark'),
    darkSummaryText,
  );
  const darkToggle = el(
    'button',
    {
      class: 'lights-switch',
      type: 'button',
      role: 'switch',
      'aria-label': 'Turn lights on when it gets dark',
      onclick: () => setDarkEnabled(darkToggle.getAttribute('aria-checked') !== 'true'),
    },
    el('span', { class: 'lights-switch__track' }),
  );
  const darkRow = el('div', { class: 'schedule-row dark-row' }, darkEdit, darkToggle);
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
      el('div', { class: 'lights-app__scroll' }, pairing, grid, notice, sensors),
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
      darkRow,
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

  function setDarkEnabled(enabled) {
    lights.setDark({ enabled }).catch((err) => toast(err.message));
  }

  function renderDark(state) {
    const { dark } = state;
    const words = darkSummary(dark, state.lights, state.sensors);
    darkSummaryText.textContent = words;
    darkRow.classList.toggle('schedule-row--off', !dark.enabled);
    darkEdit.setAttribute('aria-label', `Edit When it gets dark: ${words}`);
    darkToggle.setAttribute('aria-checked', String(dark.enabled));
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

  function createSensorTile() {
    const node = el('li', { class: 'light-tile light-tile--sensor' });
    node.append(
      el(
        'button',
        { class: 'light-tile__toggle', type: 'button', onclick: () => openMotion(node.dataset.key) },
        el('span', { class: 'light-tile__icon', html: motionIcon }),
        el(
          'span',
          { class: 'light-tile__text' },
          el('span', { class: 'light-tile__name' }),
          el('span', { class: 'light-tile__state' }, el('span', { class: 'light-tile__state-text' }), el('span', { class: 'light-tile__battery' })),
        ),
      ),
    );
    return node;
  }

  function updateSensorTile(node, sensor) {
    const button = node.firstChild;
    const [name, state] = button.lastChild.children;
    const [stateText, battery] = state.children;
    const words = motionStateLabel(sensor);
    node.classList.toggle('light-tile--motion', sensor.occupied === true);
    name.textContent = sensor.name;
    stateText.textContent = words;
    const low = isBatteryLow(sensor);
    battery.hidden = !low;
    if (low) {
      battery.innerHTML = `${batteryIcon}<span>${Number(sensor.battery)}%</span>`;
      battery.setAttribute('aria-label', `Battery low, ${sensor.battery}%`);
    }
    button.setAttribute('aria-label', `${sensor.name}: ${words}. ${motionSummary(sensor.rule)}`);
  }

  // Off for a few seconds, then on again. The answer comes once it's back on.
  function testScreen() {
    if (testingScreen || lights.getState().screen?.testing) return;
    testingScreen = true;
    render(lights.getState());
    lights
      .testScreen()
      .then(
        () => toast(`The screen went off for ${SCREEN_TEST_SECONDS} seconds and came back on.`),
        (err) => toast(err.message),
      )
      .finally(() => {
        testingScreen = false;
        render(lights.getState());
      });
  }

  function renderSensors(state) {
    const open = canPair(state) && state.pairing.open;
    sensors.hidden = !(state.configured && state.connected) && !state.motion.length;
    sensorPair.innerHTML = open ? icons.close : icons.plus;
    sensorPair.classList.toggle('lights-app__add--quiet', open || !canPair(state));
    sensorPair.setAttribute('aria-label', open ? 'Stop pairing' : 'Pair a motion sensor');
    const testing = testingScreen || Boolean(state.screen?.testing);
    screenTestLabel.textContent = testing ? 'Testing…' : 'Test Screen Off';
    screenTest.setAttribute('aria-disabled', String(testing));
    reconcile(sensorGrid, state.motion, (sensor) => sensor.id, createSensorTile, updateSensorTile);
    sensorGrid.hidden = !state.motion.length;
    sensorEmpty.hidden = state.motion.length > 0;
  }

  function renderPairing(state) {
    const ready = canPair(state);
    const open = ready && state.pairing.open;
    pairIcon.innerHTML = open ? icons.close : icons.plus;
    pairLabel.textContent = open ? 'Stop Pairing' : 'Pair a Light';
    // Still shown when pairing can't start, so a tap can say what's missing.
    pairButton.classList.toggle('lights-app__pair--quiet', open || !ready);
    pairing.hidden = !open;
    pairingText.textContent = pairingMessage(state.pairing.found, state.pairing.kind);
    tick();
    if (open && !countdown) countdown = setInterval(tick, COUNTDOWN_MS);
    if (!open && countdown) {
      clearInterval(countdown);
      countdown = null;
    }
    announcePairing(state.pairing, (id) => openDevice(id, { rename: true }));
  }

  function render(state) {
    renderPairing(state);
    const shown = state.configured ? state.lights : [];
    meta.textContent = [statusLabel(state), state.connected && lowBatteryLabel([...state.lights, ...state.motion])]
      .filter(Boolean)
      .join(' · ');
    showNext(state);
    showNotice(state);
    renderDark(state);
    renderSensors(state);
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
      ? {
          time: existing.time,
          on: existing.on,
          lights: [...existing.lights],
          days: [...existing.days],
          offAgain: existing.offAgain ?? 0,
          watchFor: existing.watchFor ?? 8,
        }
      : { time: toTime((new Date().getHours() + 1) * 60), on: true, lights: [], days: [...EVERY_DAY], offAgain: 0, watchFor: 8 };

    const hourValue = el('span', { class: 'time-picker__value' });
    const minuteValue = el('span', { class: 'time-picker__value' });
    const am = segment('AM', () => set({ time: setPeriod(draft.time, false) }));
    const pm = segment('PM', () => set({ time: setPeriod(draft.time, true) }));
    const turnOn = segment('Turn on', () => set({ on: true }));
    const turnOff = segment('Turn off', () => set({ on: false }));
    const lightChips = el('div', { class: 'chip-row' });
    const pickLight = (lightId) => set({ lights: pickedLights(draft.lights, lightId) });
    const dayPills = DAY_LETTERS.map((letter, day) =>
      el('button', { class: 'day-pill', type: 'button', text: letter, 'aria-label': DAY_NAMES[day], onclick: () => toggleDay(day) }),
    );
    const repeat = el('p', { class: 'schedule-editor__repeat' });
    const againChips = el('div', { class: 'chip-row' });
    const watchChips = el('div', { class: 'chip-row' });
    const watchRow = el('div', { class: 'schedule-editor__group' }, el('p', { class: 'schedule-editor__hint', text: 'Keep watching until' }), watchChips);
    const again = group(
      'Turn off again',
      el('p', { class: 'schedule-editor__hint', text: 'If someone switches a light back on afterwards, turn it off again after:' }),
      againChips,
      watchRow,
    );

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
      again,
      existing && el('button', { class: 'schedule-editor__delete', type: 'button', text: 'Delete Schedule', onclick: remove }),
    );

    function set(changes) {
      Object.assign(draft, changes);
      paint();
    }

    function toggleDay(day) {
      set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort() });
    }

    function paint() {
      const { hour, minute, period } = clockParts(draft.time);
      hourValue.textContent = hour;
      minuteValue.textContent = minute;
      am.setAttribute('aria-pressed', String(period === 'AM'));
      pm.setAttribute('aria-pressed', String(period === 'PM'));
      turnOn.setAttribute('aria-pressed', String(draft.on));
      turnOff.setAttribute('aria-pressed', String(!draft.on));
      lightPicker(lightChips, lights.getLights(), draft.lights, pickLight);
      dayPills.forEach((pill, day) => pill.setAttribute('aria-pressed', String(draft.days.includes(day))));
      // Only a Turn off schedule watches for lights switched back on.
      again.hidden = draft.on;
      watchRow.hidden = !draft.offAgain;
      choiceChips(againChips, OFF_AGAIN_MINUTES, {
        label: (minutes) => (minutes ? durationLabel(minutes) : 'Never'),
        pressed: (minutes) => draft.offAgain === minutes,
        pick: (minutes) => set({ offAgain: minutes }),
      });
      choiceChips(watchChips, WATCH_HOURS, {
        label: (hours) => clockLabel(watchEnd({ time: draft.time, watchFor: hours })),
        title: (hours) => `For ${hours} hours, until ${clockLabel(watchEnd({ time: draft.time, watchFor: hours }))}`,
        pressed: (hours) => draft.watchFor === hours,
        pick: (hours) => set({ watchFor: hours }),
      });
      repeat.textContent = draft.days.length ? repeatLabel(draft.days) : 'Once — pick days to repeat it';
    }

    async function save() {
      const own = sheet;
      own.primaryButton.disabled = true;
      try {
        const fields = { ...draft, offAgain: draft.on ? 0 : draft.offAgain };
        if (existing) await lights.updateSchedule(existing.id, { ...fields, enabled: true });
        else await lights.addSchedule(fields);
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

  // "When it gets dark": how dark, which lights, until when, and (with a light sensor
  // paired) whether the sun or the sensor tells. Saving it switches it on.

  function openDark() {
    const now = lights.getDark();
    const draft = { lights: [...now.lights], level: now.level, until: now.until, sensor: now.sensor };

    const sourceChips = el('div', { class: 'chip-row' });
    const sourceHint = el('p', { class: 'schedule-editor__hint' });
    const source = group('Tell it’s dark by', sourceChips, sourceHint);
    const levelChips = el('div', { class: 'chip-row' });
    const levelHint = el('p', { class: 'schedule-editor__hint' });
    const lightChips = el('div', { class: 'chip-row' });
    const untilChips = el('div', { class: 'chip-row' });
    const missing = el('p', {
      class: 'dark-editor__missing',
      text: 'To tell when it’s dark, the board needs its latitude and longitude in config.json on the Pi, or a paired light sensor.',
    });

    const content = el(
      'div',
      { class: 'schedule-editor' },
      el('p', {
        class: 'schedule-editor__hint',
        text: 'Turns the lights on once a day, the first time it gets dark. Switch them off again and they stay off.',
      }),
      missing,
      source,
      group('How dark', levelChips, levelHint),
      group('Lights', lightChips),
      group(
        'Not after',
        untilChips,
        el('p', { class: 'schedule-editor__hint', text: 'Only from noon until then, so nobody gets woken up.' }),
      ),
    );

    function set(changes) {
      Object.assign(draft, changes);
      paint();
    }

    function paint() {
      const state = lights.getState();
      const dark = { ...state.dark, ...draft };
      const sensors = state.sensors;
      const sensor = sensors.find((s) => s.id === draft.sensor);
      const bySensor = Boolean(draft.sensor);
      missing.hidden = Boolean(dark.sunTimes) || sensors.length > 0;
      // Only worth asking once there's a sensor to pick (or one picked that has gone).
      source.hidden = !sensors.length && !draft.sensor;
      const sourceChoices = [{ id: 'sun', name: 'The sun' }, ...sensors];
      if (draft.sensor && !sensor) sourceChoices.push({ id: draft.sensor, name: 'Removed sensor' });
      choiceChips(sourceChips, sourceChoices.map((c) => c.id), {
        label: (id) => sourceChoices.find((c) => c.id === id).name,
        pressed: (id) => id === (draft.sensor ?? 'sun'),
        pick: (id) => set({ sensor: id === 'sun' ? null : id }),
      });
      if (!bySensor) sourceHint.textContent = dark.sunTimes ? 'Works out sunset where the board is.' : 'The board doesn’t know where it is yet.';
      else if (!sensor) sourceHint.textContent = 'That sensor isn’t paired any more. Pick another, or the sun.';
      else if (!sensor.reporting) sourceHint.textContent = `No reading from ${sensor.name} yet. ${dark.sunTimes ? 'The sun decides until it reports.' : ''}`.trim();
      else sourceHint.textContent = `Watches the light level ${sensor.name} reports.`;
      choiceChips(levelChips, DARK_LEVELS, {
        label: (level) => darkLevelLabel(level, bySensor),
        title: (level) => (bySensor ? `${darkLevelLabel(level, true)}: under ${DARK_LUX[level]} lux` : sunLevelLabel(level, dark)),
        pressed: (level) => draft.level === level,
        pick: (level) => set({ level }),
      });
      levelHint.textContent = bySensor
        ? `When ${sensor?.name ?? 'the sensor'} reads under ${DARK_LUX[draft.level]} lux for a few minutes.`
        : dark.sunTimes
          ? `Today: ${sunLevelLabel(draft.level, dark)}`
          : '';
      lightPicker(lightChips, state.lights, draft.lights, (lightId) => set({ lights: pickedLights(draft.lights, lightId) }));
      choiceChips(untilChips, DARK_UNTIL, {
        label: untilLabel,
        pressed: (until) => draft.until === until,
        pick: (until) => set({ until }),
      });
    }

    async function save() {
      const own = sheet;
      own.primaryButton.disabled = true;
      try {
        await lights.setDark({ ...draft, enabled: true });
        if (sheet === own) closeSheet();
      } catch (err) {
        toast(err.message);
        own.primaryButton.disabled = false;
      }
    }

    openSheet({
      title: 'When It Gets Dark',
      content,
      primary: { label: 'Save', onClick: save },
      cancel: true,
      refresh: paint,
    });
    paint();
  }

  // A light's own settings: its name, switching it, and swapping On and Off for a
  // switch paired the other way round. `rename` opens it ready to type a name.

  // The name at the top of a light's or a sensor's sheet. Done (or Enter) keeps a new
  // name; tapping outside the sheet leaves the old one.

  function nameEditor(value, onDone) {
    const input = el('input', {
      class: 'light-sheet__name-input',
      type: 'text',
      name: 'light-name',
      value,
      maxlength: '40',
      autocomplete: 'off',
      autocapitalize: 'words',
      enterkeyhint: 'done',
      'aria-label': 'Name',
      // The board brings its own keyboard; the system one would cover half the screen.
      inputmode: kiosk ? 'none' : null,
      onkeydown: (event) => event.key === 'Enter' && (event.preventDefault(), onDone()),
    });
    const field = el('label', { class: 'light-sheet__name' }, el('span', { class: 'light-sheet__name-label', text: 'Name' }), input);
    const keyboard = kiosk
      ? createKeyboard({
          input,
          enterLabel: 'Done',
          onEnter: onDone,
          onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
        })
      : null;
    if (keyboard) root.append(keyboard.node);
    return {
      field,
      focus() {
        input.select();
        if (keyboard) keyboard.show();
        else input.focus();
      },
      // Closes the sheet, then renames if the name changed. `current` is the name now.
      save(id, current) {
        const name = input.value.trim().replace(/\s+/g, ' ');
        closeSheet();
        if (!current || !name || name === current) return;
        lights.renameLight(id, name).catch((err) => toast(err.message));
      },
      destroy() {
        keyboard?.destroy();
        document.documentElement.classList.remove('is-typing');
      },
    };
  }

  function openDevice(id, options) {
    if (lights.getMotion().some((m) => m.id === id)) openMotion(id, options);
    else openLight(id, options);
  }

  function openLight(lightId, { rename = false } = {}) {
    const light = lights.getLights().find((l) => l.id === lightId);
    if (!light) return;
    const names = nameEditor(light.name, done);
    const stateText = el('span', { class: 'light-sheet__state' });
    const power = el(
      'button',
      { class: 'light-sheet__power', type: 'button', onclick: () => toggleLight(lights, lightId) },
      el('span', { class: 'light-tile__icon', html: bulbIcon }),
      stateText,
    );
    // Battery-powered switches only.
    const batteryText = el('span');
    const battery = el('p', { class: 'light-sheet__battery' }, el('span', { class: 'light-sheet__battery-icon', html: batteryIcon }), batteryText);
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
      battery.hidden = now.battery == null;
      battery.classList.toggle('light-sheet__battery--low', isBatteryLow(now));
      batteryText.textContent = batteryLabel(now);
      power.classList.toggle('light-sheet__power--on', now.on === true);
      power.setAttribute('aria-pressed', String(now.on === true));
      power.setAttribute('aria-disabled', String(!now.reachable));
      if (!now.reachable) stateText.textContent = unreachableMessage(state, now);
      else if (now.on === null) stateText.textContent = 'Checking… Tap to turn on';
      else if (now.on && now.offAt) stateText.textContent = `On — turns off again at ${clockLabel(now.offAt)}`;
      else stateText.textContent = now.on ? 'On — tap to turn off' : 'Off — tap to turn on';
      swap.setAttribute('aria-checked', String(now.swapped));
    }

    function done() {
      names.save(lightId, lights.getLights().find((l) => l.id === lightId)?.name);
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
      content: el('div', { class: 'light-sheet' }, names.field, power, battery, swap),
      primary: { label: 'Done', onClick: done },
      cancel: false,
      refresh: paint,
      onClose: names.destroy,
    });
    paint();
    if (rename) names.focus();
  }

  // A motion sensor: its name, what it's seeing, which lights it switches on (and when
  // they go off again), and its own settings. Changes apply straight away, like a switch.

  function openMotion(sensorId, { rename = false } = {}) {
    const sensor = lights.getMotion().find((m) => m.id === sensorId);
    if (!sensor) return;
    const names = nameEditor(sensor.name, done);
    const statusText = el('span', { class: 'motion-sheet__status-text' });
    const status = el('p', { class: 'motion-sheet__status' }, el('span', { class: 'light-tile__icon', html: motionIcon }), statusText);
    const batteryText = el('span');
    const battery = el('p', { class: 'light-sheet__battery' }, el('span', { class: 'light-sheet__battery-icon', html: batteryIcon }), batteryText);
    const enable = el(
      'button',
      { class: 'light-sheet__swap', type: 'button', role: 'switch', onclick: () => change({ enabled: !current()?.rule.enabled }) },
      el(
        'span',
        { class: 'light-sheet__swap-text' },
        el('span', { class: 'light-sheet__swap-title', text: 'Turn the screen off when nobody’s around' }),
        el('span', {
          class: 'light-sheet__swap-help',
          text: 'The board’s screen goes dark when this sensor hasn’t seen anyone for a while, and comes back on as soon as it does (or someone taps the screen). The Pi keeps running.',
        }),
      ),
      el('span', { class: 'lights-switch__track' }),
    );
    const offChips = el('div', { class: 'chip-row' });
    const rule = el(
      'div',
      { class: 'schedule-editor' },
      group('Turn it off after', offChips, el('p', { class: 'schedule-editor__hint', text: 'With no motion for this long.' })),
    );
    const testText = el('span');
    const test = el(
      'button',
      { class: 'motion-sheet__test', type: 'button', onclick: () => testScreen() },
      el('span', { class: 'lights-app__pair-icon', html: screenIcon }),
      testText,
    );
    const screenHint = el('p', { class: 'schedule-editor__hint' });
    const screen = el('div', { class: 'schedule-editor' }, test, screenHint);
    const settingList = el('div', { class: 'schedule-editor' });
    const settings = el(
      'div',
      { class: 'schedule-editor motion-sheet__settings' },
      el('p', { class: 'motion-sheet__heading', text: 'Sensor' }),
      settingList,
      el('p', {
        class: 'schedule-editor__hint',
        text: 'A sensor on batteries only listens when it wakes. If a change doesn’t stick, wave at the sensor and pick it again.',
      }),
    );

    const current = () => lights.getMotion().find((m) => m.id === sensorId);

    function change(changes) {
      lights.setMotion(sensorId, changes).catch((err) => toast(err.message));
    }

    function pickSetting(setting, value) {
      lights.setMotionSetting(sensorId, setting.property, value).catch((err) => toast(err.message));
    }

    function paint() {
      const state = lights.getState();
      const now = current();
      if (!now) return closeSheet();
      statusText.textContent = motionStateLabel(now);
      status.classList.toggle('motion-sheet__status--active', now.occupied === true);
      battery.hidden = now.battery == null;
      battery.classList.toggle('light-sheet__battery--low', isBatteryLow(now));
      batteryText.textContent = batteryLabel(now);
      enable.setAttribute('aria-checked', String(now.rule.enabled));
      rule.hidden = !now.rule.enabled;
      choiceChips(offChips, [...new Set([...SCREEN_OFF_AFTER, now.rule.offAfter])].sort((a, b) => a - b), {
        label: durationLabel,
        pressed: (minutes) => now.rule.offAfter === minutes,
        pick: (minutes) => change({ offAfter: minutes }),
      });
      const testing = testingScreen || Boolean(state.screen?.testing);
      testText.textContent = testing ? 'Testing…' : `Test: Screen Off for ${SCREEN_TEST_SECONDS} Seconds`;
      test.setAttribute('aria-disabled', String(testing));
      screenHint.textContent = screenStatusLabel(state.screen);
      settings.hidden = !now.settings.length;
      reconcile(
        settingList,
        now.settings,
        (setting) => setting.property,
        (setting) => group(settingLabel(setting), el('div', { class: 'chip-row' })),
        (node, setting) => {
          node.firstChild.textContent = settingLabel(setting);
          choiceChips(node.lastChild, settingChoices(setting), {
            label: (value) => settingValueLabel(setting, value),
            pressed: (value) => setting.value === value,
            pick: (value) => pickSetting(setting, value),
          });
        },
      );
    }

    function done() {
      names.save(sensorId, current()?.name);
    }

    openSheet({
      title: sensor.name,
      content: el('div', { class: 'light-sheet' }, names.field, status, battery, enable, rule, screen, settings),
      primary: { label: 'Done', onClick: done },
      cancel: false,
      refresh: paint,
      onClose: names.destroy,
    });
    paint();
    if (rename) names.focus();
  }

  const unsubscribe = lights.subscribe(render);
  // "Next: Off at 11:00 PM" and "Motion 4 min ago" move on as the minutes pass.
  const clock = setInterval(() => {
    const state = lights.getState();
    showNext(state);
    renderSensors(state);
    sheet?.refresh();
  }, STATUS_REFRESH_MS);
  render(lights.getState());

  return {
    intent(action) {
      if (action === 'add') openSchedule();
      // From "Name it" on the message that says a new light or sensor was added.
      else if (action?.startsWith('name-')) openDevice(action.slice('name-'.length), { rename: true });
    },
    unmount() {
      unsubscribe();
      clearInterval(clock);
      clearInterval(countdown);
      closeSheet();
    },
  };
}

// Which lights: "All lights" or any of them. Lights the setting names but the board
// no longer has stay pickable, so they can be taken off.
function lightPicker(parent, known, picked, pick) {
  const choices = [{ id: '', name: 'All lights' }, ...known];
  for (const lightId of picked) {
    if (!choices.some((c) => c.id === lightId)) choices.push({ id: lightId, name: 'Unpaired light' });
  }
  reconcile(
    parent,
    choices,
    (choice) => choice.id || 'all',
    (choice) => el('button', { class: 'chip chip--choice', type: 'button', onclick: () => pick(choice.id) }),
    (chip, choice) => {
      chip.textContent = choice.name;
      chip.setAttribute('aria-pressed', String(choice.id ? picked.includes(choice.id) : picked.length === 0));
    },
  );
}

// "All lights" is no list at all, so a light paired later is included too.
function pickedLights(picked, lightId) {
  if (!lightId) return [];
  return picked.includes(lightId) ? picked.filter((i) => i !== lightId) : [...picked, lightId];
}

// A row of chips, one of which is picked. Rebuilt in place, keyed by value.
function choiceChips(parent, values, { label, title = label, pressed, pick }) {
  reconcile(
    parent,
    values,
    (value) => String(value),
    (value) => el('button', { class: 'chip chip--choice', type: 'button', onclick: () => pick(value) }),
    (chip, value) => {
      chip.textContent = label(value);
      chip.setAttribute('aria-label', title(value));
      chip.setAttribute('aria-pressed', String(pressed(value)));
    },
  );
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
