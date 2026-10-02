// Home-screen widgets: mounts the ones this screen has chosen (biggest first, see
// widget-layout.js) and fully tears down the ones that were removed.
import { reducedMotion } from './ui.js';
import { layoutOrder } from './widget-layout.js';

const APPEAR_MS = 280;

export function createWidgetHost({ container, apps, context }) {
  const mounted = new Map();
  let firstRender = true;

  function render(ids) {
    for (const [id, widget] of mounted) {
      if (ids.includes(id)) continue;
      widget.destroy();
      widget.node.remove();
      mounted.delete(id);
    }

    const added = [];
    const nodes = layoutOrder(ids, apps)
      .map((id) => {
        const app = apps.find((a) => a.id === id);
        if (!app?.createWidget) return null;
        let widget = mounted.get(id);
        if (!widget) {
          widget = app.createWidget(context);
          widget.node.classList.add('widget', `widget--${app.widgetSize}`);
          widget.node.dataset.widget = id;
          mounted.set(id, widget);
          added.push(widget.node);
        }
        return widget.node;
      })
      .filter(Boolean);

    nodes.forEach((node, i) => {
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
    });

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
    destroy() {
      mounted.forEach((widget) => widget.destroy());
      mounted.clear();
      container.replaceChildren();
    },
  };
}
