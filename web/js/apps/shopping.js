// Shopping list: the full-screen app and its home-screen widget.
import { buyAgain, nameKey, suggest } from '../groceries.js';
import { createKeyboard } from '../keyboard.js';
import { animateLayout, el, flash, haptic, icons, itemGlyph, nudge, reconcile, toast } from '../ui.js';

// Lets a checked row show its tick before it slides down to "Bought".
const SETTLE_MS = 420;
const WIDGET_MAX_ITEMS = 10;
const BUY_AGAIN_COUNT = 10;

export const id = 'shopping';
export const name = 'Shopping list';
export const iconBackground = 'var(--icon-shopping)';
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M31.5 23.5c-.6-6.2-4.4-10.6-10.5-11.5-.5 6.3 3.6 10.9 10.5 11.5z" fill="#fff" fill-opacity=".72"/>
  <path d="M33 23.5c.2-7.6 5.2-13.2 13-14.2.4 7.9-4.8 13.6-13 14.2z" fill="#fff" fill-opacity=".94"/>
  <path d="M14.5 25.5h35a2 2 0 0 1 2 2.2l-2.4 23.6a4.5 4.5 0 0 1-4.5 4.1H19.4a4.5 4.5 0 0 1-4.5-4.1L12.5 27.7a2 2 0 0 1 2-2.2z" fill="#fff"/>
  <path d="M24.5 35.5a7.5 7.5 0 0 0 15 0" fill="none" stroke="#1b7f45" stroke-width="3.2" stroke-linecap="round"/>
