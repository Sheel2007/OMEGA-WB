// Countdown: the full-screen app. Every day the house is waiting for, soonest
// first, with a form to add one (a name and a day) and a way to clear them.
// Days that have been stay at the bottom until someone clears them.
import { createKeyboard } from '../../keyboard.js';
import { animateLayout, el, icons, nudge, reconcile, toast } from '../../ui.js';
import { dayKey, msUntilMidnight } from '../calendar/agenda.js';
import { bigNumber, countLabel, dateLabel, finished, spoken, upcoming } from './format.js';
import { name } from './meta.js';

// Matches what the server accepts (board/countdown.py).
const MAX_TITLE_LENGTH = 40;
const YEARS_AHEAD = 5;

export function mount(root, { services, kiosk }) {
  const { countdown } = services;
  let firstRender = true;
  let keyboard = null;
  let midnight = null;

  const meta = el('p', { class: 'countdown-app__meta' });
  const input = el('input', {
    class: 'add-bar__input',
    type: 'text',
    name: 'countdown',
    placeholder: 'What are we waiting for?',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    maxlength: String(MAX_TITLE_LENGTH),
    'aria-label': 'Name of the day',
    inputmode: kiosk ? 'none' : null,
  });
  const picker = el('input', { class: 'countdown-form__date', type: 'date', name: 'countdown-date', 'aria-label': 'The day' });
  const submitButton = el('button', { class: 'add-bar__submit', type: 'submit', text: 'Add', disabled: true });
  const form = el(
    'form',
    { class: 'add-bar countdown-form', onsubmit: (event) => (event.preventDefault(), add()) },
    el('span', { class: 'add-bar__plus', html: icons.plus }),
    input,
    picker,
    submitButton,
  );
  const ready = () => {
    submitButton.disabled = !input.value.trim() || !picker.value;
  };
  input.addEventListener('input', ready);
  picker.addEventListener('input', ready);
  picker.addEventListener('change', ready);

  const list = el('ul', { class: 'countdown-app__list', 'aria-label': 'Coming up' });
  const doneTitle = el('h2', { class: 'countdown-app__section', text: 'Been and gone' });
  const doneList = el('ul', { class: 'countdown-app__list countdown-app__list--done', 'aria-label': 'Been and gone' });
  const done = el('section', { class: 'countdown-app__done' }, doneTitle, doneList);
  const empty = el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-state__art', html: icons.plus }),
    el('p', { class: 'empty-state__title', text: 'Nothing to count down to' }),
    el('p', { class: 'empty-state__text', text: 'Add the next thing worth waiting for: a trip, a break, the end of exams.' }),
  );
  const view = el(
    'div',
    { class: 'countdown-app' },
    el(
      'header',
      { class: 'countdown-app__header' },
      el('div', { class: 'countdown-app__heading' }, el('h1', { class: 'countdown-app__title', text: name }), meta),
    ),
    form,
    el('div', { class: 'countdown-app__scroll' }, list, done, empty),
  );
  root.append(view);

  if (kiosk) {
    keyboard = createKeyboard({
      input,
      enterLabel: 'Done',
      // The name is in; the day is next.
      onEnter: () => {
        keyboard.hide();
        if (picker.value) add();
        else openPicker();
      },
      onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
    });
    root.append(keyboard.node);
  }

  function openPicker() {
    picker.focus();
    try {
      picker.showPicker();
    } catch {
      // Not every browser can open it from a script; the field has focus anyway.
    }
  }

  function setLimits() {
    const today = new Date();
    picker.min = dayKey(today);
    picker.max = `${today.getFullYear() + YEARS_AHEAD}-12-31`;
  }

  async function add() {
    const text = input.value.trim();
    const day = picker.value;
    if (!text || !day) {
      nudge(form);
      if (text && !day) openPicker();
      return;
    }
    input.value = '';
    picker.value = '';
    ready();
    try {
      await countdown.addCountdown(text, day);
      keyboard?.hide();
      toast(`Counting down to ${text}`);
    } catch (err) {
      toast(err.message);
      if (!input.value && !picker.value) {
        input.value = text;
        picker.value = day;
        ready();
      }
    }
  }

  function remove(countdownId, title) {
    countdown.removeCountdown(countdownId).then(
      () =>
        toast(`${title} removed`, {
          action: 'Undo',
          onAction: () => countdown.restoreCountdowns([countdownId]).catch((e) => toast(e.message)),
        }),
      (err) => toast(err.message),
    );
  }

  // Cards: the days left, big, then the name and the day, and a remove button.

  function createCard() {
    const card = el('li', { class: 'countdown-card' });
    card.append(
      el(
        'p',
        { class: 'countdown-card__left' },
        el('span', { class: 'countdown-card__number' }),
        el('span', { class: 'countdown-card__unit' }),
      ),
      el(
        'div',
        { class: 'countdown-card__what' },
        el('p', { class: 'countdown-card__title' }),
        el('p', { class: 'countdown-card__date' }),
      ),
      el('button', {
        class: 'countdown-card__remove',
        type: 'button',
        html: icons.close,
        onclick: () => remove(card.dataset.key, card.dataset.title),
      }),
    );
    return card;
  }

  function updateCard(card, item, today) {
    const [left, what, removeButton] = card.children;
    const big = bigNumber(item.days);
    left.firstChild.textContent = big.number;
    left.lastChild.textContent = item.days < 0 ? `${big.unit} ago` : big.unit;
    what.firstChild.textContent = item.title;
    what.lastChild.textContent = dateLabel(item, today);
    card.dataset.title = item.title;
    card.classList.toggle('countdown-card--today', item.days === 0);
    card.setAttribute('aria-label', spoken(item, today));
    removeButton.setAttribute('aria-label', `Remove ${item.title}`);
  }

  function render(state) {
    const today = dayKey(new Date());
    const coming = upcoming(state.countdowns, today);
    const gone = finished(state.countdowns, today);
    meta.textContent = countLabel(coming.length);
    setLimits();
    const apply = () => {
      reconcile(list, coming, (item) => item.id, createCard, (card, item) => updateCard(card, item, today));
      reconcile(doneList, gone, (item) => item.id, createCard, (card, item) => updateCard(card, item, today));
      list.hidden = coming.length === 0;
      done.hidden = gone.length === 0;
      empty.hidden = coming.length > 0 || gone.length > 0;
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(view, apply);
    }
  }

  function atMidnight() {
    midnight = setTimeout(() => {
      render(countdown.getState());
      atMidnight();
    }, msUntilMidnight(new Date()) + 1000);
  }

  const unsubscribe = countdown.subscribe(render);
  render(countdown.getState());
  atMidnight();

  return {
    intent(action) {
      if (action !== 'add') return;
      if (keyboard) keyboard.show();
      else input.focus();
    },
    closeKeyboard() {
      keyboard?.hide();
    },
    unmount() {
      unsubscribe();
      clearTimeout(midnight);
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}
