// Roommate Cup: the full-screen app. The standings on the left (tap someone to see
// how they got their points), game night on the right: what's been picked, who won,
// and sending it out. Sheets sign roommates up, keep the catalog of games, set the
// weekly game night, and take down who finished where.
import { createKeyboard } from '../../keyboard.js';
import { isReady } from '../../services/roommate-games.js';
import { animateLayout, el, icons, nudge, reconcile, toast } from '../../ui.js';
import { clockLabel, DAY_LETTERS, DAY_NAMES } from '../lights/format.js';
import {
  announceChoices,
  avatarColor,
  catalogLabel,
  channelsLabel,
  currentWeek,
  dayKey,
  fromOrder,
  finisherPlaces,
  gainLabel,
  initials,
  isComplete,
  KIND_LABELS,
  leaderLabel,
  nextNightKey,
  nightLabel,
  ordinal,
  placeLabel,
  pointsLabel,
  resultLabel,
  scheduleLabel,
  sendLabel,
  stepGameTime,
  tapFinisher,
  toggleTie,
  toOrder,
  whenLabel,
} from './format.js';
import { name } from './meta.js';

// "Tonight" becomes "Last night", and send-out times come and go, as the day passes.
const REFRESH_MS = 60 * 1000;
const RECENT_NIGHTS = 4;
const PER_NIGHT = [1, 2, 3];

const svg = {
  people:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>',
  dice:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  send:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M21 3L10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/></svg>',
  shuffle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h3.5c4 0 6 10 10 10H21M3 17h3.5c1.6 0 2.8-1.6 3.9-3.5M13.6 10.5C14.7 8.6 15.9 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z"/></svg>',
  trophy:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M21 17h-5.5a1.5 1.5 0 0 0-1.5 1.5v2.5a9.5 9.5 0 0 0 9 9.5M43 17h5.5a1.5 1.5 0 0 1 1.5 1.5v2.5a9.5 9.5 0 0 1-9 9.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M20 11h24v13a12 12 0 0 1-24 0z" fill="currentColor"/><path d="M28.5 35.5h7v7.5h-7z" fill="currentColor"/><rect x="21" y="43" width="22" height="7.5" rx="2" fill="currentColor"/></svg>',
  minus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
};