</svg>`;

// Taps waiting to be sent, shared by the app and the widget: id -> { timer, done }.
const settling = new Map();

function shownDone(item) {
  return settling.has(item.id) ? settling.get(item.id).done : item.done;
}

function toggle(store, itemId, render) {
  const item = store.state.items.find((i) => i.id === itemId);
  if (!item) return;
  const waiting = settling.get(itemId);
  if (waiting) {
    // Second tap before it settled: treat it as "never mind".
    clearTimeout(waiting.timer);
    settling.delete(itemId);
    render(item.done);
    return;
  }
  const done = !item.done;
  haptic();
  render(done);
  const timer = setTimeout(() => {
    settling.delete(itemId);
    store.check(itemId, done).catch((err) => {
      toast(err.message);
      render(item.done);
    });
  }, SETTLE_MS);
  settling.set(itemId, { timer, done });
}

function bySoonestBought(a, b) {
  return String(b.checked).localeCompare(String(a.checked));
}

function countLabel(toBuy) {
  return toBuy === 0 ? 'Nothing to buy' : `${toBuy} to buy`;
}

// Full-screen app

export function mount(root, { store, kiosk, info, onTypingChange }) {
  let firstRender = true;
  let keyboard = null;

  const title = el('h1', { class: 'shop__title', text: name });
  const meta = el('p', { class: 'shop__meta' });

  const input = el('input', {
    class: 'add__input',
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
  const submitButton = el('button', { class: 'add__submit', type: 'submit', text: 'Add', disabled: true });
  const form = el(
    'form',
    { class: 'add', onsubmit: (event) => (event.preventDefault(), addItem(input.value, { fromInput: true })) },
    el('span', { class: 'add__plus', html: icons.plus }),
    input,
    submitButton,
  );
  input.addEventListener('input', () => {
    submitButton.disabled = !input.value.trim();
  });

  const todoList = el('ul', { class: 'list', 'aria-label': 'To buy' });
  const doneTitle = el('h2', { class: 'done__title' });
  const doneList = el('ul', { class: 'list', 'aria-label': 'Bought' });
  const done = el(
    'section',
    { class: 'done' },
    el(
      'header',
      { class: 'done__head' },
      doneTitle,
      el('button', { class: 'done__clear', type: 'button', text: 'Clear bought', onclick: clearBought }),
    ),
    doneList,
  );
  const emptyTitle = el('p', { class: 'empty__title' });
  const emptyText = el('p', { class: 'empty__text' });
  const empty = el('div', { class: 'empty' }, el('div', { class: 'empty__art', html: icons.bag }), emptyTitle, emptyText);
  const scroll = el('div', { class: 'shop__scroll' }, todoList, empty, done);

  const chips = el('div', { class: 'chips' });
  const again = el('section', { class: 'panel panel--again' }, el('h2', { class: 'panel__title', text: 'Buy again' }), chips);
  const qr = el('div', { class: 'phone__qr', role: 'img', 'aria-label': 'QR code for this list' });
  const url = el('p', { class: 'phone__url' });
  const phone = el(
    'section',
    { class: 'panel panel--phone' },
    el('h2', { class: 'panel__title', text: 'On your phone' }),
    el(
      'div',
      { class: 'phone' },
      qr,
      el('div', {}, el('p', { class: 'phone__text', text: 'Scan to add things from your phone. Works on the home Wi-Fi.' }), url),
    ),
  );
  phone.hidden = true;

  const view = el(
    'div',
    { class: 'shop' },
    el('div', { class: 'shop__main' }, el('header', { class: 'shop__header' }, title, meta), form, scroll),
    el('aside', { class: 'side' }, again, phone),
  );
  root.append(view);

  info.then(async (details) => {
    if (!details?.url) return;
    url.textContent = details.url.replace(/^https?:\/\//, '').replace(/\/#.*$/, '');
    const svg = await fetch('/api/qr.svg', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (svg?.startsWith('<svg')) qr.innerHTML = svg;
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
        const onList = new Set(store.state.items.map((i) => nameKey(i.name)));
        if (!value.trim()) return buyAgain(store.state.recent, onList, 3);
        const stillToBuy = new Set(store.state.items.filter((i) => !i.done).map((i) => nameKey(i.name)));
        return suggest(value, { recent: store.state.recent, exclude: stillToBuy, limit: 3 });
      },
      onToggle: (open) => {
        document.documentElement.classList.toggle('is-typing', open);
        onTypingChange?.(open);
      },
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
      const result = await store.add(value);
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
    const item = store.state.items.find((i) => i.id === itemId);
    if (!item) return;
    store.remove(itemId).then(
      () => toast(`Removed ${item.name}`, { action: 'Undo', onAction: () => store.restore([itemId]).catch((e) => toast(e.message)) }),
      (err) => toast(err.message),
    );
  }

  function clearBought() {
    const count = store.state.items.filter((i) => i.done).length;
    store.clearChecked().then(
      (result) => {
        const label = count === 1 ? 'Cleared 1 bought item' : `Cleared ${count} bought items`;
        toast(label, { action: 'Undo', onAction: () => store.restore(result.removed).catch((e) => toast(e.message)) });
      },
      (err) => toast(err.message),
    );
  }

  function createRow(item) {
    const row = el('li', { class: 'item' });
    const toggleButton = el('button', { class: 'item__toggle', type: 'button' });
    const removeButton = el('button', { class: 'item__remove', type: 'button', html: icons.close });
    toggleButton.addEventListener('click', () =>
      toggle(store, row.dataset.key, (isDone) => {
        row.dataset.done = String(isDone);
        toggleButton.setAttribute('aria-pressed', String(isDone));
      }),
    );
    removeButton.addEventListener('click', () => removeItem(row.dataset.key));
    row.append(toggleButton, removeButton);
    return row;
  }

  function updateRow(row, item) {
    const isDone = shownDone(item);
    const toggleButton = row.firstChild;
    row.dataset.done = String(isDone);
    toggleButton.setAttribute('aria-pressed', String(isDone));
    if (row.dataset.name !== item.name) {
      row.dataset.name = item.name;
      toggleButton.replaceChildren(
        el('span', { class: 'item__check', html: icons.check }),
        itemGlyph(item.name, 'item__emoji'),
        el('span', { class: 'item__name', text: item.name }),
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
      (n) => el('button', { class: 'chip', type: 'button', onclick: () => addItem(n) }, itemGlyph(n, 'chip__glyph'), el('span', { text: n })),
      () => {},
    );
  }

  function render(state) {
    const todo = state.items.filter((i) => !i.done || settling.has(i.id));
    const bought = state.items.filter((i) => i.done && !settling.has(i.id)).sort(bySoonestBought);
    meta.textContent = bought.length ? `${countLabel(todo.length)} · ${bought.length} bought` : countLabel(todo.length);

    const apply = () => {
      reconcile(todoList, todo, (i) => i.id, createRow, updateRow);
      reconcile(doneList, bought, (i) => i.id, createRow, updateRow);
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

  const unsubscribe = store.subscribe(render);
  render(store.state);

  return {
    intent(name) {
      if (name === 'add') {
        if (keyboard) keyboard.show();
        else input.focus();
      }
    },
    closeKeyboard() {
      keyboard?.hide();
    },
    unmount() {
      unsubscribe();
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}

// Home-screen widget

export function widget({ store, openApp }) {
  const count = el('p', { class: 'sw-count' });
  const list = el('ul', { class: 'sw-list' });
  const more = el('p', { class: 'sw-more' });
  const empty = el(
    'div',
    { class: 'sw-empty' },
    el('p', { class: 'sw-empty__title', text: 'Nothing to buy' }),
    el('p', { class: 'sw-empty__text', text: 'Tap + to add something.' }),
  );
  const link = el('a', {
    class: 'widget__link',
    href: '#/app/shopping',
    'aria-label': 'Open Shopping list',
    onclick: (event) => {
      event.preventDefault();
      openApp(id, { origin: node });
    },
  });
  const addButton = el('button', {
    class: 'sw-add',
    type: 'button',
    'aria-label': 'Add to the shopping list',
    html: icons.plus,
    onclick: () => openApp(id, { origin: node, intent: 'add' }),
  });
  const node = el(
    'article',
    { class: 'widget widget--shopping' },
    link,
    el(
      'header',
      { class: 'sw-head' },
      el('span', { class: 'appicon', style: `--icon-bg: ${iconBackground}`, html: iconGlyph }),
      el('div', { class: 'sw-heading' }, el('h2', { class: 'sw-title', text: name }), count),
      addButton,
    ),
    list,
    more,
    empty,
  );

  let todoCount = 0;

  function createRow(item) {
    const row = el('li', { class: 'sw-item' });
    const ring = el('button', { class: 'sw-ring', type: 'button', html: icons.check });
    ring.addEventListener('click', () =>
      toggle(store, row.dataset.key, (isDone) => {
        row.dataset.done = String(isDone);
        ring.setAttribute('aria-pressed', String(isDone));
      }),
    );
    row.append(ring);
    return row;
  }

  function updateRow(row, item) {
    const isDone = shownDone(item);
    row.dataset.done = String(isDone);
    const ring = row.firstChild;
    ring.setAttribute('aria-pressed', String(isDone));
    if (row.dataset.name !== item.name) {
      row.dataset.name = item.name;
      ring.setAttribute('aria-label', `Mark ${item.name} as bought`);
      row.replaceChildren(ring, itemGlyph(item.name, 'sw-emoji'), el('span', { class: 'sw-name', text: item.name }));
    }
  }

  // Show as many rows as fit, then say how many more are waiting.
  function fit() {
    const rows = [...list.children];
    const place = () => {
      rows.forEach((row) => (row.hidden = false));
      const limit = list.clientHeight;
      let shown = 0;
      for (const row of rows) {
        const fits = shown === rows.indexOf(row) && shown < WIDGET_MAX_ITEMS;
        if (fits && row.offsetTop + row.offsetHeight <= limit + 1) shown++;
        else row.hidden = true;
      }
      return shown;
    };
    more.hidden = true;
    let shown = place();
    if (shown < todoCount) {
      // The footer takes up a row's worth of space, so measure again with it showing.
      more.hidden = false;
      shown = place();
      more.textContent = `${todoCount - shown} more on the list`;
    }
  }

  let firstRender = true;
  function render(state) {
    const todo = state.items.filter((i) => !i.done || settling.has(i.id));
    todoCount = todo.length;
    count.textContent = countLabel(todo.length);
    const apply = () => {
      reconcile(list, todo, (i) => i.id, createRow, updateRow);
      list.hidden = todo.length === 0;
      empty.hidden = todo.length > 0;
      fit();
    };
    if (firstRender || document.documentElement.classList.contains('is-app-open')) {
      apply();
      firstRender = false;
    } else {
      animateLayout(list, apply);
    }
  }

  store.subscribe(render);
  render(store.state);
  new ResizeObserver(() => fit()).observe(list);
  return node;
}
