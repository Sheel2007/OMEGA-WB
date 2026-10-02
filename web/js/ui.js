// Small DOM helpers shared by the home screen and apps.
import { emojiFor } from './groceries.js';

export const icons = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2 8.8-8.9" pathLength="24"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  home:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.2"/></svg>',
  wifi:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 9.2a14 14 0 0 1 19 0"/><path d="M5.9 12.8a9 9 0 0 1 12.2 0"/><path d="M9.2 16.3a4.3 4.3 0 0 1 5.6 0"/><circle cx="12" cy="19.4" r="1.4" fill="currentColor" stroke="none"/></svg>',
  wifiOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 9.2a14 14 0 0 1 6-3.2M14.5 5.9a14 14 0 0 1 7 3.3"/><path d="M5.9 12.8a9 9 0 0 1 4-2.1"/><path d="M9.2 16.3a4.3 4.3 0 0 1 5.6 0"/><circle cx="12" cy="19.4" r="1.4" fill="currentColor" stroke="none"/><path d="M3.5 3.5l17 17"/></svg>',
  backspace:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M8.5 5h11a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5h-11L3 12z"/><path d="M11 9.5l5 5M16 9.5l-5 5"/></svg>',
  shift:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l8 8.5h-4.5v7.5h-7V12H4z"/></svg>',
  hideKeyboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="19" height="12" rx="2"/><path d="M6 7h.01M9.5 7h.01M13 7h.01M16.5 7h.01M7.5 11h9M9 18.5l3 2.5 3-2.5"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
  widgets:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 13.5v7M13.5 17h7" stroke-linecap="round"/></svg>',
  exit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 3h2v4h-2zM11 17h2v4h-2zM3 11h4v2H3zM17 11h4v2h-4zM9 9h6v6H9z"/></svg>',
  undo:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  minus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
  arrowUp:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  arrowDown:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5l6.5 6.5-6.5 6.5"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>',
  note:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 12h36a3 3 0 0 1 3 3v24L39 53H14a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z" fill="currentColor"/><path d="M53 39H42a3 3 0 0 0-3 3v11z" fill="currentColor" fill-opacity=".55"/></svg>',
  calendar:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="19" y="6" width="5" height="11" rx="2.5" fill="currentColor" fill-opacity=".5"/><rect x="40" y="6" width="5" height="11" rx="2.5" fill="currentColor" fill-opacity=".5"/><path d="M11 16h42a3 3 0 0 1 3 3v31a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V19a3 3 0 0 1 3-3z" fill="currentColor" fill-opacity=".4"/><rect x="8" y="26" width="48" height="27" rx="3" fill="currentColor"/></svg>',
  bag:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M31.5 23.5c-.6-6.2-4.4-10.6-10.5-11.5-.5 6.3 3.6 10.9 10.5 11.5z" fill="currentColor" fill-opacity=".55"/><path d="M33 23.5c.2-7.6 5.2-13.2 13-14.2.4 7.9-4.8 13.6-13 14.2z" fill="currentColor" fill-opacity=".8"/><path d="M14.5 25.5h35a2 2 0 0 1 2 2.2l-2.4 23.6a4.5 4.5 0 0 1-4.5 4.1H19.4a4.5 4.5 0 0 1-4.5-4.1L12.5 27.7a2 2 0 0 1 2-2.2z" fill="currentColor"/></svg>',
};

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name === 'html') node.innerHTML = value;
    else if (name === 'style') node.style.cssText = value;
    else if (name === 'dataset') Object.assign(node.dataset, value);
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

// Emoji for known groceries, otherwise a quiet letter tile so rows stay aligned.
export function itemGlyph(name, className) {
  const emoji = emojiFor(name);
  if (emoji) return el('span', { class: `glyph glyph--emoji ${className}`, 'aria-hidden': 'true', text: emoji });
  return el('span', { class: `glyph glyph--letter ${className}`, 'aria-hidden': 'true', text: (name.trim()[0] || '?').toUpperCase() });
}

export function appIcon(app, className = '') {
  return el('span', { class: `app-icon ${className}`.trim(), style: `--icon-bg: ${app.iconBackground}`, html: app.iconGlyph });
}

// Keyed list update: reuses existing nodes so they can animate between positions.
export function reconcile(parent, list, keyOf, create, update) {
  const existing = new Map();
  for (const child of parent.children) existing.set(child.dataset.key, child);
  const nodes = list.map((item) => {
    const key = keyOf(item);
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
    } else {
      node = create(item);
      node.dataset.key = key;
    }
    update(node, item);
    return node;
  });
  existing.forEach((node) => node.remove());
  nodes.forEach((node, i) => {
    if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] || null);
  });
}

// FLIP: measure keyed nodes, change the DOM, then animate each node from where it was.
// `selector` narrows which keyed nodes move (e.g. whole widgets, not the rows inside them).
export function animateLayout(root, mutate, { selector = '[data-key]' } = {}) {
  if (reducedMotion.matches) {
    mutate();
    return;
  }
  const before = new Map();
  root.querySelectorAll(selector).forEach((node) => before.set(node.dataset.key, node.getBoundingClientRect()));
  mutate();
  root.querySelectorAll(selector).forEach((node) => {
    if (node.hidden || node.closest('[hidden]')) return;
    const was = before.get(node.dataset.key);
    if (!was) {
      node.animate(
        [{ opacity: 0, transform: 'translateY(-0.6rem) scale(0.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
      return;
    }
    const now = node.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: 420,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    });
  });
}

// Pairs with reconcile(): never put more than this many rows in the DOM.
export const MAX_ROWS = 100;

// Shows as many of a list's rows as fit its height. The rest are hidden and
// counted in `more` (which takes up space itself, so measure again with it showing).
export function fitRows(list, more, total, describe) {
  const rows = [...list.children];
  const place = () => {
    rows.forEach((row) => (row.hidden = false));
    const limit = list.clientHeight;
    let shown = 0;
    rows.forEach((row, index) => {
      if (shown === index && row.offsetTop + row.offsetHeight <= limit + 1) shown++;
      else row.hidden = true;
    });
    return shown;
  };
  more.hidden = true;
  let shown = place();
  if (shown < total) {
    more.hidden = false;
    shown = place();
    more.textContent = describe(total - shown);
  }
}

export function flash(node) {
  if (!node) return;
  node.classList.remove('is-flashing');
  void node.offsetWidth;
  node.classList.add('is-flashing');
  node.addEventListener('animationend', () => node.classList.remove('is-flashing'), { once: true });
  node.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

export function nudge(node) {
  node.classList.remove('is-nudged');
  void node.offsetWidth;
  node.classList.add('is-nudged');
}

export function haptic() {
  navigator.vibrate?.(8);
}

const TOAST_MS = 5000;

export function toast(message, { action, onAction, duration = TOAST_MS } = {}) {
  const root = document.querySelector('.toasts');
  root.querySelectorAll('.toast').forEach((node) => node.remove());
  const node = el('div', { class: 'toast' }, el('span', { class: 'toast__text', text: message }));
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('toast--leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };
  if (action) {
    node.append(
      el('button', {
        class: 'toast__action',
        type: 'button',
        text: action,
        onclick: () => {
          dismiss();
          onAction?.();
        },
      }),
    );
  }
  root.append(node);
  const timer = setTimeout(dismiss, duration);
  return dismiss;
}
