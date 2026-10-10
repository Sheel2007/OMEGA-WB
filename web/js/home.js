// Home-screen widgets: puts each chosen widget on its page at the grid area
// widget-layout.js worked out, moves widgets between pages without rebuilding
// them, and fully tears down the ones that were removed.
import { el, reducedMotion } from './ui.js';
import { arrange } from './widget-layout.js';

const APPEAR_MS = 280;

export function gridArea({ col, row, w, h }) {
  return `${row} / ${col} / span ${h} / span ${w}`;
}

// getLayout() is the grid for the current theme (LAYOUTS in widget-layout.js);
// onRender() is called once widgets are where they'll be shown.
export function createWidgetHost({ track, apps, context, pager, getLayout, onRender }) {
  const mounted = new Map();
  const firstPage = track.firstElementChild;
  const clock = firstPage.querySelector('.clock');
  const sizeOf = (id) => apps.find((a) => a.id === id).widgetSize;
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
      widget.node.classList.add('widget', `widget--${app.widgetSize}`);
      widget.node.dataset.widget = id;
      widget.node.dataset.key = id;
      widget.isNew = true;
      mounted.set(id, widget);
    }
    return widget;
  }

  // ghost: { id, element } puts `element` (the drop placeholder) where widget `id`
  // would go, while the widget itself is being dragged around.
  function render(pages, { ghost = null } = {}) {
    const wanted = new Set(pages.flat());
    for (const [id, widget] of mounted) {
      if (wanted.has(id)) continue;
      widget.destroy();
      widget.node.remove();
      mounted.delete(id);
    }

    const layout = getLayout();
    const { placements } = arrange(pages, sizeOf, layout);
    track.style.setProperty('--grid-cols', layout.grid.cols);
    track.style.setProperty('--grid-rows', layout.grid.rows);
    clock.style.gridArea = gridArea(layout.clock);
    const added = [];
    pages.forEach((ids, p) => {
      const pageEl = pageElement(p);
      let previous = p === 0 ? clock : null;
      for (const id of ids) {
        const widget = widgetFor(id);
        const node = ghost?.id === id ? ghost.element : widget.node;
        node.style.gridArea = gridArea(placements.get(id));
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
