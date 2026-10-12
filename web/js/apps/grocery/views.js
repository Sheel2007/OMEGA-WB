// Pieces the grocery widget and app both draw: avatars, store tags, prices, icons.
import { el, itemGlyph } from '../../ui.js';
import { avatarColor } from '../roommate-games/format.js';
import { initials, money, pictureUrl, STORE_LABELS } from './format.js';

export const svg = {
  scan:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M7.5 8v8M10.5 8v8M13.5 8v8M16.5 8v8"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5a2 2 0 0 1 2-2h2.2l1.6-2.5h5.4l1.6 2.5h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  torch:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M7 3.5h10v3l-3 4v10h-4v-10l-3-4z"/><path d="M12 13.5v2"/></svg>',
  keyboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M7.5 14.5h9"/></svg>',
  message:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M12 4c4.97 0 9 3.13 9 7s-4.03 7-9 7c-.9 0-1.77-.1-2.6-.3L5 20l1-3.6C4.15 15.1 3 13.15 3 11c0-3.87 4.03-7 9-7z"/></svg>',
  cart:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 12h7.5l6.2 28.5a4 4 0 0 0 3.9 3.2h22.8a4 4 0 0 0 3.9-3.1L56 22H19" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="52" r="4" fill="currentColor"/><circle cx="47" cy="52" r="4" fill="currentColor"/></svg>',
};

// Every item's picture: its photo when there is one, and the illustration (an emoji,
// or its first letter) underneath, which shows if there's no photo or it won't load.
export function picture(product, className = '') {
  const node = el('span', { class: `grocery-pic ${className}`.trim(), 'aria-hidden': 'true' }, itemGlyph(product.name || '?', 'grocery-pic__glyph'));
  const url = pictureUrl(product);
  if (url) {
    const img = el('img', { class: 'grocery-pic__img', src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    img.addEventListener('load', () => node.classList.add('grocery-pic--photo'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    node.append(img);
  }
  return node;
}

// Changes whenever an item's picture would.
export const pictureKey = (product) => `${product.name}|${pictureUrl(product)}`;

export function avatar(name, className = '') {
  return el('span', {
    class: `grocery-avatar grocery-avatar--${avatarColor(name.toLowerCase())} ${className}`.trim(),
    'aria-hidden': 'true',
    text: initials(name),
  });
}

export function storeTag(store, className = '') {
  if (!STORE_LABELS[store]) return null;
  return el('span', { class: `grocery-store grocery-store--${store} ${className}`.trim(), text: STORE_LABELS[store] });
}

// What a row costs: the price times how many, or nothing when there's no price yet.
export function lineCost(item, currency) {
  return item.price == null ? '' : money(item.price * item.qty, currency);
}
