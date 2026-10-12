// Grocery: the full-screen app. The list on the left (filtered to one store if you
// like), what it all comes to on the right, split by store and by who asked.
//
// Things get on the list three ways: a phone scans a barcode or QR code (the Scan
// button), a search finds the product (Open Food Facts, through the Pi), or a name
// is typed in. Each goes through the same sheet, where the price, how many, the
// store and who's asking can be set before it's added.
//
// Under the totals, anyone can sign up for a text when someone else adds to the list.
import { createKeyboard } from '../../keyboard.js';
import { fetchQrSvg } from '../../services/board.js';
import { isReady } from '../../services/grocery.js';
import { animateLayout, el, haptic, icons, MAX_ROWS, nudge, reconcile, toast } from '../../ui.js';
import { boughtOf, shownDone, toBuyOf, toggleItem } from './settle.js';
import { readScan } from './codes.js';
import {
  askers,
  CARRIER_LABELS,
  countLabel,
  detailLabel,
  money,
  parsePrice,
  priceInput,
  STORE_LABELS,
  summaryLabel,
  totals,
} from './format.js';
import { id, name } from './meta.js';
import { fold, highlight, predict } from './predict.js';
import { createScanner } from './scanner.js';
import { avatar, lineCost, picture, pictureKey, storeTag, svg } from './views.js';

const KEYBOARD_SUGGESTIONS = 3;
// Predictions under the search bar: what this screen knows straight away, then the
// Trader Joe's and Lidl products the Pi keeps a list of, once typing pauses.
const PREDICTIONS_SHOWN = 8;
const LOCAL_PREDICTIONS = 5;
const ONLINE_AFTER_MS = 150;
const ONLINE_MIN_LETTERS = 2;
// Photos are shrunk on the phone to this many pixels on the long side before sending.
const PHOTO_SIZE = 480;
const MAX_QTY = 99;
const STORE_CHOICES = [
  [null, 'Either'],
  ['traderjoes', STORE_LABELS.traderjoes],
  ['lidl', STORE_LABELS.lidl],
];
const CARRIERS = Object.entries(CARRIER_LABELS);
const FILTERS = [
  [null, 'All'],
  ['traderjoes', STORE_LABELS.traderjoes],
  ['lidl', STORE_LABELS.lidl],
];

const tidy = (text) => {
  const clean = String(text ?? '').trim().replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

// A photo from the phone, shrunk to a JPEG of a few tens of kilobytes.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That photo couldn’t be read.'))), 'image/jpeg', 0.82),
  );
}

// A row of buttons where exactly one is chosen, like iOS's segmented control.
function segmented(options, value, label, onChange) {
  const node = el('div', { class: 'grocery-segments', role: 'radiogroup', 'aria-label': label });
  const set = (next) => {
    value = next;
    for (const button of node.children) button.setAttribute('aria-checked', String(button.dataset.value === String(next)));
  };
  for (const [option, text] of options) {
    node.append(
      el('button', {
        class: 'grocery-segments__option',
        type: 'button',
        role: 'radio',
        dataset: { value: String(option) },
        text,
        onclick: () => {
          set(option);
          onChange?.(option);
        },
      }),
    );
  }
  set(value);
  return { node, get: () => value, set };
}

