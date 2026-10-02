// Shopping list: the full-screen app.
import { buyAgain, nameKey, suggest } from '../../groceries.js';
import { createKeyboard } from '../../keyboard.js';
import { fetchQrSvg } from '../../services/board.js';
import { animateLayout, el, flash, icons, itemGlyph, MAX_ROWS, nudge, reconcile, toast } from '../../ui.js';
import { name } from './meta.js';
import { boughtOf, countLabel, shownDone, toBuyOf, toggleItem } from './settle.js';

const BUY_AGAIN_COUNT = 10;
const KEYBOARD_SUGGESTIONS = 3;

export function mount(root, { services, kiosk, info }) {
  const { shopping } = services;
  let firstRender = true;
  let keyboard = null;
  let unmounted = false;

  const title = el('h1', { class: 'shopping-app__title', text: name });
  const meta = el('p', { class: 'shopping-app__meta' });

  const input = el('input', {
    class: 'add-bar__input',
    type: 'text',
    name: 'item',
    placeholder: 'Add an item',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    maxlength: '80',
    'aria-label': 'Item to add',
    inputmode: kiosk ? 'none' : null,
  });
  const submitButton = el('button', { class: 'add-bar__submit', type: 'submit', text: 'Add', disabled: true });
  const form = el(
    'form',
    { class: 'add-bar', onsubmit: (event) => (event.preventDefault(), addItem(input.value, { fromInput: true })) },
    el('span', { class: 'add-bar__plus', html: icons.plus }),
    input,
    submitButton,
  );
  input.addEventListener('input', () => {
    submitButton.disabled = !input.value.trim();
  });

  const todoList = el('ul', { class: 'check-list', 'aria-label': 'To buy' });
  const todoOverflow = el('p', { class: 'shopping-app__overflow' });
  const doneTitle = el('h2', { class: 'shopping-app__done-title' });
  const doneList = el('ul', { class: 'check-list check-list--quiet', 'aria-label': 'Bought' });
  const doneOverflow = el('p', { class: 'shopping-app__overflow' });
  const done = el(
    'section',
    { class: 'shopping-app__done' },
    el(
      'header',
      { class: 'shopping-app__done-head' },
      doneTitle,
      el('button', { class: 'shopping-app__clear', type: 'button', text: 'Clear bought', onclick: clearBought }),
    ),
    doneList,
    doneOverflow,
  );
  const emptyTitle = el('p', { class: 'empty-state__title' });
  const emptyText = el('p', { class: 'empty-state__text' });
  const empty = el('div', { class: 'empty-state' }, el('div', { class: 'empty-state__art', html: icons.bag }), emptyTitle, emptyText);
  const scroll = el('div', { class: 'shopping-app__scroll' }, todoList, todoOverflow, empty, done);

  const chips = el('div', { class: 'chip-row' });
  const again = el('section', { class: 'panel panel--again' }, el('h2', { class: 'panel__title', text: 'Buy again' }), chips);
  const qr = el('div', { class: 'phone-link__qr', role: 'img', 'aria-label': 'QR code for this list' });
  const url = el('p', { class: 'phone-link__url' });
  const phone = el(
    'section',
    { class: 'panel panel--phone' },
    el('h2', { class: 'panel__title', text: 'On your phone' }),
    el(
      'div',
      { class: 'phone-link' },
      qr,
      el('div', {}, el('p', { class: 'phone-link__text', text: 'Scan to add things from your phone. Works on the home Wi-Fi.' }), url),
    ),
  );
  phone.hidden = true;

  const view = el(
    'div',
    { class: 'shopping-app' },
    el('div', { class: 'shopping-app__main' }, el('header', { class: 'shopping-app__header' }, title, meta), form, scroll),
    el('aside', { class: 'shopping-app__side' }, again, phone),
  );
  root.append(view);

  info.then(async (details) => {
    if (!details?.url) return;
    const svg = await fetchQrSvg();
    if (unmounted) return;
    url.textContent = details.url.replace(/^https?:\/\//, '').replace(/\/#.*$/, '');
    if (svg) qr.innerHTML = svg;
    phone.hidden = false;
  });

  if (kiosk) {
    keyboard = createKeyboard({
      input,
      onEnter: () => addItem(input.value, { fromInput: true }),
      onPick: (picked) => {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        addItem(picked);
      },
      getSuggestions: (value) => {
        const items = shopping.getItems();
        const recent = shopping.getRecent();
        const onList = new Set(items.map((i) => nameKey(i.name)));
        if (!value.trim()) return buyAgain(recent, onList, KEYBOARD_SUGGESTIONS);
        const stillToBuy = new Set(items.filter((i) => !i.done).map((i) => nameKey(i.name)));
        return suggest(value, { recent, exclude: stillToBuy, limit: KEYBOARD_SUGGESTIONS });
      },
      onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
    });
    root.append(keyboard.node);
  }

  async function addItem(raw, { fromInput = false } = {}) {
    const value = raw.trim();
    if (!value) {
      nudge(form);
      return;
    }
    if (fromInput) {
      input.value = '';
      input.dispatchEvent(new Event('input'));
    }
    try {
      const result = await shopping.addItem(value);
      const row = todoList.querySelector(`[data-key="${result.item.id}"]`);
      if (result.outcome === 'exists') {
        toast(`${result.item.name} is already on the list`);
        flash(row);
      } else if (result.outcome === 'readded') {
        flash(row);
      }
    } catch (err) {
      toast(err.message);
      if (fromInput && !input.value) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
    }
    keyboard?.refresh();
  }

  function removeItem(itemId) {
    const item = shopping.getItems().find((i) => i.id === itemId);
    if (!item) return;
    shopping.removeItem(itemId).then(
      () => toast(`Removed ${item.name}`, { action: 'Undo', onAction: () => shopping.restoreItems([itemId]).catch((e) => toast(e.message)) }),
      (err) => toast(err.message),
    );
  }

  function clearBought() {
    const count = shopping.getItems().filter((i) => i.done).length;
    shopping.clearBought().then(
      (result) => {
        const label = count === 1 ? 'Cleared 1 bought item' : `Cleared ${count} bought items`;
        toast(label, { action: 'Undo', onAction: () => shopping.restoreItems(result.removed).catch((e) => toast(e.message)) });
      },
      (err) => toast(err.message),
    );
  }

  function setRowDone(row, isDone) {
    row.classList.toggle('check-list__item--done', isDone);
    row.firstChild.setAttribute('aria-pressed', String(isDone));
  }

  function createRow() {
    const row = el('li', { class: 'check-list__item' });
    const toggleButton = el('button', {
      class: 'check-list__toggle',
      type: 'button',
      onclick: () => toggleItem(shopping, row.dataset.key, (isDone) => setRowDone(row, isDone)),
    });
    const removeButton = el('button', {
      class: 'check-list__remove',
      type: 'button',
      html: icons.close,
      onclick: () => removeItem(row.dataset.key),
    });
    row.append(toggleButton, removeButton);
    return row;
  }

  function updateRow(row, item) {
    setRowDone(row, shownDone(item));
    if (row.dataset.name !== item.name) {
      row.dataset.name = item.name;
      row.firstChild.replaceChildren(
        el('span', { class: 'check-list__check', html: icons.check }),
        itemGlyph(item.name, 'check-list__glyph'),
        el('span', { class: 'check-list__name', text: item.name }),
      );
      row.lastChild.setAttribute('aria-label', `Remove ${item.name}`);
    }
  }

  function renderChips(state) {
    const onList = new Set(state.items.map((i) => nameKey(i.name)));
    const names = buyAgain(state.recent, onList, BUY_AGAIN_COUNT);
    again.hidden = names.length === 0;
    reconcile(
      chips,
      names,
      (n) => nameKey(n),
      (n) =>
        el(
          'button',
          { class: 'chip', type: 'button', onclick: () => addItem(n) },
          itemGlyph(n, 'chip__glyph'),
          el('span', { class: 'chip__label', text: n }),
        ),
      () => {},
    );
  }

  function overflowNote(node, hidden) {
    node.hidden = hidden === 0;
    node.textContent = `${hidden} more not shown`;
  }

  function render(state) {
    const todo = toBuyOf(state.items);
    const bought = boughtOf(state.items);
    // Keep the DOM light: never more than MAX_ROWS rows across both lists.
    const todoShown = todo.slice(0, MAX_ROWS);
    const boughtShown = bought.slice(0, MAX_ROWS - todoShown.length);
    meta.textContent = bought.length ? `${countLabel(todo.length)} · ${bought.length} bought` : countLabel(todo.length);

    const apply = () => {
      reconcile(todoList, todoShown, (i) => i.id, createRow, updateRow);
      reconcile(doneList, boughtShown, (i) => i.id, createRow, updateRow);
      overflowNote(todoOverflow, todo.length - todoShown.length);
      overflowNote(doneOverflow, bought.length - boughtShown.length);
      todoList.hidden = todo.length === 0;
      done.hidden = bought.length === 0;
      doneTitle.textContent = `Bought (${bought.length})`;
      empty.hidden = todo.length > 0;
      emptyTitle.textContent = bought.length ? 'All bought' : 'Nothing to buy';
      emptyText.textContent = bought.length
        ? 'Clear the bought items once they’re put away.'
        : 'Add an item above, or pick one from Buy again.';
      renderChips(state);
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(view, apply);
    }
    keyboard?.refresh();
  }

  const unsubscribe = shopping.subscribe(render);
  render(shopping.getState());

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
      unmounted = true;
      unsubscribe();
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}
