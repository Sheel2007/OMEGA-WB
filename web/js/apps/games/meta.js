export const id = 'games';
export const name = 'Games';
export const description = 'Four in a Row, Reversi, Dots and Boxes, Blackjack';
// The size it starts at, and every size it can be resized to in edit mode
// (small, medium, large; see SIZES in widget-layout.js). It must look right in each.
export const widgetSize = 'small';
export const widgetSizes = ['small', 'medium', 'large'];
export const iconBackground = 'var(--icon-games)';
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <rect x="12" y="12" width="40" height="40" rx="6" fill="#fff"/>
  <circle cx="24" cy="24" r="7" fill="#e5483a"/>
  <circle cx="40" cy="24" r="7" fill="#f2c230"/>
  <circle cx="24" cy="40" r="7" fill="#f2c230"/>
  <circle cx="40" cy="40" r="7" fill="#e5483a"/>
</svg>`;
