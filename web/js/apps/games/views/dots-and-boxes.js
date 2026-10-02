// Dots and Boxes board: an SVG for dots, lines and boxes, with a big invisible
// button over every line (3rem thick) so lines are easy to hit by touch.
import { el } from '../../../ui.js';
import { BOXES, EDGES, PLAYERS, view } from '../rules/dots-and-boxes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const UNIT = 100;

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function endpoints(edge) {
  const [kind, r, c] = edge.split('-').map((part, i) => (i ? Number(part) : part));
  return kind === 'h' ? [c, r, c + 1, r] : [c, r, c, r + 1];
}

export function createDotsAndBoxesView({ onMove }) {
  const span = BOXES * UNIT;
  const pad = UNIT * 0.15;
  const svg = svgEl('svg', { viewBox: `${-pad} ${-pad} ${span + 2 * pad} ${span + 2 * pad}`, class: 'dots-board__drawing', 'aria-hidden': 'true' });
  const boxLayer = svgEl('g', {});
  const lineLayer = svgEl('g', {});
  const dotLayer = svgEl('g', {});
  svg.append(boxLayer, lineLayer, dotLayer);

  const boxes = {};
  for (let r = 0; r < BOXES; r++) {
    for (let c = 0; c < BOXES; c++) {
      const rect = svgEl('rect', { x: c * UNIT + 6, y: r * UNIT + 6, width: UNIT - 12, height: UNIT - 12, class: 'dots-board__box' });
      const label = svgEl('text', { x: c * UNIT + UNIT / 2, y: r * UNIT + UNIT / 2, class: 'dots-board__initial', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      boxLayer.append(rect, label);
      boxes[`${r}-${c}`] = { rect, label };
    }
  }
  const lines = {};
  const buttons = {};
  const hits = el('div', { class: 'dots-board__hits' });
  for (const edge of EDGES) {
    const [x1, y1, x2, y2] = endpoints(edge);
    lines[edge] = svgEl('line', { x1: x1 * UNIT, y1: y1 * UNIT, x2: x2 * UNIT, y2: y2 * UNIT, class: 'dots-board__line' });
    lineLayer.append(lines[edge]);
    const horizontal = edge.startsWith('h');
    const button = el('button', {
      class: `dots-board__hit dots-board__hit--${horizontal ? 'h' : 'v'}`,
      type: 'button',
      style: `--x: ${(Math.min(x1, x2) / BOXES) * 100}%; --y: ${(Math.min(y1, y2) / BOXES) * 100}%`,
      onclick: () => onMove(edge),
    });
    button.setAttribute('aria-label', `${horizontal ? 'Line across' : 'Line down'} from dot ${y1 + 1},${x1 + 1}`);
    buttons[edge] = button;
    hits.append(button);
  }
  for (let r = 0; r <= BOXES; r++) for (let c = 0; c <= BOXES; c++) dotLayer.append(svgEl('rect', { x: c * UNIT - 7, y: r * UNIT - 7, width: 14, height: 14, class: 'dots-board__dot' }));

  const node = el('div', { class: 'dots-board', role: 'group', 'aria-label': 'Dots and Boxes board' }, svg, el('div', { class: 'dots-board__area' }, hits));

  function render(state, { locked }) {
    const { drawn, boxes: owners, last, over } = view(state);
    for (const edge of EDGES) {
      const player = drawn.get(edge);
      lines[edge].setAttribute('class', `dots-board__line${player ? ` dots-board__line--p${player}` : ''}${edge === last ? ' dots-board__line--last' : ''}`);
      buttons[edge].disabled = Boolean(player) || locked || over;
    }
    for (const [key, { rect, label }] of Object.entries(boxes)) {
      const owner = owners[key];
      rect.setAttribute('class', `dots-board__box${owner ? ` dots-board__box--p${owner}` : ''}`);
      // A letter as well as a colour, so ownership doesn't rely on colour alone.
      label.textContent = owner ? PLAYERS[owner][0] : '';
    }
  }

  return { node, render, destroy() {} };
}
