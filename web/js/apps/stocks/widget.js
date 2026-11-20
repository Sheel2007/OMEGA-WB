// Stocks: the AI Index, a basket of the biggest listed AI companies as one fund, in
// the one-column strip beside the clock. Top to bottom: its name, how far it has
// moved today (the big number, with an arrow, so colour is never the only sign),
// a small line of its day against yesterday's close, and the companies' own
// moves, a few at a time. Display only: there's no app behind it.
//
// The server pushes a new reading when a price changes. The line is a static
// inline SVG redrawn then. The only timer is the one that steps through the
// companies, a single setTimeout every few seconds that runs only while there are
// more companies than fit; each step is a one-shot fade (opacity and transform).
import { el, reducedMotion } from '../../ui.js';
import { describe, direction, magnitude, noteFor, pageCount, pageOf, percentText, sparkline, statusLabel, viewOf } from './format.js';
import * as meta from './meta.js';

const ROTATE_MS = 6000;
const STEP_MS = 320;
// Rows in the DOM. How many of them show is the theme's call: stocks.css sets
// --stock-rows (two in the strip, four when the Glass theme's dock is wide).
const MAX_ROWS = 4;
const DEFAULT_ROWS = 2;
// The line's own units (its viewBox); CSS stretches it to the space it gets.
const CHART = { width: 100, height: 50, pad: 4 };
const ARROWS = {
  up: '<svg viewBox="0 0 24 20" aria-hidden="true"><path d="M12 1 23 19H1z"/></svg>',
  down: '<svg viewBox="0 0 24 20" aria-hidden="true"><path d="M12 19 1 1h22z"/></svg>',
  flat: '<svg viewBox="0 0 24 20" aria-hidden="true"><rect x="2" y="7" width="20" height="6" rx="1.5"/></svg>',
};
const WAYS = ['up', 'down', 'flat'];

export function createWidget({ services }) {
  const { stocks } = services;
  const name = el('p', { class: 'stocks-widget__name' });
  const arrow = el('span', { class: 'stocks-widget__arrow' });
  const value = el('span', { class: 'stocks-widget__value' });
  const change = el('p', { class: 'stocks-widget__change' }, value, el('span', { class: 'stocks-widget__unit', text: '%' }));
  const status = el('p', { class: 'stocks-widget__status' });
  const chart = el('div', {
    class: 'stocks-widget__chart',
    html: `<svg viewBox="0 0 ${CHART.width} ${CHART.height}" preserveAspectRatio="none" aria-hidden="true">
      <line class="stocks-widget__baseline" x1="0" x2="${CHART.width}"/>
      <polyline class="stocks-widget__line" fill="none"/>
    </svg>`,
  });
  const baseline = chart.querySelector('.stocks-widget__baseline');
  const line = chart.querySelector('.stocks-widget__line');
  const rows = Array.from({ length: MAX_ROWS }, () => {
    const ticker = el('span', { class: 'stocks-widget__ticker' });
    const move = el('span', { class: 'stocks-widget__move' });
    return { node: el('li', { class: 'stocks-widget__row' }, ticker, move), ticker, move };
  });
  const list = el('ul', { class: 'stocks-widget__list' }, rows.map((row) => row.node));
  const noteTitle = el('p', { class: 'stocks-widget__note-title' });
  const noteHint = el('p', { class: 'stocks-widget__note-hint' });
  const note = el('div', { class: 'stocks-widget__note' }, noteTitle, noteHint);
  // Screen readers get the whole reading from the label; the parts are for eyes.
  const data = el(
    'div',
    { class: 'stocks-widget__data', 'aria-hidden': 'true' },
    el('div', { class: 'stocks-widget__index' }, arrow, change, status),
    chart,
    list,
  );
  const node = el('article', { class: 'stocks-widget', 'aria-label': meta.name }, name, data, note);

  let constituents = [];
  let basket = '';
  let perPage = DEFAULT_ROWS;
  let page = 0;
  let timer = null;
  let shownWay = null;
  let logged = null;

  function setWay(target, way) {
    for (const other of WAYS) target.classList.toggle(`is-${other}`, other === way);
  }

  function drawRows({ animate = false } = {}) {
    const shown = pageOf(constituents, page, perPage);
    rows.forEach((row, i) => {
      const item = shown[i];
      row.node.hidden = !item;
      if (!item) return;
      row.ticker.textContent = item.symbol;
      row.move.textContent = percentText(item.change);
      setWay(row.node, direction(item.change));
    });
    if (animate && !reducedMotion.matches) {
      list.animate(
        [
          { opacity: 0, transform: 'translateY(0.4rem)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: STEP_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }

  // Steps to the next few companies, only while there are more than fit.
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (pageCount(constituents.length, perPage) > 1) timer = setTimeout(step, ROTATE_MS);
  }

  function step() {
    timer = null;
    page = (page + 1) % pageCount(constituents.length, perPage);
    drawRows({ animate: true });
    schedule();
  }

  // Shows as many companies at once as the theme asks for. The chart takes
  // whatever height is left, so nothing here needs measuring.
  function fit() {
    const asked = parseInt(getComputedStyle(list).getPropertyValue('--stock-rows'), 10) || DEFAULT_ROWS;
    const fits = Math.min(MAX_ROWS, Math.max(1, asked));
    if (fits !== perPage) {
      perPage = fits;
      page = 0;
      schedule();
    }
    drawRows();
  }

  function drawChart(series) {
    const drawn = sparkline(series, CHART);
    chart.classList.toggle('stocks-widget__chart--empty', !drawn);
    if (!drawn) {
      line.removeAttribute('points');
      return;
    }
    line.setAttribute('points', drawn.points);
    baseline.setAttribute('y1', drawn.baseline);
    baseline.setAttribute('y2', drawn.baseline);
  }

  function render(state) {
    const view = viewOf(state);
    if (state.error && state.error !== logged) console.warn(`Stocks: ${state.error}`);
    logged = state.error;
    node.dataset.view = view;
    node.setAttribute('aria-label', describe(state));
    name.textContent = state.name || meta.name;
    data.hidden = view !== 'ready';
    note.hidden = view === 'ready';

    if (view !== 'ready') {
      const words = noteFor(state);
      noteTitle.textContent = words.title;
      noteHint.textContent = words.hint;
      setWay(node, 'flat');
      constituents = [];
      basket = '';
      clearTimeout(timer);
      timer = null;
      return;
    }

    const way = direction(state.index.change);
    setWay(node, way);
    if (way !== shownWay) {
      arrow.innerHTML = ARROWS[way];
      shownWay = way;
    }
    value.textContent = magnitude(state.index.change);
    status.textContent = statusLabel(state);
    drawChart(state.series);

    constituents = Array.isArray(state.constituents) ? state.constituents : [];
    // A different basket starts again from the top; new prices keep their place.
    const symbols = constituents.map((item) => item.symbol).join(' ');
    if (symbols !== basket) {
      basket = symbols;
      page = 0;
      schedule();
    }
    fit();
  }

  // The theme can change under a mounted widget (and with it the card's shape).
  const resizes = new ResizeObserver(() => fit());
  resizes.observe(node);
  const unsubscribe = stocks.subscribe(render);

  return {
    node,
    destroy() {
      unsubscribe();
      resizes.disconnect();
      clearTimeout(timer);
      timer = null;
    },
  };
}
