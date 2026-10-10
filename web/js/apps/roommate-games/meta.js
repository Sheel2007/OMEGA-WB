export const id = 'roommate-games';
export const name = 'Roommate Cup';
export const description = 'Roommate Games: the weekly competition and its scoreboard';
// The size it starts at, and every size it can be resized to in edit mode
// (small, medium, large; see SIZES in widget-layout.js). It must look right in each.
export const widgetSize = 'small';
export const widgetSizes = ['small', 'medium', 'large'];
export const iconBackground = 'var(--icon-roommate-games)';
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M21 17h-5.5a1.5 1.5 0 0 0-1.5 1.5v2.5a9.5 9.5 0 0 0 9 9.5M43 17h5.5a1.5 1.5 0 0 1 1.5 1.5v2.5a9.5 9.5 0 0 1-9 9.5" fill="none" stroke="#ffd54a" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M20 11h24v13a12 12 0 0 1-24 0z" fill="#ffd54a"/>
  <path d="M32 15.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" fill="#d18f00"/>
  <path d="M28.5 35.5h7v7.5h-7z" fill="#ffd54a"/>
  <rect x="21" y="43" width="22" height="7.5" rx="2" fill="#fff"/>
</svg>`;
