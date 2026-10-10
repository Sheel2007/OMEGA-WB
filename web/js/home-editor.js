// Edit mode for the home screen, like an iPhone's: pick a widget up and drag it
// anywhere (across pages too), resize it from its corner, remove it with −, add
// one with +. No jiggle animation (it would never stop); editing shows as a
// dashed outline instead.
//
// While a widget is dragged it floats in .home__drag-layer and a placeholder holds
// the spot it would drop into: the cell under the widget's top-left corner. The
// widgets it would land on move aside as a live preview (placeWidget). Resizing
// previews the same way (resizeWidget). Nothing is saved until the finger lifts.
import { animateLayout, el, haptic, icons } from './ui.js';
import { cellFromPoint, findWidget, nearestSize, placeWidget, removeWidget, resizeWidget } from './widget-layout.js';

// A pointer this close to the pager's side edge flips to the next page after a pause.
const EDGE_REM = 4;
const EDGE_DWELL_MS = 650;
const EDGE_REPEAT_MS = 1000;
// Movement (px) before a press on the resize handle counts as a drag rather than a tap.
const RESIZE_SLOP = 10;
const SETTLE_MS = 220;
const COMPACT = '(max-width: 900px), (max-height: 560px)';
const WIDGETS_SELECTOR = '.home-page > .widget, .home-page > .home-slot';
const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };

// onChange(editing) is called when edit mode starts or ends.
export function createHomeEditor({ home, pager, host, settings, apps, onRemoveWidget, onAddWidgetRequest, onChange }) {
  const lifetime = new AbortController();
  const compact = matchMedia(COMPACT);
  const appOf = (id) => apps.find((a) => a.id === id);
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
  let resize = null;
  let whileEditing = null;

  // Edit controls inside each widget

  function sizeOfWidget(id) {
    return findWidget(settings.getPages(), id)?.size;
  }

  function nextSize(id, size) {
    const sizes = appOf(id).widgetSizes;
    return sizes[(sizes.indexOf(size) + 1) % sizes.length];
  }

  function toolsFor(node) {
    const id = node.dataset.widget;
    const name = appOf(id)?.name ?? 'widget';
    const remove = el(
      'div',
      { class: 'widget__edit' },
      el('button', {
        class: 'widget__edit-button widget__edit-button--remove',
        type: 'button',
        'aria-label': `Remove ${name}`,
        html: icons.minus,
        onclick: () => onRemoveWidget(id),
      }),
    );
    const handle = el('button', {
      class: 'widget__resize',
      type: 'button',
      html: icons.resize,
      onpointerdown: (event) => startResize(node, event),
      // A keyboard press (detail 0) steps through the sizes; pointers are handled above.
      onclick: (event) => event.detail === 0 && settings.resizeWidget(id, nextSize(id, sizeOfWidget(id))),
    });
    const label = el('span', { class: 'widget__size-label', 'aria-hidden': 'true' });
    return [remove, handle, label];
  }

  function labelTools(node) {
    const id = node.dataset.widget;
    const size = node.dataset.size;
    const handle = node.querySelector(':scope > .widget__resize');
    const name = appOf(id)?.name ?? 'widget';
    handle?.setAttribute('aria-label', `Resize ${name} (now ${SIZE_LABELS[size] ?? size})`);
    const label = node.querySelector(':scope > .widget__size-label');
    if (label) label.textContent = SIZE_LABELS[size] ?? size;
  }

  function decorate() {
    home.querySelectorAll('.home-page > .widget').forEach((node) => {
      if (!node.querySelector(':scope > .widget__edit')) node.append(...toolsFor(node));
      labelTools(node);
    });
  }

  function undecorate() {
    home.querySelectorAll('.widget__edit, .widget__resize, .widget__size-label').forEach((tool) => tool.remove());
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
    cancelResize();
    editing = false;
    whileEditing.abort();
    home.classList.remove('home--editing');
    editBar.hidden = true;
    undecorate();
    onChange?.(false);
  }

  // The grid of the page on screen, measured from the pager (which never moves)
  // rather than the page (which may still be sliding into place).
  function pageGeometry() {
    const box = home.querySelector('.pager').getBoundingClientRect();
    const page = pager.pages()[pager.current] ?? pager.pages()[0];
    const style = getComputedStyle(page);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const { cols, rows } = settings.getLayout().grid;
    return {
      left: box.left + padLeft,
      top: box.top,
      width: box.width - padLeft - padRight,
      height: box.height,
      colGap: parseFloat(style.columnGap) || 0,
      rowGap: parseFloat(style.rowGap) || 0,
      cols,
      rows,
    };
  }

  function show(pages, options) {
    animateLayout(home, () => host.render(pages, options), { selector: WIDGETS_SELECTOR });
    decorate();
  }

  // Dragging

  const sameTarget = (a, b) => a.page === b.page && a.col === b.col && a.row === b.row;

  function preview(target) {
    drag.target = target;
    drag.pages = placeWidget(drag.base, drag.item, target, settings.getLayout());
    show(drag.pages, { ghost: { id: drag.item.id, element: drag.slot } });
  }

  function targetAt(point) {
    const corner = { x: point.x - drag.grab.x, y: point.y - drag.grab.y };
    return { page: pager.current, ...cellFromPoint(corner, pageGeometry()) };
  }

  function evaluate(point) {
    const target = targetAt(point);
    if (!sameTarget(target, drag.target)) preview(target);
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
    // Past the last page opens a new, empty page to drop onto (unless the widget is
    // already alone on the last page, which would just be the same).
    const pages = drag.pages;
    if (next >= pages.length) {
      const last = pages[pages.length - 1];
      if (last.length === 1 && last[0].id === drag.item.id) return;
    }
    const point = drag.last;
    preview({ ...targetAt(point), page: Math.min(next, pages.length) });
    pager.goTo(next);
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
    if (compact.matches || drag || resize) return;
    const id = widget.dataset.widget;
    const { pages: base, from } = removeWidget(settings.getPages(), id);
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
      item: { id, size: from.size },
      node: widget,
      slot,
      base,
      pages: settings.getPages(),
      target: { page: from.page, col: from.col, row: from.row },
      // Where on the widget it was picked up, so its corner follows the finger.
      grab: { x: x - box.left, y: y - box.top },
      start: { x, y },
      last: { x, y },
      edge: 0,
      edgeTimer: null,
      frame: 0,
      listeners,
    };
    const move = (event) => {
      if (event.pointerId !== pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      drag.last = point;
      if (!drag.frame) {
        drag.frame = requestAnimationFrame(() => {
          if (!drag) return;
          drag.frame = 0;
          widget.style.transform = `translate3d(${point.x - drag.start.x}px, ${point.y - drag.start.y}px, 0) scale(1.03)`;
        });
      }
      updateEdge(point);
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
    const { item, target } = drag;
    finishDrag();
    land();
    drag = null;
    settings.moveWidget(item.id, target);
    host.render(settings.getPages());
    decorate();
  }

  function cancelDrag() {
    if (!drag) return;
    finishDrag();
    land();
    drag = null;
    host.render(settings.getPages());
  }

  // Resizing: drag the corner handle to the size you want (it snaps to the nearest
  // size the widget comes in), or tap it to step through the sizes.

  function startResize(node, event) {
    if (!editing || drag || resize || event.button > 0) return;
    event.preventDefault();
    const id = node.dataset.widget;
    const size = sizeOfWidget(id);
    if (!size) return;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    const listeners = new AbortController();
    const box = node.getBoundingClientRect();
    const geometry = pageGeometry();
    resize = {
      id,
      node,
      from: size,
      size,
      corner: { x: box.left, y: box.top },
      pitch: { x: (geometry.width + geometry.colGap) / geometry.cols, y: (geometry.height + geometry.rowGap) / geometry.rows },
      start: { x: event.clientX, y: event.clientY },
      moved: false,
      listeners,
    };
    node.classList.add('widget--resizing');
    pager.setLocked(true);
    const opts = { signal: listeners.signal };
    handle.addEventListener('pointermove', onResizeMove, opts);
    handle.addEventListener('pointerup', () => endResize(true), opts);
    handle.addEventListener('pointercancel', () => endResize(false), opts);
  }

  function onResizeMove(event) {
    const { corner, pitch, start } = resize;
    if (!resize.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < RESIZE_SLOP) return;
    resize.moved = true;
    // How many cells the widget would span if its corner were under the finger.
    const want = {
      w: Math.max(1, Math.round((event.clientX - corner.x) / pitch.x)),
      h: Math.max(1, Math.round((event.clientY - corner.y) / pitch.y)),
    };
    const layout = settings.getLayout();
    const size = nearestSize(appOf(resize.id).widgetSizes, layout.spans, want, resize.size);
    if (size === resize.size) return;
    resize.size = size;
    haptic();
    show(resizeWidget(settings.getPages(), resize.id, size, layout));
  }

  function endResize(commit) {
    if (!resize) return;
    const { id, node, from, size, moved, listeners } = resize;
    listeners.abort();
    node.classList.remove('widget--resizing');
    pager.setLocked(false);
    resize = null;
    const chosen = moved ? size : nextSize(id, from);
    if (commit && chosen !== from) {
      animateLayout(home, () => settings.resizeWidget(id, chosen), { selector: WIDGETS_SELECTOR });
    } else {
      host.render(settings.getPages());
    }
    decorate();
  }

  function cancelResize() {
    endResize(false);
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
