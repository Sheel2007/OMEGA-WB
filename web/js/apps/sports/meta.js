export const id = 'sports';
export const name = 'Sports';
export const description = 'Arsenal, Tottenham, Maryland and the Champions League';
// The size it starts at, and every size it can be resized to in edit mode
// (mini, small, medium, large; see SIZES in widget-layout.js). Small is the one
// match that matters most right now; medium adds what's next; large adds a table.
export const widgetSize = 'medium';
export const widgetSizes = ['small', 'medium', 'large'];
export const iconBackground = 'var(--icon-sports)';
// A football: our own drawing.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="22" fill="#fff"/>
  <path d="M32 23.5l8.1 5.9-3.1 9.5H27l-3.1-9.5z" fill="#232838"/>
  <path d="M32 23.5V10.5M40.1 29.4l12.3-4M37 38.9l7.6 10.4M27 38.9l-7.6 10.4M23.9 29.4l-12.3-4" stroke="#232838" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M26.5 11.2l5.5 2.3 5.5-2.3M50 20.5l1.6 6.2-3.3 4.6M47.3 45.4l-5.2 3.6-5.6-.4M16.7 45.4l5.2 3.6 5.6-.4M14 20.5l-1.6 6.2 3.3 4.6" fill="none" stroke="#232838" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
