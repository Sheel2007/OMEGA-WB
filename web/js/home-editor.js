// Edit mode for the home screen, like an iPhone's: pick a widget up and drag it
// anywhere, push it against the side of the screen to carry it to the next page,
// stretch it from its corner to resize it, remove it with −, add one with +. No
// jiggle animation (it would never stop); editing shows as a dashed outline instead.
//
// While a widget is dragged or stretched it floats in .home__drag-layer and a
// placeholder holds the spot it would drop into: for a drag, the cell under the
// widget's top-left corner (placeWidget); for a stretch, the size closest to how
// far it's been pulled (resizeWidget). The widgets in the way move aside as a live
// preview. Nothing is saved until the finger lifts.
import { animateLayout, el, haptic, icons } from './ui.js';
import { cellFromPoint, findWidget, nearestSize, placeWidget, removeWidget, resizeWidget } from './widget-layout.js';

// A finger this close to the side of the pages, or a widget pushed this far past
// it, carries the widget to the next page after a short pause. The pages peek
// (slide a little) while it waits, so you can see it's about to happen.
const EDGE_REM = 5;
const EDGE_OVERHANG_REM = 2;
const EDGE_DWELL_MS = 450;
const EDGE_REPEAT_MS = 900;
const PEEK_REM = 3;
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
  // Glowing edges with an arrow while a widget is held: the ways it can go.
  const edges = {
    [-1]: el('div', { class: 'pager-edge pager-edge--left', 'aria-hidden': 'true', html: icons.chevronLeft }),
    [1]: el('div', { class: 'pager-edge pager-edge--right', 'aria-hidden': 'true', html: icons.chevronRight }),
  };
  home.querySelector('.pager').append(edges[-1], edges[1]);

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
    // A corner to pull, like an iPhone's. Keyboard users press it to step through
    // the sizes (a keyboard click has detail 0; pointers stretch it instead).
    const handle = el('button', {
      class: 'widget__resize',
      type: 'button',
      onpointerdown: (event) => startResize(node, event),
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
    handle?.setAttribute('aria-label', `Resize ${name} (now ${SIZE_LABELS[size] ?? size}): drag the corner`);
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

  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

  // Can the dragged widget go one page that way? Right of the last page is a new,
  // empty page (unless the widget is already alone on the last page).
  function canGo(direction) {
    const next = pager.current + direction;
    if (next < 0) return false;
    const pages = drag.pages;
    if (next < pages.length) return true;
    const last = pages[pages.length - 1];
    return !(last.length === 1 && last[0].id === drag.item.id);
  }

  // -1, 1 or 0: whether the finger is near a side, or the widget pushed past one.
  function edgeDirection(point) {
    const box = home.querySelector('.pager').getBoundingClientRect();
    const near = EDGE_REM * rem();
    const past = EDGE_OVERHANG_REM * rem();
    const left = point.x - drag.grab.x;
    const right = left + drag.width;
    if (point.x < box.left + near || left < box.left - past) return canGo(-1) ? -1 : 0;
    if (point.x > box.right - near || right > box.right + past) return canGo(1) ? 1 : 0;
    return 0;
  }

  function showEdges(armed = 0) {
    for (const direction of [-1, 1]) {
      edges[direction].classList.toggle('pager-edge--shown', Boolean(drag) && canGo(direction));
      edges[direction].classList.toggle('pager-edge--armed', armed === direction);
    }
  }

  function flipPage(direction) {
    if (!canGo(direction)) return;
    const next = pager.current + direction;
    preview({ ...targetAt(drag.last), page: Math.min(next, drag.pages.length) });
    pager.goTo(next);
    showEdges(drag.edge);
  }

  function updateEdge(point) {
    const direction = edgeDirection(point);
    if (direction === drag.edge) return;
    drag.edge = direction;
    clearTimeout(drag.edgeTimer);
    showEdges(direction);
    pager.peek(direction, PEEK_REM * rem());
    if (!direction) return;
    const dwell = (delay) => {
      drag.edgeTimer = setTimeout(() => {
        flipPage(direction);
        if (drag && canGo(direction)) {
          pager.peek(direction, PEEK_REM * rem());
          dwell(EDGE_REPEAT_MS);
        }
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
    home.classList.add('home--dragging');
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
      width: box.width,
      start: { x, y },
      last: { x, y },
      edge: 0,
      edgeTimer: null,
      frame: 0,
      listeners,
    };
    showEdges();
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

  // Puts a floating widget back into the grid (where its slot is) and animates it
  // there from where (and how big) it was.
  function land({ node, slot }) {
    const floating = node.getBoundingClientRect();
    node.classList.remove('widget--lifted', 'widget--resizing');
    node.style.removeProperty('left');
    node.style.removeProperty('top');
    node.style.removeProperty('width');
    node.style.removeProperty('height');
    node.style.removeProperty('transform');
    node.style.gridArea = slot.style.gridArea;
    slot.replaceWith(node);
    const settled = node.getBoundingClientRect();
    const scale = `scale(${floating.width / settled.width}, ${floating.height / settled.height})`;
    node.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${floating.left - settled.left}px, ${floating.top - settled.top}px) ${scale}` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: SETTLE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }

  function finishDrag() {
    clearTimeout(drag.edgeTimer);
    cancelAnimationFrame(drag.frame);
    drag.listeners.abort();
    pager.setLocked(false);
    pager.peek(0);
    home.classList.remove('home--dragging');
  }

  function drop() {
    if (!drag) return;
    const { item, target } = drag;
    finishDrag();
    land(drag);
    drag = null;
    showEdges();
    settings.moveWidget(item.id, target);
    host.render(settings.getPages());
    decorate();
  }

  function cancelDrag() {
    if (!drag) return;
    finishDrag();
    land(drag);
    drag = null;
    showEdges();
    host.render(settings.getPages());
  }

  // Resizing: pull the corner. The widget stretches with the finger (between its
  // smallest and largest sizes) while its slot shows the size it will snap to,
  // the closest one to how far it's been pulled.

  function startResize(node, event) {
    if (!editing || drag || resize || event.button > 0) return;
    event.preventDefault();
    const id = node.dataset.widget;
    const size = sizeOfWidget(id);
    if (!size) return;
    const pointerId = event.pointerId;
    const layout = settings.getLayout();
    const geometry = pageGeometry();
    const pitch = { x: (geometry.width + geometry.colGap) / geometry.cols, y: (geometry.height + geometry.rowGap) / geometry.rows };
    const sizes = appOf(id).widgetSizes;
    // How big each size is on screen, so the stretch stops at the smallest and largest.
    const px = (s) => ({ w: layout.spans[s].w * pitch.x - geometry.colGap, h: layout.spans[s].h * pitch.y - geometry.rowGap });
    const bounds = {
      minW: Math.min(...sizes.map((s) => px(s).w)),
      maxW: Math.max(...sizes.map((s) => px(s).w)),
      minH: Math.min(...sizes.map((s) => px(s).h)),
      maxH: Math.max(...sizes.map((s) => px(s).h)),
    };

    const homeBox = home.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const slot = el('div', { class: 'home-slot home-slot--resize', dataset: { key: id } });
    slot.style.gridArea = node.style.gridArea;
    node.replaceWith(slot);
    Object.assign(node.style, {
      left: `${box.left - homeBox.left}px`,
      top: `${box.top - homeBox.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      gridArea: 'auto',
    });
    node.classList.add('widget--lifted', 'widget--resizing');
    dragLayer.append(node);
    pager.setLocked(true);

    const listeners = new AbortController();
    resize = { id, node, slot, from: size, size, box, pitch, geometry, bounds, start: { x: event.clientX, y: event.clientY }, frame: 0, listeners };
    const opts = { signal: listeners.signal };
    // On the window: the handle moves into the drag layer, which ends pointer capture.
    addEventListener('pointermove', (e) => e.pointerId === pointerId && onResizeMove(e), opts);
    addEventListener('pointerup', (e) => e.pointerId === pointerId && endResize(true), opts);
    addEventListener('pointercancel', (e) => e.pointerId === pointerId && endResize(false), opts);
  }

  function onResizeMove(event) {
    const { box, bounds, pitch, geometry, start } = resize;
    const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const width = clampTo(box.width + event.clientX - start.x, bounds.minW, bounds.maxW);
    const height = clampTo(box.height + event.clientY - start.y, bounds.minH, bounds.maxH);
    if (!resize.frame) {
      resize.frame = requestAnimationFrame(() => {
        if (!resize) return;
        resize.frame = 0;
        resize.node.style.width = `${width}px`;
        resize.node.style.height = `${height}px`;
      });
    }
    // The size it would snap to: the one whose cells best match the stretch.
    const want = { w: Math.max(1, Math.round((width + geometry.colGap) / pitch.x)), h: Math.max(1, Math.round((height + geometry.rowGap) / pitch.y)) };
    const layout = settings.getLayout();
    const size = nearestSize(appOf(resize.id).widgetSizes, layout.spans, want, resize.size);
    if (size === resize.size) return;
    resize.size = size;
    haptic();
    show(resizeWidget(settings.getPages(), resize.id, size, layout), { ghost: { id: resize.id, element: resize.slot } });
    labelTools(resize.node);
  }

  function endResize(commit) {
    if (!resize) return;
    const current = resize;
    resize = null;
    cancelAnimationFrame(current.frame);
    current.listeners.abort();
    pager.setLocked(false);
    land(current);
    if (commit && current.size !== current.from) settings.resizeWidget(current.id, current.size);
    else host.render(settings.getPages());
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
