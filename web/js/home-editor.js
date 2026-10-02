// Edit mode for the home screen: drag widgets to rearrange them (across pages too),
// remove them with −, add them with +. No jiggle animation (it would never stop);
// editing shows as a dashed outline instead.
//
// While a widget is dragged it floats in .home__drag-layer and a placeholder holds
// its slot; the other widgets reflow around the placeholder as a live preview.
// Nothing is saved until the drop.
import { animateLayout, el, haptic, icons } from './ui.js';
import { dropIndex, insertWidget, paginate, removeWidget, SPANS } from './widget-layout.js';

// A pointer this close to the pager's side edge flips to the next page after a pause.
const EDGE_REM = 4;
const EDGE_DWELL_MS = 650;
const EDGE_REPEAT_MS = 1000;
// Re-pick the drop spot only after the pointer moves this far, and not straight after a reflow.
const REEVALUATE_PX = 8;
const REFLOW_LOCK_MS = 250;
const SETTLE_MS = 220;
const COMPACT = '(max-width: 900px), (max-height: 560px)';
const WIDGETS_SELECTOR = '.home-page > .widget, .home-page > .home-slot';

// onChange(editing) is called when edit mode starts or ends.
export function createHomeEditor({ home, pager, host, settings, apps, onRemoveWidget, onAddWidgetRequest, onChange }) {
  const lifetime = new AbortController();
  const compact = matchMedia(COMPACT);
  const spanOf = (id) => SPANS[apps.find((a) => a.id === id).widgetSize];
  const dragLayer = el('div', { class: 'home__drag-layer', 'aria-hidden': 'true' });
  const editBar = el(
    'div',
    { class: 'edit-bar', role: 'toolbar', 'aria-label': 'Editing the home screen' },
    el('button', { class: 'edit-bar__button', type: 'button', html: `${icons.plus}<span>Add widget</span>`, onclick: () => onAddWidgetRequest() }),
    el('button', { class: 'edit-bar__button edit-bar__button--done', type: 'button', text: 'Done', onclick: () => exit() }),
  );
  editBar.hidden = true;
  home.append(dragLayer);
  home.parentElement.append(editBar);

  let editing = false;
  let drag = null;
  let whileEditing = null;

  // Edit controls inside each widget

  function toolsFor(node) {
    const id = node.dataset.widget;
    const name = apps.find((a) => a.id === id)?.name ?? 'widget';
    const tools = el(
      'div',
      { class: 'widget__edit' },
      el('button', {
        class: 'widget__edit-button widget__edit-button--remove',
        type: 'button',
        'aria-label': `Remove ${name}`,
        html: icons.minus,
        onclick: () => onRemoveWidget(id),
      }),
      // Phones have no drag: these move a widget up or down the single column.
      el('button', { class: 'widget__edit-button widget__edit-button--step', type: 'button', 'aria-label': `Move ${name} up`, html: icons.arrowUp, onclick: () => step(id, -1) }),
      el('button', { class: 'widget__edit-button widget__edit-button--step', type: 'button', 'aria-label': `Move ${name} down`, html: icons.arrowDown, onclick: () => step(id, 1) }),
    );
    return tools;
  }

  function decorate() {
    home.querySelectorAll('.home-page > .widget').forEach((node) => {
      if (!node.querySelector(':scope > .widget__edit')) node.append(toolsFor(node));
    });
  }

  function undecorate() {
    home.querySelectorAll('.widget__edit').forEach((tools) => tools.remove());
  }

  // Moves a widget one place along the flattened (phone) order.
  function step(id, direction) {
    const flat = settings.getWidgets();
    const index = flat.indexOf(id);
    const neighbour = flat[index + direction];
    if (!neighbour) return;
    const pages = settings.getPages();
    const page = pages.findIndex((ids) => ids.includes(neighbour));
    const at = pages[page].indexOf(neighbour);
    const without = removeWidget(pages, id).pages;
    const target = { page, index: direction < 0 ? at : without[page].indexOf(neighbour) + 1 };
    animateLayout(home, () => settings.moveWidget(id, target), { selector: WIDGETS_SELECTOR });
  }

  // Entering and leaving

  function enter() {
    if (editing) return;
    editing = true;
    home.classList.add('home--editing');
    editBar.hidden = false;
    decorate();
    haptic();
    whileEditing = new AbortController();
    addEventListener('keydown', (event) => event.key === 'Escape' && exit(), { signal: whileEditing.signal });
    onChange?.(true);
  }

  function exit() {
    if (!editing) return;
    cancelDrag();
    editing = false;
    whileEditing.abort();
    home.classList.remove('home--editing');
    editBar.hidden = true;
    undecorate();
    onChange?.(false);
  }

  // Dragging

  function rectsOnPage(page) {
    const pageEl = pager.pages()[page];
    if (!pageEl) return { others: [], hole: null };
    const slot = pageEl.querySelector(':scope > .home-slot');
    const others = [...pageEl.querySelectorAll(':scope > .widget')].map((node) => node.getBoundingClientRect());
    return { others, hole: slot?.getBoundingClientRect() ?? null };
  }

  function preview(target) {
    drag.target = target;
    const pages = paginate(insertWidget(drag.base, drag.id, target), spanOf).pages;
    animateLayout(home, () => host.render(pages, { ghost: { id: drag.id, element: drag.slot } }), { selector: WIDGETS_SELECTOR });
    decorate();
    drag.rects = rectsOnPage(pager.current);
    drag.lockedUntil = performance.now() + REFLOW_LOCK_MS;
  }

  function evaluate(point) {
    if (performance.now() < drag.lockedUntil) return;
    const { others, hole } = drag.rects;
    const index = dropIndex(others, point, { hole });
    if (index === null) return;
    const target = { page: pager.current, index };
    if (target.page !== drag.target.page || target.index !== drag.target.index) preview(target);
  }

  function edgeDirection(point) {
    const box = home.querySelector('.pager').getBoundingClientRect();
    const edge = EDGE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
    if (point.x < box.left + edge) return -1;
    if (point.x > box.right - edge) return 1;
    return 0;
  }

  function flipPage(direction) {
    const next = pager.current + direction;
    if (next < 0) return;
    const pages = paginate(insertWidget(drag.base, drag.id, drag.target), spanOf).pages;
    if (next >= pages.length) {
      // Past the last page: open a new, empty page to drop onto (unless the
      // widget is already alone on the last page, which would just be the same).
      const aloneOnLast = drag.target.page === pages.length - 1 && pages[pages.length - 1].length === 1;
      if (aloneOnLast) return;
      preview({ page: pages.length, index: 0 });
      pager.goTo(next);
    } else {
      pager.goTo(next);
      // Until the pointer says otherwise, the widget joins the end of the new page.
      preview({ page: next, index: rectsOnPage(next).others.length });
    }
    drag.rects = rectsOnPage(pager.current);
  }

  function updateEdge(point) {
    const direction = edgeDirection(point);
    if (direction === drag.edge) return;
    drag.edge = direction;
    clearTimeout(drag.edgeTimer);
    if (!direction) return;
    const dwell = (delay) => {
      drag.edgeTimer = setTimeout(() => {
        flipPage(direction);
        dwell(EDGE_REPEAT_MS);
      }, delay);
    };
    dwell(EDGE_DWELL_MS);
  }

  function startDrag({ widget, pointerId, x, y }) {
    if (!editing) enter();
    if (compact.matches || drag) return;
    const id = widget.dataset.widget;
    const pages = settings.getPages();
    const { pages: base, from } = removeWidget(pages, id);
    if (!from) return;
    const homeBox = home.getBoundingClientRect();
    const box = widget.getBoundingClientRect();
    const slot = el('div', { class: 'home-slot', dataset: { key: id } });
    slot.style.gridArea = widget.style.gridArea;
    widget.replaceWith(slot);
    Object.assign(widget.style, {
      left: `${box.left - homeBox.left}px`,
      top: `${box.top - homeBox.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      gridArea: 'auto',
    });
    widget.classList.add('widget--lifted');
    dragLayer.append(widget);
    pager.setLocked(true);
    haptic();

    const listeners = new AbortController();
    drag = {
      id,
      node: widget,
      slot,
      base,
      target: from,
      start: { x, y },
      last: { x, y },
      rects: rectsOnPage(pager.current),
      lockedUntil: 0,
      edge: 0,
      edgeTimer: null,
      frame: 0,
      pointerId,
      listeners,
    };
    const move = (event) => {
      if (event.pointerId !== pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!drag.frame) {
        drag.frame = requestAnimationFrame(() => {
          if (!drag) return;
          drag.frame = 0;
          widget.style.transform = `translate3d(${point.x - drag.start.x}px, ${point.y - drag.start.y}px, 0) scale(1.03)`;
        });
      }
      updateEdge(point);
      if (Math.hypot(point.x - drag.last.x, point.y - drag.last.y) < REEVALUATE_PX) return;
      drag.last = point;
      evaluate(point);
    };
    const opts = { signal: listeners.signal };
    addEventListener('pointermove', move, opts);
    addEventListener('pointerup', (event) => event.pointerId === pointerId && drop(), opts);
    addEventListener('pointercancel', (event) => event.pointerId === pointerId && drop(), opts);
  }

  // Puts the floating widget back into the grid (where its slot is) and animates it there.
  function land() {
    const { node, slot } = drag;
    const floating = node.getBoundingClientRect();
    node.classList.remove('widget--lifted');
    node.style.removeProperty('left');
    node.style.removeProperty('top');
    node.style.removeProperty('width');
    node.style.removeProperty('height');
    node.style.removeProperty('transform');
    node.style.gridArea = slot.style.gridArea;
    slot.replaceWith(node);
    const settled = node.getBoundingClientRect();
    node.animate(
      [{ transform: `translate(${floating.left - settled.left}px, ${floating.top - settled.top}px)` }, { transform: 'none' }],
      { duration: SETTLE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }

  function finishDrag() {
    clearTimeout(drag.edgeTimer);
    cancelAnimationFrame(drag.frame);
    drag.listeners.abort();
    pager.setLocked(false);
  }

  function drop() {
    if (!drag) return;
    const { id, target } = drag;
    finishDrag();
    land();
    drag = null;
    settings.moveWidget(id, target);
    decorate();
  }

  function cancelDrag() {
    if (!drag) return;
    finishDrag();
    land();
    drag = null;
    host.render(settings.getPages());
  }

  compact.addEventListener('change', () => cancelDrag(), { signal: lifetime.signal });

  return {
    get editing() {
      return editing;
    },
    enter,
    exit,
    startDrag,
    // New widgets (added while editing) need their edit controls too.
    refresh() {
      if (editing) decorate();
    },
    destroy() {
      exit();
      lifetime.abort();
      dragLayer.remove();
      editBar.remove();
    },
  };
}
