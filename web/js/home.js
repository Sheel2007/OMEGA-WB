// Home-screen widgets: puts each chosen widget on its page at its place and size
// (placements from widget-layout.js), moves widgets between pages without
// rebuilding them, and fully tears down the ones that were removed.
import { el, reducedMotion } from './ui.js';
import { SIZES, widgetOrder } from './widget-layout.js';

const APPEAR_MS = 280;

export function gridArea({ col, row, w, h }) {
  return `${row} / ${col} / span ${h} / span ${w}`;
}

// getLayout() is the grid for the current theme (LAYOUTS in widget-layout.js);
// onRender() is called once widgets are where they'll be shown.
// getDocked() is the widgets shown beside the clock instead of on the grid.
export function createWidgetHost({ track, apps, context, pager, getLayout, getDocked = () => [], onRender }) {
  const mounted = new Map();
  const firstPage = track.firstElementChild;
  const clock = firstPage.querySelector('.clock');
  let firstRender = true;

  function pageElement(index) {
    while (track.children.length <= index) {
      track.append(el('section', { class: 'home-page', 'aria-label': `Page ${track.children.length + 1}` }));
    }
    return track.children[index];
  }

  function widgetFor(id) {
    let widget = mounted.get(id);
    if (!widget) {
      const app = apps.find((a) => a.id === id);
      widget = app.createWidget(context);
      widget.node.classList.add('widget');
      widget.node.dataset.widget = id;
      widget.node.dataset.key = id;
      widget.isNew = true;
      mounted.set(id, widget);
    }
    return widget;
  }

  // Each widget says how big it is with widget--mini, widget--small, widget--medium or widget--large.
  function setSize(node, size) {
    for (const other of SIZES) node.classList.toggle(`widget--${other}`, other === size);
    node.dataset.size = size;
  }

  // pages: lists of placements { id, size, col, row }, as SettingsService keeps them.
  // ghost: { id, element } puts `element` (the drop placeholder) where widget `id`
  // would go, while the widget itself is being dragged around.
  function render(pages, { ghost = null } = {}) {
    const layout = getLayout();
    // A grid with no one-column strip (Glass) stands a strip widget at the end of
    // the clock's slot instead. There's room for one.
    const docked = layout.strip ? getDocked().slice(0, 1) : [];
    const wanted = new Set([...widgetOrder(pages), ...docked]);
    for (const [id, widget] of mounted) {
      if (wanted.has(id)) continue;
      widget.destroy();
      widget.node.remove();
      mounted.delete(id);
    }

    track.style.setProperty('--grid-cols', layout.grid.cols);
    track.style.setProperty('--grid-rows', layout.grid.rows);
    clock.style.gridArea = gridArea(layout.clock);
    const added = [];
    // The stylesheet makes room: the time comes down a size, and the widget is a strip.
    firstPage.classList.toggle('home-page--docked', docked.length > 0);
    let afterClock = clock;
    for (const id of docked) {
      const widget = widgetFor(id);
      widget.node.style.gridArea = gridArea({ ...layout.strip, w: 1, h: 1 });
      setSize(widget.node, 'mini');
      widget.node.classList.add('widget--docked');
      if (afterClock.nextSibling !== widget.node) firstPage.insertBefore(widget.node, afterClock.nextSibling);
      afterClock = widget.node;
      if (widget.isNew) {
        widget.isNew = false;
        added.push(widget.node);
      }
    }
    pages.forEach((items, p) => {
      const pageEl = pageElement(p);
      let previous = p === 0 ? afterClock : null;
      for (const { id, size, col, row } of items) {
        const widget = widgetFor(id);
        const node = ghost?.id === id ? ghost.element : widget.node;
        node.style.gridArea = gridArea({ col, row, ...layout.spans[size] });
        setSize(widget.node, size);
        widget.node.classList.remove('widget--docked');
        const expected = previous ? previous.nextSibling : pageEl.firstChild;
        if (expected !== node) pageEl.insertBefore(node, expected);
        previous = node;
        if (widget.isNew) {
          widget.isNew = false;
          added.push(widget.node);
        }
      }
    });
    while (track.children.length > Math.max(1, pages.length)) track.lastElementChild.remove();
    pager.setCount(pages.length);
    onRender?.();

    if (!firstRender && !reducedMotion.matches) {
      added.forEach((node) =>
        node.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], {
          duration: APPEAR_MS,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        }),
      );
    }
    firstRender = false;
  }

  return {
    render,
    nodeOf: (id) => mounted.get(id)?.node ?? null,
    destroy() {
      mounted.forEach((widget) => widget.destroy());
      mounted.clear();
    },
  };
}