export function mount(root, { services, kiosk }) {
  const cup = services.roommateGames;
  let sheet = null;
  let pendingIntent = null;
  let firstRender = true;

  // Header

  const meta = el('p', { class: 'cup-app__meta' });
  const view = el('div', { class: 'cup-app' });

  // Standings

  const standings = el('ol', { class: 'cup-standings', 'aria-label': 'Standings' });
  const standingsEmpty = el(
    'div',
    { class: 'empty-state cup-app__empty' },
    el('div', { class: 'empty-state__art', html: svg.trophy }),
    el('p', { class: 'empty-state__title', text: 'Sign up the roommates' }),
    el('p', {
      class: 'empty-state__text',
      text: 'Each roommate needs a name and an email or phone number, so the board can send them the week’s games.',
    }),
    el('button', { class: 'cup-button cup-button--primary', type: 'button', onclick: () => openPlayerForm() }, iconSpan(icons.plus), 'Sign Up'),
  );

  // Game night

  const nightWhen = el('p', { class: 'cup-night__when' });
  const nightTitle = el('h2', { class: 'cup-night__title' });
  const picks = el('ul', { class: 'cup-picks', 'aria-label': 'Games' });
  const nightText = el('p', { class: 'cup-night__text' });
  const drawIcon = iconSpan(svg.shuffle);
  const drawLabel = el('span');
  const drawButton = el('button', { class: 'cup-button', type: 'button', onclick: draw }, drawIcon, drawLabel);
  const sendButton = el('button', { class: 'cup-button', type: 'button', onclick: send }, iconSpan(svg.send), 'Send to Everyone');
  const sendStatus = el('p', { class: 'cup-night__status', 'aria-live': 'polite' });
  const recent = el('ul', { class: 'cup-recent', 'aria-label': 'Recent game nights' });
  const recentSection = el('section', { class: 'cup-app__recent' }, el('h2', { class: 'cup-app__subtitle', text: 'Recent' }), recent);

  view.append(
    el(
      'header',
      { class: 'cup-app__header' },
      el('div', { class: 'cup-app__heading' }, el('h1', { class: 'cup-app__title', text: name }), meta),
      el(
        'div',
        { class: 'cup-app__tools' },
        toolButton(svg.people, 'Roommates', openRoommates),
        toolButton(svg.dice, 'Games', openCatalog),
        toolButton(svg.clock, 'Game Night', openSchedule),
      ),
    ),
    el(
      'div',
      { class: 'cup-app__columns' },
      el(
        'section',
        { class: 'cup-app__standings', 'aria-label': 'Standings' },
        el('h2', { class: 'cup-app__subtitle', text: 'Standings' }),
        standings,
        standingsEmpty,
      ),
      el(
        'div',
        { class: 'cup-app__side' },
        el(
          'section',
          { class: 'cup-night', 'aria-label': 'Game night' },
          nightWhen,
          nightTitle,
          picks,
          nightText,
          el('div', { class: 'cup-night__actions' }, drawButton, sendButton),
          sendStatus,
        ),
        recentSection,
      ),
    ),
  );
  root.append(view);

  // Rendering

  function createStanding() {
    const row = el('li', { class: 'cup-standing' });
    row.append(
      el(
        'button',
        { class: 'cup-standing__open', type: 'button', onclick: () => openPlayer(row.dataset.key) },
        el('span', { class: 'cup-rank cup-rank--lg' }),
        el('span', { class: 'cup-avatar cup-avatar--lg', 'aria-hidden': 'true' }),
        el('span', { class: 'cup-standing__text' }, el('span', { class: 'cup-standing__name' }), el('span', { class: 'cup-standing__sub' })),
        el('span', { class: 'cup-standing__points' }, el('span', { class: 'cup-standing__number' }), el('span', { class: 'cup-standing__unit' })),
        el('span', { class: 'cup-standing__chevron', html: icons.chevronRight }),
      ),
    );
    return row;
  }

  function updateStanding(row, player) {
    const [rank, avatar, text, points] = row.firstChild.children;
    rank.textContent = player.rank;
    rank.className = `cup-rank cup-rank--lg${player.points > 0 && player.rank <= 3 ? ` cup-rank--${player.rank}` : ''}`;
    avatar.className = `cup-avatar cup-avatar--lg cup-avatar--${avatarColor(player.id)}`;
    avatar.textContent = initials(player.name);
    text.firstChild.textContent = player.name;
    text.lastChild.replaceChildren(...standingDetails(player));
    points.firstChild.textContent = player.points;
    points.lastChild.textContent = player.points === 1 ? 'pt' : 'pts';
    row.firstChild.setAttribute('aria-label', `${ordinal(player.rank)}, ${player.name}, ${pointsLabel(player.points)}. Show how.`);
  }

  function standingDetails(player) {
    if (player.played === 0) return ['No games yet'];
    const parts = [`${player.played} ${player.played === 1 ? 'game' : 'games'}`, `${player.wins} ${player.wins === 1 ? 'win' : 'wins'}`];
    const out = [parts.join(' · ')];
    if (player.crowns) out.push(' · ', el('span', { class: 'cup-crown', html: svg.crown }), ` ${player.crowns}`);
    return out;
  }

  function createPick() {
    const row = el('li', { class: 'cup-pick' });
    row.append(
      el(
        'div',
        { class: 'cup-pick__head' },
        el('span', { class: 'cup-pick__name' }),
        el('span', { class: 'cup-tag' }),
      ),
      el('p', { class: 'cup-pick__expert' }),
      el('button', { class: 'cup-pick__record', type: 'button', onclick: () => openRecord(row.dataset.week, row.dataset.key) }),
    );
    return row;
  }

  function updatePick(row, pick, week, state) {
    const [head, expert, record] = row.children;
    row.dataset.week = week.id;
    head.firstChild.textContent = pick.name;
    head.lastChild.textContent = KIND_LABELS[pick.kind];
    head.lastChild.className = `cup-tag cup-tag--${pick.kind}`;
    const specialist = state.names[pick.specialist];
    expert.hidden = pick.kind !== 'specialized';
    expert.textContent = specialist ? `${specialist}’s game · finish ahead of ${specialist} for +${state.bonus}` : '';
    record.classList.toggle('cup-pick__record--done', Boolean(pick.result));
    record.textContent = pick.result ? resultLabel(pick.result, state.names) : 'Record Result';
    record.setAttribute('aria-label', pick.result ? `${pick.name}: ${record.textContent}. Change the result.` : `Record who won ${pick.name}`);
  }

  function renderNight(state, now) {
    const week = currentWeek(state.weeks, now);
    const { schedule } = state;
    const canSend = state.channels.email || state.channels.sms;
    const drawable = state.games.some((game) => game.available);
    picks.hidden = !week;
    if (week) {
      const today = dayKey(now);
      nightWhen.textContent = whenLabel(week.id, schedule.time, now);
      if (week.id < today) nightTitle.textContent = isComplete(week) ? 'All played' : 'Waiting on results';
      else nightTitle.textContent = week.picks.length === 1 ? 'The game' : 'The games';
      reconcile(picks, week.picks, (pick) => pick.id, createPick, (row, pick) => updatePick(row, pick, week, state));
      const upcoming = week.id >= today;
      nightText.hidden = true;
      drawLabel.textContent = upcoming ? 'Pick Again' : 'Pick Next Game Night';
      drawButton.dataset.again = String(upcoming);
      drawButton.hidden = isComplete(week) || (!upcoming && !schedule.on);
      sendButton.hidden = !canSend || !upcoming || isComplete(week);
      sendButton.disabled = state.sending;
      sendStatus.textContent = upcoming ? sendLabel(week, state, now) : '';
      return;
    }
    const key = nextNightKey(schedule, now, state.weeks);
    nightWhen.textContent = schedule.on ? whenLabel(key, schedule.time, now) : 'Paused';
    nightTitle.textContent = 'Next game night';
    nightText.hidden = false;
    const count = schedule.perNight === 1 ? 'a game' : `${schedule.perNight} games`;
    if (!drawable) nightText.textContent = 'Add some games to the catalog and the board will pick from them.';
    else if (!schedule.on) nightText.textContent = 'Game night is paused. Turn it back on in Game Night.';
    else nightText.textContent = `The board picks ${count} at ${clockLabel(schedule.announce)} that day and sends ${schedule.perNight === 1 ? 'it' : 'them'} to everyone.`;
    drawLabel.textContent = 'Pick Now';
    drawButton.dataset.again = 'false';
    drawButton.hidden = !drawable;
    sendButton.hidden = true;
    sendStatus.textContent = canSend ? '' : 'Texts and emails aren’t set up on the Pi, so share the games yourself.';
  }

  function renderRecent(state, now) {
    const current = currentWeek(state.weeks, now);
    const past = state.weeks.filter((week) => week !== current && week.id <= dayKey(now)).slice(-RECENT_NIGHTS).reverse();
    recentSection.hidden = past.length === 0;
    reconcile(
      recent,
      past,
      (week) => week.id,
      () => el('li', { class: 'cup-recent__night' }, el('p', { class: 'cup-recent__date' }), el('div', { class: 'cup-recent__games' })),
      (row, week) => {
        const [date, games] = row.children;
        date.textContent = nightLabel(week.id);
        games.replaceChildren(
          ...week.picks.map((pick) =>
            el(
              'button',
              { class: 'cup-recent__game', type: 'button', onclick: () => openRecord(week.id, pick.id) },
              el('span', { class: 'cup-recent__name', text: pick.name }),
              el('span', { class: 'cup-recent__winner', text: pick.result ? winnersOf(pick, state.names) : 'Record result' }),
            ),
          ),
        );
      },
    );
  }

  function render(state) {
    if (!isReady(state)) {
      meta.textContent = 'Connecting…';
      return;
    }
    const now = new Date();
    meta.textContent = [leaderLabel(state.players), scheduleLabel(state.schedule)].filter(Boolean).join(' · ');
    const apply = () => {
      reconcile(standings, state.players, (player) => player.id, createStanding, updateStanding);
      standings.hidden = state.players.length === 0;
      standingsEmpty.hidden = state.players.length > 0;
      renderNight(state, now);
      renderRecent(state, now);
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(view, apply, { selector: '.cup-standing' });
    }
    sheet?.refresh?.();
    if (pendingIntent) {
      const action = pendingIntent;
      pendingIntent = null;
      runIntent(action);
    }
  }

  // Game night actions

  function draw() {
    const again = drawButton.dataset.again === 'true';
    const week = currentWeek(cup.getState().weeks, new Date());
    drawButton.disabled = true;
    cup
      .draw({ again })
      .then(
        () => toast(again && week?.notified ? 'Picked again. Send them out so everyone knows.' : again ? 'Picked again' : 'Games picked'),
        (err) => toast(err.message),
      )
      .finally(() => (drawButton.disabled = false));
  }

  function send() {
    const week = currentWeek(cup.getState().weeks, new Date());
    if (!week) return;
    cup.notify(week.id).then(
      () => toast('Sending the games to everyone'),
      (err) => toast(err.message),
    );
  }

  // Sheets: one at a time, over the app, closed by Cancel, Done, Escape or a tap outside.

  function openSheet({ title, content, primary, cancel = true, refresh, onClose }) {
    closeSheet();
    const keys = new AbortController();
    const primaryButton = el('button', { class: 'cup-sheet__primary', type: 'button', text: primary.label, onclick: primary.onClick });
    const card = el(
      'div',
      { class: 'cup-sheet__card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      el(
        'header',
        { class: 'cup-sheet__head' },
        cancel ? el('button', { class: 'cup-sheet__cancel', type: 'button', text: 'Cancel', onclick: closeSheet }) : el('span'),
        el('h2', { class: 'cup-sheet__title', text: title }),
        primaryButton,
      ),
      el('div', { class: 'cup-sheet__body' }, content),
    );
    const node = el(
      'div',
      { class: 'cup-sheet' },
      el('button', { class: 'cup-sheet__scrim', type: 'button', tabindex: '-1', 'aria-label': 'Close', onclick: closeSheet }),
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

  // Text fields, with the board's own keyboard in kiosk mode. Enter moves to the
  // next field, and on the last one does `onDone`.
  function textFields(fields, onDone) {
    const inputs = fields.map(({ label, value = '', placeholder = '', type = 'text', mode, autocomplete, max }) =>
      el('input', {
        class: 'cup-field__input',
        type,
        value,
        placeholder,
        maxlength: String(max),
        autocomplete: autocomplete ?? 'off',
        autocapitalize: type === 'text' && !mode ? 'words' : 'off',
        spellcheck: 'false',
        enterkeyhint: 'next',
        'aria-label': label,
        // The board brings its own keyboard; the system one would cover half the screen.
        inputmode: kiosk ? 'none' : mode,
      }),
    );
    inputs.at(-1).setAttribute('enterkeyhint', 'done');
    // The field being typed in, which the board's keyboard's Enter key moves on from.
    let current = inputs[0];
    inputs.forEach((input) => input.addEventListener('focus', () => (current = input)));
    const advance = (input) => {
      const next = inputs[inputs.indexOf(input) + 1];
      if (!next) return onDone();
      current = next;
      if (keyboard) keyboard.focusField(next);
      else next.focus();
    };
    inputs.forEach((input) =>
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        advance(input);
      }),
    );
    const keyboard = kiosk
      ? createKeyboard({
          inputs,
          enterLabel: 'Next',
          onEnter: () => advance(current),
          onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
        })
      : null;
    if (keyboard) root.append(keyboard.node);
    const nodes = fields.map(({ label }, index) =>
      el('label', { class: 'cup-field' }, el('span', { class: 'cup-field__label', text: label }), inputs[index]),
    );
    return {
      inputs,
      nodes,
      focus(input = inputs[0]) {
        current = input;
        if (keyboard) keyboard.focusField(input);
        else input.focus();
      },
      destroy() {
        keyboard?.destroy();
        document.documentElement.classList.remove('is-typing');
      },
    };
  }

  // Roommates

  function openRoommates() {
    const list = el('ul', { class: 'cup-list', 'aria-label': 'Roommates' });
    const empty = el('p', { class: 'cup-form__hint', text: 'Nobody’s signed up yet.' });
    const content = el(
      'div',
      { class: 'cup-form' },
      list,
      empty,
      el('button', { class: 'cup-button cup-button--primary cup-button--wide', type: 'button', onclick: () => openPlayerForm() }, iconSpan(icons.plus), 'Sign Up a Roommate'),
      el('p', { class: 'cup-form__hint', text: 'The board keeps a name, an email and a phone number for each roommate. No passwords. Screens only ever show part of each.' }),
    );
    function paint() {
      const { players } = cup.getState();
      const byName = [...players].sort((a, b) => a.name.localeCompare(b.name));
      reconcile(
        list,
        byName,
        (player) => player.id,
        (player) =>
          el(
            'li',
            {},
            el(
              'button',
              { class: 'cup-list__row', type: 'button', onclick: () => openPlayerForm(player.id) },
              el('span', { class: 'cup-avatar', 'aria-hidden': 'true' }),
              el('span', { class: 'cup-list__text' }, el('span', { class: 'cup-list__name' }), el('span', { class: 'cup-list__sub' })),
              el('span', { class: 'cup-standing__chevron', html: icons.chevronRight }),
            ),
          ),
        (row, player) => {
          const [avatar, text] = row.firstChild.children;
          avatar.className = `cup-avatar cup-avatar--${avatarColor(player.id)}`;
          avatar.textContent = initials(player.name);
          text.firstChild.textContent = player.name;
          text.lastChild.textContent = [player.email, player.phone].filter(Boolean).join(' · ');
        },
      );
      list.hidden = players.length === 0;
      empty.hidden = players.length > 0;
    }
    openSheet({ title: 'Roommates', content, primary: { label: 'Done', onClick: closeSheet }, cancel: false, refresh: paint });
    paint();
  }

  // Signing up a roommate, or changing their details. Only a name, an email and a
  // phone number; the email and phone come back masked, so they're typed fresh to change.
  function openPlayerForm(id) {
    const existing = id ? cup.getState().players.find((p) => p.id === id) : null;
    if (id && !existing) return;
    const fields = textFields(
      [
        { label: 'Name', value: existing?.name ?? '', max: 30, autocomplete: 'off' },
        {
          label: 'Email',
          placeholder: existing?.email ? `Keep ${existing.email}` : 'name@example.com',
          mode: 'email',
          autocomplete: 'email',
          max: 254,
        },
        {
          label: 'Phone',
          placeholder: existing?.phone ? `Keep ${existing.phone}` : '(555) 123-4567',
          type: 'tel',
          mode: 'tel',
          autocomplete: 'tel',
          max: 24,
        },
      ],
      save,
    );
    const [nameInput, emailInput, phoneInput] = fields.inputs;
    const form = el(
      'div',
      { class: 'cup-form' },
      el('div', { class: 'cup-fields' }, fields.nodes),
      el('p', {
        class: 'cup-form__hint',
        text: existing
          ? 'Leave the email or phone empty to keep what’s there.'
          : 'An email, a phone number, or both: the board sends the week’s games to whichever it can.',
      }),
      existing &&
        el('button', { class: 'cup-button cup-button--danger cup-button--wide', type: 'button', text: 'Remove from the Cup', onclick: remove }),
    );

    async function save() {
      const own = sheet;
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      const email = emailInput.value.trim();
      const phone = phoneInput.value.trim();
      if (!name) {
        nudge(nameInput.parentElement);
        return fields.focus(nameInput);
      }
      if (!existing && !email && !phone) {
        nudge(emailInput.parentElement);
        return toast('Add an email or a phone number.');
      }
      own.primaryButton.disabled = true;
      try {
        if (existing) {
          const changes = {};
          if (name !== existing.name) changes.name = name;
          if (email) changes.email = email;
          if (phone) changes.phone = phone;
          if (Object.keys(changes).length) await cup.updatePlayer(existing.id, changes);
        } else {
          await cup.addPlayer({ name, email, phone });
          toast(`${name} is signed up`);
        }
        if (sheet === own) closeSheet();
      } catch (err) {
        toast(err.message);
        own.primaryButton.disabled = false;
      }
    }

    function remove() {
      closeSheet();
      cup.removePlayer(existing.id).then(
        () =>
          toast(`${existing.name} left the Cup`, {
            action: 'Undo',
            onAction: () => cup.restorePlayers([existing.id]).catch((err) => toast(err.message)),
          }),
        (err) => toast(err.message),
      );
    }

    openSheet({
      title: existing ? existing.name : 'New Roommate',
      content: form,
      primary: { label: existing ? 'Save' : 'Sign Up', onClick: save },
      refresh: () => existing && !cup.getState().players.some((p) => p.id === existing.id) && closeSheet(),
      onClose: fields.destroy,
    });
    if (!existing) fields.focus();
  }

  // The catalog of games

  function openCatalog() {
    const general = el('ul', { class: 'cup-list', 'aria-label': 'General games' });
    const specialized = el('ul', { class: 'cup-list', 'aria-label': 'Specialized games' });
    const generalHead = el('p', { class: 'cup-form__label' });
    const specializedHead = el('p', { class: 'cup-form__label' });
    const summary = el('p', { class: 'cup-form__hint' });
    const content = el(
      'div',
      { class: 'cup-form' },
      summary,
      el('button', { class: 'cup-button cup-button--primary cup-button--wide', type: 'button', onclick: () => openGameForm() }, iconSpan(icons.plus), 'Add a Game'),
      generalHead,
      general,
      specializedHead,
      specialized,
    );

    function gameRow(game) {
      return el(
        'li',
        {},
        el(
          'button',
          { class: 'cup-list__row', type: 'button', onclick: () => openGameForm(game.id) },
          el('span', { class: 'cup-list__text' }, el('span', { class: 'cup-list__name' }), el('span', { class: 'cup-list__sub' })),
          el('span', { class: 'cup-standing__chevron', html: icons.chevronRight }),
        ),
      );
    }

    function updateRow(row, game, state) {
      const text = row.firstChild.firstChild;
      const played = game.played ? `played ${game.played} ${game.played === 1 ? 'time' : 'times'}` : 'not played yet';
      const expert = state.names[game.specialist];
      text.firstChild.textContent = game.name;
      if (game.kind === 'general') text.lastChild.textContent = played[0].toUpperCase() + played.slice(1);
      else if (!game.available) text.lastChild.textContent = `${expert ?? 'Its specialist'} left, so it sits out the draw`;
      else text.lastChild.textContent = `${expert}’s game · ${played}`;
      row.classList.toggle('cup-list__item--away', !game.available);
    }

    function paint() {
      const state = cup.getState();
      summary.textContent = `${catalogLabel(state.games)}. About 3 in every 4 games picked are General. In a Specialized game, everyone who finishes ahead of its specialist gets +${state.bonus}.`;
      for (const [kind, list, head] of [
        ['general', general, generalHead],
        ['specialized', specialized, specializedHead],
      ]) {
        const games = state.games.filter((game) => game.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
        head.textContent = kind === 'general' ? 'General: everyone’s about as good' : 'Specialized: one roommate is clearly better';
        reconcile(list, games, (game) => game.id, gameRow, (row, game) => updateRow(row, game, state));
        list.hidden = games.length === 0;
      }
    }

    openSheet({ title: 'Games', content, primary: { label: 'Done', onClick: closeSheet }, cancel: false, refresh: paint });
    paint();
  }

  function openGameForm(id) {
    const existing = id ? cup.getState().games.find((g) => g.id === id) : null;
    if (id && !existing) return;
    const draft = { kind: existing?.kind ?? 'general', specialist: existing?.specialist ?? null };
    const fields = textFields([{ label: 'Name', value: existing?.name ?? '', max: 40 }], save);
    const [nameInput] = fields.inputs;
    const general = segment('General', () => set({ kind: 'general' }));
    const special = segment('Specialized', () => set({ kind: 'specialized' }));
    const explain = el('p', { class: 'cup-form__hint' });
    const experts = el('div', { class: 'chip-row' });
    const expertGroup = el('div', { class: 'cup-form__group' }, el('p', { class: 'cup-form__label', text: 'Who’s best at it?' }), experts);
    const content = el(
      'div',
      { class: 'cup-form' },
      el('div', { class: 'cup-fields' }, fields.nodes),
      el('div', { class: 'cup-segmented', role: 'group', 'aria-label': 'Kind of game' }, general, special),
      explain,
      expertGroup,
      existing && el('button', { class: 'cup-button cup-button--danger cup-button--wide', type: 'button', text: 'Remove from the Catalog', onclick: remove }),
    );

    function set(changes) {
      Object.assign(draft, changes);
      paint();
    }

    function paint() {
      const state = cup.getState();
      general.setAttribute('aria-pressed', String(draft.kind === 'general'));
      special.setAttribute('aria-pressed', String(draft.kind === 'specialized'));
      explain.textContent =
        draft.kind === 'general'
          ? 'Everyone’s about as good at it. Most weeks’ games come from here.'
          : `One roommate is clearly better at it. When it comes up, everyone who finishes ahead of them gets +${state.bonus}.`;
      expertGroup.hidden = draft.kind !== 'specialized';
      reconcile(
        experts,
        state.players,
        (player) => player.id,
        (player) => el('button', { class: 'chip cup-chip', type: 'button', onclick: () => set({ specialist: player.id }) }),
        (chip, player) => {
          chip.textContent = player.name;
          chip.setAttribute('aria-pressed', String(draft.specialist === player.id));
        },
      );
    }

    async function save() {
      const own = sheet;
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      if (!name) {
        nudge(nameInput.parentElement);
        return fields.focus(nameInput);
      }
      if (draft.kind === 'specialized' && !cup.getState().players.some((p) => p.id === draft.specialist)) {
        nudge(experts);
        return toast(cup.getState().players.length ? 'Pick who’s best at it.' : 'Sign up the roommates first.');
      }
      own.primaryButton.disabled = true;
      try {
        const game = { name, kind: draft.kind, specialist: draft.kind === 'specialized' ? draft.specialist : null };
        if (existing) await cup.updateGame(existing.id, game);
        else await cup.addGame(game);
        if (sheet === own) openCatalog();
      } catch (err) {
        toast(err.message);
        own.primaryButton.disabled = false;
      }
    }

    function remove() {
      openCatalog();
      cup.removeGame(existing.id).then(
        () =>
          toast(`${existing.name} taken out`, {
            action: 'Undo',
            onAction: () => cup.restoreGames([existing.id]).catch((err) => toast(err.message)),
          }),
        (err) => toast(err.message),
      );
    }

    openSheet({
      title: existing ? existing.name : 'New Game',
      content,
      primary: { label: existing ? 'Save' : 'Add', onClick: save },
      refresh: () => (existing && !cup.getState().games.some((g) => g.id === existing.id) ? closeSheet() : paint()),
      onClose: fields.destroy,
    });
    paint();
    if (!existing) fields.focus();
  }

  // The weekly game night

  function openSchedule() {
    const state = cup.getState();
    const draft = { ...state.schedule };
    const onSwitch = el(
      'button',
      { class: 'cup-switch', type: 'button', role: 'switch', onclick: () => set({ on: !draft.on }) },
      el('span', { class: 'cup-switch__text' }, el('span', { class: 'cup-switch__title', text: 'Every week' }), el('span', { class: 'cup-switch__help' })),
      el('span', { class: 'cup-switch__track' }),
    );
    const days = DAY_LETTERS.map((letter, day) =>
      el('button', { class: 'cup-day', type: 'button', text: letter, 'aria-label': DAY_NAMES[day], onclick: () => set({ day }) }),
    );
    const timeValue = el('span', { class: 'cup-stepper__value' });
    const announce = el('div', { class: 'chip-row' });
    const perNight = PER_NIGHT.map((count) => segment(String(count), () => set({ perNight: count })));
    const content = el(
      'div',
      { class: 'cup-form' },
      onSwitch,
      group('Day', el('div', { class: 'cup-days' }, days)),
      group(
        'Starts at',
        el(
          'div',
          { class: 'cup-stepper' },
          el('button', { class: 'cup-stepper__step', type: 'button', html: svg.minus, 'aria-label': 'Earlier', onclick: () => stepTime(-1) }),
          timeValue,
          el('button', { class: 'cup-stepper__step', type: 'button', html: icons.plus, 'aria-label': 'Later', onclick: () => stepTime(1) }),
        ),
      ),
      group('Send the games at', announce, el('p', { class: 'cup-form__hint', text: channelsLabel(state.channels) })),
      group('Games each night', el('div', { class: 'cup-segmented', role: 'group', 'aria-label': 'Games each night' }, perNight)),
    );

    function set(changes) {
      Object.assign(draft, changes);
      paint();
    }

    // The games have to go out before game night starts.
    function stepTime(by) {
      const time = stepGameTime(draft.time, by);
      const choices = announceChoices(time);
      set({ time, announce: choices.includes(draft.announce) ? draft.announce : choices.at(-1) });
    }

    function paint() {
      onSwitch.setAttribute('aria-checked', String(draft.on));
      onSwitch.querySelector('.cup-switch__help').textContent = draft.on
        ? `${DAY_NAMES[draft.day]}s, until you pause it`
        : 'Paused: no games are picked or sent';
      days.forEach((pill, day) => pill.setAttribute('aria-pressed', String(draft.day === day)));
      timeValue.textContent = clockLabel(draft.time);
      reconcile(
        announce,
        announceChoices(draft.time),
        (time) => time,
        (time) => el('button', { class: 'chip cup-chip', type: 'button', onclick: () => set({ announce: time }) }),
        (chip, time) => {
          chip.textContent = clockLabel(time);
          chip.setAttribute('aria-pressed', String(draft.announce === time));
        },
      );
      perNight.forEach((option, index) => option.setAttribute('aria-pressed', String(draft.perNight === PER_NIGHT[index])));
    }

    async function save() {
      const own = sheet;
      own.primaryButton.disabled = true;
      try {
        await cup.setSchedule(draft);
        if (sheet === own) closeSheet();
      } catch (err) {
        toast(err.message);
        own.primaryButton.disabled = false;
      }
    }

    openSheet({ title: 'Game Night', content, primary: { label: 'Save', onClick: save } });
    paint();
  }

  // Who finished where: tap roommates in the order they finished.

  function openRecord(weekId, pickId) {
    const find = () => {
      const week = cup.getState().weeks.find((w) => w.id === weekId);
      return { week, pick: week?.picks.find((p) => p.id === pickId) };
    };
    const { pick } = find();
    if (!pick) return;
    let finishers = fromOrder(pick.result);
    const order = el('ol', { class: 'cup-finishers', 'aria-label': 'Finishing order' });
    const pool = el('div', { class: 'chip-row' });
    const poolGroup = el('div', { class: 'cup-form__group' }, el('p', { class: 'cup-form__label', text: 'Tap who finished next' }), pool);
    const hint = el('p', { class: 'cup-form__hint' });
    const content = el(
      'div',
      { class: 'cup-form' },
      hint,
      order,
      poolGroup,
      pick.result && el('button', { class: 'cup-button cup-button--danger cup-button--wide', type: 'button', text: 'Clear Result', onclick: clear }),
    );

    // Everyone signed up, plus anyone in the saved result who's since left.
    function choices(state) {
      const ids = state.players.map((p) => p.id);
      for (const { id } of fromOrder(pick.result)) if (!ids.includes(id)) ids.push(id);
      return ids;
    }

    function paint() {
      const state = cup.getState();
      const current = find().pick;
      if (!current) return closeSheet();
      const places = finisherPlaces(finishers);
      const expert = current.kind === 'specialized' ? state.names[current.specialist] : null;
      hint.textContent = `Tap everyone in the order they finished. Leave out anyone who didn’t play.${
        expert ? ` Anyone ahead of ${expert} gets +${state.bonus}.` : ''
      }`;
      reconcile(
        order,
        finishers,
        (f) => f.id,
        (f) =>
          el(
            'li',
            { class: 'cup-finisher' },
            el('span', { class: 'cup-finisher__place' }),
            el('span', { class: 'cup-avatar', 'aria-hidden': 'true' }),
            el('span', { class: 'cup-finisher__name' }),
            el('button', { class: 'cup-finisher__tie', type: 'button', text: 'Tied', onclick: () => update(toggleTie(finishers, finishers.findIndex((x) => x.id === f.id))) }),
            el('button', { class: 'cup-finisher__remove', type: 'button', html: icons.close, onclick: () => update(tapFinisher(finishers, f.id)) }),
          ),
        (row, f) => {
          const index = finishers.indexOf(f);
          const [place, avatar, label, tie, remove] = row.children;
          const who = state.names[f.id] ?? 'Someone';
          place.textContent = ordinal(places[index]);
          avatar.className = `cup-avatar cup-avatar--${avatarColor(f.id)}`;
          avatar.textContent = initials(who);
          label.textContent = who;
          tie.hidden = index === 0;
          tie.setAttribute('aria-pressed', String(f.tied));
          tie.setAttribute('aria-label', `${who} tied with the one above`);
          remove.setAttribute('aria-label', `Take ${who} out`);
        },
      );
      order.hidden = finishers.length === 0;
      const left = choices(state).filter((id) => !finishers.some((f) => f.id === id));
      reconcile(
        pool,
        left,
        (id) => id,
        (id) => el('button', { class: 'chip cup-chip', type: 'button', onclick: () => update(tapFinisher(finishers, id)) }),
        (chip, id) => {
          chip.textContent = state.names[id] ?? 'Someone';
          chip.setAttribute('aria-label', `${state.names[id] ?? 'Someone'} finished ${ordinal(finishers.length + 1)}`);
        },
      );
      poolGroup.hidden = left.length === 0;
      if (sheet) sheet.primaryButton.disabled = finishers.length < 2;
    }

    function update(next) {
      finishers = next;
      paint();
    }

    async function save() {
      const own = sheet;
      own.primaryButton.disabled = true;
      try {
        await cup.record(weekId, pickId, toOrder(finishers));
        if (sheet === own) closeSheet();
        toast(`${pick.name} recorded`);
      } catch (err) {
        toast(err.message);
        own.primaryButton.disabled = false;
      }
    }

    function clear() {
      closeSheet();
      const before = pick.result;
      cup.record(weekId, pickId, null).then(
        () => toast(`${pick.name} result cleared`, { action: 'Undo', onAction: () => cup.record(weekId, pickId, before).catch((err) => toast(err.message)) }),
        (err) => toast(err.message),
      );
    }

    openSheet({ title: pick.name, content, primary: { label: 'Save', onClick: save }, refresh: paint });
    paint();
  }

  // How someone got their points.

  function openPlayer(playerId) {
    const stats = el('div', { class: 'cup-stats' });
    const list = el('ul', { class: 'cup-ledger', 'aria-label': 'Points, game by game' });
    const empty = el('p', { class: 'cup-form__hint', text: 'No games yet. Points show up here once results are in.' });
    const content = el(
      'div',
      { class: 'cup-form' },
      stats,
      list,
      empty,
      el('p', { class: 'cup-form__hint' }),
    );

    function paint() {
      const state = cup.getState();
      const player = state.players.find((p) => p.id === playerId);
      if (!player) return closeSheet();
      content.lastChild.textContent = `A point for every roommate you finish ahead of. Beat a Specialized game’s specialist for +${state.bonus}.`;
      stats.replaceChildren(
        stat(player.points, player.points === 1 ? 'Point' : 'Points'),
        stat(player.wins, player.wins === 1 ? 'Win' : 'Wins'),
        stat(player.crowns, player.crowns === 1 ? 'Best night' : 'Best nights'),
        stat(player.bonus, 'Bonus'),
      );
      const entries = state.ledger[playerId] ?? [];
      reconcile(
        list,
        entries,
        (entry) => `${entry.week}:${entry.pick}`,
        () =>
          el(
            'li',
            { class: 'cup-entry' },
            el('span', { class: 'cup-entry__text' }, el('span', { class: 'cup-entry__game' }), el('span', { class: 'cup-entry__when' })),
            el('span', { class: 'cup-entry__gain' }),
          ),
        (row, entry) => {
          const [text, gain] = row.children;
          text.firstChild.textContent = entry.game;
          text.lastChild.textContent = `${nightLabel(entry.week)} · ${placeLabel(entry)}${entry.bonus ? ` · beat the specialist (+${entry.bonus})` : ''}`;
          gain.textContent = gainLabel(entry);
        },
      );
      list.hidden = entries.length === 0;
      empty.hidden = entries.length > 0;
    }

    const player = cup.getState().players.find((p) => p.id === playerId);
    if (!player) return;
    openSheet({ title: player.name, content, primary: { label: 'Done', onClick: closeSheet }, cancel: false, refresh: paint });
    paint();
  }

  // From the widget, and from the link in the texts and emails.
  function runIntent(action) {
    if (action === 'signup') return openPlayerForm();
    if (action !== 'record') return;
    const week = currentWeek(cup.getState().weeks, new Date());
    const pick = week?.picks.find((p) => !p.result);
    if (pick) openRecord(week.id, pick.id);
    else if (week) toast('Every game that night has a result.');
    else toast('Nothing to record yet: the games haven’t been picked.');
  }

  const unsubscribe = cup.subscribe(render);
  const clock = setInterval(() => render(cup.getState()), REFRESH_MS);
  render(cup.getState());

  return {
    intent(action) {
      if (isReady(cup.getState())) runIntent(action);
      else pendingIntent = action;
    },
    // The app is closing: a sheet (and its keyboard) goes with it.
    closeKeyboard: closeSheet,
    unmount() {
      unsubscribe();
      clearInterval(clock);
      closeSheet();
    },
  };
}

function winnersOf(pick, names) {
  return pick.result[0].map((id) => names[id] ?? 'Someone').join(' & ');
}

function iconSpan(html) {
  return el('span', { class: 'cup-button__icon', html });
}

function toolButton(html, label, onclick) {
  return el('button', { class: 'cup-tool', type: 'button', onclick }, iconSpan(html), el('span', { text: label }));
}

function segment(label, onclick) {
  return el('button', { class: 'cup-segmented__option', type: 'button', text: label, onclick });
}

function group(label, ...children) {
  return el('div', { class: 'cup-form__group' }, el('p', { class: 'cup-form__label', text: label }), ...children);
}

function stat(value, label) {
  return el('div', { class: 'cup-stat' }, el('span', { class: 'cup-stat__value', text: String(value) }), el('span', { class: 'cup-stat__label', text: label }));
}