export function mount(root, { services, kiosk, info }) {
  const { grocery, roommateGames, settings } = services;
  const phone = matchMedia('(max-width: 900px), (max-height: 560px)').matches;
  let storeFilter = null;
  let sheet = null;
  let scanner = null;
  let results = null;
  let searchToken = 0;
  let firstRender = true;
  let unmounted = false;

  // Header

  const meta = el('p', { class: 'grocery-app__meta' });
  const filter = segmented(FILTERS, null, 'Show items for', (store) => {
    storeFilter = store;
    if (results) runSearch(results.query);
    render(grocery.getState());
  });

  // Search

  const input = el('input', {
    class: 'grocery-search__input',
    type: 'search',
    name: 'grocery-search',
    placeholder: 'Search or type a name',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'search',
    maxlength: '80',
    'aria-label': 'Search products, or type a name',
    inputmode: kiosk ? 'none' : null,
  });
  const clearButton = el('button', {
    class: 'grocery-search__clear',
    type: 'button',
    'aria-label': 'Clear the search',
    html: icons.close,
    onclick: () => {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      closeResults();
    },
  });
  clearButton.hidden = true;
  const submit = el('button', { class: 'grocery-search__submit', type: 'submit', text: 'Search', disabled: true });
  const form = el(
    'form',
    { class: 'grocery-search', role: 'search', onsubmit: (event) => (event.preventDefault(), runSearch(input.value)) },
    el('span', { class: 'grocery-search__icon', html: svg.search }),
    input,
    clearButton,
    submit,
  );
  const predictions = el('ul', { class: 'grocery-predict', role: 'listbox', 'aria-label': 'Suggestions' });
  predictions.hidden = true;
  // Tapping a suggestion mustn't take the focus (and the phone's keyboard) away first.
  predictions.addEventListener('pointerdown', (event) => event.preventDefault());
  input.addEventListener('keydown', (event) => event.key === 'Escape' && hidePredictions());
  input.addEventListener('input', () => {
    submit.disabled = !input.value.trim();
    clearButton.hidden = !input.value;
  });

  // Search results

  const resultsTitle = el('h2', { class: 'grocery-results__title' });
  const resultsStatus = el('p', { class: 'grocery-results__status', role: 'status' });
  const addTyped = el('button', { class: 'grocery-results__typed', type: 'button', onclick: () => openAddSheet({ name: tidy(results?.query), store: storeFilter }) });
  const knownTitle = el('h3', { class: 'grocery-results__heading', text: 'Bought before' });
  const knownList = el('ul', { class: 'grocery-card grocery-products', 'aria-label': 'Bought before' });
  const onlineTitle = el('h3', { class: 'grocery-results__heading', text: 'Products' });
  const onlineList = el('ul', { class: 'grocery-card grocery-products', 'aria-label': 'Products' });
  const resultsView = el(
    'section',
    { class: 'grocery-results', 'aria-label': 'Search results' },
    el(
      'header',
      { class: 'grocery-results__head' },
      resultsTitle,
      el('button', { class: 'grocery-link', type: 'button', text: 'Back to List', onclick: closeResults }),
    ),
    addTyped,
    resultsStatus,
    knownTitle,
    knownList,
    onlineTitle,
    onlineList,
  );
  resultsView.hidden = true;

  // The list

  const todoList = el('ul', { class: 'grocery-card grocery-list', 'aria-label': 'To get' });
  const doneTitle = el('h2', { class: 'grocery-done__title' });
  const doneList = el('ul', { class: 'grocery-card grocery-card--quiet grocery-list', 'aria-label': 'In the cart' });
  const overflow = el('p', { class: 'grocery-app__overflow' });
  const done = el(
    'section',
    { class: 'grocery-done' },
    el('header', { class: 'grocery-done__head' }, doneTitle, el('button', { class: 'grocery-link', type: 'button', text: 'Clear', onclick: clearBought })),
    doneList,
  );
  const emptyTitle = el('p', { class: 'empty-state__title' });
  const emptyText = el('p', { class: 'empty-state__text' });
  const empty = el('div', { class: 'empty-state grocery-empty' }, el('div', { class: 'empty-state__art', html: svg.cart }), emptyTitle, emptyText);
  const listView = el('div', { class: 'grocery-app__list' }, todoList, overflow, empty, done);
  const scroll = el('div', { class: 'grocery-app__scroll' }, resultsView, listView);

  // Totals

  const totalLabel = el('p', { class: 'grocery-total__label', text: 'Comes to' });
  const totalAmount = el('p', { class: 'grocery-total__amount' });
  const totalNote = el('p', { class: 'grocery-total__note' });
  const storeTotals = el('ul', { class: 'grocery-total__rows', 'aria-label': 'By store' });
  const peopleTitle = el('h3', { class: 'grocery-total__heading', text: 'Who asked' });
  const peopleTotals = el('ul', { class: 'grocery-total__rows', 'aria-label': 'By who asked' });
  const totalPanel = el(
    'section',
    { class: 'grocery-glass grocery-total', 'aria-label': 'What it comes to' },
    totalLabel,
    totalAmount,
    totalNote,
    storeTotals,
    peopleTitle,
    peopleTotals,
  );

  // Texts

  const textingNote = el('p', { class: 'grocery-texting__note' });
  const textingList = el('ul', { class: 'grocery-total__rows', 'aria-label': 'Getting texts' });
  const textingPanel = el(
    'section',
    { class: 'grocery-glass grocery-texting', 'aria-label': 'Texts' },
    el(
      'header',
      { class: 'grocery-texting__head' },
      el('h2', { class: 'grocery-phone__title grocery-texting__title' }, el('span', { class: 'grocery-phone__icon', html: svg.message }), 'Texts'),
      el('button', { class: 'grocery-link', type: 'button', text: 'Add Your Number', onclick: () => openTextingSheet() }),
    ),
    textingNote,
    textingList,
  );

  const qr = el('div', { class: 'phone-link__qr', role: 'img', 'aria-label': 'QR code for the grocery list' });
  const url = el('p', { class: 'phone-link__url' });
  const phonePanel = el(
    'section',
    { class: 'grocery-glass grocery-phone' },
    el('h2', { class: 'grocery-phone__title' }, el('span', { class: 'grocery-phone__icon', html: svg.scan }), 'Scan with your phone'),
    el(
      'div',
      { class: 'phone-link' },
      qr,
      el('div', {}, el('p', { class: 'phone-link__text', text: 'Open this on your phone, tap Scan, and point the camera at a barcode or QR code.' }), url),
    ),
  );
  phonePanel.hidden = true;

  const scanFab = el(
    'button',
    { class: 'grocery-app__scan', type: 'button', onclick: () => openScanner() },
    el('span', { class: 'grocery-app__scan-icon', html: svg.scan }),
    'Scan',
  );
  scanFab.hidden = !phone || kiosk;

  const view = el(
    'div',
    { class: 'grocery-app' },
    el(
      'div',
      { class: 'grocery-app__main' },
      el(
        'header',
        { class: 'grocery-app__header' },
        el('div', { class: 'grocery-app__heading' }, el('h1', { class: 'grocery-app__title', text: name }), meta),
        filter.node,
      ),
      el('div', { class: 'grocery-search-area' }, form, predictions),
      scroll,
    ),
    el('aside', { class: 'grocery-app__side' }, totalPanel, textingPanel, phonePanel),
    scanFab,
  );
  root.append(view);

  if (!phone) {
    info.then(async (details) => {
      if (!details?.url) return;
      const code = await fetchQrSvg({ app: id });
      if (unmounted) return;
      url.textContent = details.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (code) qr.innerHTML = code;
      phonePanel.hidden = false;
    });
  }

  const keyboard = kiosk
    ? createKeyboard({
        input,
        enterLabel: 'Search',
        onEnter: () => runSearch(input.value),
        onPick: (picked) => {
          input.value = picked;
          input.dispatchEvent(new Event('input'));
          runSearch(picked);
        },
        getSuggestions: (value) =>
          value.trim() ? predict(value, { catalog: grocery.getState().catalog, limit: KEYBOARD_SUGGESTIONS }).map((p) => p.name) : [],
        onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
      })
    : null;
  if (keyboard) root.append(keyboard.node);

  // Predictions

  const listen = new AbortController();
  let predictTimer = null;
  let predictToken = 0;

  function hidePredictions() {
    clearTimeout(predictTimer);
    predictToken++;
    predictions.hidden = true;
    predictions.replaceChildren();
  }

  function predictionRow({ kind, name: label, product }, typed) {
    const text = el(
      'span',
      { class: 'grocery-predict__label' },
      highlight(label, typed).map((part) => (part.match ? el('b', { text: part.text }) : part.text)),
    );
    const currency = grocery.getState().currency;
    const detail =
      kind === 'known'
        ? ['Bought before', product.price != null ? money(product.price, currency) : null].filter(Boolean).join(' · ')
        : kind === 'online'
          ? [product.brand, product.size].filter(Boolean).join(' · ')
          : '';
    return el(
      'li',
      { role: 'option' },
      el(
        'button',
        {
          class: `grocery-predict__row grocery-predict__row--${kind}`,
          type: 'button',
          onclick: () => {
            hidePredictions();
            if (kind === 'word') {
              input.value = label;
              input.dispatchEvent(new Event('input'));
              hidePredictions();
              runSearch(label);
            } else {
              keyboard?.hide();
              openAddSheet(product);
            }
          },
        },
        kind === 'word' ? el('span', { class: 'grocery-predict__icon', html: svg.search }) : picture(product, 'grocery-predict__pic'),
        el('span', { class: 'grocery-predict__text' }, text, detail ? el('span', { class: 'grocery-predict__detail', text: detail }) : null),
        product?.store ? storeTag(product.store) : null,
      ),
    );
  }

  function showPredictions(typed, online = []) {
    const local = predict(typed, { catalog: grocery.getState().catalog, limit: LOCAL_PREDICTIONS });
    const known = local.filter((p) => p.kind === 'known');
    const knownNames = new Set(known.map((p) => fold(p.name)));
    const stores = online.filter((p) => !knownNames.has(fold(p.name))).map((product) => ({ kind: 'online', name: product.name, product }));
    // A real product beats a plain word with the same name.
    const storeNames = new Set(stores.map((p) => fold(p.name)));
    const words = local.filter((p) => p.kind === 'word' && !storeNames.has(fold(p.name)));
    // Things bought before, then the stores' products (with their pictures), then words.
    const rows = [...known, ...stores, ...words].slice(0, PREDICTIONS_SHOWN);
    predictions.replaceChildren(...rows.map((row) => predictionRow(row, typed)));
    predictions.hidden = rows.length === 0;
  }

  function updatePredictions() {
    const typed = input.value.trim();
    clearTimeout(predictTimer);
    const token = ++predictToken;
    if (!typed || readScan(typed).code || /^\d+$/.test(typed)) {
      hidePredictions();
      return;
    }
    showPredictions(typed);
    if (typed.replace(/\s/g, '').length < ONLINE_MIN_LETTERS) return;
    predictTimer = setTimeout(async () => {
      try {
        const { online } = await grocery.suggest(typed, storeFilter);
        if (token === predictToken && !unmounted && input.value.trim() === typed) showPredictions(typed, online);
      } catch {
        // Offline: the local predictions stay.
      }
    }, ONLINE_AFTER_MS);
  }

  input.addEventListener('input', updatePredictions, { signal: listen.signal });
  // A tap anywhere else puts the suggestions away.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!predictions.hidden && !event.target.closest('.grocery-search-area, .keyboard')) hidePredictions();
    },
    { signal: listen.signal },
  );

  // Searching and scanning

  function closeResults() {
    searchToken++;
    results = null;
    resultsView.hidden = true;
    listView.hidden = false;
  }

  async function runSearch(raw) {
    const query = String(raw ?? '').trim();
    if (!query) {
      nudge(form);
      return;
    }
    hidePredictions();
    keyboard?.hide();
    input.blur();
    const read = readScan(query);
    if (read.code) {
      lookUp(read.code);
      return;
    }
    const token = ++searchToken;
    results = { query, loading: true, known: [], online: [] };
    renderResults();
    try {
      const found = await grocery.search(query, storeFilter);
      if (token !== searchToken || unmounted) return;
      results = { query, ...found };
    } catch (err) {
      if (token !== searchToken || unmounted) return;
      results = { query, known: [], online: [], error: err.message };
    }
    renderResults();
  }

  function productRow(product) {
    const where = [product.brand, product.size].filter(Boolean).join(' · ');
    return el(
      'li',
      { class: 'grocery-product' },
      el(
        'button',
        { class: 'grocery-product__button', type: 'button', onclick: () => openAddSheet(product) },
        picture(product, 'grocery-row__pic'),
        el(
          'span',
          { class: 'grocery-row__text' },
          el('span', { class: 'grocery-row__name', text: product.name }),
          where ? el('span', { class: 'grocery-row__detail', text: where }) : null,
        ),
        storeTag(product.store),
        product.price != null ? el('span', { class: 'grocery-row__price', text: money(product.price, grocery.getState().currency) }) : null,
        el('span', { class: 'grocery-product__add', html: icons.plus }),
      ),
    );
  }

  function renderResults() {
    listView.hidden = true;
    resultsView.hidden = false;
    const { query, loading, known = [], online = [], offline, error } = results;
    resultsTitle.textContent = `“${query}”`;
    addTyped.replaceChildren(el('span', { class: 'grocery-results__typed-icon', html: icons.plus }), `Add “${tidy(query)}” as typed`);
    knownList.replaceChildren(...known.map(productRow));
    onlineList.replaceChildren(...online.map(productRow));
    knownTitle.hidden = knownList.hidden = known.length === 0;
    onlineTitle.hidden = onlineList.hidden = online.length === 0;
    let status = '';
    if (loading) status = 'Searching…';
    else if (error) status = error;
    else if (offline) status = 'The product database can’t be reached, so only things bought before are shown.';
    else if (!known.length && !online.length) status = 'Nothing found. Add it as typed, or try fewer words.';
    resultsStatus.textContent = status;
    resultsStatus.hidden = !status;
  }

  async function lookUp(code, { fromScan = false } = {}) {
    if (!fromScan) toast('Looking up that barcode…', { duration: 2000 });
    try {
      const { product } = await grocery.lookup(code);
      if (unmounted) return;
      openAddSheet(product.name ? product : { ...product, name: '' }, {
        note: product.name ? null : 'This barcode isn’t in the product database yet. What is it?',
      });
    } catch (err) {
      if (unmounted) return;
      openAddSheet({ code, name: '' }, { note: `${err.message.replace(/ Type the item in instead\.$/, '')} What is it?` });
    }
  }

  function openScanner() {
    if (scanner || !phone) return;
    keyboard?.hide();
    scanner = createScanner({
      onCode: handleScan,
      onClose: closeScanner,
      onType: () => {
        closeScanner();
        input.focus();
      },
    });
    root.append(scanner.node);
    document.documentElement.classList.add('is-scanning');
  }

  function closeScanner() {
    if (!scanner) return;
    scanner.destroy();
    scanner = null;
    document.documentElement.classList.remove('is-scanning');
  }

  function handleScan(text, format) {
    const read = readScan(text, format);
    if (read.code) {
      lookUp(read.code, { fromScan: true });
    } else if (read.name) {
      openAddSheet({ name: read.name, store: read.store });
    } else if (read.query) {
      closeScanner();
      input.value = read.query;
      input.dispatchEvent(new Event('input'));
      runSearch(read.query);
    } else {
      toast('That code isn’t a product. Scan the barcode, or search instead.');
      scanner?.resume();
    }
  }

  // Sheets: one at a time, over the app (and over the scanner), closed by Cancel,
  // the primary button, Escape or a tap outside.

  function openSheet({ title, content, primary, onClose }) {
    // Replaced by another sheet: the scanner stays paused for the new one.
    closeSheet({ quiet: true });
    hidePredictions();
    keyboard?.hide();
    const keys = new AbortController();
    const primaryButton = el('button', { class: 'grocery-sheet__primary', type: 'button', text: primary.label, onclick: primary.onClick });
    const card = el(
      'div',
      { class: 'grocery-sheet__card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      el(
        'header',
        { class: 'grocery-sheet__head' },
        el('button', { class: 'grocery-sheet__cancel', type: 'button', text: 'Cancel', onclick: () => closeSheet() }),
        el('h2', { class: 'grocery-sheet__title', text: title }),
        primaryButton,
      ),
      el('div', { class: 'grocery-sheet__body' }, content),
    );
    const node = el(
      'div',
      { class: 'grocery-sheet' },
      el('button', { class: 'grocery-sheet__scrim', type: 'button', tabindex: '-1', 'aria-label': 'Close', onclick: () => closeSheet() }),
      card,
    );
    root.append(node);
    addEventListener('keydown', (event) => event.key === 'Escape' && closeSheet(), { signal: keys.signal });
    card.focus({ preventScroll: true });
    sheet = { node, keys, primaryButton, onClose };
    return sheet;
  }

  function closeSheet({ quiet = false } = {}) {
    if (!sheet) return;
    const { keys, node, onClose } = sheet;
    sheet = null;
    keys.abort();
    node.remove();
    onClose?.(quiet);
  }

  // The fields an item has: name, store, price, how many and who's asking.
  function itemForm(start, note) {
    const currency = grocery.getState().currency;
    const nameInput = el('input', {
      class: 'grocery-field__input grocery-field__input--name',
      type: 'text',
      value: start.name ?? '',
      placeholder: 'What is it?',
      maxlength: '80',
      autocomplete: 'off',
      autocapitalize: 'sentences',
      enterkeyhint: 'next',
      'aria-label': 'Name',
      inputmode: kiosk ? 'none' : null,
    });
    const priceField = el('input', {
      class: 'grocery-field__input grocery-field__input--price',
      type: 'text',
      value: priceInput(start.price),
      placeholder: '0.00',
      maxlength: '9',
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': `Price in ${currency}`,
      inputmode: kiosk ? 'none' : 'decimal',
    });
    const otherInput = el('input', {
      class: 'grocery-field__input',
      type: 'text',
      placeholder: 'Their name',
      maxlength: '30',
      autocomplete: 'off',
      autocapitalize: 'words',
      enterkeyhint: 'done',
      'aria-label': 'Who’s asking',
      inputmode: kiosk ? 'none' : null,
    });

    const store = segmented(STORE_CHOICES, start.store ?? null, 'Store');

    let qty = start.qty ?? 1;
    const qtyValue = el('span', { class: 'grocery-stepper__value', 'aria-live': 'polite' });
    const minus = el('button', { class: 'grocery-stepper__button', type: 'button', 'aria-label': 'One fewer', html: icons.minus, onclick: () => setQty(qty - 1) });
    const plus = el('button', { class: 'grocery-stepper__button', type: 'button', 'aria-label': 'One more', html: icons.plus, onclick: () => setQty(qty + 1) });
    const setQty = (next) => {
      qty = Math.max(1, Math.min(MAX_QTY, next));
      qtyValue.textContent = String(qty);
      minus.disabled = qty <= 1;
      plus.disabled = qty >= MAX_QTY;
    };
    setQty(qty);

    // Who's asking: the roommates and anyone who has asked before, or someone new.
    const roommates = roommateGames.getState().players.map((p) => p.name);
    const names = askers(roommates, grocery.getState().people);
    let by = start.by ?? (kiosk ? null : settings.getAsker());
    if (by && !names.some((n) => n.toLowerCase() === by.toLowerCase())) names.unshift(by);
    const people = el('div', { class: 'grocery-people', role: 'radiogroup', 'aria-label': 'Who’s asking' });
    const otherField = el('div', { class: 'grocery-people__other' }, otherInput);
    const setBy = (next) => {
      by = next;
      for (const chip of people.children) {
        const isOther = chip.dataset.other === 'true';
        chip.setAttribute('aria-checked', String(isOther ? by === '' : chip.dataset.name === by));
      }
      otherField.hidden = by !== '';
      if (by === '') focus(otherInput);
    };
    for (const person of names) {
      people.append(
        el('button', { class: 'grocery-person', type: 'button', role: 'radio', dataset: { name: person }, onclick: () => setBy(by === person ? null : person) }, avatar(person, 'grocery-person__avatar'), el('span', { text: person })),
      );
    }
    people.append(
      el('button', { class: 'grocery-person grocery-person--other', type: 'button', role: 'radio', dataset: { other: 'true' }, onclick: () => setBy(by === '' ? null : '') }, el('span', { class: 'grocery-person__plus', html: icons.plus }), el('span', { text: names.length ? 'Someone else' : 'Add a name' })),
    );

    const inputs = [nameInput, priceField, otherInput];
    let current = nameInput;
    inputs.forEach((field) => field.addEventListener('focus', () => (current = field)));
    // Enter goes from the name to the price; anywhere else it's the sheet's button.
    const advance = (field) => {
      if (field === nameInput) focus(priceField);
      else sheet?.primaryButton.click();
    };
    inputs.forEach((field) =>
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        advance(field);
      }),
    );
    const formKeyboard = kiosk
      ? createKeyboard({
          inputs,
          enterLabel: 'Next',
          onEnter: () => advance(current),
          onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
        })
      : null;
    function focus(field) {
      current = field;
      if (formKeyboard) formKeyboard.focusField(field);
      else field.focus();
    }

    // The picture: the product's photo, or one taken now, or its illustration
    // (which follows the name as it's typed).
    let photo = start.photo ?? null;
    let uploading = false;
    const pictureSlot = el('span', { class: 'grocery-form__picture' });
    const showPicture = () => pictureSlot.replaceChildren(picture({ ...start, name: nameInput.value || start.name || '?', photo }, 'grocery-form__pic'));
    nameInput.addEventListener('input', () => {
      if (!photo && !start.code) showPicture();
    });
    showPicture();
    const photoInput = el('input', { class: 'grocery-form__file', type: 'file', accept: 'image/*', tabindex: '-1' });
    const removePhoto = el('button', {
      class: 'grocery-form__photo-remove',
      type: 'button',
      text: 'Remove Photo',
      onclick: () => {
        photo = null;
        removePhoto.hidden = true;
        showPicture();
      },
    });
    removePhoto.hidden = !photo;
    const photoButton = el('button', {
      class: 'grocery-form__photo',
      type: 'button',
      'aria-label': photo ? 'Change the photo' : 'Take a photo of it',
      html: svg.camera,
      onclick: () => photoInput.click(),
    });
    photoInput.addEventListener('change', async () => {
      const [file] = photoInput.files;
      photoInput.value = '';
      if (!file) return;
      uploading = true;
      pictureSlot.classList.add('is-uploading');
      try {
        photo = await grocery.uploadPhoto(await shrinkPhoto(file));
        removePhoto.hidden = false;
        showPicture();
      } catch (err) {
        toast(err.message);
      } finally {
        uploading = false;
        pictureSlot.classList.remove('is-uploading');
      }
    });

    const where = [start.brand, start.size].filter(Boolean).join(' · ');
    const node = el(
      'div',
      { class: 'grocery-form' },
      note ? el('p', { class: 'grocery-form__note', text: note }) : null,
      el(
        'div',
        { class: 'grocery-form__product' },
        // The board's own screen has no camera; phones (and computers) can add a photo.
        el('div', { class: 'grocery-form__media' }, pictureSlot, kiosk ? null : photoButton, kiosk ? null : photoInput),
        el(
          'div',
          { class: 'grocery-form__product-text' },
          nameInput,
          where ? el('p', { class: 'grocery-form__where', text: where }) : null,
          kiosk ? null : removePhoto,
        ),
      ),
      el('div', { class: 'grocery-field' }, el('span', { class: 'grocery-field__label', text: 'Store' }), store.node),
      el(
        'div',
        { class: 'grocery-form__pair' },
        el(
          'label',
          { class: 'grocery-field' },
          el('span', { class: 'grocery-field__label', text: 'Price each' }),
          el('span', { class: 'grocery-price' }, el('span', { class: 'grocery-price__currency', text: money(0, currency).replace(/[\d.,\s]/g, '') || currency }), priceField),
        ),
        el('div', { class: 'grocery-field' }, el('span', { class: 'grocery-field__label', text: 'How many' }), el('div', { class: 'grocery-stepper' }, minus, qtyValue, plus)),
      ),
      el('div', { class: 'grocery-field' }, el('span', { class: 'grocery-field__label', text: 'Who’s asking?' }), people, otherField),
    );
    if (formKeyboard) root.append(formKeyboard.node);
    setBy(by);

    return {
      node,
      focus,
      nameInput,
      // The fields as typed, or null (after pointing at the problem) if one isn't right.
      read() {
        if (uploading) {
          toast('One moment: the photo is still saving.');
          return null;
        }
        const itemName = tidy(nameInput.value);
        if (!itemName) {
          nudge(nameInput.parentElement);
          focus(nameInput);
          toast('Type what it is first.');
          return null;
        }
        const price = parsePrice(priceField.value);
        if (Number.isNaN(price) || price > 100000) {
          nudge(priceField.parentElement);
          focus(priceField);
          toast('Type the price like 3.49');
          return null;
        }
        const person = by === '' ? tidy(otherInput.value) || null : by;
        return { name: itemName, store: store.get(), price, qty, by: person, photo };
      },
      destroy() {
        formKeyboard?.destroy();
        document.documentElement.classList.remove('is-typing');
      },
    };
  }

  function openAddSheet(product, { note = null } = {}) {
    const form = itemForm({ ...product, qty: 1 }, note);
    const own = openSheet({
      title: 'Add to List',
      content: form.node,
      primary: {
        label: 'Add',
        onClick: () => {
          const fields = form.read();
          if (!fields) return;
          if (!kiosk && fields.by) settings.setAsker(fields.by);
          own.primaryButton.disabled = true;
          grocery
            .addItem({ ...fields, code: product.code ?? null, brand: product.brand ?? null, size: product.size ?? null })
            .then(
              (result) => {
                haptic();
                const item = result?.item;
                const message =
                  result?.outcome === 'more' ? `${item.name}: now ${item.qty} on the list` : `Added ${item?.name ?? fields.name}`;
                if (sheet === own) closeSheet({ quiet: true });
                if (scanner) scanner.resume(`${message}. Scan the next one.`);
                else toast(message);
                if (results && !scanner) closeResults();
              },
              (err) => {
                toast(err.message);
                own.primaryButton.disabled = false;
              },
            );
        },
      },
      onClose: (quiet) => {
        form.destroy();
        if (!quiet) scanner?.resume();
      },
    });
    if (!product.name) form.focus(form.nameInput);
  }

  function openEditSheet(itemId) {
    const item = grocery.getItems().find((i) => i.id === itemId);
    if (!item) return;
    const form = itemForm(item);
    form.node.append(
      el('button', {
        class: 'grocery-form__remove',
        type: 'button',
        text: 'Remove from List',
        onclick: () => {
          closeSheet();
          removeItem(itemId);
        },
      }),
    );
    const own = openSheet({
      title: 'Edit Item',
      content: form.node,
      primary: {
        label: 'Save',
        onClick: () => {
          const fields = form.read();
          if (!fields) return;
          const latest = grocery.getItems().find((i) => i.id === itemId);
          const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => latest?.[key] !== value));
          if (sheet === own) closeSheet();
          if (!latest || !Object.keys(changes).length) return;
          grocery.updateItem(itemId, changes).catch((err) => toast(err.message));
        },
      },
      onClose: () => form.destroy(),
    });
  }

  function removeItem(itemId) {
    const item = grocery.getItems().find((i) => i.id === itemId);
    if (!item) return;
    grocery.removeItem(itemId).then(
      () => toast(`Removed ${item.name}`, { action: 'Undo', onAction: () => grocery.restoreItems([itemId]).catch((e) => toast(e.message)) }),
      (err) => toast(err.message),
    );
  }

  function clearBought() {
    const count = grocery.getItems().filter((i) => i.done).length;
    grocery.clearBought().then(
      (result) => {
        const label = count === 1 ? 'Cleared 1 item' : `Cleared ${count} items`;
        toast(label, { action: 'Undo', onAction: () => grocery.restoreItems(result.removed).catch((e) => toast(e.message)) });
      },
      (err) => toast(err.message),
    );
  }

  // Texts

  function openTextingSheet() {
    const nameField = el('input', {
      class: 'grocery-field__input',
      type: 'text',
      value: kiosk ? '' : (settings.getAsker() ?? ''),
      placeholder: 'Your name',
      maxlength: '30',
      autocomplete: 'given-name',
      autocapitalize: 'words',
      enterkeyhint: 'next',
      inputmode: kiosk ? 'none' : null,
    });
    const phoneField = el('input', {
      class: 'grocery-field__input',
      type: 'tel',
      placeholder: '(555) 123-4567',
      maxlength: '20',
      autocomplete: 'tel-national',
      enterkeyhint: 'done',
      inputmode: kiosk ? 'none' : 'tel',
    });
    const carrier = segmented(CARRIERS, 'tmobile', 'Carrier');
    const inputs = [nameField, phoneField];
    let current = nameField;
    inputs.forEach((field) => field.addEventListener('focus', () => (current = field)));
    const advance = (field) => {
      if (field === nameField) focus(phoneField);
      else sheet?.primaryButton.click();
    };
    inputs.forEach((field) =>
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        advance(field);
      }),
    );
    const formKeyboard = kiosk
      ? createKeyboard({
          inputs,
          enterLabel: 'Next',
          onEnter: () => advance(current),
          onToggle: (open) => document.documentElement.classList.toggle('is-typing', open),
        })
      : null;
    function focus(field) {
      current = field;
      if (formKeyboard) formKeyboard.focusField(field);
      else field.focus();
    }

    const content = el(
      'div',
      { class: 'grocery-form' },
      el('p', {
        class: 'grocery-form__note',
        text: grocery.getState().texts
          ? 'Get a free text whenever someone else adds to the list. A welcome text comes first, so you know it works.'
          : 'Texts are off until the Pi has an email account to send them from. Numbers added now get texts once it does.',
      }),
      el('label', { class: 'grocery-field' }, el('span', { class: 'grocery-field__label', text: 'Name' }), nameField),
      el('label', { class: 'grocery-field' }, el('span', { class: 'grocery-field__label', text: 'Phone number' }), phoneField),
      el('div', { class: 'grocery-field' }, el('span', { class: 'grocery-field__label', text: 'Carrier' }), carrier.node),
      el('p', { class: 'grocery-texting__fine', text: 'Your number stays on the board. Screens only show its last four digits.' }),
    );
    if (formKeyboard) root.append(formKeyboard.node);

    const own = openSheet({
      title: 'Get Texts',
      content,
      primary: {
        label: 'Add',
        onClick: () => {
          const person = tidy(nameField.value);
          const number = phoneField.value.trim();
          const missing = !person ? nameField : !number ? phoneField : null;
          if (missing) {
            nudge(missing);
            focus(missing);
            toast(missing === nameField ? 'Type your name first.' : 'Type your phone number first.');
            return;
          }
          own.primaryButton.disabled = true;
          grocery.addTexter({ name: person, phone: number, carrier: carrier.get() }).then(
            () => {
              if (!kiosk) settings.setAsker(person);
              if (sheet === own) closeSheet();
              toast(grocery.getState().texts ? 'Added. A welcome text is on its way.' : `Added ${person}`);
            },
            (err) => {
              toast(err.message);
              own.primaryButton.disabled = false;
            },
          );
        },
      },
      onClose: () => {
        formKeyboard?.destroy();
        document.documentElement.classList.remove('is-typing');
      },
    });
    focus(nameField.value ? phoneField : nameField);
  }

  function removeTexter(texterId) {
    const texter = grocery.getState().texting.find((t) => t.id === texterId);
    if (!texter) return;
    grocery.removeTexter(texterId).then(
      () =>
        toast(`${texter.name} won’t get texts`, {
          action: 'Undo',
          onAction: () => grocery.restoreTexters([texterId]).catch((e) => toast(e.message)),
        }),
      (err) => toast(err.message),
    );
  }

  function createTexterRow() {
    const row = el('li', { class: 'grocery-total__row grocery-texting__row' });
    row.append(
      el('span'),
      el('span', { class: 'grocery-texting__text' }, el('span', { class: 'grocery-total__name' }), el('span', { class: 'grocery-texting__detail' })),
      el('button', { class: 'grocery-texting__remove', type: 'button', html: icons.close, onclick: () => removeTexter(row.dataset.key) }),
    );
    return row;
  }

  function updateTexterRow(row, texter) {
    const [, text, remove] = row.children;
    if (row.dataset.name !== texter.name) {
      row.dataset.name = texter.name;
      row.firstChild.replaceWith(avatar(texter.name, 'grocery-texting__avatar'));
    }
    text.children[0].textContent = texter.name;
    text.children[1].textContent = [CARRIER_LABELS[texter.carrier], texter.phone].filter(Boolean).join(' · ');
    remove.setAttribute('aria-label', `Stop texting ${texter.name}`);
  }

  function renderTexting(state) {
    const people = state.texting ?? [];
    textingNote.textContent = !isReady(state)
      ? ''
      : !state.texts
        ? 'Texts are off until the Pi has an email account to send them from.'
        : people.length
          ? 'They get a text when someone else adds to the list.'
          : 'Get a free text when someone adds to the list.';
    reconcile(textingList, people, (t) => t.id, createTexterRow, updateTexterRow);
  }

  // Rows

  function setRowDone(row, isDone) {
    row.classList.toggle('grocery-row--done', isDone);
    row.firstChild.setAttribute('aria-pressed', String(isDone));
  }

  function createRow() {
    const row = el('li', { class: 'grocery-row' });
    row.append(
      el('button', {
        class: 'grocery-row__check',
        type: 'button',
        html: `<span class="grocery-row__ring">${icons.check}</span>`,
        onclick: () => toggleItem(grocery, row.dataset.key, (isDone) => setRowDone(row, isDone)),
      }),
      el('button', { class: 'grocery-row__main', type: 'button', onclick: () => openEditSheet(row.dataset.key) }),
    );
    return row;
  }

  function updateRow(row, item) {
    setRowDone(row, shownDone(item));
    const currency = grocery.getState().currency;
    const signature = JSON.stringify([pictureKey(item), item.by, item.store, item.size, item.qty, item.price, currency]);
    if (row.dataset.signature === signature) return;
    row.dataset.signature = signature;
    row.firstChild.setAttribute('aria-label', `Mark ${item.name} as in the cart`);
    const main = row.lastChild;
    main.setAttribute('aria-label', `Edit ${item.name}`);
    const detail = detailLabel({ ...item, by: null, store: null });
    const parts = [
      picture(item, 'grocery-row__pic'),
      el(
        'span',
        { class: 'grocery-row__text' },
        el('span', { class: 'grocery-row__name', text: item.name }),
        el(
          'span',
          { class: 'grocery-row__meta' },
          item.by ? avatar(item.by, 'grocery-row__avatar') : null,
          item.by ? el('span', { class: 'grocery-row__detail', text: item.by }) : null,
          storeTag(item.store),
          detail ? el('span', { class: 'grocery-row__detail', text: detail }) : null,
        ),
      ),
      item.qty > 1 ? el('span', { class: 'grocery-row__qty', text: `×${item.qty}` }) : null,
      el('span', { class: 'grocery-row__price', text: lineCost(item, currency) || (item.done ? '' : 'Add price') }),
    ];
    main.replaceChildren(...parts.filter(Boolean));
    main.lastChild.classList.toggle('grocery-row__price--missing', item.price == null);
  }

  // Totals

  function renderTotals(state) {
    const sum = totals(state.items);
    const currency = state.currency;
    totalAmount.textContent = sum.cents ? money(sum.cents, currency) : sum.count ? '—' : money(0, currency);
    totalNote.textContent = sum.unpriced
      ? `${sum.unpriced === 1 ? '1 item has' : `${sum.unpriced} items have`} no price yet`
      : sum.count
        ? countLabel(sum.count)
        : 'Nothing to get';
    reconcile(
      storeTotals,
      sum.stores,
      (s) => String(s.key),
      (s) =>
        el(
          'li',
          { class: 'grocery-total__row' },
          el('span', { class: `grocery-total__dot grocery-total__dot--${s.key ?? 'any'}` }),
          el('span', { class: 'grocery-total__name', text: STORE_LABELS[s.key] ?? 'Either store' }),
          el('span', { class: 'grocery-total__count' }),
          el('span', { class: 'grocery-total__value' }),
        ),
      (li, s) => {
        li.children[2].textContent = countLabel(s.count);
        li.children[3].textContent = s.cents ? money(s.cents, currency) : '—';
      },
    );
    const people = sum.people.filter((p) => p.key);
    peopleTitle.hidden = peopleTotals.hidden = people.length === 0;
    reconcile(
      peopleTotals,
      people,
      (p) => p.key,
      (p) =>
        el(
          'li',
          { class: 'grocery-total__row' },
          avatar(p.key, 'grocery-total__avatar'),
          el('span', { class: 'grocery-total__name', text: p.key }),
          el('span', { class: 'grocery-total__count' }),
          el('span', { class: 'grocery-total__value' }),
        ),
      (li, p) => {
        li.children[2].textContent = countLabel(p.count);
        li.children[3].textContent = p.cents ? money(p.cents, currency) : '—';
      },
    );
  }

  function render(state) {
    const shown = (item) => !storeFilter || !item.store || item.store === storeFilter;
    const toGet = toBuyOf(state.items).filter(shown);
    const inCart = boughtOf(state.items).filter(shown);
    const todoShown = toGet.slice(0, MAX_ROWS);
    const cartShown = inCart.slice(0, MAX_ROWS - todoShown.length);
    meta.textContent = isReady(state) ? summaryLabel(state.items, state.currency) : '';
    const apply = () => {
      reconcile(todoList, todoShown, (i) => i.id, createRow, updateRow);
      reconcile(doneList, cartShown, (i) => i.id, createRow, updateRow);
      const hidden = toGet.length - todoShown.length + inCart.length - cartShown.length;
      overflow.hidden = hidden === 0;
      overflow.textContent = `${hidden} more not shown`;
      todoList.hidden = toGet.length === 0;
      done.hidden = inCart.length === 0;
      doneTitle.textContent = `In the cart (${inCart.length})`;
      empty.hidden = !isReady(state) || toGet.length > 0;
      emptyTitle.textContent = inCart.length ? 'All in the cart' : storeFilter ? `Nothing from ${STORE_LABELS[storeFilter]}` : 'Nothing to get';
      emptyText.textContent = inCart.length
        ? 'Clear the cart once it’s all put away.'
        : phone && !kiosk
          ? 'Tap Scan and point at a barcode, or search above.'
          : 'Search above, or scan a barcode with your phone.';
      renderTotals(state);
      renderTexting(state);
    };
    if (firstRender) {
      apply();
      firstRender = false;
    } else {
      animateLayout(listView, apply);
    }
    keyboard?.refresh();
  }

  const unsubscribe = grocery.subscribe(render);
  render(grocery.getState());

  function focusSearch() {
    if (keyboard) keyboard.show();
    else input.focus();
  }

  return {
    intent(action) {
      if (action === 'scan' && phone && !kiosk) {
        // Live scanning can start by itself; a photo needs a tap, which the scanner asks for.
        openScanner();
      } else if (action === 'scan' || action === 'search' || action === 'add') {
        focusSearch();
      }
    },
    closeKeyboard() {
      keyboard?.hide();
      closeSheet();
      closeScanner();
    },
    unmount() {
      unmounted = true;
      searchToken++;
      hidePredictions();
      listen.abort();
      unsubscribe();
      closeSheet();
      closeScanner();
      keyboard?.destroy();
      document.documentElement.classList.remove('is-typing');
    },
  };
}

